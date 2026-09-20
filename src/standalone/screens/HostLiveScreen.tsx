/**
 * 교사 실시간 화면 — 학생들이 각자 폰으로 참여하는 수업을 진행한다.
 *
 * 흐름은 넷이다.
 *   ① 수업 열기 — 6자리 코드를 받는다 (교실 뒤에서도 보이게 크게)
 *   ② 로비     — QR·주소로 학생을 받고, 난이도·시간·선정 규칙을 정한다
 *   ③ 진행 중  — 올라오는 점수를 실시간으로 본다
 *   ④ 집계·결과 — core 의 순수 함수로 순위를 내고 발표자를 뽑는다
 *
 * 지키는 것
 *  - 서버는 **명단과 점수만** 모은다. 순위와 발표자 선정은 여기서 core 로 낸다.
 *  - 실명·학번·반은 올라오지 않는다. 올라오는 것은 학생이 정한 닉네임과 점수뿐이다.
 *  - 연결이 끊겨도 학생 폰의 게임은 그대로 돈다. 집계는 부가 기능이다.
 *  - 상태를 색으로만 알리지 않는다 — "끊김"·"진행 중" 같은 글자를 함께 쓴다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DIFFICULTY_LABELS,
  ENGINE_VERSION,
  PLAY_STATUS_LABELS,
  ROUND_DURATION_OPTIONS_MS,
  UNTIL_CLEARED_CAP_OPTIONS_MS,
  UNTIL_CLEARED_DEFAULT_CAP_MS,
  SCHEMA_VERSION,
  SELECTION_PRESETS,
  checkSelectionRule,
  computeRanking,
  createSeedString,
  describeSelectionRule,
  resolveDifficulty,
  selectPresenters,
} from '../../core'
import type {
  BrickPickResult,
  DifficultyPreset,
  ItemStat,
  ParticipantResult,
  RankingEntry,
  SelectionRule,
  RoundMode,
} from '../../core'
import { LiveClient, deviceToken, forgetHostCode, hostCodes } from '../../live/client'
import type { HostCodeEntry } from '../../live/client'
import { buildJoinUrl } from '../../live/types'
import type { MatchStartView, MemberView, ResultBroadcast } from '../../live/types'
import { Callout } from '../components/Callout'
import { ChoiceCards } from '../components/ChoiceCards'
import { NumberField } from '../components/Field'
import { Card, ScreenShell } from '../components/ScreenShell'
import { useLiveRoom } from '../live/useLiveRoom'
import '../../styles/live.css'

export interface HostLiveScreenProps {
  /** 처음 화면으로 돌아간다. */
  onExit: () => void
  reducedMotion: boolean
  soundEnabled: boolean
}

/** 리허설용 가짜 학생 수. 수업 전에 혼자 확인할 때만 쓴다. */
const DEMO_BOT_COUNT = 6

/** 데모봇 모듈(다른 파일)의 손잡이. */
interface DemoBotHandle {
  stop(): Promise<void>
  count: number
}

/** 이번 경기의 기억. 집계할 때 이 값으로 순위를 낸다. */
interface MatchMemo {
  matchId: string
  seed: string
  difficulty: DifficultyPreset
  roundDurationMs: number
  roundMode: RoundMode
  rule: SelectionRule
  excludedNicks: string[]
  startedAt: string
}

/** collect 응답 — 서버가 준 최종 기록 명단. */
interface CollectedFinal {
  token: string
  nick: string
  status: string
  final: {
    score: number
    livesRemaining: number
    bricksDestroyed: number
    playedMs: number
    wavesCleared: number
    items: unknown
  } | null
}

type Stage = 'open' | 'lobby' | 'running' | 'result'

/* ───────────────────────────────────────────────────────── 작은 도우미들 */

function scoreText(score: number | null): string {
  return score === null ? '기록 없음' : `${score.toLocaleString('ko-KR')}점`
}

/** 명단 한 줄의 상태 글자. 색이 아니라 글자로 구분한다. */
function memberStatusText(m: MemberView): string {
  if (!m.on) return '끊김'
  if (m.status === 'done') return '완료'
  if (m.status === 'playing') return '진행 중'
  return '대기'
}

