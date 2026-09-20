/**
 * 데모 학생(봇) — 교사 혼자 리허설하기.
 *
 * 왜 필요한가
 *  실시간 참여 화면은 사람이 여럿 있어야 비로소 모습이 나온다. 혼자서는 명단도
 *  점수판도 빈 화면이라, 교사가 수업 전에 "실제로 이렇게 보이겠구나" 를 얻을 수 없다.
 *
 * ★ 가장 중요한 규칙 — 진짜 학생과 **같은 경로·같은 시점**으로 보낸다
 *  예전에 데모봇이 서버로 바로 결과를 쏘고, 진짜 학생 화면은 다른 함수를 거쳤다.
 *  그런데 진짜 쪽이 잘못된 시점에 불리고 있었다. 데모는 잘 차오르는데 실제 수업에서는
 *  내내 0이었다. 데모가 버그를 찾아 준 게 아니라 **가리고 있었다.**
 *  그래서 이 파일의 봇은 진짜 학생 폰과 똑같이
 *    · join  : 붙자마자 1회
 *    · score : 경기 중 800ms(SCORE_SHARE_MS) 마다, **값이 바뀌었을 때만**
 *    · done  : 경기가 끝났을 때 1회
 *  만 보낸다. 메시지 모양도 worker/protocol 의 ScoreReport / FinalReport 그대로다.
 *  진짜 학생 화면의 보내는 시점이 바뀌면 **이 파일도 같이 고쳐야 한다.**
 *
 * 왜 LiveClient 를 그대로 쓰지 않는가
 *  LiveClient 의 deviceToken() 은 기기마다 하나다(localStorage). 봇 20명이 그걸 쓰면
 *  서버에는 한 명으로 보인다. 그래서 여기서는 표준 WebSocket 을 봇마다 하나씩 열고,
 *  **같은 메시지 봉투**({t, i, d})를 같은 시점에 보낸다.
 *
 * 개인정보
 *  올라가는 것은 닉네임(가짜 사람 이름)과 점수뿐이다. 실명·학번·반은 없다.
 *
 * 이 파일은 교사 화면에서 **동적 import** 로만 불러야 한다.
 *   const { startDemoBots } = await import('./live/demoBots')
 * 학생 폰이 이 코드를 받을 이유가 없다.
 */

import type { MatchStartView } from '../../../worker/protocol'
import { DEMO_PREFIX, ROOM_MAX_MEMBERS } from '../../../worker/protocol'
import { SCORE_SHARE_MS } from '../../live/client'

/* ------------------------------------------------------------------ 공개 계약 */

export interface DemoBotHandle {
  /** 봇 전원이 `leave` 를 보내고 소켓을 닫는다. 끝나면 서버에 아무것도 남지 않는다. */
  stop(): Promise<void>
  /** 실제로 띄운 봇 수. */
  count: number
}

export interface DemoBotOptions {
  /** 수업 코드 6자. */
  code: string
  /** 띄울 봇 수. 1 ~ 40(ROOM_MAX_MEMBERS) 으로 잘린다. */
  count: number
  /** 기본값은 현재 사이트. 개발 중 다른 주소를 볼 때만 바꾼다. */
  origin?: string
}

/* ------------------------------------------------------------------ 만드는 값 */

/**
 * 짧은 사람 이름. `user1`, `test2` 를 쓰면 리허설 화면이 지저분해져
 * "실제로 이렇게 보이겠구나" 를 못 얻는다.
 */
const NICKS = [
  '가람', '나래', '다올', '라온', '마루', '바다',
  '사랑', '아라', '푸른', '하늘', '한별', '해든',
  '슬기', '나무', '미르', '보람', '아름', '윤슬',
  '초록', '다솜', '단비', '새롬', '온새미', '밤톨',
]

/** 한꺼번에 도착하지 않는다. 실제로 30명이 동시에 누르는 일은 없다. */
const JOIN_MIN_MS = 900
const JOIN_MAX_MS = 6000

/** 이 비율만큼은 done 을 보내지 않고 중간에서 멈춘다(교사가 "언제 집계할까" 를 판단하게). */
const QUIT_RATIO = 0.2

/** 봇이 쓰는 목숨 수. core 의 기본값과 같은 3으로 둔다. */
const START_LIVES = 3

/** 응답(ack)을 기다리는 시간. 넘으면 조용히 포기한다 — 리허설이 멈추면 안 된다. */
const ACK_TIMEOUT_MS = 6000

