/**
 * 학생 화면 — 수업 코드로 들어와 자기 폰에서 한 판을 돌리고, 점수만 올린다.
 *
 * 세로 모바일(375px)이 기준이다. 교실에서 30명이 동시에 쓰는 화면이라
 * 다음 세 가지를 특히 지켰다.
 *
 *  1. **연결이 끊겨도 게임은 그대로 돈다.** 집계는 부가 기능이다.
 *     score 는 notify(응답을 안 기다린다) 로 보내고, 끊겨 있으면 조용히 버려진다.
 *     다 끝났는데 done 을 못 보냈으면 다시 붙었을 때 한 번 더 보낸다(3회까지).
 *  2. **점수를 경기 중에 계속 올린다.** 끝나고 한 번만 보내면 선생님 화면의
 *     진행 상황이 경기 내내 0으로 남는다(실제로 겪은 버그다).
 *     SCORE_SHARE_MS 간격으로, 그리고 값이 바뀌었을 때만 보낸다.
 *  3. **게임은 React 가 다시 그리지 않는다.** mountBrickPick 이 자기 DOM 안에
 *     전부 그린다. 이 파일은 경기 한 번에 한 번만 마운트한다.
 *
 * 서버로 올라가는 것은 학생이 스스로 정한 닉네임과 점수뿐이다.
 * 실명·학번·반은 이 화면 어디에서도 묻지 않는다.
 */

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { LiveClient, SCORE_SHARE_MS, deviceToken, normalizeCodeInput } from '../../live/client'
import type { LiveEvent } from '../../live/client'
import type { MatchStartView, ResultBroadcast } from '../../live/types'
import { mountBrickPick } from '../../adapters/mount'
import type { BrickPickController } from '../../adapters/types'
import type {
  BrickPickProgress,
  BrickPickResult,
  DifficultyPreset,
  DifficultySettings,
  ItemStat,
} from '../../core'
import '../../styles/student.css'

export interface StudentJoinScreenProps {
  /** URL 의 ?code= 에서 읽은 값. 없으면 null. */
  initialCode: string | null
  onExit: () => void
}

/** 닉네임 길이 상한. worker/protocol 의 NICK_MAX 와 같은 값이다. */
const NICK_MAX = 12

/** 화면에 그대로 나가면 태그로 읽힐 수 있는 기호 — 서버(cleanNick)와 같은 목록. */
const BAD_NICK_CHARS = ['<', '>', '&', '"', "'", '\\', '`']

/** 경기 진행 보고 간격. 이것보다 촘촘히 보내지 않는다. */
const PROGRESS_INTERVAL_MS = 400

/** done 을 못 보냈을 때 다시 시도하기까지 기다리는 시간. */
const DONE_RETRY_MS = 1500

/** done 재시도 횟수 상한. */
const DONE_MAX_TRIES = 3

type Stage = 'form' | 'waiting' | 'playing' | 'submitted' | 'result'

type SendState = 'idle' | 'sending' | 'sent' | 'failed'

interface FinalPayload {
  token: string
  matchId: string
  score: number
  livesRemaining: number
  bricksDestroyed: number
  playedMs: number
  wavesCleared: number
  items: ItemStat[]
}

interface MyRun {
  score: number
  bricksDestroyed: number
  livesRemaining: number
}

/**
 * 서버(cleanNick)와 **같은 방식으로** 닉네임을 다듬는다.
 * 여기서 먼저 다듬어야, 보낸 이름과 화면에 뜨는 이름이 어긋나지 않는다.
 */
