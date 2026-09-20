/**
 * 한 번의 경기(매치)를 총괄한다.
 *
 * - 자동 경기  : 모든 참가자의 경기장을 **같은 스텝으로 동시에** 전진시킨다.
 *                화면에 안 보이는 참가자도 똑같이 계산한다. 렌더링만 축약할 뿐이다.
 * - 직접 조작  : 같은 기기에서 한 명씩 차례로 플레이한다. 모든 참가자가 같은 판·같은
 *                제한 시간·같은 목숨·같은 서브 각도로 시작한다.
 *
 * 시간은 벽시계가 아니라 스텝 수로 센다. 프레임이 밀려도 경기 길이와 결과가 변하지 않는다.
 */

import { STEP_MS } from './config'
import { resolveDifficulty } from './config'
import type {
  BrickPickInput,
  BrickPickProgress,
  BrickPickResult,
  DifficultySettings,
  ItemStat,
  Participant,
  PlayStatus,
} from './contract'
import { ITEM_KINDS } from './contract'
import { AutoPilot } from './autopilot'
import { Arena, NEUTRAL_INPUT } from './engine'
import type { ArenaEvent, ArenaInput } from './engine'
import { InputPlayer, InputRecorder } from './events'
import type { ParticipantInputLog, ReplayLog } from './events'
import { computeRanking } from './ranking'
import type { RankingEntry } from './ranking'
import { selectPresenters } from './selection'
import { ENGINE_VERSION, SCHEMA_VERSION } from './version'
import { hashString } from './rng'

export type MatchPhase =
  | 'idle'
  | 'ready'
  | 'running'
  | 'paused'
  | 'between-players'
  | 'finished'
  | 'cancelled'

export interface ParticipantRun {
  participant: Participant
  arena: Arena | null
  autopilot: AutoPilot | null
  status: 'pending' | 'playing' | 'played' | 'not_played' | 'aborted'
  score: number | null
  livesRemaining: number | null
  bricksDestroyed: number
  playedMs: number
  wavesCleared: number
  /** 벽돌을 처음 전부 깬 시각(ms). 못 깼으면 null. */
  clearedAtMs: number | null
  items: ItemStat[]
  excluded: boolean
  inputLog: ParticipantInputLog | null
}

export interface MatchOptions {
  /** parseBrickPickInput 을 통과한 입력. */
  input: BrickPickInput
  /** 현재 시각(ms). 테스트에서 고정할 수 있게 주입한다. */
  now?: () => number
  /** resultId 생성용 난수. 시뮬레이션에는 쓰이지 않는다. */
  random?: () => number
  /** 경기 이벤트를 모아 둘지 (재현 로그 내보내기용). 기본 false. */
  collectArenaEvents?: boolean
  /** 직접 조작 모드 재현 — 기록된 입력으로 자동 재생한다. */
  replayInputs?: ParticipantInputLog[]
}

const emptyItemStats = (): ItemStat[] =>
  ITEM_KINDS.map((kind) => ({ kind, dropped: 0, collected: 0 }))

export class Match {
  readonly input: BrickPickInput
  readonly settings: DifficultySettings
  readonly runs: ParticipantRun[]
  /** 한 참가자(직접 조작) 또는 매치 전체(자동)의 총 스텝 수. */
  readonly totalSteps: number

  phase: MatchPhase = 'idle'
  /** 직접 조작 모드에서 지금 순서인 참가자 인덱스. */
  currentIndex = 0
  /** 현재 참가자(또는 자동 경기 전체)가 진행한 스텝 수. */
  stepsDone = 0

  private startedAtMs: number | null = null
  private completedAtMs: number | null = null
  private readonly nowFn: () => number
  private readonly randomFn: () => number
  private readonly collectEvents: boolean
  private readonly collectedEvents = new Map<string, ArenaEvent[]>()
  private readonly recorder = new InputRecorder()
  private readonly replayPlayers = new Map<string, InputPlayer>()

  constructor(options: MatchOptions) {
    this.input = options.input
    this.nowFn = options.now ?? (() => Date.now())
    this.randomFn = options.random ?? Math.random
    this.collectEvents = options.collectArenaEvents ?? false
    this.settings = resolveDifficulty(options.input.difficulty, options.input.difficultySettings)
    this.totalSteps = Math.max(1, Math.round(options.input.roundDurationMs / STEP_MS))

    const excluded = new Set(options.input.excludedParticipantIds)
    this.runs = options.input.participants.map((participant) => ({
      participant,
      arena: null,
      autopilot: null,
      status: 'pending',
      score: null,
      livesRemaining: null,
      bricksDestroyed: 0,
      playedMs: 0,
      wavesCleared: 0,
      clearedAtMs: null,
      items: emptyItemStats(),
      excluded: excluded.has(participant.id),
      inputLog: null,
    }))

    for (const log of options.replayInputs ?? []) {
      this.replayPlayers.set(log.participantId, new InputPlayer(log))
    }
  }

