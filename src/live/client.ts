/**
 * 실시간 참여 — 브라우저 쪽.
 *
 * 규칙 (실제 수업에서 데어 본 것들)
 *  1. 서버가 준 응답을 **필드별로 다시 만들지 않는다.** 통째로 받는다.
 *     새 칸이 생겼을 때 조용히 사라지는 사고가 가장 찾기 어렵다.
 *  2. 기기마다 무작위 토큰. 이름이 아니다 — 서버도 누가 누군지 모른다.
 *  3. 실명·학번·반을 보내지 않는다. 올라가는 것은 닉네임과 점수뿐이다.
 *  4. 끊기면 스스로 돌아온다. 그래도 **연결이 없어도 게임은 혼자 돌아간다.**
 *  5. 경기 중 점수는 "끝나고 한 번" 이 아니라 **하는 동안 계속** 올린다.
 *     안 그러면 교사 화면의 진행 상황이 내내 0이다.
 */

import type {
  MatchStartView,
  ResultBroadcast,
  RosterView,
} from '../../worker/protocol'

export type LiveRole = 'host' | 'student'

export interface LiveSnapshot extends Partial<RosterView> {
  phase?: string
  match?: MatchStartView | null
  /** 서버가 새 칸을 더해도 그대로 실려 온다. */
  [key: string]: unknown
}

export type LiveEvent =
  | { type: 'change' }
  | { type: 'match'; match: MatchStartView }
  | { type: 'result'; result: ResultBroadcast }
  | { type: 'cancel' }
  | { type: 'error'; message: string }

export interface LiveClientOptions {
  /** 기본값은 현재 사이트. 개발 중 다른 주소를 볼 때만 바꾼다. */
  origin?: string
}

const TOKEN_KEY = 'brickpick:liveToken'
/**
 * 교사 기기의 토큰은 **따로** 둔다.
 *
 * 같은 브라우저에서 교사 화면과 학생 화면을 함께 열면 (교사가 학생 쪽을 확인해 보는 흔한 경우)
 * 두 화면이 같은 localStorage 를 쓴다. 키가 하나뿐이면 학생 화면이 토큰을 덮어써
 * 교사가 "진행 권한이 없습니다" 로 자기 수업에서 쫓겨난다. 실제로 겪었다.
 */
const HOST_TOKEN_KEY = 'brickpick:liveHostToken'
const HOST_CODES_KEY = 'brickpick:hostCodes'
const HOST_KEEP_MS = 8 * 24 * 60 * 60 * 1000 // 서버 보관 기간과 같게
const HOST_MAX = 5

/** 경기 중 점수를 올리는 간격. 너무 잦으면 30명이 서버를 두드린다. */
export const SCORE_SHARE_MS = 800

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeStore(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 사생활 보호 모드 등 — 저장 못 해도 게임은 그대로 돈다 */
  }
}

/**
 * 이 기기의 식별자. 이름이 아니라 무작위 값이라 서버도 누가 누군지 모른다.
 *
 * @param role 교사 화면은 'host' 를 준다. 학생 화면과 다른 칸을 쓰므로
 *             한 브라우저에서 둘을 함께 열어도 서로의 토큰을 덮어쓰지 않는다.
 */