const rnd = (min: number, max: number): number => min + Math.random() * (max - min)

/** 12자 상한(NICK_MAX) 안에서 서로 다른 이름을 만든다. */
function nickFor(index: number): string {
  const base = NICKS[index % NICKS.length]
  const round = Math.floor(index / NICKS.length)
  return round === 0 ? base : `${base}${round + 1}`
}

/* ------------------------------------------------------------------ 봇 한 명 */

interface BotPlan {
  /** 실력 0 ~ 1. 점수가 갈리는 가장 큰 이유. */
  skill: number
  /** 속도. 1보다 크면 같은 시간에 점수를 더 빨리 쌓는다. */
  pace: number
  /** 끝까지 못 하는 봇인가. true 면 done 을 보내지 않는다. */
  quits: boolean
  /** 경기가 이 진행률에 닿으면 끝낸다(0 ~ 1). quits 면 여기서 조용히 멈춘다. */
  endAt: number
  /** 최종 점수. 진행률에 따라 이 값까지 차오른다. */
  finalScore: number
  /** 최종 벽돌 수. */
  finalBricks: number
  /** 최종 남은 목숨. */
  finalLives: number
  /** 클리어한 판 수. */
  waves: number
}

function planFor(): BotPlan {
  const skill = Math.random()
  const quits = Math.random() < QUIT_RATIO
  // 실력이 좋을수록 일찍 판을 깨고 끝난다. 못 하는 봇은 시간을 다 쓴다.
  const cleared = !quits && skill > 0.55 && Math.random() < 0.5
  return {
    skill,
    pace: rnd(0.82, 1.28),
    quits,
    endAt: quits ? rnd(0.3, 0.8) : cleared ? rnd(0.7, 0.95) : 1,
    // 점수 폭이 넓어야 순위표가 실제처럼 갈린다.
    finalScore: Math.round(rnd(250, 700) + skill * rnd(1800, 3200)),
    finalBricks: Math.round(rnd(8, 20) + skill * rnd(30, 70)),
    finalLives: Math.max(0, Math.min(START_LIVES, Math.round(skill * START_LIVES + rnd(-0.6, 0.6)))),
    waves: skill > 0.75 ? 2 : skill > 0.45 ? 1 : 0,
  }
}

class DemoBot {
  readonly token: string
  readonly nick: string
  private readonly plan = planFor()
  private readonly url: string

  private ws: WebSocket | null = null
  private seq = 1
  private waiting = new Map<number, (err: string | null, data?: unknown) => void>()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private tick: ReturnType<typeof setInterval> | null = null

  private match: MatchStartView | null = null
  private startedAt = 0
  private finished = false
  /** 마지막으로 서버에 올린 값. 같으면 다시 보내지 않는다. */
  private lastSent = ''
  private stopped = false

  constructor(index: number, url: string) {
    this.token = `${DEMO_PREFIX}${index}-${Math.random().toString(36).slice(2, 7)}`
    this.nick = nickFor(index)
    this.url = url
  }

  /** 소켓을 열고 join 까지 마친다. 실패하면 reject. */
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket
      try {
        ws = new WebSocket(this.url)
      } catch {
        reject(new Error('데모 학생을 붙일 수 없습니다.'))
        return
      }
      this.ws = ws

      ws.onopen = () => {
        // ── 진짜 학생 화면: 소켓이 열리자마자 join 1회. (LiveClient.connect → ws.onopen)
        this.request('join', { token: this.token, nick: this.nick, role: 'student' })
          .then((d) => {
            // 늦게 들어왔는데 이미 경기 중이면 진짜 학생처럼 그 자리에서 판을 만든다.
            const snap = d as { phase?: string; match?: MatchStartView | null } | null
            if (snap && snap.phase === 'playing' && snap.match) this.beginMatch(snap.match)
            resolve()
          })
          .catch(reject)
      }

      ws.onmessage = (ev) => {
        let msg: { t?: string; i?: number; d?: unknown; err?: string }
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
        } catch {
          return
        }
        if (!msg || typeof msg.t !== 'string') return

