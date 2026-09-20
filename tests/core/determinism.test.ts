/**
 * 재현성 시험.
 *
 * 이 게임은 "게임으로 진행하는 추첨"이므로 두 가지를 동시에 증명해야 한다.
 *  1. 같은 seed·같은 설정이면 몇 번을 돌려도 결과가 똑같다 (재현).
 *  2. 참가자 명단의 **순서**가 결과에 전혀 영향을 주지 않는다 (공정).
 *
 * 시간에 의존하지 않도록 Match 에 now/random 을 주입한다.
 */

import { describe, expect, it } from 'vitest'
import {
  ITEM_KINDS,
  Match,
  NEUTRAL_INPUT,
  createRng,
  matchSeedFor,
  parseBrickPickInput,
  participantSeed,
} from '../../src/core'
import type {
  ArenaInput,
  BrickPickInput,
  BrickPickResult,
  ItemKind,
  Participant,
  ParticipantInputLog,
} from '../../src/core'

// ────────────────────────────────────────────────────────────────────────────
// 시험 장치
// ────────────────────────────────────────────────────────────────────────────

const people = (n: number, tag = 'u'): Participant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${tag}${i + 1}`, nickname: `학생${i + 1}` }))

function makeInput(
  over: Partial<BrickPickInput> & { participants: Participant[] },
): BrickPickInput {
  const parsed = parseBrickPickInput({
    schemaVersion: '1.0',
    sessionId: 'determinism',
    mode: 'auto',
    difficulty: 'normal',
    roundDurationMs: 30_000,
    selectionRule: { kind: 'top', count: 1 },
    excludedParticipantIds: [],
    seed: 'DET-SEED',
    locale: 'ko',
    soundEnabled: false,
    reducedMotion: false,
    ...over,
  })
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

function newMatch(input: BrickPickInput, replayInputs?: ParticipantInputLog[]): Match {
  return new Match({
    input,
    now: () => 1,
    random: () => 0.5,
    ...(replayInputs ? { replayInputs } : {}),
  })
}

/** 자동 경기를 끝까지 돌린다. */
function runAuto(input: BrickPickInput): Match {
  const match = newMatch(input)
  match.start()
  let guard = 0
  while (!match.isFinished && guard < 1_000_000) {
    match.step()
    guard += 1
  }
  expect(match.isFinished).toBe(true)
  return match
}

/** 직접 조작 경기를 각 참가자별 입력 대본으로 끝까지 돌린다. */
function runManual(match: Match, scripts: ArenaInput[][]): Match {
  match.start()
  let guard = 0
  while (!match.isFinished && guard < 1_000_000) {
    guard += 1
    if (match.phase === 'between-players') {
      match.continueToNext()
      continue
    }
    if (match.phase !== 'running') break
    const input = scripts[match.currentIndex]?.[match.stepsDone] ?? NEUTRAL_INPUT
    match.step(input)
  }
  expect(match.isFinished).toBe(true)
  return match
}

interface Snap {
  id: string
  score: number | null
  rank: number
  eligibleRank: number | null
  bricksDestroyed: number
  items: string
}

function snapshot(result: BrickPickResult): Snap[] {
  return result.participants.map((p) => ({
    id: p.id,
    score: p.score,
    rank: p.rank,
    eligibleRank: p.eligibleRank,
    bricksDestroyed: p.bricksDestroyed,
    items: p.items.map((i) => `${i.kind}:${i.dropped}/${i.collected}`).join(','),
  }))
}

/** id → 점수. 순서가 달라도 비교할 수 있게 사전으로 만든다. */
const scoreById = (result: BrickPickResult): Record<string, number | null> =>
  Object.fromEntries(result.participants.map((p) => [p.id, p.score]))

const rankById = (result: BrickPickResult): Record<string, number> =>
  Object.fromEntries(result.participants.map((p) => [p.id, p.rank]))

/** 테스트 전용 결정적 난수(LCG). 엔진의 난수와 완전히 분리돼 있다. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 참가자마다 다르지만 완전히 결정적인 입력열. */
function scriptFor(participantIndex: number, steps: number): ArenaInput[] {
  const rnd = lcg(0xbeef + participantIndex * 7919)
  const out: ArenaInput[] = []
  let direction: -1 | 0 | 1 = 0
  let fireHeld = false
  for (let step = 1; step <= steps; step += 1) {
    // 사람처럼 한 번 누르면 잠시 유지한다 (매 스텝 바꾸면 기록이 비현실적으로 커진다).
    if (step % 24 === 1) {
      const r = rnd()
      direction = r < 0.4 ? -1 : r < 0.8 ? 1 : 0
      fireHeld = rnd() < 0.35
    }
    out.push({ pointerX: null, direction, firePressed: rnd() < 0.01, fireHeld })
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────

describe('같은 seed → 같은 결과', () => {
  const seeds = ['SEED-1', 'SEED-2', 'KX7M2PQR4T', '가나다', '00000']

  for (const seed of seeds) {
    it(`자동 경기 6명을 seed "${seed}" 로 두 번 돌리면 결과가 완전히 같다`, () => {
      const first = runAuto(makeInput({ participants: people(6), seed })).buildResult()
      const second = runAuto(makeInput({ participants: people(6), seed })).buildResult()

      expect(snapshot(second)).toEqual(snapshot(first))
      // 아무 일도 없어서 통과하는 것이 아니어야 한다.
      expect(Math.max(...first.participants.map((p) => p.score ?? 0))).toBeGreaterThan(200)
    })
  }

  it('같은 seed 면 각 참가자가 획득한 아이템 종류·개수까지 같다', () => {
    const itemsById = (r: BrickPickResult): Record<string, string> =>
      Object.fromEntries(
        r.participants.map((p) => [
          p.id,
          ITEM_KINDS.map((kind) => {
            const stat = p.items.find((i) => i.kind === kind)
            return `${kind}=${stat?.dropped ?? 0}/${stat?.collected ?? 0}`
          }).join(' '),
        ]),
      )

    const a = runAuto(makeInput({ participants: people(6), seed: 'ITEM-REPRO' })).buildResult()
    const b = runAuto(makeInput({ participants: people(6), seed: 'ITEM-REPRO' })).buildResult()

    expect(itemsById(b)).toEqual(itemsById(a))
    // 실제로 아이템을 받은 사람이 있어야 의미 있는 비교다.
    const collected = a.participants.reduce(
      (sum, p) => sum + p.items.reduce((m, i) => m + i.collected, 0),
      0,
    )
    expect(collected).toBeGreaterThan(0)
  })

  it('다른 seed 면 결과가 달라진다 (재현이 곧 고정은 아니다)', () => {
    const a = runAuto(makeInput({ participants: people(6), seed: 'SEED-1' })).buildResult()
    const b = runAuto(makeInput({ participants: people(6), seed: 'SEED-2' })).buildResult()
    expect(JSON.stringify(snapshot(b))).not.toEqual(JSON.stringify(snapshot(a)))
  })
})

describe('전원 같은 아이템 배치', () => {
  it('자동 경기 — 모든 참가자의 (벽돌 id → 아이템) 이 완전히 같다', () => {
    const match = newMatch(makeInput({ participants: people(6), seed: 'LAYOUT-A' }))
    match.start() // 경기 시작 직후에 확인한다

    const layouts = match.runs.map((run) => {
      const arena = run.arena
      expect(arena).not.toBeNull()
      return JSON.stringify(arena?.level.bricks.map((b) => [b.id, b.typeId, b.item ?? '-']))
    })

    expect(new Set(layouts).size).toBe(1)
    // 아이템이 하나도 없으면 비교가 공허하다.
    const first = match.runs[0].arena
    expect(first?.level.bricks.some((b) => b.item !== null)).toBe(true)
    match.destroy()
  })

  it('직접 조작 모드 — 차례가 바뀌어도 같은 배치로 시작한다', () => {
    const input = makeInput({
      participants: people(3),
      mode: 'manual',
      roundDurationMs: 6_000,
      seed: 'LAYOUT-B',
    })
    const match = newMatch(input)
    match.start()

    const layouts: string[] = []
    let guard = 0
    while (!match.isFinished && guard < 1_000_000) {
      guard += 1
      if (match.phase === 'between-players') {
        match.continueToNext()
        continue
      }
      if (match.stepsDone === 0) {
        const arena = match.runs[match.currentIndex].arena
        expect(arena).not.toBeNull()
        layouts.push(
          JSON.stringify(arena?.level.bricks.map((b) => [b.id, b.typeId, b.item ?? '-'])),
        )
      }
      match.step()
    }

    expect(layouts).toHaveLength(3)
    expect(new Set(layouts).size).toBe(1)
  })
})

describe('입력 기록 재현', () => {
  it('기록한 입력 로그로 다시 돌리면 점수·순위가 같다', () => {
    const input = makeInput({
      participants: people(3),
      mode: 'manual',
      roundDurationMs: 8_000,
      seed: 'REPLAY-SEED',
      selectionRule: { kind: 'ranks', ranks: [2] },
    })
    const scripts = input.participants.map((_, i) => scriptFor(i, 2_000))

    const live = runManual(newMatch(input), scripts)
    const liveResult = live.buildResult()
    const log = live.exportReplayLog()

    expect(log.inputs).toHaveLength(3)
    expect(log.inputs.every((l) => l.frames.length > 0)).toBe(true)

    // 같은 입력 로그를 주면 사람이 조작하지 않아도 똑같이 재현된다.
    const replayInput = makeInput({
      participants: people(3),
      mode: 'manual',
      roundDurationMs: 8_000,
      seed: 'REPLAY-SEED',
      selectionRule: { kind: 'ranks', ranks: [2] },
      replayOf: 'live-1',
    })
    const replay = runManual(newMatch(replayInput, log.inputs), [])
    const replayResult = replay.buildResult()

    expect(scoreById(replayResult)).toEqual(scoreById(liveResult))
    expect(rankById(replayResult)).toEqual(rankById(liveResult))
    expect(replayResult.selectedParticipantIds).toEqual(liveResult.selectedParticipantIds)
    // 조작이 실제로 경기에 영향을 준 경우여야 의미가 있다.
    expect(Math.max(...liveResult.participants.map((p) => p.score ?? 0))).toBeGreaterThan(0)
  })

  /**
   * ⚠ 이 시험은 현재 **실패한다 — 엔진 버그로 보인다.**
   *
   * InputRecorder.record() 가 pointerX 를 `Math.round(x * 100) / 100` 으로 줄여 적는다
   * (src/core/events.ts). 마우스·터치가 만드는 실제 좌표는 소수점 아래가 더 길므로
   * 재생된 패들 위치가 최대 0.005 만큼 어긋나고, 패들 반사각이
   * `offset = (ball.x - paddleX) / half` 로 정해지는 탓에 궤적이 갈라져
   * 30초 한 판이면 점수가 달라진다.
   *
   * 같은 대본을 미리 소수 둘째 자리로 반올림해 주면 재현이 정확히 맞는 것으로
   * 원인을 확인했다. 기록 정밀도를 높이거나(원값 그대로 저장) 엔진이 입력 pointerX 를
   * 같은 자리에서 반올림해 쓰면 해결된다.
   */
  it('마우스·터치 조작(pointerX)도 기록만으로 그대로 재현된다', () => {
    const base = {
      participants: people(4),
      mode: 'manual' as const,
      roundDurationMs: 30_000,
      seed: 'REPLAY-POINTER',
    }
    // 실제 마우스/터치가 만드는 값 — 소수점 아래가 딱 떨어지지 않는 좌표다.
    const pointerScripts = base.participants.map((_, i) => {
      const rnd = lcg(0x1234 + i * 104729)
      const out: ArenaInput[] = []
      let pointerX = 160
      for (let step = 1; step <= 4_000; step += 1) {
        if (step % 12 === 1) pointerX = 20 + rnd() * 280
        out.push({ pointerX, direction: 0, firePressed: false, fireHeld: false })
      }
      return out
    })

    const live = runManual(newMatch(makeInput(base)), pointerScripts)
    const liveResult = live.buildResult()
    const log = live.exportReplayLog()

    const replay = runManual(newMatch(makeInput(base), log.inputs), [])
    const replayResult = replay.buildResult()

    expect(Math.max(...liveResult.participants.map((p) => p.score ?? 0))).toBeGreaterThan(0)
    expect(scoreById(replayResult)).toEqual(scoreById(liveResult))
    expect(rankById(replayResult)).toEqual(rankById(liveResult))
  })
})

describe('참가자 순서 무관', () => {
  /** 같은 참가자 집합을 결정적으로 뒤섞는다. */
  function shuffleDeterministically(list: Participant[], seed: number): Participant[] {
    const rnd = lcg(seed)
    const out = list.slice()
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1))
      const tmp = out[i]
      out[i] = out[j]
      out[j] = tmp
    }
    return out
  }

  it('6명 — 명단 순서를 바꿔도 각자의 점수가 완전히 같다', () => {
    const base = people(6)
    const shuffled = shuffleDeterministically(base, 12345)
    expect(shuffled.map((p) => p.id)).not.toEqual(base.map((p) => p.id))

    const a = runAuto(makeInput({ participants: base, seed: 'ORDER-6' })).buildResult()
    const b = runAuto(makeInput({ participants: shuffled, seed: 'ORDER-6' })).buildResult()

    expect(scoreById(b)).toEqual(scoreById(a))
    // 순위도 입력 순서가 아니라 ID 해시로 갈리므로 같아야 한다.
    expect(rankById(b)).toEqual(rankById(a))
    // 전원 같은 점수라 "우연히" 통과하는 상황이 아니어야 한다.
    expect(new Set(Object.values(scoreById(a))).size).toBeGreaterThan(1)
  })

  it('40명 — 위치가 달라도 점수가 완전히 같다 (ID 해시 기반)', () => {
    const base = people(40, 'stu_')
    const shuffled = shuffleDeterministically(base, 98765)
    expect(shuffled.map((p) => p.id)).not.toEqual(base.map((p) => p.id))

    const a = runAuto(makeInput({ participants: base, seed: 'ORDER-40' })).buildResult()
    const b = runAuto(makeInput({ participants: shuffled, seed: 'ORDER-40' })).buildResult()

    expect(scoreById(b)).toEqual(scoreById(a))
    expect(rankById(b)).toEqual(rankById(a))
    expect(new Set(Object.values(scoreById(a))).size).toBeGreaterThan(1)
  })
})

describe('난수 기초 (rng.ts)', () => {
  it('같은 seed 는 같은 수열, 다른 seed 는 다른 수열', () => {
    const take = (seed: string | number, n = 20): number[] => {
      const rng = createRng(seed)
      return Array.from({ length: n }, () => rng.next())
    }

    expect(take('ABC')).toEqual(take('ABC'))
    expect(take('ABC')).not.toEqual(take('ABD'))
    // [0, 1) 범위를 벗어나지 않는다.
    for (const v of take('RANGE', 200)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    // 뽑은 횟수를 정확히 센다.
    const rng = createRng('COUNT')
    for (let i = 0; i < 7; i += 1) rng.next()
    expect(rng.drawCount).toBe(7)
  })

  it('participantSeed 는 명단 순서·위치와 무관하고 ID 마다 다르다', () => {
    const ids = people(8).map((p) => p.id)
    const direct = ids.map((id) => participantSeed('S', id, 'auto'))
    // 순서를 뒤집어 계산해도 각 ID 의 값은 그대로다.
    const reversed = [...ids].reverse().map((id) => participantSeed('S', id, 'auto'))
    expect([...reversed].reverse()).toEqual(direct)
    // ID 가 다르면 스트림도 다르다.
    expect(new Set(direct).size).toBe(ids.length)
    // 용도(purpose)가 다르면 스트림도 다르다 — 서브 각도와 조종 난수가 섞이지 않는다.
    expect(participantSeed('S', 'u1', 'auto')).not.toBe(participantSeed('S', 'u1', 'serve'))
    // 매치 seed 가 다르면 달라진다.
    expect(participantSeed('S', 'u1', 'auto')).not.toBe(participantSeed('T', 'u1', 'auto'))
    // 매치 공용 스트림은 참가자와 무관하게 seed 로만 정해진다.
    expect(matchSeedFor('S', 'items:wave:1')).toBe(matchSeedFor('S', 'items:wave:1'))
    expect(matchSeedFor('S', 'items:wave:1')).not.toBe(matchSeedFor('S', 'items:wave:2'))
  })

  it('weightedIndex 는 가중치 0 인 항목을 절대 고르지 않는다', () => {
    const weights = [0, 5, 0, 3, 0, 0]
    const rng = createRng('WEIGHTS')
    const picked = new Set<number>()
    for (let i = 0; i < 5_000; i += 1) {
      const idx = rng.weightedIndex(weights)
      expect(weights[idx]).toBeGreaterThan(0)
      picked.add(idx)
    }
    // 가중치가 있는 항목은 실제로 둘 다 나온다.
    expect(picked).toEqual(new Set([1, 3]))
    // 전부 0이면 고르지 않는다(-1).
    expect(createRng('ZERO').weightedIndex([0, 0, 0])).toBe(-1)
    expect(createRng('EMPTY').weightedIndex([])).toBe(-1)
  })

  it('shuffled 는 원본을 바꾸지 않고 같은 원소를 그대로 가진다', () => {
    const source: ItemKind[] = [...ITEM_KINDS]
    const copy = [...source]
    const out = createRng('SHUFFLE').shuffled(source)

    expect(source).toEqual(copy) // 원본 불변
    expect(out).not.toBe(source)
    expect([...out].sort()).toEqual([...source].sort()) // 원소 보존
    expect(createRng('SHUFFLE').shuffled(source)).toEqual(out) // 같은 seed 면 같은 순서
    expect(createRng('SHUFFLE-2').shuffled(source)).not.toEqual(out)
  })
})