export function deviceToken(role: LiveRole = 'student'): string {
  const key = role === 'host' ? HOST_TOKEN_KEY : TOKEN_KEY
  const prefix = role === 'host' ? 'h' : 'd'
  let t = readStore<string | null>(key, null)
  if (!t) {
    t = `${prefix}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    writeStore(key, t)
  }
  return t
}

/**
 * ★ 서버 응답을 통째로 받는다.
 * 필드 이름을 여기서 일일이 적으면, 서버에 칸이 하나 늘었을 때 그 칸이 조용히 버려진다.
 */
export function takeSnapshot(d: unknown): LiveSnapshot | null {
  if (!d || typeof d !== 'object') return null
  const out: LiveSnapshot = {}
  for (const k of Object.keys(d as Record<string, unknown>)) {
    out[k] = (d as Record<string, unknown>)[k]
  }
  // 빠진 칸만 기본값으로 채운다 (화면이 undefined 로 터지지 않게).
  out.members = (out.members as RosterView['members']) ?? []
  out.joined = (out.joined as number) ?? 0
  out.online = (out.online as number) ?? 0
  out.done = (out.done as number) ?? 0
  return out
}

export class LiveClient {
  /** 지금 붙어 있는 수업 코드. */
  code: string | null = null
  role: LiveRole | null = null
  nick: string | null = null
  /** 서버가 준 마지막 상태. 통째로 받은 것이다. */
  snapshot: LiveSnapshot | null = null
  /** 연결이 살아 있는가. false 여도 게임 자체는 돌아간다. */
  ready = false
  /** 내가 진행자(교사)인가. */
  isHost = false
  lastError: string | null = null

  private ws: WebSocket | null = null
  private seq = 1
  private waiting = new Map<number, (err: string | null, data?: unknown) => void>()
  private listeners = new Set<(e: LiveEvent) => void>()
  private retry = 0
  private closedByUs = false
  private readonly origin: string

  constructor(options: LiveClientOptions = {}) {
    this.origin = options.origin ?? ''
  }

  /** 이 앱이 Worker 위에서 돌고 있는가 (= 실시간 기능을 쓸 수 있는가). */
  static available(): boolean {
    return typeof WebSocket !== 'undefined' && /^https?:$/.test(location.protocol)
  }

  on(handler: (e: LiveEvent) => void): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  private emit(e: LiveEvent): void {
    for (const h of [...this.listeners]) {
      try {
        h(e)
      } catch (err) {
        console.warn('[brickpick] live 이벤트 처리 중 오류', err)
      }
    }
  }

  /** 교사: 새 수업 코드를 발급받는다. Worker 가 없으면 실패한다. */
  async createCode(): Promise<string> {
    const res = await fetch(`${this.origin}/api/new-code`, { cache: 'no-store' })
    if (!res.ok) throw new Error('실시간 기능을 쓸 수 없습니다. 배포된 주소에서만 됩니다.')
    const data = (await res.json()) as { code?: string }
    if (!data.code) throw new Error('수업 코드를 받지 못했습니다.')
    rememberHostCode(data.code)
    return data.code
  }

  connect(code: string, role: LiveRole, nick?: string): void {
    this.closedByUs = false
    this.code = code
    this.role = role
    if (nick !== undefined) this.nick = nick
    this.openSocket()
  }

  private openSocket(): void {
    if (!this.code) return
    const base = this.origin || `${location.protocol}//${location.host}`
    const wsUrl = base.replace(/^http/, 'ws') + `/ws?code=${encodeURIComponent(this.code)}`

    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch {
      this.fail('연결할 수 없습니다.')
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.ready = true
      this.retry = 0
      this.lastError = null
      // 붙자마자 자기소개. 같은 토큰이면 서버가 지난 기록을 되살려 준다.
      void this.request('join', {
        token: deviceToken(this.role ?? 'student'),
        nick: this.role === 'student' ? this.nick : null,
        role: this.role,
      })
        .then((d) => {
          const snap = takeSnapshot(d)
          if (snap) this.snapshot = snap
          const you = (d as { isHost?: boolean })?.isHost
          this.isHost = !!you
          this.emit({ type: 'change' })
        })
        .catch((err: Error) => this.fail(err.message))
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
      if (msg.t === 'match' && msg.d) {
        this.emit({ type: 'match', match: msg.d as MatchStartView })
        return
      }
      if (msg.t === 'result') {
        this.emit({ type: 'result', result: msg.d as ResultBroadcast })
        return
      }
      if (msg.t === 'cancel') {
        this.emit({ type: 'cancel' })
        return
      }
      // roster / board — 통째로 받는다.
      const snap = takeSnapshot(msg.d)
      if (snap) {
        this.snapshot = { ...(this.snapshot ?? {}), ...snap }
        this.emit({ type: 'change' })
      }
    }

    ws.onclose = () => {
      this.ready = false
      this.emit({ type: 'change' })
      if (this.closedByUs || !this.code) return
      // 수업 중 잠깐 끊겨도 스스로 돌아온다.
      if (this.retry < 6) {
        this.retry += 1
        setTimeout(() => {
          if (!this.closedByUs && this.code) this.openSocket()
        }, Math.min(8000, 800 * this.retry))
      } else {
        this.fail('연결이 끊겼습니다. 새로고침해 주세요.')
      }
    }

    ws.onerror = () => {
      /* onclose 가 이어서 처리한다 */
    }
  }

  private fail(message: string): void {
    this.lastError = message
    this.emit({ type: 'error', message })
    this.emit({ type: 'change' })
  }

  /** 응답을 기다리는 요청. */
  request(type: string, data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('연결되지 않았습니다.'))
        return
      }
      const id = this.seq++
      this.waiting.set(id, (err, d) => (err ? reject(new Error(err)) : resolve(d)))
      // 응답이 영영 안 오는 경우를 대비한다.
      setTimeout(() => {
        if (this.waiting.has(id)) {
          this.waiting.delete(id)
          reject(new Error('응답이 없습니다.'))
        }
      }, 8000)
      ws.send(JSON.stringify({ t: type, i: id, d: data }))
    })
  }

  /** 응답이 필요 없는 알림. 연결이 없으면 조용히 버린다(게임은 계속 돌아야 하므로). */
  notify(type: string, data: unknown): void {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify({ t: type, d: data }))
    } catch {
      /* 끊겼다 — 다음 보고에서 따라잡는다 */
    }
  }

  disconnect(): void {
    this.closedByUs = true
    this.waiting.clear()
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* 이미 닫힘 */
      }
    }
    this.ws = null
    this.ready = false
  }

  /** 방에서 나가고 이 기기가 남긴 것을 서버에서 지운다. */
  async leave(): Promise<void> {
    try {
      await this.request('leave', { token: deviceToken(this.role ?? 'student') })
    } catch {
      /* 못 보내도 나간다 */
    }
    this.code = null
    this.role = null
    this.snapshot = null
    this.isHost = false
    this.disconnect()
    this.emit({ type: 'change' })
  }
}

