/**
 * iframe 연동 postMessage 프로토콜.
 *
 * 게임(iframe 안)과 수업 앱(부모) 양쪽이 **이 파일 하나**를 공유한다.
 * 코드 모듈 방식과 같은 BrickPickInput / BrickPickResult 타입을 그대로 실어 나른다.
 *
 * 보안 규칙 (양쪽 모두 지켜야 한다)
 *  - 모든 메시지에 채널 이름과 프로토콜 버전을 싣는다. 다른 앱의 메시지와 섞이지 않는다.
 *  - 받는 쪽은 event.origin · event.source · 메시지 구조를 **전부** 확인한다.
 *  - 호스트는 정확한 게임 origin 으로 보낸다. targetOrigin '*' 는 쓰지 않는다.
 *  - 게임은 배포 설정으로 허용된 부모 origin 만 받아들이고, INIT 이후에는 그 부모와
 *    세션에 고정한다.
 *  - 닉네임 목록을 URL 쿼리에 넣지 않는다. 참가자는 항상 INIT 메시지로만 전달한다.
 */

import type {
  BrickPickCancelEvent,
  BrickPickErrorEvent,
  BrickPickInput,
  BrickPickProgress,
  BrickPickResult,
} from '../../core'
import { PROTOCOL_CHANNEL, PROTOCOL_VERSION } from '../../core'

export const CHANNEL = PROTOCOL_CHANNEL
export const PROTOCOL = PROTOCOL_VERSION
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = ['1.0']

/** 게임 → 호스트 */
export type GameToHostType = 'READY' | 'INIT_ACK' | 'PROGRESS' | 'COMPLETE' | 'CANCEL' | 'ERROR'
/** 호스트 → 게임 */
export type HostToGameType = 'INIT' | 'START' | 'PAUSE' | 'RESUME' | 'CANCEL' | 'COMPLETE_ACK'

export type MessageType = GameToHostType | HostToGameType

export interface EnvelopeBase<T extends MessageType, P> {
  /** 항상 'brickpick'. */
  channel: typeof CHANNEL
  protocolVersion: string
  type: T
  /** 메시지 한 건의 고유 id — 재전송 중복 판별에 쓴다. */
  messageId: string
  /** 세션과 관련된 메시지에는 반드시 들어간다. READY 에는 없다. */
  sessionId: string | null
  payload: P
}

// ── 게임 → 호스트 ───────────────────────────────────────────────────────────

/** iframe 이 뜨자마자 한 번 보낸다. 호스트는 이걸 받고 INIT 을 보낸다. */
export interface ReadyPayload {
  engineVersion: string
  schemaVersion: string
  /** 이 배포가 지원하는 기능. 호스트는 필요한 기능이 없으면 "옛 배포"라고 안내할 수 있다. */
  capabilities: readonly string[]
  /** 게임이 받아들일 수 있는 프로토콜 버전들. */
  supportedProtocolVersions: readonly string[]
}

/** INIT 을 받아들였는지 알려 준다. accepted=false 면 error 에 이유가 담긴다. */
export interface InitAckPayload {
  accepted: boolean
  sessionId: string | null
  /** 검증 중 조정된 항목 안내 (한국어). */
  warnings: string[]
  error?: BrickPickErrorEvent
  /** 실제로 적용된 입력. 호스트는 이걸로 자기 화면을 맞춘다. */
  appliedInput?: BrickPickInput
}

export type ProgressPayload = BrickPickProgress
export type CompletePayload = { result: BrickPickResult }
export type GameCancelPayload = BrickPickCancelEvent
export type ErrorPayload = BrickPickErrorEvent

// ── 호스트 → 게임 ───────────────────────────────────────────────────────────

export interface InitPayload {
  /** 코드 모듈 방식과 완전히 같은 입력 데이터. */
  input: unknown
}
export type StartPayload = Record<string, never>
export type PausePayload = Record<string, never>
export type ResumePayload = Record<string, never>
export interface HostCancelPayload {
  reason?: 'host' | 'user'
}
/** 결과를 잘 받았다는 확인. 게임은 이걸 받을 때까지 제한적으로 재전송한다. */
export interface CompleteAckPayload {
  resultId: string
}