  // ── 진행 ──────────────────────────────────────────────────────────────────

  /** 경기를 시작한다. 이 시점 이후로는 설정을 바꿀 수 없다. */
  start(): void {
    if (this.phase !== 'idle' && this.phase !== 'ready') return
    this.startedAtMs = this.nowFn()
    this.stepsDone = 0
    if (this.input.mode === 'auto') {
      for (const run of this.runs) {
        run.arena = this.createArena(run)
        run.autopilot = new AutoPilot(run.arena)
        run.status = 'playing'
      }
      this.phase = 'running'
    } else {
      this.currentIndex = 0
      this.beginParticipant(0)
    }
  }

  private createArena(run: ParticipantRun): Arena {
    const arena = new Arena({
      participantId: run.participant.id,
      nickname: run.participant.nickname,
      index: this.runs.indexOf(run),
      seed: this.input.seed,
      mode: this.input.mode,
      difficulty: this.settings,
    })
    if (this.collectEvents) {
      // 렌더러의 drainEvents() 와 독립적인 출구로 받는다 — 서로 이벤트를 빼앗지 않는다.
      const id = run.participant.id
      arena.eventSink = (event) => {
        const list = this.collectedEvents.get(id)
        if (list) list.push(event)
        else this.collectedEvents.set(id, [event])
      }
    }
    return arena
  }

  /** 직접 조작 모드 — 특정 참가자의 차례를 시작한다. */
  beginParticipant(index: number): void {
    if (index >= this.runs.length) {
      this.finishMatch()
      return
    }
    this.currentIndex = index
    const run = this.runs[index]
    run.arena = this.createArena(run)
    run.status = 'playing'
    this.stepsDone = 0
    this.recorder.reset()
    this.replayPlayers.get(run.participant.id)?.reset()
    this.phase = 'running'
  }

  /** "다 깰 때까지" 방식인가. roundDurationMs 는 이때 최대 시간으로 쓰인다. */
  get untilCleared(): boolean {
    return this.input.roundMode === 'until-cleared'
  }

  get currentRun(): ParticipantRun | null {
    if (this.input.mode === 'auto') return null
    return this.runs[this.currentIndex] ?? null
  }

  /**
   * 정확히 한 스텝(1/120초) 전진한다.
   * 자동 경기는 모든 경기장을, 직접 조작은 현재 참가자의 경기장만 전진시킨다.
   */
  step(input: ArenaInput = NEUTRAL_INPUT): void {
    if (this.phase !== 'running') return
    this.stepsDone += 1

    if (this.input.mode === 'auto') {
      for (const run of this.runs) {
        const arena = run.arena
        if (!arena) continue
        const pilotInput = run.autopilot ? run.autopilot.decide() : NEUTRAL_INPUT
        arena.step(pilotInput)
      }
      // "다 깰 때까지" — 누군가 벽돌을 전부 깨는 순간 전체 경기가 끝난다(경주).
      const someoneCleared =
        this.untilCleared && this.runs.some((r) => r.arena?.firstClearAt != null)
      if (someoneCleared || this.stepsDone >= this.totalSteps) {
        for (const run of this.runs) this.completeRun(run, 'played')
        this.finishMatch()
      }
      return
    }

    const run = this.currentRun
    const arena = run?.arena
    if (!run || !arena) return
    const replay = this.replayPlayers.get(run.participant.id)
    const actual = replay ? replay.at(this.stepsDone) : input
    this.recorder.record(this.stepsDone, actual)
    arena.step(actual)

    // 제한 시간이 끝났거나, 목숨을 모두 잃었거나,
    // "다 깰 때까지" 방식에서 벽돌을 전부 깼으면 그 참가자의 차례가 끝난다.
    const cleared = this.untilCleared && arena.firstClearAt != null
    if (cleared || this.stepsDone >= this.totalSteps || arena.gameOver) {
      this.completeRun(run, 'played')
      this.advanceToNextParticipant()
    }
  }