/* ---------------------------------------------------------------- 교사 코드 기억 */

export interface HostCodeEntry {
  code: string
  at: number
}

/**
 * 교사가 연 코드를 기기에 남긴다.
 * 하나만 두면 다음 차시에 실수로 [새로 열기] 를 누르는 순간 지난 코드가 사라지므로
 * 최근 몇 개를 함께 들고 있는다.
 */
export function rememberHostCode(code: string): void {
  const list = hostCodes().filter((h) => h.code !== code)
  list.unshift({ code, at: Date.now() })
  writeStore(HOST_CODES_KEY, list.slice(0, HOST_MAX))
}

/** 이 기기가 연 적 있는 수업 코드들 — 최근 것부터. 8일이 지난 것은 뺀다. */
export function hostCodes(): HostCodeEntry[] {
  const raw = readStore<HostCodeEntry[]>(HOST_CODES_KEY, [])
  if (!Array.isArray(raw)) return []
  const now = Date.now()
  return raw.filter((h) => h && h.code && now - (h.at ?? 0) < HOST_KEEP_MS)
}

export function forgetHostCode(code: string): void {
  writeStore(
    HOST_CODES_KEY,
    hostCodes().filter((h) => h.code !== code),
  )
}

/** 사람이 친 코드를 서버와 **같은 방식으로** 다듬는다. */
export function normalizeCodeInput(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 6)
}