export type BrickPickMessage =
  | EnvelopeBase<'READY', ReadyPayload>
  | EnvelopeBase<'INIT_ACK', InitAckPayload>
  | EnvelopeBase<'PROGRESS', ProgressPayload>
  | EnvelopeBase<'COMPLETE', CompletePayload>
  | EnvelopeBase<'CANCEL', GameCancelPayload | HostCancelPayload>
  | EnvelopeBase<'ERROR', ErrorPayload>
  | EnvelopeBase<'INIT', InitPayload>
  | EnvelopeBase<'START', StartPayload>
  | EnvelopeBase<'PAUSE', PausePayload>
  | EnvelopeBase<'RESUME', ResumePayload>
  | EnvelopeBase<'COMPLETE_ACK', CompleteAckPayload>

/** 완료 메시지 재전송 규칙 — ACK 가 올 때까지 이 간격으로 다시 보낸다. */
export const COMPLETE_RETRY_DELAYS_MS: readonly number[] = [800, 2000, 5000]

/** 메시지 id 만들기. 암호학적 용도가 아니므로 간단한 난수면 충분하다. */
let messageCounter = 0
export function createMessageId(prefix = 'm'): string {
  messageCounter += 1
  const rand = Math.floor(Math.random() * 0xffffff).toString(36)
  return `${prefix}${messageCounter.toString(36)}_${rand}`
}

export function createMessage<T extends MessageType, P>(
  type: T,
  sessionId: string | null,
  payload: P,
): EnvelopeBase<T, P> {
  return {
    channel: CHANNEL,
    protocolVersion: PROTOCOL,
    type,
    messageId: createMessageId(),
    sessionId,
    payload,
  }
}

/**
 * 받은 데이터가 우리 프로토콜의 메시지인지 확인한다.
 * 구조가 조금이라도 다르면 무시한다 — 다른 앱이 보낸 메시지에 반응하지 않는다.
 */
export function isBrickPickMessage(data: unknown): data is BrickPickMessage {
  if (typeof data !== 'object' || data === null) return false
  const m = data as Record<string, unknown>
  if (m.channel !== CHANNEL) return false
  if (typeof m.protocolVersion !== 'string') return false
  if (typeof m.type !== 'string') return false
  if (typeof m.messageId !== 'string') return false
  if (m.sessionId !== null && typeof m.sessionId !== 'string') return false
  if (typeof m.payload !== 'object' || m.payload === null) return false
  return true
}

export function isSupportedProtocol(version: string): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version)
}

/** origin 문자열을 정규화한다 (끝 슬래시 제거, 소문자). */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * 허용 목록 검사. 와일드카드를 지원하지 않는다 — 정확히 일치하는 origin 만 허용한다.
 * 개발 편의를 위해 http://localhost:* 와 http://127.0.0.1:* 만 별도로 허용할 수 있다.
 */
export function isOriginAllowed(
  origin: string,
  allowList: readonly string[],
  options: { allowLocalhost?: boolean } = {},
): boolean {
  const normalized = normalizeOrigin(origin)
  if (!normalized || normalized === 'null') return false
  if (allowList.some((a) => normalizeOrigin(a) === normalized)) return true
  if (options.allowLocalhost) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)
  }
  return false
}

/** 쉼표로 구분된 환경변수 문자열 → origin 배열. */
export function parseOriginList(value: string | undefined | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => normalizeOrigin(s))
    .filter((s) => s.length > 0)
}

/** 게임 쪽에서 부모 origin 을 알아내는 방법: ?parentOrigin=... 쿼리. 닉네임은 절대 넣지 않는다. */
export const PARENT_ORIGIN_QUERY_KEY = 'parentOrigin'

export function readParentOriginFromUrl(href: string): string | null {
  try {
    const url = new URL(href)
    const raw = url.searchParams.get(PARENT_ORIGIN_QUERY_KEY)
    if (!raw) return null
    return normalizeOrigin(raw)
  } catch {
    return null
  }
}

/** 호스트가 iframe 주소를 만들 때 쓴다. */
export function buildEmbedUrl(gameOrigin: string, parentOrigin: string, path = '/embed/'): string {
  const base = normalizeOrigin(gameOrigin)
  const url = new URL(path, base + '/')
  url.searchParams.set(PARENT_ORIGIN_QUERY_KEY, parentOrigin)
  return url.toString()
}