  private completeRun(run: ParticipantRun, status: 'played' | 'aborted'): void {
    const arena = run.arena
    if (!arena) return
    run.status = status
    run.score = arena.score
    run.livesRemaining = arena.lives
    run.bricksDestroyed = arena.bricksDestroyed
    run.wavesCleared = arena.wavesCleared
    run.clearedAtMs = arena.firstClearAt === null ? null : Math.round(arena.firstClearAt)
    // 다 깨고 끝났으면 그때까지가 실제 플레이 시간이다.
    run.playedMs = Math.round(
      (this.untilCleared ? arena.firstClearAt : null) ?? arena.gameOverAt ?? arena.simTimeMs,
    )
    // 한 번도 나오지 않은 아이템은 빼서 결과 JSON 이 불필요하게 커지지 않게 한다.
    run.items = ITEM_KINDS.map((kind) => ({
      kind,
      dropped: arena.itemStats[kind].dropped,
      collected: arena.itemStats[kind].collected,
    })).filter((i) => i.dropped > 0 || i.collected > 0)
    if (this.input.mode === 'manual') {
      run.inputLog = this.recorder.toLog(run.participant.id)
    }
    arena.finish()
  }

  private advanceToNextParticipant(): void {
    const next = this.currentIndex + 1
    if (next >= this.runs.length) {
      this.finishMatch()
      return
    }
    this.currentIndex = next
    this.phase = 'between-players'
  }

  /** 직접 조작 모드 — 다음 참가자의 차례를 시작한다 (준비 화면에서 "시작" 을 눌렀을 때). */
  continueToNext(): void {
    if (this.phase !== 'between-players') return
    this.beginParticipant(this.currentIndex)
  }

  /** 현재 참가자를 건너뛴다 — 0점이 아니라 "미플레이" 로 남는다. */
  skipCurrent(): void {
    if (this.input.mode !== 'manual') return
    const run = this.currentRun
    if (!run) return
    run.status = 'not_played'
    run.score = null
    run.livesRemaining = null
    run.playedMs = 0
    run.clearedAtMs = null
    run.arena?.finish()
    run.arena = null
    this.advanceToNextParticipant()
  }

  /** 현재 참가자가 도중에 그만둔다 — 그때까지의 점수는 남지만 후보에서는 빠진다. */
  abortCurrent(): void {
    if (this.input.mode !== 'manual') return
    const run = this.currentRun
    if (!run || !run.arena) return
    this.completeRun(run, 'aborted')
    this.advanceToNextParticipant()
  }

  /** 일시정지 — 공·아이템 낙하·효과 지속 시간·제한 시간이 모두 함께 멈춘다. */
  pause(): void {
    if (this.phase === 'running') this.phase = 'paused'
  }

  resume(): void {
    if (this.phase === 'paused') this.phase = 'running'
  }

  /** 경기 취소 — 완료 결과를 만들지 않는다. */
  cancel(): void {
    for (const run of this.runs) {
      run.arena?.finish()
    }
    this.phase = 'cancelled'
  }

  private finishMatch(): void {
    this.completedAtMs = this.nowFn()
    for (const run of this.runs) {
      if (run.status === 'pending') run.status = 'not_played'
    }
    this.phase = 'finished'
  }

  get isFinished(): boolean {
    return this.phase === 'finished'
  }

  // ── 진행 상황 ─────────────────────────────────────────────────────────────

  progress(): BrickPickProgress {
    const elapsedMs = this.stepsDone * STEP_MS
    const totalMs = this.totalSteps * STEP_MS
    const remainingMs = Math.max(0, totalMs - elapsedMs)
    const completedCount =
      this.input.mode === 'auto'
        ? this.phase === 'finished'
          ? this.runs.length
          : 0
        : this.runs.filter((r) => r.status !== 'pending' && r.status !== 'playing').length

    const phase: BrickPickProgress['phase'] =
      this.phase === 'finished'
        ? 'finished'
        : this.phase === 'paused'
          ? 'paused'
          : this.phase === 'between-players'
            ? 'between-players'
            : this.phase === 'running'
              ? 'running'
              : 'preparing'

    return {
      schemaVersion: SCHEMA_VERSION,
      sessionId: this.input.sessionId,
      phase,
      remainingMs,
      elapsedMs,
      progress: totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0,
      currentParticipantId:
        this.input.mode === 'manual' ? (this.currentRun?.participant.id ?? null) : null,
      completedCount,
      totalCount: this.runs.length,
      leaderboard: this.leaderboard(),
    }
  }