function cleanNickLocal(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length && out.length < NICK_MAX; i += 1) {
    const ch = raw[i]
    const code = raw.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) continue
    if (BAD_NICK_CHARS.indexOf(ch) >= 0) continue
    out += ch
  }
  return out.trim()
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function StudentJoinScreen({ initialCode, onExit }: StudentJoinScreenProps) {
  /* ---------------------------------------------------------------- 화면 상태 */

  const [stage, setStage] = useState<Stage>('form')
  const [code, setCode] = useState(() => normalizeCodeInput(initialCode ?? ''))
  const [nick, setNick] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  /** 지금 붙어 있는가. false 여도 게임은 그대로 돈다. */
  const [online, setOnline] = useState(false)
  /** 되살릴 수 없는 연결 오류(재접속을 포기했을 때). */
  const [liveError, setLiveError] = useState<string | null>(null)
  const [joinedCount, setJoinedCount] = useState(0)
  const [roomPhase, setRoomPhase] = useState<string>('lobby')

  const [match, setMatch] = useState<MatchStartView | null>(null)
  const [result, setResult] = useState<ResultBroadcast | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [gameError, setGameError] = useState<string | null>(null)
  const [sendState, setSendState] = useState<SendState>('idle')
  const [myRun, setMyRun] = useState<MyRun | null>(null)
  const [confirmExit, setConfirmExit] = useState(false)

  const [available] = useState(() => LiveClient.available())
  const [motionOff] = useState(() => prefersReducedMotion())

  /* ---------------------------------------------------------------- 보관함 */

  // 연결은 화면이 다시 그려져도 그대로 유지된다.
  const clientRef = useRef<LiveClient | null>(null)
  if (clientRef.current === null) clientRef.current = new LiveClient()

  const gameHostRef = useRef<HTMLDivElement | null>(null)
  const codeInputRef = useRef<HTMLInputElement | null>(null)
  const nickInputRef = useRef<HTMLInputElement | null>(null)

  /** 참여 요청을 보내 놓고 응답을 기다리는 중인가. */
  const joiningRef = useRef(false)
  /** 지금 내 닉네임(이벤트 처리기 안에서 옛 값을 보지 않도록 ref 로 둔다). */
  const nickRef = useRef('')
  const matchIdRef = useRef<string | null>(null)

  /** 아직 서버가 받아 주지 않은 최종 기록. */
  const pendingFinalRef = useRef<{ payload: FinalPayload; tries: number } | null>(null)
  const sendingRef = useRef(false)
  /** 직전에 보낸 점수의 서명. 같으면 보내지 않는다. */
  const lastSigRef = useRef('')
  const lastSentAtRef = useRef(0)

  /* ---------------------------------------------------------------- 최종 기록 올리기 */

  // 매 렌더마다 최신 판으로 바꿔 둔다 (이벤트 처리기가 옛 상태를 보지 않게).
  const flushFinalRef = useRef<() => Promise<void>>(async () => {})
  flushFinalRef.current = async () => {
    const pending = pendingFinalRef.current
    const client = clientRef.current
    if (!pending || !client || !client.ready || sendingRef.current) return
    sendingRef.current = true
    setSendState('sending')
    try {
      await client.request('done', pending.payload)
      pendingFinalRef.current = null
      setSendState('sent')
    } catch {
      pending.tries += 1
      if (pending.tries >= DONE_MAX_TRIES) {
        // 더 매달리지 않는다. 게임은 이미 끝났고, 선생님이 다시 시작할 수 있다.
        pendingFinalRef.current = null
        setSendState('failed')
      } else {
        setSendState('idle')
        window.setTimeout(() => {
          void flushFinalRef.current()
        }, DONE_RETRY_MS)
      }
    } finally {
      sendingRef.current = false
    }
  }

  /* ---------------------------------------------------------------- 연결 */

  useEffect(() => {
    const client = clientRef.current
    if (!client) return undefined

    const off = client.on((event: LiveEvent) => {
      if (event.type === 'error') {
        if (joiningRef.current) {
          // 참여 자체가 거절됐다(코드가 틀렸거나 방이 꽉 찼다). 서버 문구를 그대로 보여 준다.
          joiningRef.current = false
          setConnecting(false)
          setFormError(event.message)
          setStage('form')
          client.disconnect()
        } else {
          setLiveError(event.message)
        }
        return
      }

      if (event.type === 'match') {
        matchIdRef.current = event.match.matchId
        pendingFinalRef.current = null
        lastSigRef.current = ''
        lastSentAtRef.current = 0
        setResult(null)
        setNotice(null)
        setGameError(null)
        setMyRun(null)
        setSendState('idle')
        setMatch(event.match)
        setStage('playing')
        return
      }

      if (event.type === 'result') {
        setResult(event.result)
        setStage('result')
        return
      }

      if (event.type === 'cancel') {
        pendingFinalRef.current = null
        matchIdRef.current = null
        setMatch(null)
        setResult(null)
        setMyRun(null)
        setSendState('idle')
        setNotice('선생님이 경기를 취소했습니다.')
        setStage('waiting')
        return
      }

      // change — 명단·접속 상태가 바뀌었다.
      const snap = client.snapshot
      setOnline(client.ready)
      setJoinedCount(typeof snap?.joined === 'number' ? snap.joined : 0)
      setRoomPhase(typeof snap?.phase === 'string' ? snap.phase : 'lobby')
      if (client.ready) setLiveError(null)
      else if (client.lastError) setLiveError(client.lastError)

      if (joiningRef.current && client.ready && snap) {
        joiningRef.current = false
        setConnecting(false)
        setFormError(null)
        setStage((s) => (s === 'form' ? 'waiting' : s))
      }

      // 다시 붙었다면, 못 보낸 최종 기록을 이때 올린다.
      if (client.ready) void flushFinalRef.current()
    })

    return () => {
      off()
      client.disconnect()
    }
  }, [])

  /* ---------------------------------------------------------------- 게임 마운트 */

  const matchId = match?.matchId ?? null

  useEffect(() => {
    if (stage !== 'playing' || !match) return undefined
    const host = gameHostRef.current
    if (!host) return undefined

    const token = deviceToken()
    let controller: BrickPickController | null = null

    const handleProgress = (progress: BrickPickProgress) => {
      const client = clientRef.current
      const id = matchIdRef.current
      if (!client || !id) return
      const me = progress.leaderboard[0]
      const score = me ? me.score : 0
      const lives = me ? me.livesRemaining : 0
      const ratio = Math.max(0, Math.min(1, progress.progress))
      // 값이 그대로면 보내지 않는다 — 30명이 800ms마다 같은 값을 올릴 이유가 없다.
      const sig = `${score}|${lives}|${Math.round(ratio * 100)}`
      if (sig === lastSigRef.current) return
      const now = Date.now()
      if (now - lastSentAtRef.current < SCORE_SHARE_MS) return
      lastSigRef.current = sig
      lastSentAtRef.current = now
      // notify — 응답을 기다리지 않는다. 끊겨 있으면 조용히 버려지고 게임은 계속된다.
      client.notify('score', {
        token,
        matchId: id,
        score,
        lives,
        // 중간 보고에는 벽돌 수가 없다. 최종 기록(done)에서 정확한 값이 올라간다.
        bricksDestroyed: 0,
        progress: ratio,
      })
    }

    const handleComplete = (matchResult: BrickPickResult) => {
      const me = matchResult.participants[0]
      const payload: FinalPayload = {
        token,
        matchId: match.matchId,
        score: me?.score ?? 0,
        livesRemaining: me?.livesRemaining ?? 0,
        bricksDestroyed: me?.bricksDestroyed ?? 0,
        playedMs: me?.playedMs ?? 0,
        wavesCleared: me?.wavesCleared ?? 0,
        items: me?.items ?? [],
      }
      pendingFinalRef.current = { payload, tries: 0 }
      setMyRun({
        score: payload.score,
        bricksDestroyed: payload.bricksDestroyed,
        livesRemaining: payload.livesRemaining,
      })
      setStage('submitted')
      void flushFinalRef.current()
    }

    try {
      controller = mountBrickPick(host, {
        participants: [{ id: token, nickname: nickRef.current || '나' }],
        mode: 'manual',
        seed: match.seed,
        difficulty: match.difficulty as DifficultyPreset,
        difficultySettings: match.difficultySettings as Partial<DifficultySettings> | undefined,
        roundDurationMs: match.roundDurationMs,
        // 혼자 도는 판이라 의미는 없다. 검증을 통과하기 위한 값이다.
        selectionRule: { kind: 'top', count: 1 },
        soundEnabled: match.soundEnabled,
        reducedMotion: match.reducedMotion,
        // 혼자니까 순위표는 필요 없고, 결과는 선생님이 집계한 뒤 서버가 내려준다.
        showLeaderboard: false,
        showResult: false,
        // 조작 줄(시작·일시정지·경기 취소·소리·전체화면)은 학생 폰에서 숨긴다.
        // 좁은 화면에서 게임판 높이를 먹고, "경기 취소" 를 누르면 그 학생만 기록이 없어진다.
        // **발사 버튼과 준비 화면은 이것과 무관하게 그대로 나온다.**
        showControls: false,
        autoStart: true,
        progressIntervalMs: PROGRESS_INTERVAL_MS,
        onProgress: handleProgress,
        onComplete: handleComplete,
        onCancel: () => setGameError('경기가 중단되었습니다. 선생님께 알려 주세요.'),
        onError: (event) => setGameError(event.message),
      })
    } catch (err) {
      setGameError(
        err instanceof Error ? err.message : '게임을 띄우지 못했습니다. 새로고침해 주세요.',
      )
    }

    return () => {
      try {
        controller?.destroy()
      } catch {
        /* 이미 정리됐을 수 있다 */
      }
    }
    // matchId 가 바뀔 때만 다시 마운트한다 — 경기 중 재마운트는 진행을 잃는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, matchId])

  /* ---------------------------------------------------------------- 초점 */

  useEffect(() => {
    if (stage !== 'form') return
    // QR 로 들어왔으면 코드는 이미 채워져 있다 — 바로 별명 칸으로 보낸다.
    const target = normalizeCodeInput(code).length === 6 ? nickInputRef.current : codeInputRef.current
    try {
      target?.focus()
    } catch {
      /* 초점을 못 줘도 화면은 쓸 수 있다 */
    }
    // 화면이 바뀔 때 한 번만 준다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  /* ---------------------------------------------------------------- 조작 */

  const submitJoin = (e: FormEvent) => {
    e.preventDefault()
    if (connecting) return

    const cleanCode = normalizeCodeInput(code)
    if (cleanCode.length !== 6) {
      setFormError('수업 코드는 6자리입니다. 화면에 뜬 코드를 그대로 입력해 주세요.')
      codeInputRef.current?.focus()
      return
    }
    const cleanNick = cleanNickLocal(nick)
    if (!cleanNick) {
      setFormError('별명을 입력해 주세요. 공백이나 기호만으로는 참여할 수 없습니다.')
      nickInputRef.current?.focus()
      return
    }
    if (!available) {
      setFormError('이 주소에서는 실시간 참여를 쓸 수 없습니다. 선생님이 알려 준 주소로 다시 들어와 주세요.')
      return
    }

    setCode(cleanCode)
    setNick(cleanNick)
    nickRef.current = cleanNick
    setFormError(null)
    setNotice(null)
    setLiveError(null)
    setConnecting(true)
    joiningRef.current = true

    const client = clientRef.current
    if (!client) return
    client.disconnect()
    client.connect(cleanCode, 'student', cleanNick)
  }

  const backToForm = () => {
    joiningRef.current = false
    setConnecting(false)
    setStage('form')
    setNotice(null)
    clientRef.current?.disconnect()
  }

  const leaveRoom = () => {
    const client = clientRef.current
    if (client) void client.leave()
    onExit()
  }

  /* ---------------------------------------------------------------- 조각들 */

  const connectionBar =
    stage === 'form' ? null : (
      <p
        className={`bp-stu-conn ${online ? 'bp-stu-conn--on' : 'bp-stu-conn--off'}`}
        role="status"
        aria-live="polite"
      >
        <span aria-hidden="true">{online ? '●' : '○'}</span>{' '}
        {online
          ? '연결됨'
          : liveError
            ? liveError
            : '연결이 끊겼습니다. 다시 연결하는 중입니다…'}
      </p>
    )

  /* ---------------------------------------------------------------- ① 코드 입력 */

  if (stage === 'form') {
    return (
      <section className="bp-stu" aria-labelledby="bp-stu-title">
        <div className="bp-stu-scroll">
          <header className="bp-stu-head">
            <h1 id="bp-stu-title" className="bp-stu-title">
              수업에 참여하기
            </h1>
            <p className="bp-stu-lead">
              선생님 화면에 뜬 6자리 수업 코드를 입력하면 바로 들어갑니다.
            </p>
          </header>

          <form className="bp-stu-form" onSubmit={submitJoin} noValidate>
            <div className="bp-stu-field">
              <label className="bp-stu-label" htmlFor="bp-stu-code">
                수업 코드
              </label>
              <input
                id="bp-stu-code"
                ref={codeInputRef}
                className="bp-stu-input bp-stu-input--code"
                type="text"
                value={code}
                onChange={(e) => setCode(normalizeCodeInput(e.target.value))}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                maxLength={6}
                placeholder="ABC123"
                aria-describedby="bp-stu-code-hint"
              />
              <p id="bp-stu-code-hint" className="bp-stu-hint">
                대문자와 숫자 6자리입니다. 소문자로 적어도 알아서 대문자가 됩니다.
              </p>
            </div>

            <div className="bp-stu-field">
              <label className="bp-stu-label" htmlFor="bp-stu-nick">
                화면에 보일 별명
              </label>
              <input
                id="bp-stu-nick"
                ref={nickInputRef}
                className="bp-stu-input"
                type="text"
                value={nick}
                onChange={(e) => setNick(e.target.value.slice(0, NICK_MAX))}
                maxLength={NICK_MAX}
                autoComplete="off"
                placeholder="예) 초록펭귄"
                aria-describedby="bp-stu-nick-hint"
              />
              <p id="bp-stu-nick-hint" className="bp-stu-hint">
                이름 대신 별명을 써도 됩니다. 학번·실명은 보내지 않습니다. 최대 {NICK_MAX}자.
              </p>
            </div>

            {formError ? (
              <p className="bp-stu-error" role="alert">
                <span aria-hidden="true">⚠ </span>
                {formError}
              </p>
            ) : null}

            <button
              type="submit"
              className="bp-stu-btn bp-stu-btn--primary bp-stu-btn--wide"
              disabled={connecting}
            >
              {connecting ? '참여하는 중…' : '참여하기'}
            </button>
          </form>

          <p className="bp-stu-privacy">
            올라가는 것은 <strong>별명과 점수</strong>뿐입니다. 게임은 여러분 폰에서 돌아가고,
            선생님 화면은 점수만 모읍니다.
          </p>

          <button type="button" className="bp-stu-linkbtn" onClick={onExit}>
            처음 화면으로 돌아가기
          </button>
        </div>
      </section>
    )
  }

  /* ---------------------------------------------------------------- ② 대기 */

  if (stage === 'waiting') {
    return (
      <section className="bp-stu" aria-labelledby="bp-stu-title">
        <div className="bp-stu-scroll">
          {connectionBar}
          <header className="bp-stu-head">
            <h1 id="bp-stu-title" className="bp-stu-title">
              선생님이 시작하면 바로 시작해요
            </h1>
            <p className="bp-stu-lead">이 화면을 그대로 두고 기다려 주세요.</p>
          </header>

          {notice ? (
            <p className="bp-stu-notice" role="status">
              <span aria-hidden="true">ℹ </span>
              {notice}
            </p>
          ) : null}

          {roomPhase === 'playing' ? (
            <p className="bp-stu-notice" role="status">
              <span aria-hidden="true">⏳ </span>
              지금 경기가 진행 중입니다. 다음 판부터 함께합니다.
            </p>
          ) : null}

          <div className="bp-stu-me">
            <p className="bp-stu-me__label">내 별명</p>
            <p className="bp-stu-me__nick">{nick}</p>
            <button type="button" className="bp-stu-btn bp-stu-btn--small" onClick={backToForm}>
              이름 바꾸기
            </button>
          </div>

          <p className="bp-stu-count">
            지금까지 <strong>{joinedCount}</strong>명이 들어왔습니다. · 수업 코드{' '}
            <span className="bp-stu-code-chip">{code}</span>
          </p>

          <div className="bp-stu-foot">
            {confirmExit ? (
              <div className="bp-stu-confirm" role="group" aria-label="수업 나가기 확인">
                <p className="bp-stu-confirm__text">
                  나가면 명단에서 내 별명이 지워집니다. 나갈까요?
                </p>
                <button
                  type="button"
                  className="bp-stu-btn bp-stu-btn--small"
                  onClick={() => setConfirmExit(false)}
                >
                  계속 기다리기
                </button>
                <button
                  type="button"
                  className="bp-stu-btn bp-stu-btn--small bp-stu-btn--danger"
                  onClick={leaveRoom}
                >
                  나가기
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="bp-stu-linkbtn"
                onClick={() => setConfirmExit(true)}
              >
                수업 나가기
              </button>
            )}
          </div>
        </div>
      </section>
    )
  }

  /* ---------------------------------------------------------------- ③ 경기 */

  if (stage === 'playing') {
    return (
      <section className="bp-stu bp-stu--play" aria-labelledby="bp-stu-title">
        <div className="bp-stu-playbar">
          <h1 id="bp-stu-title" className="bp-stu-playbar__title">
            <span className="bp-stu-playbar__nick">{nick}</span>
            <span className="bp-stu-playbar__meta">
              {online ? '점수 전송 중' : '연결 끊김 · 게임은 계속됩니다'}
            </span>
          </h1>
        </div>
        {gameError ? (
          <div className="bp-stu-gameerr" role="alert">
            <p className="bp-stu-error">
              <span aria-hidden="true">⚠ </span>
              {gameError}
            </p>
            <button
              type="button"
              className="bp-stu-btn bp-stu-btn--small"
              onClick={() => {
                setGameError(null)
                setMatch(null)
                setStage('waiting')
              }}
            >
              대기 화면으로
            </button>
          </div>
        ) : null}
        <div className="bp-stu-stage" ref={gameHostRef} />
      </section>
    )
  }

  /* ---------------------------------------------------------------- ③-2 집계 대기 */

  if (stage === 'submitted') {
    return (
      <section className="bp-stu" aria-labelledby="bp-stu-title">
        <div className="bp-stu-scroll">
          {connectionBar}
          <header className="bp-stu-head">
            <h1 id="bp-stu-title" className="bp-stu-title">
              선생님이 집계하는 중입니다
            </h1>
            <p className="bp-stu-lead">잠시만 이 화면을 그대로 두세요. 곧 결과가 뜹니다.</p>
          </header>

          {myRun ? (
            <dl className="bp-stu-run">
              <div className="bp-stu-run__item">
                <dt>내 점수</dt>
                <dd className="bp-stu-run__big">{myRun.score.toLocaleString('ko-KR')}</dd>
              </div>
              <div className="bp-stu-run__item">
                <dt>깬 벽돌</dt>
                <dd>{myRun.bricksDestroyed}개</dd>
              </div>
              <div className="bp-stu-run__item">
                <dt>남은 목숨</dt>
                <dd>{myRun.livesRemaining}</dd>
              </div>
            </dl>
          ) : null}

          <p className="bp-stu-send" role="status" aria-live="polite">
            {sendState === 'sent' ? (
              <>
                <span aria-hidden="true">✓ </span>점수를 보냈습니다.
              </>
            ) : sendState === 'failed' ? (
              <>
                <span aria-hidden="true">⚠ </span>
                점수를 보내지 못했습니다. 선생님께 점수를 말씀드려 주세요.
              </>
            ) : (
              <>
                <span aria-hidden="true">… </span>점수를 보내는 중입니다.
              </>
            )}
          </p>
        </div>
      </section>
    )
  }

  /* ---------------------------------------------------------------- ④ 결과 */

  const picked = !!result && result.selectedNicks.indexOf(nick) >= 0
  const myRow = result ? result.board.find((row) => row.nick === nick) ?? null : null

  return (
    <section className="bp-stu" aria-labelledby="bp-stu-title">
      <div className="bp-stu-scroll">
        {connectionBar}

        {picked ? (
          <div
            className="bp-stu-picked"
            data-motion={motionOff || match?.reducedMotion ? 'off' : 'on'}
          >
            <p className="bp-stu-picked__mark" aria-hidden="true">
              ★
            </p>
            <h1 id="bp-stu-title" className="bp-stu-picked__title">
              이번 발표자는 나!
            </h1>
            <p className="bp-stu-picked__nick">{nick}</p>
            {result && result.reasons.length > 0 ? (
              <p className="bp-stu-picked__reason">{result.reasons[0]}</p>
            ) : null}
          </div>
        ) : (
          <header className="bp-stu-head">
            <h1 id="bp-stu-title" className="bp-stu-title">
              이번 발표자
            </h1>
            <p className="bp-stu-others">
              {result && result.selectedNicks.length > 0
                ? result.selectedNicks.map((n, i) => (
                    <span key={`${n}-${i}`} className="bp-stu-others__nick">
                      {n}
                    </span>
                  ))
                : '이번에는 아무도 뽑히지 않았습니다.'}
            </p>
            {myRow ? (
              <p className="bp-stu-lead">
                나({nick})는 {myRow.rank}위 ·{' '}
                {myRow.score === null ? '기록 없음' : `${myRow.score.toLocaleString('ko-KR')}점`}
                입니다.
              </p>
            ) : (
              <p className="bp-stu-lead">내 기록은 순위표에 올라가지 않았습니다.</p>
            )}
          </header>
        )}

        <h2 className="bp-stu-subtitle">전체 순위</h2>
        <ol className="bp-stu-board">
          {(result?.board ?? []).map((row, i) => {
            const mine = row.nick === nick
            return (
              <li
                key={`${row.nick}-${i}`}
                className={`bp-stu-board__row${mine ? ' bp-stu-board__row--me' : ''}`}
              >
                <span className="bp-stu-board__rank">{row.rank}</span>
                <span className="bp-stu-board__nick">
                  {row.nick}
                  {mine ? <span className="bp-stu-board__tag">나</span> : null}
                  {row.picked ? <span className="bp-stu-board__tag">발표</span> : null}
                </span>
                <span className="bp-stu-board__score">
                  {row.score === null ? '—' : row.score.toLocaleString('ko-KR')}
                </span>
              </li>
            )
          })}
        </ol>

        <div className="bp-stu-foot">
          <p className="bp-stu-hint">다음 판을 기다리려면 이 화면을 그대로 두세요.</p>
          <button
            type="button"
            className="bp-stu-btn bp-stu-btn--small"
            onClick={() => {
              setResult(null)
              setNotice(null)
              setStage('waiting')
            }}
          >
            대기 화면으로
          </button>
        </div>
      </div>
    </section>
  )
}