        if (msg.t === 'ack') {
          const cb = msg.i !== undefined ? this.waiting.get(msg.i) : undefined
          if (cb && msg.i !== undefined) {
            this.waiting.delete(msg.i)
            cb(msg.err ?? null, msg.d)
          }
          return
        }
        // ── 진짜 학생 화면: 'match' 를 받으면 그때 판을 만들고 플레이를 시작한다.
        if (msg.t === 'match' && msg.d) {
          this.beginMatch(msg.d as MatchStartView)
          return
        }
        if (msg.t === 'cancel') {
          this.endMatch(false)
          return
        }
        // roster / board / result — 봇은 화면이 없으니 볼 것이 없다.
      }

      ws.onclose = () => {
        // 봇은 스스로 다시 붙지 않는다. 리허설이 조용히 늘어나면 안 되기 때문이다.
        this.clearTimers()
        for (const [id, cb] of [...this.waiting]) {
          this.waiting.delete(id)
          cb('연결이 끊겼습니다.')
        }
        if (!this.stopped) reject(new Error('연결이 끊겼습니다.'))
      }

      ws.onerror = () => {
        /* onclose 가 이어서 처리한다 */
      }
    })
  }

  /* --------------------------------------------------------------- 경기 진행 */

  private beginMatch(match: MatchStartView): void {
    this.match = match
    this.startedAt = Date.now()
    this.finished = false
    this.lastSent = ''
    if (this.tick !== null) clearInterval(this.tick)
    // ── 진짜 학생 화면: 경기 중 SCORE_SHARE_MS(800ms) 마다 score 를 올린다.
    //    더 잦으면 40명이 서버를 두드리고, 더 뜸하면 교사 화면의 진행 막대가 끊겨 보인다.
    this.tick = setInterval(() => this.step(), SCORE_SHARE_MS)
  }

  private step(): void {
    const match = this.match
    if (!match || this.finished || this.stopped) return

    const duration = Math.max(1000, Number(match.roundDurationMs) || 60_000)
    // 실제로 시간이 흐르는 것처럼 0 → 1 로 올린다.
    const elapsed = Date.now() - this.startedAt
    const timeProgress = Math.max(0, Math.min(1, elapsed / duration))

    if (timeProgress >= this.plan.endAt) {
      this.endMatch(!this.plan.quits)
      return
    }

    // 실력·속도에 따라 점수가 차오르는 속도가 다르다.
    const grown = Math.max(0, Math.min(1, (timeProgress / this.plan.endAt) * this.plan.pace))
    const score = Math.round(this.plan.finalScore * grown)
    const bricks = Math.round(this.plan.finalBricks * grown)
    const lives = Math.max(
      this.plan.finalLives,
      START_LIVES - Math.round((START_LIVES - this.plan.finalLives) * grown),
    )
    this.sendScore(match.matchId, score, lives, bricks, timeProgress)
  }

  /**
   * ── 진짜 학생 화면: 값이 **바뀌었을 때만** 보낸다.
   * 멈춰 있는 학생이 800ms 마다 같은 숫자를 다시 올리면, 교사 화면에서
   * "아직 하고 있는 사람" 과 "손 놓은 사람" 이 구분되지 않는다.
   */
  private sendScore(
    matchId: string,
    score: number,
    lives: number,
    bricksDestroyed: number,
    progress: number,
  ): void {
    const key = `${score}|${lives}|${bricksDestroyed}|${Math.round(progress * 100)}`
    if (key === this.lastSent) return
    this.lastSent = key
    // worker/protocol 의 ScoreReport 그대로.
    this.notify('score', { token: this.token, matchId, score, lives, bricksDestroyed, progress })
  }

  /** 경기 종료. finish=false 면 done 을 보내지 않고 중간에서 멈춘 것이다. */
  private endMatch(finish: boolean): void {
    if (this.finished) return
    this.finished = true
    if (this.tick !== null) {
      clearInterval(this.tick)
      this.tick = null
    }
    const match = this.match
    if (!match) return
    const playedMs = Math.round(
      Math.max(0, Math.min(1, this.plan.endAt)) * (Number(match.roundDurationMs) || 60_000),
    )

    if (!finish) {
      // 끝까지 못 한 봇. 서버에서는 status 가 'playing' 인 채로 남고, 교사 화면에서
      // "아직 안 끝난 사람 n명" 으로 보인다. 집계하면 미플레이로 빠진다.
      return
    }

    // ── 진짜 학생 화면: 경기가 끝나는 순간 done 1회. 이게 유실되면 그 학생은
    //    집계에서 통째로 빠지므로, ack 를 기다리고 실패하면 한 번 더 보낸다.
    //    worker/protocol 의 FinalReport 그대로.
    const report = {
      token: this.token,
      matchId: match.matchId,
      score: this.plan.finalScore,
      livesRemaining: this.plan.finalLives,
      bricksDestroyed: this.plan.finalBricks,
      playedMs,
      wavesCleared: this.plan.waves,
      items: [] as unknown[],
    }
    this.request('done', report).catch(() => {
      this.request('done', report).catch(() => {
        /* 리허설이다 — 못 보내도 멈추지 않는다 */
      })
    })
  }

  /* --------------------------------------------------------------- 주고받기 */

  private request(type: string, data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('연결되지 않았습니다.'))
        return
      }
      const id = this.seq++
      this.waiting.set(id, (err, d) => (err ? reject(new Error(err)) : resolve(d)))
      const timer = setTimeout(() => {
        if (this.waiting.has(id)) {
          this.waiting.delete(id)
          reject(new Error('응답이 없습니다.'))
        }
      }, ACK_TIMEOUT_MS)
      this.timers.add(timer)
      ws.send(JSON.stringify({ t: type, i: id, d: data }))
    })
  }

  /** 응답이 필요 없는 알림. 연결이 없으면 조용히 버린다(진짜 학생 화면과 같다). */
  private notify(type: string, data: unknown): void {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify({ t: type, d: data }))
    } catch {
      /* 끊겼다 — 다음 보고에서 따라잡는다 */
    }
  }

  after(ms: number, fn: () => void): void {
    const timer = setTimeout(fn, ms)
    this.timers.add(timer)
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    if (this.tick !== null) {
      clearInterval(this.tick)
      this.tick = null
    }
  }

  /** 서버에서 이 봇이 남긴 것을 지우고 소켓을 닫는다. */
  async stop(): Promise<void> {
    this.stopped = true
    this.clearTimers()
    try {
      // 'leave' 는 서버가 이 토큰의 기록을 명단에서 **삭제**한다.
      await this.request('leave', { token: this.token })
    } catch {
      /* 못 보내도 닫는다. 남은 것은 교사 화면의 reset {what:'demo'} 가 걷어낸다. */
    }
    this.waiting.clear()
    try {
      this.ws?.close()
    } catch {
      /* 이미 닫혔다 */
    }
    this.ws = null
  }
}

