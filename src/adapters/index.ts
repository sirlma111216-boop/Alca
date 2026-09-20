/**
 * 브릭픽 기본 진입점 — 프레임워크 무의존.
 *
 * **여기서는 React 를 절대로 import 하지 않는다.** React 를 쓰지 않는 수업 앱도
 * 이 진입점 하나로 게임을 띄울 수 있어야 하기 때문이다.
 * React 어댑터가 필요하면 'brickpick/react' 를, 부모 쪽 iframe 도우미만 필요하면
 * 'brickpick/host' 를 따로 불러 쓴다.
 *
 * ```ts
 * import { mountBrickPick } from 'brickpick'
 * const game = mountBrickPick(document.getElementById('game')!, {
 *   participants: [{ id: 's1', nickname: '김하늘' }],
 *   mode: 'auto',
 *   onComplete: (result) => save(result),
 * })
 * game.start()
 * ```
 */

// 게임 화면 스타일 — 라이브러리 빌드가 brickpick.css 를 만들도록 여기서 불러온다.
import '../styles/brickpick.css'

// ── 마운트 ──────────────────────────────────────────────────────────────────

export { mountBrickPick } from './mount'

// ── 연동 타입 ───────────────────────────────────────────────────────────────

export type {
  BrickPickController,
  BrickPickOptions,
  BrickPickReadyInfo,
  BrickPickState,
  MountBrickPick,
} from './types'

// ── iframe 연동 ─────────────────────────────────────────────────────────────

export { createBrickPickHost } from './iframe/host-client'
export type {
  BrickPickHost,
  BrickPickHostOptions,
  BrickPickHostReadyInfo,
} from './iframe/host-client'

export {
  CHANNEL as PROTOCOL_CHANNEL_NAME,
  COMPLETE_RETRY_DELAYS_MS,
  SUPPORTED_PROTOCOL_VERSIONS,
  buildEmbedUrl,
  createMessage,
  isBrickPickMessage,
  isOriginAllowed,
  isSupportedProtocol,
  normalizeOrigin,
  parseOriginList,
  readParentOriginFromUrl,
} from './iframe/protocol'
export type {
  BrickPickMessage,
  GameToHostType,
  HostToGameType,
  InitAckPayload,
  InitPayload,
  ReadyPayload,
} from './iframe/protocol'

// ── core 에서 그대로 쓸 만한 것들 ──────────────────────────────────────────

export {
  DIFFICULTY_LABELS,
  DIFFICULTY_PRESETS,
  DIFFICULTY_RANGES,
  ENGINE_CAPABILITIES,
  ENGINE_VERSION,
  ITEM_DEFS,
  ITEM_KINDS,
  ITEM_SETTING_RANGES,
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
  PLAY_STATUS_LABELS,
  PROTOCOL_CHANNEL,
  PROTOCOL_VERSION,
  ROUND_DURATION_OPTIONS_MS,
  SCHEMA_VERSION,
  SELECTION_PRESETS,
  SUPPORTED_SCHEMA_VERSIONS,
  checkSelectionRule,
  createSeedString,
  defaultDifficultySettings,
  describeSelectionRule,
  parseBrickPickInput,
  presetIdForRule,
  resolveDifficulty,
  validateParticipants,
  validateSelectionRule,
} from '../core'

export type {
  BrickPickCancelEvent,
  BrickPickErrorCode,
  BrickPickErrorEvent,
  BrickPickInput,
  BrickPickInputLike,
  BrickPickProgress,
  BrickPickResult,
  DifficultyPreset,
  DifficultySettings,
  GameMode,
  ItemKind,
  ItemSettings,
  ItemStat,
  Locale,
  Participant,
  ParticipantResult,
  PlayStatus,
  ReplayLog,
  SelectionPreset,
  SelectionReason,
  SelectionRule,
  TieInfo,
  ValidationResult,
} from '../core'
