/**
 * 수업 하나 = Durable Object 하나.
 *
 * `idFromName(code)` 로 찾으므로 **같은 코드면 언제나 같은 객체**로 간다.
 * 외부 데이터베이스가 필요 없는 이유이고, 새로고침해도 방이 살아 있는 이유다.
 *
 * 서버가 하는 일은 셋뿐이다.
 *   1. 누가 들어왔는지 센다 (명단)
 *   2. 교사가 누른 "시작" 을 모두에게 알린다 (같은 seed)
 *   3. 올라온 점수를 모아 교사 화면에 밀어 준다
 *
 * **점수 계산과 순위 계산은 서버가 하지 않는다.** 각 폰이 같은 엔진으로 계산하고,
 * 최종 순위·발표자는 교사 화면이 core 의 순수 함수로 낸다.
 *
 * 담는 것: 학생이 스스로 정한 닉네임과 점수뿐. 실명·학번·반은 올라오지 않는다.
 */

import { DurableObject } from 'cloudflare:workers'
import {
  DEMO_PREFIX,
  ROOM_MAX_MEMBERS,
  ack,
  cleanNick,
  cleanToken,
  decode,
  nack,
  push,
} from './protocol'
import type {
  FinalReport,
  MatchStartView,
  MemberStatus,
  MemberView,
  RoomPhase,
  RosterView,
} from './protocol'

/** 수업이 끝나고 이만큼 지나면 방을 비운다. 두 차시가 한 주 떨어져 있어도 이어지게. */
const TTL_MS = 8 * 24 * 60 * 60 * 1000

/** 30명이 한꺼번에 들어와도 방송이 폭주하지 않도록 묶어 보낸다. */
const ROSTER_THROTTLE_MS = 250

/** 점수판은 덩치가 커서 조금 더 느슨하게 묶는다. */
const BOARD_THROTTLE_MS = 700

interface MemberRecord {
  nick: string
  at: number
  status: MemberStatus
  score: number | null
  lives: number | null
  bricksDestroyed: number
  progress: number
  /** 경기를 마쳤을 때의 최종 기록. 교사 화면이 이걸로 순위를 낸다. */
  final: FinalReport | null
}

interface RoomState {
  createdAt: number
  updatedAt: number
  phase: RoomPhase
  /** 교사 기기의 토큰. 제어 메시지는 이 토큰만 보낼 수 있다. */
  hostToken: string | null
  /** 지금 경기의 설정. 늦게 들어온 학생에게도 그대로 준다. */
  match: MatchStartView | null
  members: Record<string, MemberRecord>
}

interface Attachment {
  token: string
  role: 'host' | 'student'
}

export class RoomSession extends DurableObject {
  private state: RoomState | null = null
  private loading: Promise<void> | null = null
  private rosterTimer: ReturnType<typeof setTimeout> | null = null
  private boardTimer: ReturnType<typeof setTimeout> | null = null

  /* ------------------------------------------------------------ 상태 보관 */

  private async load(): Promise<RoomState> {
    if (this.state) return this.state
    if (!this.loading) {
      this.loading = (async () => {
        const saved = (await this.ctx.storage.get('state')) as Partial<RoomState> | undefined
        const fresh = saved && Date.now() - (saved.updatedAt ?? 0) < TTL_MS
        // 기본 칸을 앞에 늘어놓는 게 요령이다 — 예전 판에 없던 칸이 생겨도 undefined 로 안 터진다.
        this.state = fresh
          ? {
              createdAt: Date.now(),
              updatedAt: Date.now(),
              phase: 'lobby',
              hostToken: null,
              match: null,
              members: {},
              ...saved,
            }
          : {
              createdAt: Date.now(),
              updatedAt: Date.now(),
              phase: 'lobby',
              hostToken: null,
              match: null,
              members: {},
            }
      })()
    }
    await this.loading
    if (!this.state) throw new Error('방 상태를 불러오지 못했습니다.')
    return this.state
  }

  private async save(): Promise<void> {
    if (!this.state) return
    this.state.updatedAt = Date.now()
    await this.ctx.storage.put('state', this.state)
  }

  /* ------------------------------------------------------------ 조회 */

  /** 지금 붙어 있는 기기들의 토큰. */
  private onlineTokens(): Set<string> {
    const on = new Set<string>()
    for (const ws of this.ctx.getWebSockets()) {
      let a: Attachment | null = null
      try {
        a = ws.deserializeAttachment() as Attachment
      } catch {
        /* 아직 join 전 */
      }
      if (a && a.token) on.add(a.token)
    }
    return on
  }