  /** 실시간 순위표 — 점수 내림차순. 화면 표시용이며 최종 순위와 별개다. */
  leaderboard(): BrickPickProgress['leaderboard'] {
    const rows = this.runs.map((run) => ({
      id: run.participant.id,
      nickname: run.participant.nickname,
      score: run.arena ? run.arena.score : (run.score ?? 0),
      livesRemaining: run.arena ? run.arena.lives : (run.livesRemaining ?? 0),
    }))
    rows.sort((a, b) => b.score - a.score || b.livesRemaining - a.livesRemaining)
    return rows
  }

  // ── 결과 ──────────────────────────────────────────────────────────────────

  /** 최종 결과를 만든다. phase 가 finished 일 때만 의미가 있다. */
  buildResult(): BrickPickResult {
    const startedAtMs = this.startedAtMs ?? this.nowFn()
    const completedAtMs = this.completedAtMs ?? this.nowFn()

    const entries: RankingEntry[] = this.runs.map((run) => {
      const playStatus: PlayStatus =
        run.status === 'played'
          ? 'played'
          : run.status === 'aborted'
            ? 'aborted'
            : 'not_played'
      return {
        id: run.participant.id,
        nickname: run.participant.nickname,
        score: playStatus === 'not_played' ? null : (run.score ?? 0),
        livesRemaining: playStatus === 'not_played' ? null : (run.livesRemaining ?? 0),
        playStatus,
        excluded: run.excluded,
        bricksDestroyed: run.bricksDestroyed,
        playedMs: run.playedMs,
        wavesCleared: run.wavesCleared,
        clearedAtMs: playStatus === 'not_played' ? null : run.clearedAtMs,
        items: run.items,
      }
    })

    const participants = computeRanking(entries, {
      seed: this.input.seed,
      // "다 깰 때까지" 는 다 깬 사람이 전부 같은 점수가 되므로 깬 시각으로 가른다.
      rankBy: this.untilCleared ? 'clear-time' : 'score',
    })
    const selection = selectPresenters(participants, this.input.selectionRule)

    return {
      schemaVersion: SCHEMA_VERSION,
      sessionId: this.input.sessionId,
      resultId: createResultId(this.input.sessionId, startedAtMs, this.randomFn),
      engineVersion: ENGINE_VERSION,
      seed: this.input.seed,
      appliedSettings: {
        mode: this.input.mode,
        difficulty: this.input.difficulty,
        difficultySettings: this.settings,
        roundDurationMs: this.input.roundDurationMs,
        roundMode: this.input.roundMode,
        selectionRule: this.input.selectionRule,
        excludedParticipantIds: [...this.input.excludedParticipantIds],
      },
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
      participants,
      selectedParticipantIds: selection.selectedParticipantIds,
      selectionReasons: selection.selectionReasons,
      // 경기 중 건너뛰기·중도 취소로 후보가 줄어 규칙을 다 못 채웠으면 여기에 이유가 담긴다.
      selectionIssue: selection.issue,
      status: 'completed',
      run: {
        kind: this.input.replayOf ? 'replay' : 'live',
        replayOf: this.input.replayOf ?? null,
      },
      eligibleCount: selection.eligibleCount,
    }
  }

  /** 재현용 로그를 꺼낸다. */
  exportReplayLog(): ReplayLog {
    return {
      schemaVersion: SCHEMA_VERSION,
      sessionId: this.input.sessionId,
      seed: this.input.seed,
      mode: this.input.mode,
      roundDurationMs: this.input.roundDurationMs,
      stepMs: STEP_MS,
      inputs: this.runs.map((r) => r.inputLog).filter((l): l is ParticipantInputLog => l !== null),
      ...(this.collectEvents
        ? {
            arenaEvents: [...this.collectedEvents.entries()].map(([participantId, events]) => ({
              participantId,
              events,
            })),
          }
        : {}),
    }
  }

  /** 취소·종료 시 모든 객체를 정리한다. */
  destroy(): void {
    for (const run of this.runs) {
      run.arena?.finish()
      run.arena = null
      run.autopilot?.reset()
      run.autopilot = null
    }
    this.collectedEvents.clear()
    this.replayPlayers.clear()
  }
}

/** 결과 한 건의 고유 ID. 호스트는 이 값으로 중복 반영을 막는다. */
export function createResultId(
  sessionId: string,
  startedAtMs: number,
  random: () => number,
): string {
  const base = hashString(`${sessionId}:${startedAtMs}`).toString(36)
  const suffix = Math.floor(random() * 0xffffff)
    .toString(36)
    .padStart(4, '0')
  return `bpr_${base}_${suffix}`
}