/* ------------------------------------------------------------------ 바깥에서 쓰는 것 */

/**
 * 데모 학생을 띄운다.
 *
 * 반환된 promise 는 **첫 봇이 방에 들어간 뒤** 완료된다(코드가 틀렸거나 방이 꽉 찼으면
 * 여기서 오류가 난다). 나머지 봇은 그 뒤로 0.9~6초에 걸쳐 흩어져 들어온다.
 */
export async function startDemoBots(opts: DemoBotOptions): Promise<DemoBotHandle> {
  const code = String(opts.code ?? '').trim().toUpperCase()
  if (!code) throw new Error('수업 코드가 필요합니다.')

  const count = Math.max(1, Math.min(ROOM_MAX_MEMBERS, Math.trunc(Number(opts.count) || 0)))
  const base = opts.origin || `${location.protocol}//${location.host}`
  const url = `${base.replace(/^http/, 'ws')}/ws?code=${encodeURIComponent(code)}`

  const bots: DemoBot[] = []
  for (let i = 0; i < count; i += 1) bots.push(new DemoBot(i, url))

  const stop = async (): Promise<void> => {
    await Promise.all(bots.map((b) => b.stop()))
  }

  // 첫 봇은 바로 붙여 오류를 곧장 알린다.
  const first = bots[0]
  try {
    await first.open()
  } catch (err) {
    await stop()
    throw err instanceof Error ? err : new Error('데모 학생을 붙이지 못했습니다.')
  }

  // 나머지는 흩어져 들어온다 — 한꺼번에 도착하면 교사가 "기다릴까 넘어갈까" 를 연습할 수 없다.
  for (let i = 1; i < bots.length; i += 1) {
    const bot = bots[i]
    bot.after(Math.round(rnd(JOIN_MIN_MS, JOIN_MAX_MS)), () => {
      bot.open().catch(() => {
        /* 한 명 못 붙어도 리허설은 계속된다 */
      })
    })
  }

  return { stop, count: bots.length }
}