  /**
   * 참여자 명단. 실명이 아니라 학생이 스스로 정한 닉네임만 나간다.
   * 잠깐 끊긴 사람도 목록에 남기되 접속 여부를 따로 표시한다
   * (교사가 "누가 아직 안 들어왔지?" 를 봐야 하기 때문).
   */
  private roster(): RosterView {
    const on = this.onlineTokens()
    const s = this.state as RoomState
    const members: MemberView[] = Object.keys(s.members).map((t) => {
      const m = s.members[t]
      return {
        nick: m.nick,
        on: on.has(t),
        status: m.status,
        score: m.score,
        lives: m.lives,
        progress: m.progress,
      }
    })
    members.sort((a, b) => a.nick.localeCompare(b.nick, 'ko'))
    return {
      members,
      joined: members.length,
      online: members.filter((m) => m.on).length,
      done: members.filter((m) => m.status === 'done').length,
    }
  }

  /** 교사·학생 화면으로 내려보내는 한 덩어리. */
  private snap(): Record<string, unknown> {
    const s = this.state as RoomState
    return { ...this.roster(), phase: s.phase, match: s.match }
  }

  /** 교사 화면이 순위를 내는 데 쓰는, 최종 기록이 붙은 명단. */
  private finals(): Array<{ token: string; nick: string; status: MemberStatus; final: FinalReport | null }> {
    const s = this.state as RoomState
    return Object.keys(s.members).map((t) => ({
      token: t,
      nick: s.members[t].nick,
      status: s.members[t].status,
      final: s.members[t].final,
    }))
  }

  /** 제어 메시지를 보낼 자격이 있는가. */
  private isHost(token: string): boolean {
    const s = this.state as RoomState
    return !!token && s.hostToken === token
  }

  /* ------------------------------------------------------------ 실시간 */

