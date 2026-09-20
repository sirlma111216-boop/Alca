/**
 * 실시간 참여 프로토콜 — 서버(Durable Object)와 브라우저가 함께 쓴다.
 *
 * 라이브러리 없이 표준 WebSocket 한 줄로 주고받는다. 모양은 셋뿐이다.
 *   요청 + 응답   { t: 'join', i: 7, d: {...} }  →  { t: 'ack', i: 7, d: {...} }
 *   서버 밀어주기 { t: 'board', d: {...} }
 *   오류          { t: 'ack', i: 7, err: '...' }
 *
 * 설계 원칙
 *  - 계정을 만들지 않는다. **6자리 수업 코드가 가장 가벼운 계정이다.**
 *  - 기기마다 무작위 토큰을 쓴다. 이름이 아니라서 서버도 누가 누군지 모른다.
 *  - 실명·학번·반은 서버로 올라가지 않는다. 올라가는 것은 학생이 정한 닉네임과 점수뿐이다.
 *  - 점수 계산은 학생 폰에서 끝난다. 서버는 모으기만 한다(발표자 뽑기용으로 충분하다).
 */

/** 이 프로토콜의 버전. 배포가 어긋나면 화면에 "다시 배포하세요" 를 띄우는 근거가 된다. */
export const LIVE_PROTOCOL_VERSION = '1.0'

/** 수업 코드 길이. */
export const CODE_LENGTH = 6

/** 한 방에 들어올 수 있는 최대 인원. core 의 MAX_PARTICIPANTS 와 맞춘다. */
export const ROOM_MAX_MEMBERS = 40

/** 닉네임 길이 상한. */
export const NICK_MAX = 12

// ────────────────────────────────────────────────────────────────────────────
// 메시지 봉투
// ────────────────────────────────────────────────────────────────────────────

export interface Envelope<T = unknown> {
  /** 메시지 종류. */
  t: string
  /** 요청 번호. 응답(ack)에 그대로 실려 돌아온다. 서버가 먼저 보낼 때는 없다. */
  i?: number
  d?: T
  err?: string
}

export const encode = (msg: Envelope): string => JSON.stringify(msg)

export function decode(raw: string | ArrayBuffer): Envelope | null {
  try {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
    const msg = JSON.parse(text) as Envelope
    return msg && typeof msg.t === 'string' ? msg : null
  } catch {
    return null
  }
}

export const ack = (id: number | undefined, data: unknown): string =>
  encode({ t: 'ack', i: id, d: data })

export const nack = (id: number | undefined, message: string): string =>
  encode({ t: 'ack', i: id, err: message })

export const push = (type: string, data: unknown): string => encode({ t: type, d: data })

// ────────────────────────────────────────────────────────────────────────────
// 수업 코드
// ────────────────────────────────────────────────────────────────────────────

/** 헷갈리는 글자(0 O 1 I L)를 뺀 31자. 교실에서 불러 주기 좋게. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function makeCode(): string {
  let out = ''
  const buf = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(buf)
  for (let i = 0; i < CODE_LENGTH; i += 1) out += ALPHABET[buf[i] % ALPHABET.length]
  return out
}

/** 사람이 친 코드를 서버·브라우저 양쪽에서 **같은 방식으로** 다듬는다. */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, CODE_LENGTH)
}

// ────────────────────────────────────────────────────────────────────────────
// 문자열 다듬기 — 화면에 그대로 나가므로 서버에서도 반드시 거른다
// ────────────────────────────────────────────────────────────────────────────

/** 화면에 그대로 나가면 태그로 읽힐 수 있는 기호. */
const BAD_CHARS = ['<', '>', '&', '"', "'", '\\', '`']

/**
 * 닉네임을 다듬는다. 정규식 대신 한 글자씩 걸러 escape 사고를 피한다.
 * 클라이언트만 믿지 않는다 — 서버에서 한 번 더 자른다.
 */
export function cleanNick(v: unknown): string {
  const s = String(v ?? '')
  let out = ''
  for (let i = 0; i < s.length && out.length < NICK_MAX; i += 1) {
    const n = s.charCodeAt(i)
    if (n < 0x20 || n === 0x7f) continue // 제어문자
    if (BAD_CHARS.indexOf(s[i]) >= 0) continue
    out += s[i]
  }
  return out.trim()
}