function downloadJson(result: BrickPickResult): void {
  const text = JSON.stringify(result, null, 2)
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `brickpick-live-${result.resultId}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return '처리 중 문제가 생겼습니다.'
}

/** 동적으로 불러 쓰는 qrcode 의 표면. CJS/ESM 어느 쪽으로 와도 같게 다룬다. */
interface QrApi {
  toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: Record<string, unknown>,
  ): Promise<void>
}

/**
 * 참여 주소 QR.
 *
 * qrcode 라이브러리는 **교사 화면에서만** 쓴다. 학생 폰이 이 코드를 내려받지 않도록
 * 반드시 동적 import 로만 부른다.
 */
function JoinQr({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    void import('qrcode')
      .then(async (mod) => {
        const canvas = canvasRef.current
        if (!alive || !canvas) return
        const api =
          (mod as unknown as { default?: QrApi }).default ?? (mod as unknown as QrApi)
        await api.toCanvas(canvas, url, {
          width: 260,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#070b18', light: '#ffffff' },
        })
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [url])

  return (
    <div className="bp-live-qr">
      <canvas
        ref={canvasRef}
        className="bp-live-qr__canvas"
        role="img"
        aria-label="참여 주소 QR 코드"
      />
      {failed ? (
        <p className="bp-live-qr__fallback">
          QR 을 그리지 못했습니다. 아래 주소를 칠판에 적어 주세요.
        </p>
      ) : null}
    </div>
  )
}

/* ───────────────────────────────────────────────────────── 본 화면 */

export function HostLiveScreen({ onExit, reducedMotion, soundEnabled }: HostLiveScreenProps) {
  /* 연결 */
  const [code, setCode] = useState<string | null>(null)

  /* 알림 */
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /* 최근 코드 */
  const [recent, setRecent] = useState<HostCodeEntry[]>(() => hostCodes())

  /* 경기 설정 */
  const [difficulty, setDifficulty] = useState<DifficultyPreset>('normal')
  const [roundDurationMs, setRoundDurationMs] = useState<number>(30_000)
  /** 'fixed' = 정해진 시간, 'until-cleared' = 벽돌을 다 깰 때까지. */
  const [roundMode, setRoundMode] = useState<RoundMode>('fixed')
  const [presetId, setPresetId] = useState<string>('best')
  const [count, setCount] = useState(1)
  const [rankValue, setRankValue] = useState(1)
  const [ranks, setRanks] = useState<number[]>([1])
  const [excludedNicks, setExcludedNicks] = useState<string[]>([])
  const [matchSound, setMatchSound] = useState<boolean>(soundEnabled)

  /* 경기·결과 */
  const [matchMemo, setMatchMemo] = useState<MatchMemo | null>(null)
  const [result, setResult] = useState<BrickPickResult | null>(null)
  const [broadcastSent, setBroadcastSent] = useState(false)

  /* 데모 학생 */
  const demoRef = useRef<DemoBotHandle | null>(null)
  const [demoCount, setDemoCount] = useState(0)
  const [demoBusy, setDemoBusy] = useState(false)

  // 방 연결. 콜백이 위 상태를 쓰므로 상태 선언 뒤에 둔다.
  const room = useLiveRoom('host', {
    onCancel: () => setMatchMemo(null),
    onError: (message) => setError(message),
  })
  const { client, snapshot, ready, members, joined, online, done, phase } = room

  /* 이 브라우저에서 실시간 기능을 아예 쓸 수 없는 경우 */
  const available = useMemo(() => LiveClient.available(), [])
  const [blocked, setBlocked] = useState(!available)

  const joinUrl = code ? buildJoinUrl(window.location.origin, code) : ''

  /* ── 선정 규칙 ─────────────────────────────────────────────────────── */

  const preset = SELECTION_PRESETS.find((p) => p.id === presetId) ?? SELECTION_PRESETS[0]
  const rule: SelectionRule = useMemo(() => {
    if (preset.input === 'count') return preset.build(count)
    if (preset.input === 'rank') return preset.build(rankValue)
    if (preset.input === 'ranks') return preset.build(ranks.length > 0 ? ranks : [1])
    return preset.build(1)
  }, [preset, count, rankValue, ranks])

  const candidates = members.filter((m) => !excludedNicks.includes(m.nick)).length
  const ruleProblem = checkSelectionRule(rule, candidates)

  /* ── 단계 ──────────────────────────────────────────────────────────── */

  const liveMatch: MatchStartView | null = (snapshot?.match as MatchStartView | null) ?? null
  /** 교사가 새로고침해 기억을 잃어도, 서버가 들고 있는 경기 설정으로 이어서 집계한다. */
  const effectiveMatch: MatchMemo | null =
    matchMemo ??
    (liveMatch
      ? {
          matchId: liveMatch.matchId,
          seed: liveMatch.seed,
          difficulty: (liveMatch.difficulty as DifficultyPreset) || 'normal',
          roundDurationMs: liveMatch.roundDurationMs,
          roundMode: (liveMatch.roundMode as RoundMode) ?? 'fixed',
          rule: (liveMatch.selectionRule as SelectionRule | undefined) ?? rule,
          excludedNicks,
          startedAt: new Date().toISOString(),
        }
      : null)

  const stage: Stage = !code
    ? 'open'
    : result
      ? 'result'
      : phase === 'playing'
        ? 'running'
        : 'lobby'

  /* ── 데모 학생 정리 ────────────────────────────────────────────────── */

  const stopDemo = useCallback(async () => {
    const handle = demoRef.current
    demoRef.current = null
    setDemoCount(0)
    if (!handle) return
    try {
      await handle.stop()
    } catch {
      /* 못 지워도 교사 화면은 계속 돈다 — 서버가 다음에 걷어낸다 */
    }
  }, [])

  useEffect(() => {
    return () => {
      void stopDemo()
    }
  }, [stopDemo])

  /* ── ① 수업 열기 ──────────────────────────────────────────────────── */

  const openNewClass = async () => {
    setBusy(true)
    setError(null)
    try {
      const fresh = await client.createCode()
      setRecent(hostCodes())
      setCode(fresh)
      room.join(fresh)
      setNotice(`수업 코드 ${fresh} 를 열었습니다. 학생들에게 QR 또는 주소를 보여 주세요.`)
    } catch (err) {
      setBlocked(true)
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const reattach = (target: string) => {
    setError(null)
    setCode(target)
    room.join(target)
    setNotice(`수업 ${target} 에 다시 붙었습니다.`)
  }

  const dropRecent = (target: string) => {
    forgetHostCode(target)
    setRecent(hostCodes())
  }

  const exitRoom = async () => {
    await stopDemo()
    try {
      await room.leave()
    } catch {
      /* 못 알려도 나간다 */
    }
    onExit()
  }

  /* ── ② 경기 시작 ──────────────────────────────────────────────────── */

  const startBlockedReason = !ready
    ? '연결이 끊겨 있습니다. 다시 연결될 때까지 기다려 주세요.'
    : joined === 0
      ? '아직 들어온 학생이 없습니다. QR 또는 주소로 먼저 참여시켜 주세요.'
      : ruleProblem
        ? ruleProblem.message
        : null

  const startMatch = async () => {
    if (startBlockedReason) {
      setError(startBlockedReason)
      return
    }
    setBusy(true)
    setError(null)
    const memo: MatchMemo = {
      matchId: `m${Date.now().toString(36)}`,
      seed: createSeedString(Math.random),
      difficulty,
      roundDurationMs,
      roundMode,
      rule,
      excludedNicks: [...excludedNicks],
      startedAt: new Date().toISOString(),
    }
    const match: MatchStartView = {
      matchId: memo.matchId,
      seed: memo.seed,
      difficulty: memo.difficulty,
      roundDurationMs: memo.roundDurationMs,
      roundMode,
      selectionRule: memo.rule,
      soundEnabled: matchSound,
      reducedMotion,
    }
    try {
      await client.request('start', { token: deviceToken('host'), match })
      setMatchMemo(memo)
      setResult(null)
      setBroadcastSent(false)
      setNotice('경기를 시작했습니다. 학생 폰마다 같은 판이 만들어집니다.')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  /* ── ③ 취소 ───────────────────────────────────────────────────────── */

  const cancelMatch = async () => {
    setBusy(true)
    try {
      await client.request('cancel', { token: deviceToken('host') })
      setMatchMemo(null)
      setResult(null)
      setNotice('경기를 취소했습니다. 학생 폰의 판도 함께 멈춥니다.')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  /* ── ④ 집계 ───────────────────────────────────────────────────────── */

  const collectAndRank = async () => {
    const memo = effectiveMatch
    if (!memo) {
      setError('집계할 경기가 없습니다.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const raw = await client.request('collect', { token: deviceToken('host') })
      const finals = ((raw as { finals?: unknown })?.finals ?? []) as CollectedFinal[]

      const entries: RankingEntry[] = finals.map((f) => {
        const fin = f.final
        const excluded = memo.excludedNicks.includes(f.nick)
        return {
          id: f.token,
          nickname: f.nick,
          score: fin ? fin.score : null,
          livesRemaining: fin ? fin.livesRemaining : null,
          // final 이 있으면 실제로 마친 것, 없으면 0점이 아니라 "기록 없음".
          playStatus: fin ? 'played' : 'not_played',
          excluded,
          bricksDestroyed: fin ? fin.bricksDestroyed : 0,
          playedMs: fin ? fin.playedMs : 0,
          wavesCleared: fin ? fin.wavesCleared : 0,
          items: fin && Array.isArray(fin.items) ? (fin.items as ItemStat[]) : [],
        }
      })

      // 순위와 발표자는 서버가 아니라 여기서 core 의 순수 함수로 낸다.
      const participants = computeRanking(entries, {
        seed: memo.seed,
        // "다 깰 때까지" 는 다 깬 사람이 전부 같은 점수가 되므로 깬 시각으로 가른다.
        rankBy: memo.roundMode === 'until-cleared' ? 'clear-time' : 'score',
      })
      const outcome = selectPresenters(participants, memo.rule)

      const built: BrickPickResult = {
        schemaVersion: SCHEMA_VERSION,
        sessionId: `bp_live_${code ?? 'room'}`,
        resultId: `bpr_live_${memo.matchId}`,
        engineVersion: ENGINE_VERSION,
        seed: memo.seed,
        appliedSettings: {
          mode: 'manual',
          difficulty: memo.difficulty,
          difficultySettings: resolveDifficulty(memo.difficulty),
          roundDurationMs: memo.roundDurationMs,
          roundMode: memo.roundMode,
          selectionRule: memo.rule,
          excludedParticipantIds: entries.filter((e) => e.excluded).map((e) => e.id),
        },
        startedAt: memo.startedAt,
        completedAt: new Date().toISOString(),
        participants,
        selectedParticipantIds: outcome.selectedParticipantIds,
        selectionReasons: outcome.selectionReasons,
        selectionIssue: outcome.issue,
        status: 'completed',
        run: { kind: 'live', replayOf: null },
        eligibleCount: outcome.eligibleCount,
      }
      setResult(built)

      // 학생 폰에는 닉네임·점수·순위·선정 여부만 내려보낸다.
      const picked = new Set(outcome.selectedParticipantIds)
      const broadcast: ResultBroadcast = {
        matchId: memo.matchId,
        selectedNicks: outcome.selectionReasons.map((r) => r.nickname),
        reasons: outcome.selectionReasons.map((r) => r.reason),
        board: participants.map((p) => ({
          nick: p.nickname,
          score: p.score,
          rank: p.rank,
          picked: picked.has(p.id),
        })),
      }
      try {
        await client.request('result', { token: deviceToken('host'), result: broadcast })
        setBroadcastSent(true)
        setNotice('집계를 마치고 학생 폰으로 결과를 내려보냈습니다.')
      } catch {
        setBroadcastSent(false)
        setNotice('집계는 끝났습니다. 다만 학생 폰으로 결과를 보내지 못했습니다 — 다시 보내기를 눌러 주세요.')
      }
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const resendResult = async () => {
    if (!result) return
    const picked = new Set(result.selectedParticipantIds)
    const broadcast: ResultBroadcast = {
      matchId: result.resultId.replace('bpr_live_', ''),
      selectedNicks: result.selectionReasons.map((r) => r.nickname),
      reasons: result.selectionReasons.map((r) => r.reason),
      board: result.participants.map((p) => ({
        nick: p.nickname,
        score: p.score,
        rank: p.rank,
        picked: picked.has(p.id),
      })),
    }
    setBusy(true)
    try {
      await client.request('result', { token: deviceToken('host'), result: broadcast })
      setBroadcastSent(true)
      setNotice('학생 폰으로 결과를 다시 보냈습니다.')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const newRoundSameStudents = async () => {
    setBusy(true)
    try {
      await client.request('reset', { token: deviceToken('host'), what: 'scores' })
      setResult(null)
      setMatchMemo(null)
      setBroadcastSent(false)
      setNotice('같은 학생 명단으로 새 경기를 준비했습니다.')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  /* ── 데모 학생 ────────────────────────────────────────────────────── */

  const addDemoStudents = async () => {
    if (!code) return
    setDemoBusy(true)
    setError(null)
    try {
      // 다른 파일(데모봇)은 교사 화면에서만 쓴다 — 학생 폰이 내려받지 않도록 동적 import.
      // @ts-ignore 아직 만들어지지 않았을 수 있는 파일이다.
      const mod: unknown = await import('../live/demoBots')
      const start = (
        mod as {
          startDemoBots?: (opts: {
            code: string
            count: number
            origin?: string
          }) => Promise<DemoBotHandle>
        }
      ).startDemoBots
      if (typeof start !== 'function') throw new Error('데모 학생 기능을 아직 쓸 수 없습니다.')
      await stopDemo()
      const handle = await start({ code, count: DEMO_BOT_COUNT })
      demoRef.current = handle
      setDemoCount(handle.count)
      setNotice(
        `데모 학생 ${handle.count}명을 넣었습니다. 수업 전에 혼자 확인할 때만 쓰고, 수업 전에 빼 주세요.`,
      )
    } catch (err) {
      setError(errorText(err))
    } finally {
      setDemoBusy(false)
    }
  }

  const removeDemoStudents = async () => {
    setDemoBusy(true)
    await stopDemo()
    try {
      await client.request('reset', { token: deviceToken('host'), what: 'demo' })
    } catch {
      /* 못 지워도 실제 학생에게는 영향이 없다 */
    }
    setNotice('데모 학생을 뺐습니다.')
    setDemoBusy(false)
  }

  /* ── 막힌 환경 ────────────────────────────────────────────────────── */

  if (blocked) {
    return (
      <ScreenShell
        title="실시간 참여"
        lead="이 주소에서는 실시간 참여를 쓸 수 없습니다."
        footer={
          <div className="bp-nav">
            <div className="bp-nav__left">
              <button type="button" className="bpx-btn bpx-btn--ghost" onClick={onExit}>
                ← 처음 화면으로
              </button>
            </div>
          </div>
        }
      >
        <Callout tone="warn">
          실시간 참여는 <strong>배포된 주소에서만</strong> 됩니다. 지금 보고 있는 주소에는 참여를
          받아 줄 서버가 없습니다.
        </Callout>
        <Card title="어떻게 하면 되나요">
          <p className="bp-note">
            배포된 브릭픽 주소를 열고 다시 <strong>실시간 참여</strong>를 눌러 주세요. 학생 폰도
            같은 주소로 들어옵니다.
          </p>
          <p className="bp-note">
            지금 이 화면에서도 <strong>자동 경기</strong>와 <strong>직접 조작</strong>은 그대로 쓸 수
            있습니다. 학생 폰 없이 교사 화면 하나로 발표자를 뽑는 방식입니다.
          </p>
        </Card>
      </ScreenShell>
    )
  }

  /* ── 공통 머리말 ──────────────────────────────────────────────────── */

  const disconnectedBanner =
    code && !ready ? (
      <div className="bp-live-banner" role="status" aria-live="polite">
        <span className="bp-live-banner__mark" aria-hidden="true">
          ⚠
        </span>
        <span>
          <strong>연결이 끊겼습니다 — 다시 연결하는 중</strong>
          <br />
          교사가 할 일은 없습니다. 잠시 뒤 저절로 돌아옵니다. 그동안에도 학생 폰의 게임은 그대로
          돌아갑니다.
        </span>
      </div>
    ) : null

  const alerts = (
    <div className="bp-live">
      {error ? (
        <Callout tone="error" onDismiss={() => setError(null)}>
          {error}
        </Callout>
      ) : null}
      {notice ? (
        <Callout tone="info" onDismiss={() => setNotice(null)}>
          {notice}
        </Callout>
      ) : null}
    </div>
  )

  /* ── ① 수업 열기 화면 ─────────────────────────────────────────────── */

  if (stage === 'open') {
    return (
      <ScreenShell
        title="실시간 참여 — 수업 열기"
        lead="학생들이 각자 폰으로 같은 판을 돌리고, 점수만 이 화면에 모입니다. 실명·학번은 올라오지 않습니다."
        footer={
          <div className="bp-nav">
            <div className="bp-nav__left">
              <button type="button" className="bpx-btn bpx-btn--ghost" onClick={onExit}>
                ← 처음 화면으로
              </button>
            </div>
          </div>
        }
      >
        {alerts}
        <Card title="새 수업 열기" hint="6자리 코드가 하나 만들어집니다. 이 코드가 곧 교실 하나입니다.">
          <button
            type="button"
            className="bpx-btn bpx-btn--primary bp-live-bigbtn"
            onClick={() => void openNewClass()}
            disabled={busy}
          >
            {busy ? '여는 중…' : '새 수업 열기'}
          </button>
          <p className="bp-field__hint">
            코드는 8일 동안 살아 있습니다. 다음 차시에 같은 코드로 다시 들어올 수 있습니다.
          </p>
        </Card>

        <Card
          title="최근에 연 수업"
          hint="이 기기에서 연 코드만 보입니다. 다른 기기에서는 보이지 않습니다."
        >
          {recent.length === 0 ? (
            <p className="bp-empty">아직 연 수업이 없습니다.</p>
          ) : (
            <ul className="bp-live-recent">
              {recent.map((entry) => (
                <li key={entry.code} className="bp-live-recent__row">
                  <button
                    type="button"
                    className="bp-live-recent__code"
                    onClick={() => reattach(entry.code)}
                  >
                    <span className="bp-live-recent__text">{entry.code}</span>
                    <span className="bp-live-recent__when">
                      {new Date(entry.at).toLocaleString('ko-KR')} 에 열었습니다
                    </span>
                  </button>
                  <button
                    type="button"
                    className="bpx-btn bpx-btn--small"
                    onClick={() => dropRecent(entry.code)}
                  >
                    지우기
                    <span className="bp-sr-only"> — {entry.code} 를 이 목록에서 지웁니다</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </ScreenShell>
    )
  }

  /* ── ④ 결과 화면 ──────────────────────────────────────────────────── */

  if (stage === 'result' && result) {
    const byRank = [...result.participants].sort((a, b) => a.rank - b.rank)
    const byEligible = result.participants
      .filter((p) => p.eligibleRank !== null)
      .sort((a, b) => (a.eligibleRank ?? 0) - (b.eligibleRank ?? 0))
    const selected: ParticipantResult[] = result.selectedParticipantIds
      .map((id) => result.participants.find((p) => p.id === id))
      .filter((p): p is ParticipantResult => Boolean(p))

    return (
      <ScreenShell
        title="실시간 경기 결과"
        lead={
          <>
            {describeSelectionRule(result.appliedSettings.selectionRule, result.eligibleCount)} 규칙으로{' '}
            {selected.length}명을 뽑았습니다.
          </>
        }
        footer={
          <div className="bp-nav">
            <div className="bp-nav__left">
              <button type="button" className="bpx-btn bpx-btn--ghost" onClick={() => void exitRoom()}>
                수업 끝내기
              </button>
            </div>
            <div className="bp-nav__right">
              <button type="button" className="bpx-btn" onClick={() => downloadJson(result)}>
                결과 JSON 내려받기
              </button>
              <button
                type="button"
                className="bpx-btn bpx-btn--primary"
                onClick={() => void newRoundSameStudents()}
                disabled={busy}
              >
                같은 학생들로 새 경기 →
              </button>
            </div>
          </div>
        }
      >
        {disconnectedBanner}
        {alerts}

        {result.selectionIssue ? (
          <Callout tone="warn">
            선정 규칙을 그대로 적용하지 못했습니다 — {result.selectionIssue.message}
          </Callout>
        ) : null}

        <div className={`bp-live-winner${reducedMotion ? ' is-still' : ''}`}>
          <p className="bp-live-winner__tag">이번 발표자</p>
          <ul className="bp-live-winner__list">
            {selected.length === 0 ? (
              <li className="bp-live-winner__name">선정된 학생이 없습니다.</li>
            ) : (
              selected.map((p) => {
                const reason = result.selectionReasons.find((r) => r.participantId === p.id)
                return (
                  <li key={p.id} className="bp-live-winner__item">
                    <span className="bp-live-winner__name">{p.nickname}</span>
                    <span className="bp-live-winner__facts">
                      후보 {p.eligibleRank}위 · 전체 {p.rank}위 · {scoreText(p.score)}
                    </span>
                    {reason ? (
                      <span className="bp-live-winner__reason">{reason.reason}</span>
                    ) : null}
                  </li>
                )
              })
            )}
          </ul>
        </div>

        <Callout tone="info">
          <strong>학생이 직접 조작한 결과입니다.</strong> 점수는 실력과 운이 함께 작용합니다. 같은
          판이라도 공이 튀는 방향과 떨어지는 아이템에 따라 결과가 달라지고, 동점일 때는 seed
          추첨으로 순서를 정합니다. 이 점수를 성취도 평가에 쓰지 마세요.
        </Callout>

        {!broadcastSent ? (
          <Callout tone="warn">
            학생 폰으로 결과를 아직 보내지 못했습니다.{' '}
            <button
              type="button"
              className="bpx-btn bpx-btn--small"
              onClick={() => void resendResult()}
              disabled={busy}
            >
              학생 폰에 결과 다시 보내기
            </button>
          </Callout>
        ) : null}

        <Card
          title="전체 순위와 후보 순위"
          hint="왼쪽은 참여한 학생 전원 기준, 오른쪽은 제외·미완료를 뺀 후보 기준입니다. 발표자는 오른쪽 순위로 뽑습니다."
        >
          <div className="bp-rank-columns">
            <div className="bp-rank-column">
              <h3 className="bp-rank-column__title">
                전체 순위 <span className="bp-rank-column__count">{byRank.length}명</span>
              </h3>
              <ol className="bp-rank-list">
                {byRank.map((p) => (
                  <li
                    key={p.id}
                    className={`bp-rank-list__row${
                      result.selectedParticipantIds.includes(p.id) ? ' is-selected' : ''
                    }`}
                  >
                    <span className="bp-rank-list__no">{p.rank}</span>
                    <span className="bp-rank-list__name">{p.nickname}</span>
                    <span className="bp-rank-list__score">{scoreText(p.score)}</span>
                    {p.playStatus !== 'played' ? (
                      <span className="bp-tag">{PLAY_STATUS_LABELS[p.playStatus]}</span>
                    ) : null}
                    {p.excluded ? <span className="bp-tag bp-tag--muted">선정 제외</span> : null}
                  </li>
                ))}
              </ol>
            </div>

            <div className="bp-rank-column">
              <h3 className="bp-rank-column__title">
                후보 순위 <span className="bp-rank-column__count">{byEligible.length}명</span>
              </h3>
              {byEligible.length === 0 ? (
                <p className="bp-empty">후보가 없습니다.</p>
              ) : (
                <ol className="bp-rank-list">
                  {byEligible.map((p) => (
                    <li
                      key={p.id}
                      className={`bp-rank-list__row${
                        result.selectedParticipantIds.includes(p.id) ? ' is-selected' : ''
                      }`}
                    >
                      <span className="bp-rank-list__no">{p.eligibleRank}</span>
                      <span className="bp-rank-list__name">{p.nickname}</span>
                      <span className="bp-rank-list__score">{scoreText(p.score)}</span>
                      <span className="bp-rank-list__aside">전체 {p.rank}위</span>
                      {result.selectedParticipantIds.includes(p.id) ? (
                        <span className="bp-tag bp-tag--pick">발표자</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
          <p className="bp-field__hint">
            경기를 끝내지 못한 학생은 <strong>0점이 아니라 “기록 없음”</strong>으로 남고 후보에서
            빠집니다. 그래서 두 목록의 순위 번호가 서로 다릅니다.
          </p>
        </Card>

        <Card title="이 경기의 기록" collapsible defaultOpen={false}>
          <dl className="bp-kv-list">
            <div className="bp-kv">
              <dt className="bp-kv__key">수업 코드</dt>
              <dd className="bp-kv__value">
                <code className="bp-code">{code}</code>
              </dd>
            </div>
            <div className="bp-kv">
              <dt className="bp-kv__key">seed</dt>
              <dd className="bp-kv__value">
                <code className="bp-code">{result.seed}</code>
              </dd>
            </div>
            <div className="bp-kv">
              <dt className="bp-kv__key">결과 ID</dt>
              <dd className="bp-kv__value">
                <code className="bp-code">{result.resultId}</code>
              </dd>
            </div>
            <div className="bp-kv">
              <dt className="bp-kv__key">진행 시각</dt>
              <dd className="bp-kv__value">
                {new Date(result.startedAt).toLocaleString('ko-KR')} →{' '}
                {new Date(result.completedAt).toLocaleString('ko-KR')}
              </dd>
            </div>
          </dl>
          <p className="bp-field__hint">
            결과는 자동으로 어디에도 저장되지 않습니다. 필요하면 JSON 으로 내려받으세요.
          </p>
        </Card>
      </ScreenShell>
    )
  }

  /* ── ③ 진행 중 화면 ───────────────────────────────────────────────── */

  if (stage === 'running') {
    const board = [...members].sort((a, b) => {
      const sa = a.score
      const sb = b.score
      if (sa === null && sb === null) return a.nick.localeCompare(b.nick, 'ko')
      if (sa === null) return 1
      if (sb === null) return -1
      return sb - sa
    })
    const playingCount = members.filter((m) => m.status !== 'done').length

    return (
      <ScreenShell
        title="경기 진행 중"
        lead="학생 폰마다 같은 판이 돌고 있습니다. 점수만 이 화면에 모입니다."
        footer={
          <div className="bp-nav">
            <div className="bp-nav__left">
              <button
                type="button"
                className="bpx-btn bpx-btn--danger"
                onClick={() => void cancelMatch()}
                disabled={busy}
              >
                경기 취소
              </button>
            </div>
            <div className="bp-nav__right">
              <button
                type="button"
                className="bpx-btn bpx-btn--primary"
                onClick={() => void collectAndRank()}
                disabled={busy}
              >
                {busy ? '집계하는 중…' : '지금 집계하기 →'}
              </button>
            </div>
          </div>
        }
      >
        {disconnectedBanner}
        {alerts}

        <div className="bp-live-bignums">
          <div className="bp-live-bignum">
            <span className="bp-live-bignum__value">{playingCount}</span>
            <span className="bp-live-bignum__label">명이 아직 하는 중</span>
          </div>
          <div className="bp-live-bignum">
            <span className="bp-live-bignum__value">{done}</span>
            <span className="bp-live-bignum__label">명이 마침</span>
          </div>
          <div className="bp-live-bignum">
            <span className="bp-live-bignum__value">{online}</span>
            <span className="bp-live-bignum__label">명 접속 중</span>
          </div>
        </div>
        <p className="bp-live-wait">모두 마칠 때까지 기다려 주세요.</p>

        <Callout tone="info">
          <strong>지금 집계하기</strong>를 누르면 아직 마치지 못한 학생은{' '}
          <strong>“{PLAY_STATUS_LABELS.not_played}”</strong> 로 처리됩니다. 0점이 아니라 기록이 없는
          것으로 남고, 발표자 후보에서 빠집니다.
        </Callout>

        <Card title="실시간 점수판" hint="점수가 높은 순입니다. 700ms 마다 갱신됩니다.">
          {board.length === 0 ? (
            <p className="bp-empty">아직 올라온 점수가 없습니다.</p>
          ) : (
            <ol className="bp-live-board">
              {board.map((m, index) => (
                <li
                  key={m.nick + String(index)}
                  className={`bp-live-board__row${m.on ? '' : ' is-off'}${
                    m.status === 'done' ? ' is-done' : ''
                  }`}
                >
                  <span className="bp-live-board__no">{index + 1}</span>
                  <span className="bp-live-board__name">{m.nick}</span>
                  <span className="bp-live-board__score">{scoreText(m.score)}</span>
                  <span className="bp-live-board__lives">
                    목숨 {m.lives === null ? '—' : `${m.lives}개`}
                  </span>
                  <span className="bp-live-board__state">{memberStatusText(m)}</span>
                  <span
                    className="bp-live-board__bar"
                    role="progressbar"
                    aria-label={`${m.nick} 진행률`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(m.progress * 100)}
                  >
                    <span
                      className="bp-live-board__fill"
                      style={{ width: `${Math.round(Math.max(0, Math.min(1, m.progress)) * 100)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="bp-field__hint">
            <strong>진행 중</strong>은 아직 하는 중이라는 뜻이고, <strong>끊김</strong>은 폰의
            연결이 끊어졌다는 뜻입니다. 둘 다 <strong>0점과 다릅니다</strong> — 점수 칸에 “기록
            없음”이라고 적힌 학생은 아직 한 판도 마치지 않은 사람입니다.
          </p>
        </Card>
      </ScreenShell>
    )
  }

  /* ── ② 로비 화면 ──────────────────────────────────────────────────── */

  return (
    <ScreenShell
      title="학생 참여 기다리는 중"
      lead="아래 QR 이나 주소로 학생들이 각자 폰으로 들어옵니다. 앱을 깔 필요도, 계정을 만들 필요도 없습니다."
      footer={
        <div className="bp-nav">
          <div className="bp-nav__left">
            <button type="button" className="bpx-btn bpx-btn--ghost" onClick={() => void exitRoom()}>
              수업 끝내기
            </button>
          </div>
          <div className="bp-nav__right">
            {startBlockedReason ? (
              <p id="bp-live-start-reason" className="bp-nav__reason">
                {startBlockedReason}
              </p>
            ) : null}
            <button
              type="button"
              className="bpx-btn bpx-btn--primary"
              onClick={() => void startMatch()}
              disabled={busy || startBlockedReason !== null}
              aria-describedby={startBlockedReason ? 'bp-live-start-reason' : undefined}
            >
              경기 시작 →
            </button>
          </div>
        </div>
      }
    >
      {disconnectedBanner}
      {alerts}

      <Card title="수업 코드" hint="교실 뒤에서도 보이게 크게 띄웠습니다.">
        <p className="bp-live-code">
          <span className="bp-sr-only">수업 코드 </span>
          {code}
        </p>
        <div className="bp-live-join">
          <JoinQr url={joinUrl} />
          <div className="bp-live-join__text">
            <p className="bp-live-join__label">QR 을 못 찍으면 이 주소를 직접 칩니다</p>
            <p className="bp-live-url">{joinUrl}</p>
            <div className="bp-row-buttons">
              <button
                type="button"
                className="bpx-btn"
                onClick={() => {
                  void (async () => {
                    try {
                      await navigator.clipboard.writeText(joinUrl)
                      setNotice('참여 주소를 복사했습니다.')
                    } catch {
                      setNotice('복사가 막혀 있습니다. 주소를 직접 읽어 주세요.')
                    }
                  })()
                }}
              >
                주소 복사
              </button>
            </div>
            <p className="bp-field__hint">
              학생은 닉네임만 정하면 바로 들어옵니다. 실명·학번·반은 어디에도 올라가지 않습니다.
            </p>
          </div>
        </div>
      </Card>

      <Card
        title="들어온 학생"
        hint="체크한 학생은 이번 발표자 선정에서 빠집니다. 경기에는 그대로 참여하고 점수도 남습니다."
      >
        <div className="bp-live-bignums">
          <div className="bp-live-bignum">
            <span className="bp-live-bignum__value">{joined}</span>
            <span className="bp-live-bignum__label">명 참여</span>
          </div>
          <div className="bp-live-bignum">
            <span className="bp-live-bignum__value">{online}</span>
            <span className="bp-live-bignum__label">명 접속 중</span>
          </div>
          <div className="bp-live-bignum">
            <span className="bp-live-bignum__value">{candidates}</span>
            <span className="bp-live-bignum__label">명이 선정 후보</span>
          </div>
        </div>

        {members.length === 0 ? (
          <p className="bp-empty">아직 들어온 학생이 없습니다. QR 을 띄워 두고 기다려 주세요.</p>
        ) : (
          <ul className="bp-live-roster">
            {members.map((m, index) => {
              const checkboxId = `bp-live-ex-${index}`
              const excluded = excludedNicks.includes(m.nick)
              return (
                <li
                  key={m.nick + String(index)}
                  className={`bp-live-roster__row${m.on ? '' : ' is-off'}${
                    excluded ? ' is-excluded' : ''
                  }`}
                >
                  <input
                    id={checkboxId}
                    type="checkbox"
                    className="bp-checkbox"
                    checked={excluded}
                    onChange={() =>
                      setExcludedNicks((prev) =>
                        prev.includes(m.nick)
                          ? prev.filter((n) => n !== m.nick)
                          : [...prev, m.nick],
                      )
                    }
                  />
                  <label htmlFor={checkboxId} className="bp-live-roster__label">
                    <span className="bp-live-roster__name">{m.nick}</span>
                    {m.on ? null : <span className="bp-tag">끊김</span>}
                    {excluded ? <span className="bp-tag bp-tag--muted">선정 제외</span> : null}
                  </label>
                </li>
              )
            })}
          </ul>
        )}

        <div className="bp-row-buttons">
          <button
            type="button"
            className="bpx-btn"
            disabled={excludedNicks.length === 0}
            onClick={() => setExcludedNicks([])}
          >
            제외 목록 비우기
          </button>
          <button
            type="button"
            className="bpx-btn"
            onClick={() => void addDemoStudents()}
            disabled={demoBusy}
          >
            데모 학생 넣기
          </button>
          <button
            type="button"
            className="bpx-btn"
            onClick={() => void removeDemoStudents()}
            disabled={demoBusy}
          >
            데모 학생 빼기
          </button>
        </div>
        <p className="bp-field__hint">
          데모 학생은 <strong>수업 전 리허설용 가짜 참가자</strong>입니다
          {demoCount > 0 ? ` (지금 ${demoCount}명 들어와 있습니다)` : ''}. 수업을 시작하기 전에 꼭
          빼 주세요.
        </p>
      </Card>

      <Card title="경기 설정">
        <ChoiceCards<DifficultyPreset>
          legend="난이도"
          value={difficulty}
          onChange={setDifficulty}
          variant="chips"
          options={(['easy', 'normal', 'hard'] as const).map((d) => ({
            value: d,
            label: DIFFICULTY_LABELS[d],
          }))}
        />

        <ChoiceCards<string>
          legend="경기 시간"
          value={roundMode === 'until-cleared' ? 'cleared' : String(roundDurationMs)}
          onChange={(v) => {
            if (v === 'cleared') {
              setRoundMode('until-cleared')
              setRoundDurationMs(UNTIL_CLEARED_DEFAULT_CAP_MS)
            } else {
              setRoundMode('fixed')
              setRoundDurationMs(Number(v))
            }
          }}
          variant="chips"
          options={[
            ...ROUND_DURATION_OPTIONS_MS.map((ms) => ({
              value: String(ms),
              label: `${Math.round(ms / 1000)}초`,
            })),
            { value: 'cleared', label: '다 깰 때까지' },
          ]}
        />

        {roundMode === 'until-cleared' ? (
          <div className="bp-live-clearnote">
            <p>
              <strong>벽돌을 전부 깨면 그 학생의 경기가 끝납니다.</strong> 다 깬 학생이 앞에 오고,
              그중 <strong>빨리 깬 순서</strong>로 순위가 정해집니다. 다 깨면 점수가 모두 같아지기
              때문입니다. 못 깬 학생끼리는 평소대로 점수 순입니다.
            </p>
            <ChoiceCards<string>
              legend="아무도 못 깰 때 끊을 시간"
              value={String(roundDurationMs)}
              onChange={(v) => setRoundDurationMs(Number(v))}
              variant="chips"
              options={UNTIL_CLEARED_CAP_OPTIONS_MS.map((ms) => ({
                value: String(ms),
                label: ms >= 60000 ? `${Math.round(ms / 60000)}분` : `${Math.round(ms / 1000)}초`,
              }))}
            />
          </div>
        ) : null}

        <div className="bp-live-toggle">
          <input
            id="bp-live-sound"
            type="checkbox"
            className="bp-checkbox"
            checked={matchSound}
            onChange={(e) => setMatchSound(e.target.checked)}
          />
          <label htmlFor="bp-live-sound" className="bp-live-toggle__label">
            학생 폰에서 소리 켜기
            <span className="bp-field__hint">
              교실에서 폰 서른 대가 한꺼번에 소리를 내면 시끄럽습니다. 보통은 꺼 두세요.
            </span>
          </label>
        </div>
      </Card>

      <Card title="발표자 선정 규칙">
        <ChoiceCards<string>
          legend="선정 규칙"
          value={presetId}
          onChange={setPresetId}
          options={SELECTION_PRESETS.map((p) => ({ value: p.id, label: p.label, hint: p.hint }))}
        />

        {preset.input === 'count' ? (
          <NumberField
            label="몇 명을 뽑을까요?"
            value={count}
            range={{ min: 1, max: Math.max(1, candidates), step: 1 }}
            unit="명"
            onChange={setCount}
            hint={`지금 후보는 최대 ${candidates}명입니다.`}
          />
        ) : null}

        {preset.input === 'rank' ? (
          <NumberField
            label="몇 위를 뽑을까요?"
            value={rankValue}
            range={{ min: 1, max: Math.max(1, candidates), step: 1 }}
            unit="위"
            onChange={setRankValue}
            hint="후보 순위 기준입니다. 제외한 학생은 이 순위에 들어가지 않습니다."
          />
        ) : null}

        {preset.input === 'ranks' ? (
          <fieldset className="bp-choice">
            <legend className="bp-choice__legend">뽑을 순위 고르기</legend>
            <p className="bp-choice__desc">
              여러 개를 고를 수 있습니다. 지금 고른 순위:{' '}
              <strong>{ranks.length > 0 ? `${ranks.join('위, ')}위` : '아직 없음'}</strong>
            </p>
            <div className="bp-rank-chips">
              {Array.from({ length: Math.max(1, Math.min(candidates, 40)) }, (_, i) => i + 1).map(
                (r) => {
                  const on = ranks.includes(r)
                  return (
                    <button
                      key={r}
                      type="button"
                      className={`bp-chip${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() =>
                        setRanks((prev) =>
                          prev.includes(r)
                            ? prev.filter((x) => x !== r)
                            : [...prev, r].sort((a, b) => a - b),
                        )
                      }
                    >
                      {r}위{on ? <span className="bp-sr-only"> 선택됨</span> : null}
                    </button>
                  )
                },
              )}
            </div>
          </fieldset>
        ) : null}

        <div className="bp-preview">
          <span className="bp-preview__tag">이렇게 뽑습니다</span>
          <p className="bp-preview__text">{describeSelectionRule(rule, candidates)}</p>
        </div>

        {ruleProblem ? <Callout tone="error">{ruleProblem.message}</Callout> : null}
      </Card>
    </ScreenShell>
  )
}