  override async fetch(): Promise<Response> {
    await this.load()
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    // 잠들었다 깨어나도 연결이 유지되도록 hibernation API 를 쓴다.
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const msg = decode(raw)
    if (!msg) return
    const s = await this.load()

    try {
      switch (msg.t) {
        // ── 방에 들어온다 ──────────────────────────────────────────────────
        case 'join': {
          const d = (msg.d ?? {}) as Record<string, unknown>
          const token = cleanToken(d.token)
          const nick = cleanNick(d.nick)
          const wantsHost = d.role === 'host'
          if (!token) {
            ws.send(nack(msg.i, '기기 식별자가 없습니다.'))
            break
          }

          if (wantsHost) {
            // 교사 자리는 한 자리. 단, 원래 교사가 끊겼으면 다시 잡을 수 있게 한다
            // (새로고침·기기 교체로 수업이 멈추면 안 되므로).
            const on = this.onlineTokens()
            if (s.hostToken && s.hostToken !== token && on.has(s.hostToken)) {
              ws.send(nack(msg.i, '이미 다른 기기가 이 수업을 진행하고 있습니다.'))
              break
            }
            s.hostToken = token
            await this.save()
          } else {
            if (!nick) {
              ws.send(nack(msg.i, '이름을 입력해 주세요.'))
              break
            }
            const isNew = !s.members[token]
            if (isNew && Object.keys(s.members).length >= ROOM_MAX_MEMBERS) {
              ws.send(nack(msg.i, `이 수업은 최대 ${ROOM_MAX_MEMBERS}명까지 참여할 수 있습니다.`))
              break
            }
            // 같은 기기로 다시 들어오면 이름만 갱신하고 점수는 살린다.
            s.members[token] = {
              nick,
              at: isNew ? Date.now() : s.members[token].at,
              status: isNew ? 'waiting' : s.members[token].status,
              score: isNew ? null : s.members[token].score,
              lives: isNew ? null : s.members[token].lives,
              bricksDestroyed: isNew ? 0 : s.members[token].bricksDestroyed,
              progress: isNew ? 0 : s.members[token].progress,
              final: isNew ? null : s.members[token].final,
            }
            await this.save()
          }

          ws.serializeAttachment({ token, role: wantsHost ? 'host' : 'student' } satisfies Attachment)
          ws.send(
            ack(msg.i, {
              ...this.snap(),
              you: { token, role: wantsHost ? 'host' : 'student', nick: nick || null },
              isHost: this.isHost(token),
            }),
          )
          this.scheduleRoster()
          break
        }

        // ── 교사: 경기를 시작한다 ─────────────────────────────────────────
        case 'start': {
          const d = (msg.d ?? {}) as Record<string, unknown>
          const token = cleanToken(d.token)
          if (!this.isHost(token)) {
            ws.send(nack(msg.i, '진행 권한이 없습니다.'))
            break
          }
          const match = d.match as MatchStartView | undefined
          if (!match || typeof match.seed !== 'string' || typeof match.matchId !== 'string') {
            ws.send(nack(msg.i, '경기 설정이 올바르지 않습니다.'))
            break
          }
          s.match = match
          s.phase = 'playing'
          // 새 경기니까 지난 기록을 비운다. 명단은 남긴다.
          for (const t of Object.keys(s.members)) {
            s.members[t].status = 'waiting'
            s.members[t].score = null
            s.members[t].lives = null
            s.members[t].bricksDestroyed = 0
            s.members[t].progress = 0
            s.members[t].final = null
          }
          await this.save()
          ws.send(ack(msg.i, this.snap()))
          this.broadcastNow('match', s.match)
          this.scheduleRoster()
          break
        }

        // ── 학생: 경기 중 중간 보고 ───────────────────────────────────────
        case 'score': {
          const d = (msg.d ?? {}) as Record<string, unknown>
          const token = cleanToken(d.token)
          const m = s.members[token]
          if (!m) {
            ws.send(nack(msg.i, '참여자 명단에 없습니다.'))
            break
          }
          // 지난 경기의 뒤늦은 메시지는 버린다.
          if (!s.match || d.matchId !== s.match.matchId) {
            ws.send(ack(msg.i, { ignored: true }))
            break
          }
          if (m.status !== 'done') m.status = 'playing'
          m.score = num(d.score, 0)
          m.lives = num(d.lives, 0)
          m.bricksDestroyed = num(d.bricksDestroyed, 0)
          m.progress = Math.max(0, Math.min(1, num(d.progress, 0)))
          await this.save()
          ws.send(ack(msg.i, { ok: true }))
          this.scheduleBoard()
          break
        }

        // ── 학생: 경기를 마쳤다 ───────────────────────────────────────────
        case 'done': {
          const d = (msg.d ?? {}) as Record<string, unknown>
          const token = cleanToken(d.token)
          const m = s.members[token]
          if (!m) {
            ws.send(nack(msg.i, '참여자 명단에 없습니다.'))
            break
          }
          if (!s.match || d.matchId !== s.match.matchId) {
            ws.send(ack(msg.i, { ignored: true }))
            break
          }
          m.status = 'done'
          m.score = num(d.score, 0)
          m.lives = num(d.livesRemaining, 0)
          m.bricksDestroyed = num(d.bricksDestroyed, 0)
          m.progress = 1
          m.final = {
            token,
            matchId: String(d.matchId),
            score: num(d.score, 0),
            livesRemaining: num(d.livesRemaining, 0),
            bricksDestroyed: num(d.bricksDestroyed, 0),
            playedMs: num(d.playedMs, 0),
            wavesCleared: num(d.wavesCleared, 0),
            items: Array.isArray(d.items) ? d.items.slice(0, 16) : [],
          }
          await this.save()
          ws.send(ack(msg.i, { ok: true }))
          this.scheduleBoard()
          this.scheduleRoster()
          break
        }

        // ── 교사: 최종 기록을 가져간다 (순위는 교사 화면이 계산한다) ──────
        case 'collect': {
          const d = (msg.d ?? {}) as Record<string, unknown>
          const token = cleanToken(d.token)
          if (!this.isHost(token)) {
            ws.send(nack(msg.i, '진행 권한이 없습니다.'))
            break
          }
          ws.send(ack(msg.i, { matchId: s.match?.matchId ?? null, finals: this.finals() }))
          break
        }

        // ── 교사: 집계 결과를 모두에게 알린다 ─────────────────────────────
        case 'result': {
          const d = (msg.d ?? {}) as Record<string, unknown>
          const token = cleanToken(d.token)
          if (!this.isHost(token)) {
            ws.send(nack(msg.i, '진행 권한이 없습니다.'))
            break
          }
          s.phase = 'finished'
          await this.save()
          ws.send(ack(msg.i, { ok: true }))
          this.broadcastNow('result', d.result ?? null)
          this.scheduleRoster()
          break
        }

        // ── 교사: 경기를 취소한다 ─────────────────────────────────────────
        case 'cancel': {
          const d = (msg.d ?? {}) as Record<string, unknown>
          const token = cleanToken(d.token)
          if (!this.isHost(token)) {
            ws.send(nack(msg.i, '진행 권한이 없습니다.'))
            break
          }
          s.phase = 'lobby'
          s.match = null
          for (const t of Object.keys(s.members)) {
            s.members[t].status = 'waiting'
            s.members[t].progress = 0
            s.members[t].final = null
          }
          await this.save()
          ws.send(ack(msg.i, this.snap()))
          this.broadcastNow('cancel', { at: Date.now() })
          this.scheduleRoster()
          break
        }

        // ── 이 기기가 남긴 것을 모두 지운다 (데모봇 정리에 쓴다) ──────────
        case 'leave': {
          const d = (msg.d ?? {}) as Record<string, unknown>
          const token = cleanToken(d.token)
          if (token && s.members[token]) {
            delete s.members[token]
            await this.save()
          }
          ws.send(ack(msg.i, { ok: true }))
          this.scheduleRoster()
          this.scheduleBoard()
          break
        }

        // ── 교사: 비우기 ──────────────────────────────────────────────────
        case 'reset': {
          const d = (msg.d ?? {}) as Record<string, unknown>
          const token = cleanToken(d.token)
          if (!this.isHost(token)) {
            ws.send(nack(msg.i, '진행 권한이 없습니다.'))
            break
          }
          const what = String(d.what ?? 'scores')
          if (what === 'all') s.members = {}
          if (what === 'demo') {
            // 교사 화면이 새로고침되어 leave 를 못 보냈을 때를 위해 둔다.
            for (const t of Object.keys(s.members)) {
              if (t.indexOf(DEMO_PREFIX) !== 0) continue
              delete s.members[t]
            }
          }
          if (what === 'scores' || what === 'all') {
            for (const t of Object.keys(s.members)) {
              s.members[t].status = 'waiting'
              s.members[t].score = null
              s.members[t].lives = null
              s.members[t].bricksDestroyed = 0
              s.members[t].progress = 0
              s.members[t].final = null
            }
            s.phase = 'lobby'
            s.match = null
          }
          await this.save()
          ws.send(ack(msg.i, this.snap()))
          this.scheduleRoster()
          this.scheduleBoard()
          break
        }

        default:
          ws.send(nack(msg.i, '알 수 없는 요청입니다.'))
      }
    } catch {
      ws.send(nack(msg.i, '처리 중 문제가 생겼습니다.'))
    }
  }