/** 토큰은 기기가 만든 무작위 문자열이다. 길이만 자른다. */
export const cleanToken = (v: unknown): string => String(v ?? '').slice(0, 48)

// ────────────────────────────────────────────────────────────────────────────
// 방 상태
// ────────────────────────────────────────────────────────────────────────────

/** 방의 진행 단계. */
export type RoomPhase =
  /** 학생을 받는 중. */
  | 'lobby'
  /** 경기가 진행 중. 늦게 들어온 학생은 다음 판을 기다린다. */
  | 'playing'
  /** 집계가 끝나 발표자가 정해졌다. */
  | 'finished'

/** 학생 한 명의 상태. */
export type MemberStatus = 'waiting' | 'playing' | 'done'

export interface MemberView {
  /** 학생이 스스로 정한 닉네임. 실명이 아니다. */
  nick: string
  /** 지금 붙어 있는지. 끊긴 사람은 화면에 흐리게 그린다. */
  on: boolean
  status: MemberStatus
  /** 진행 중이거나 끝난 학생의 현재 점수. 아직이면 null. */
  score: number | null
  lives: number | null
  /** 0 ~ 1. */
  progress: number
}

export interface RosterView {
  members: MemberView[]
  joined: number
  online: number
  /** 경기를 마친 사람 수. */
  done: number
}

/**
 * 교사가 경기를 시작할 때 모든 학생에게 내려보내는 내용.
 * 이 값으로 각 폰이 **똑같은 판**을 만든다.
 */
export interface MatchStartView {
  /** 이번 경기 식별자. 늦게 온 메시지를 걸러낸다. */
  matchId: string
  /** 전원 동일. 같은 seed = 같은 벽돌·같은 아이템 배치. */
  seed: string
  /** core 의 DifficultyPreset. */
  difficulty: string
  /** core 의 Partial<DifficultySettings> — 아이템 설정 포함. */
  difficultySettings?: unknown
  roundDurationMs: number
  /** 학생 화면에서는 쓰지 않지만, 규칙 요약을 보여 줄 때 쓴다. */
  selectionRule?: unknown
  soundEnabled: boolean
  reducedMotion: boolean
}

/** 학생 폰이 경기 중에 올리는 중간 보고. */
export interface ScoreReport {
  token: string
  matchId: string
  score: number
  lives: number
  bricksDestroyed: number
  /** 0 ~ 1. */
  progress: number
}

/**
 * 학생 폰이 경기를 마쳤을 때 올리는 최종 기록.
 * 교사 화면이 이것들을 모아 core 의 computeRanking / selectPresenters 로 순위를 낸다.
 */
export interface FinalReport {
  token: string
  matchId: string
  score: number
  livesRemaining: number
  bricksDestroyed: number
  playedMs: number
  wavesCleared: number
  /** [{kind, dropped, collected}] — core 의 ItemStat. */
  items: unknown
}

/** 교사 화면이 집계를 마친 뒤 모두에게 알리는 결과. */
export interface ResultBroadcast {
  matchId: string
  /** 선정된 학생의 닉네임 (학생 화면에 크게 뜬다). */
  selectedNicks: string[]
  /** 선정 근거 한 줄씩. */
  reasons: string[]
  /** 닉네임·점수·순위만 담은 가벼운 순위표. */
  board: Array<{ nick: string; score: number | null; rank: number; picked: boolean }>
}

// ────────────────────────────────────────────────────────────────────────────
// 서버가 먼저 보내는 메시지 종류
// ────────────────────────────────────────────────────────────────────────────

export type ServerPushType =
  /** 명단·접속 상태가 바뀜 (250ms 묶음). */
  | 'roster'
  /** 경기 시작 — 학생 폰이 이걸 받으면 바로 판을 만든다. */
  | 'match'
  /** 실시간 점수판 (700ms 묶음). */
  | 'board'
  /** 최종 결과. */
  | 'result'
  /** 교사가 경기를 취소함. */
  | 'cancel'

/**
 * 데모봇 토큰은 이 말로 시작한다.
 * 교사 화면이 새로고침되어 정리 신호를 못 보냈더라도 다음에 걷어낼 수 있다.
 */
export const DEMO_PREFIX = 'demo-'