  override webSocketClose(): void {
    this.scheduleRoster()
  }

  override webSocketError(): void {
    this.scheduleRoster()
  }

  /* ------------------------------------------------------------ 방송 */

  /** 곧바로 보낸다 (경기 시작·결과처럼 묶으면 안 되는 것). */
  private broadcastNow(type: string, data: unknown): void {
    const payload = push(type, data)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload)
      } catch {
        /* 끊긴 소켓은 넘어간다 */
      }
    }
  }

  /** 짧은 시간 안의 여러 변경을 한 번으로 묶는다. */
  private scheduleRoster(): void {
    if (this.rosterTimer) return
    this.rosterTimer = setTimeout(() => {
      this.rosterTimer = null
      if (!this.state) return
      this.broadcastNow('roster', this.snap())
    }, ROSTER_THROTTLE_MS)
  }

  /** 점수판은 덩치가 커서 따로 묶어 보낸다. */
  private scheduleBoard(): void {
    if (this.boardTimer) return
    this.boardTimer = setTimeout(() => {
      this.boardTimer = null
      if (!this.state) return
      this.broadcastNow('board', this.roster())
    }, BOARD_THROTTLE_MS)
  }

  /** 화면 없이 상태만 확인할 때 (문제 생겼을 때 들여다보기 용). */
  async snapshot(): Promise<Record<string, unknown>> {
    const s = await this.load()
    return { ...this.snap(), createdAt: s.createdAt, updatedAt: s.updatedAt }
  }
}

/** 올라온 숫자를 믿을 수 있는 범위로만 받는다. */
function num(v: unknown, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  // 점수·벽돌 수가 말도 안 되게 크면 잘라 낸다(화면이 깨지지 않게).
  return Math.max(-1_000_000, Math.min(10_000_000, n))
}
