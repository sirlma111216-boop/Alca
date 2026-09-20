/**
 * 외부 앱 ↔ 게임 공통 데이터 계약.
 *
 * 코드 모듈(mountBrickPick / <BrickPick/>)과 iframe(postMessage)이 **같은 타입과
 * 같은 런타임 검증 규칙**을 쓴다. 이 파일 하나만 보면 연동에 필요한 모양이 전부 나온다.
 *
 * 규칙
 *  - 참가자 ID 는 외부 앱이 준 값을 그대로 보존해 그대로 돌려준다. 내부 인덱스로 바꾸지 않는다.
 *  - 중복 ID 는 거절한다. 같은 닉네임은 허용한다.
 *  - 지원하지 않는 schemaVersion 은 조용히 넘어가지 않고 오류로 돌려준다.
 */

import { SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS } from './version'

// ────────────────────────────────────────────────────────────────────────────
// 기본 단위
// ────────────────────────────────────────────────────────────────────────────

export type GameMode = 'auto' | 'manual'
export type DifficultyPreset = 'easy' | 'normal' | 'hard' | 'custom'
export type Locale = 'ko' | 'en'

/** 지원하는 경기 시간(ms). 화면에서는 15/30/60초로 고른다. */
export const ROUND_DURATION_OPTIONS_MS = [15_000, 30_000, 60_000] as const
export const MIN_ROUND_DURATION_MS = 5_000
export const MAX_ROUND_DURATION_MS = 300_000

/** 기본 지원 참가자 수. 초과는 거절하고 안내한다. */
export const MIN_PARTICIPANTS = 1
export const MAX_PARTICIPANTS = 40

export interface Participant {
  /** 외부 앱의 고유 식별자. 게임은 이 값을 바꾸지 않고 그대로 돌려준다. */
  id: string
  /** 화면에 보일 이름. HTML 로 해석하지 않고 텍스트로만 출력한다. */
  nickname: string
}

// ────────────────────────────────────────────────────────────────────────────
// 아이템
// ────────────────────────────────────────────────────────────────────────────

export type ItemKind = 'expand' | 'catch' | 'multiball' | 'slow' | 'laser' | 'shield' | 'life'

export const ITEM_KINDS: readonly ItemKind[] = [
  'expand',
  'catch',
  'multiball',
  'slow',
  'laser',
  'shield',
  'life',
]

/** 아이템 동작 수치. 전부 설정 데이터라 화면에서 조절할 수 있다. */
export interface ItemSettings {
  /** 아이템 기능 전체 켜기/끄기. false 면 캡슐이 아예 생기지 않는다. */
  enabled: boolean
  /** 개별 아이템 켜기/끄기. 꺼진 아이템은 배치에서 제외된다. */
  enabledKinds: Record<ItemKind, boolean>
  /** 아이템이 들어 있는 벽돌의 비율 (0 ~ 0.6). */
  brickRatio: number
  /** 아이템별 등장 가중치 (0 이상). 전부 0이면 아이템이 배치되지 않는다. */
  weights: Record<ItemKind, number>
  /** 캡슐 낙하 속도 (논리 단위/초, 20 ~ 260). */
  capsuleSpeed: number
  /** 패들 확장 배율 (1.0 ~ 2.5). */
  expandFactor: number
  /** 패들 확장 지속 시간(ms). */
  expandDurationMs: number
  /** 캐치 지속 시간(ms). */
  catchDurationMs: number
  /** 공 하나가 패들에 붙어 있을 수 있는 최대 시간(ms). 지나면 자동 발사. */
  catchHoldMs: number
  /** 슬로우 지속 시간(ms). */
  slowDurationMs: number
  /** 슬로우 속도 배율 (0.4 ~ 1.0). */
  slowFactor: number
  /** 레이저 지속 시간(ms). */
  laserDurationMs: number
  /** 레이저 발사 간격(ms). */
  laserIntervalMs: number
  /** 동시에 존재할 수 있는 공의 최대 개수 (1 ~ 5). */
  maxBalls: number
  /** 보유할 수 있는 보호막 횟수 (0 ~ 3). */
  maxShieldCharges: number
  /** 목숨 상한 (1 ~ 9). */
  maxLives: number
}

// ────────────────────────────────────────────────────────────────────────────
// 난이도
// ────────────────────────────────────────────────────────────────────────────

/** 난이도의 모든 수치. 프리셋은 이 모양의 값을 채워 넣은 것일 뿐이다. */
export interface DifficultySettings {
  /** 공의 기본 속도 (논리 단위/초). */
  ballBaseSpeed: number
  /** 공의 최대 속도 (논리 단위/초). */
  ballMaxSpeed: number
  /** 1분당 속도 증가 비율 (0 = 가속 없음, 0.2 = 분당 20%). */
  ballAccelPerMinute: number
  /** 패들 기본 너비 (논리 단위). */
  paddleWidth: number
  /** 패들 최대 너비 (논리 단위). 확장 아이템의 상한. */
  paddleMaxWidth: number
  /** 시작 목숨 수. */
  lives: number
  /** 벽돌 행 수 (1 ~ 12). */
  brickRows: number
  /** 벽돌 최대 내구도 (1 ~ 3). */
  maxBrickDurability: number
  /** 직접 조작 모드에서만 적용되는 패들 가장자리 보정 폭 (논리 단위). 자동 경기는 항상 0. */
  manualEdgeForgiveness: number
  /** 자동 패들의 반응 지연(ms). */
  autoReactionMs: number
  /** 자동 패들의 조준 오차 표준편차 (패들 반너비 기준 배율). */
  autoAimErrorSigma: number
  /** 자동 패들이 크게 빗나갈 확률 (0 ~ 0.5). */
  autoMissChance: number
  /** 자동 패들의 최대 이동 속도 (논리 단위/초). */
  autoPaddleSpeed: number
  /** 아이템 설정. */
  items: ItemSettings
}

// ────────────────────────────────────────────────────────────────────────────
// 선정 규칙
// ────────────────────────────────────────────────────────────────────────────

/**
 * 발표자 선정 규칙.
 *  - top    : 상위 N명 (N=1 이면 "최고 성적 1명")
 *  - bottom : 하위 N명 (N=1 이면 "최저 성적 1명")
 *  - ranks  : 지정한 순위들 (하나면 "지정 순위 1명", 여러 개면 "2위·5위·8위")
 *
 * 모든 순위는 **제외 처리 후의 후보 순위(eligibleRank)** 를 기준으로 한다.
 */
export type SelectionRule =
  | { kind: 'top'; count: number }
  | { kind: 'bottom'; count: number }
  | { kind: 'ranks'; ranks: number[] }

// ────────────────────────────────────────────────────────────────────────────
// 입력
// ────────────────────────────────────────────────────────────────────────────

export interface BrickPickInput {
  schemaVersion: string
  /** 외부 앱이 만든 이번 실행의 식별자. 결과에 그대로 실려 돌아온다. */
  sessionId: string
  participants: Participant[]
  mode: GameMode
  difficulty: DifficultyPreset
  /** 프리셋 위에 덮어쓸 세부 수치. 생략하면 프리셋 그대로. */
  difficultySettings?: Partial<DifficultySettings>
  roundDurationMs: number
  selectionRule: SelectionRule
  /** 이미 발표한 사람 등 후보에서 뺄 참가자 ID 목록. */
  excludedParticipantIds: string[]
  /** 재현용 seed. 같은 seed + 같은 설정 + 같은 입력이면 결과가 같다. */
  seed: string
  locale: Locale
  soundEnabled: boolean
  reducedMotion: boolean
  /** 임베드/모듈에서 참가자 편집·설정 UI 를 숨길지. 기본 true(호스트가 이미 관리). */
  hideParticipantEditor?: boolean
  /** 재현 목적의 실행인지. 결과의 run.kind 로 나간다. */
  replayOf?: string | null
}

/** 외부에서 넘길 때 생략 가능한 항목을 표시한 느슨한 입력. normalize 가 기본값을 채운다. */
export type BrickPickInputLike = Omit<
  Partial<BrickPickInput>,
  'participants' | 'selectionRule'
> & {
  participants: Participant[]
  selectionRule?: SelectionRule
}

// ────────────────────────────────────────────────────────────────────────────
// 결과
// ────────────────────────────────────────────────────────────────────────────

/**
 * 참가자의 플레이 상태.
 *  - played     : 정상적으로 경기를 마쳤다.
 *  - not_played : 아직/끝내 플레이하지 않았다. (0점 기록과 구분된다. score 는 null)
 *  - aborted    : 도중에 취소했다. (score 는 그때까지의 점수, 후보에서는 빠진다)
 *  - excluded   : 처음부터 제외됐다. (이미 발표한 사람 등)
 */
export type PlayStatus = 'played' | 'not_played' | 'aborted' | 'excluded'

export interface ItemStat {
  kind: ItemKind
  /** 캡슐이 떨어진 횟수. */
  dropped: number
  /** 패들로 실제로 받은 횟수. */
  collected: number
}

export interface TieInfo {
  /** 같은 성적이었던 참가자가 있었는지. */
  tied: boolean
  /** 같은 성적이었던 참가자 ID 목록 (자기 자신 포함). */
  tiedWith: string[]
  /** 무엇으로 순서를 갈랐는지. */
  resolvedBy: 'none' | 'lives' | 'seed'
  /** seed 추첨으로 갈랐을 때 쓰인 추첨값 (작을수록 앞). */
  drawValue?: number
}

export interface ParticipantResult {
  id: string
  nickname: string
  /** 점수. 플레이하지 않았으면 null (0점과 구분). */
  score: number | null
  /** 전체 참가자 기준 순위. 1부터 참가자 수까지 유일. */
  rank: number
  /** 제외·미플레이를 뺀 **후보** 기준 순위. 후보가 아니면 null. */
  eligibleRank: number | null
  excluded: boolean
  playStatus: PlayStatus
  /** 남은 목숨. 플레이하지 않았으면 null. */
  livesRemaining: number | null
  /** 파괴한 벽돌 수. */
  bricksDestroyed: number
  /** 실제로 플레이한 시간(ms). 자동 경기는 경기 시간과 같다. */
  playedMs: number
  /** 클리어(전멸)시킨 판 수. */
  wavesCleared: number
  /** 아이템 획득 통계. */
  items: ItemStat[]
  tie: TieInfo
}

/**
 * 선정 규칙을 그대로 적용하지 못했을 때의 안내.
 *
 * 경기 **시작 전**에도 후보 수로 규칙을 검증하지만, 직접 조작 모드에서는 경기 중에
 * 참가자를 건너뛰거나(미플레이) 중도 취소해 후보가 줄어들 수 있다.
 * 그때 게임이 조용히 아무도 뽑지 않고 "완료" 로 끝나면 안 되므로,
 * 결과에 무엇이 모자랐는지 **기계가 읽을 수 있게** 남긴다.
 */
export interface SelectionIssue {
  code: 'NOT_ENOUGH_CANDIDATES'
  /** 화면에 그대로 띄울 수 있는 한국어 안내. */
  message: string
  /** 규칙이 뽑으려던 인원. */
  requestedCount: number
  /** 실제로 뽑힌 인원. */
  selectedCount: number
  /** 후보가 모자라 뽑지 못한 순위들 (지정 순위 규칙일 때). */
  missingRanks: number[]
  /** 경기가 끝난 시점의 후보 수. */
  candidateCount: number
}

export interface SelectionReason {
  participantId: string
  nickname: string
  /** 선정 근거가 된 후보 순위. */
  eligibleRank: number
  /** 사람이 읽을 한 줄 설명. 예: "선정 가능 참가자 12명 중 3위" */
  reason: string
}

export interface BrickPickResult {
  schemaVersion: string
  sessionId: string
  /** 이 결과 한 건의 고유 ID. 호스트는 이 값으로 중복 반영을 막는다. */
  resultId: string
  engineVersion: string
  seed: string
  /** 실제로 적용된 설정의 스냅샷 (프리셋 + 덮어쓴 값이 합쳐진 최종값). */
  appliedSettings: {
    mode: GameMode
    difficulty: DifficultyPreset
    difficultySettings: DifficultySettings
    roundDurationMs: number
    selectionRule: SelectionRule
    excludedParticipantIds: string[]
  }
  /** ISO 8601 문자열. */
  startedAt: string
  completedAt: string
  participants: ParticipantResult[]
  selectedParticipantIds: string[]
  selectionReasons: SelectionReason[]
  /**
   * 선정 규칙을 그대로 적용하지 못했으면 그 이유. 정상이면 null.
   * 호스트는 이 값이 null 이 아니면 **발표자 수가 요청과 다르다는 것**을 화면에 알려야 한다.
   */
  selectionIssue: SelectionIssue | null
  /** 완료 상태. 취소·오류는 결과가 아니라 별도 이벤트로 나간다. */
  status: 'completed'
  /** 이 실행이 새 경기인지 재현 실행인지. */
  run: { kind: 'live' | 'replay'; replayOf: string | null }
  /** 선정 후보였던 참가자 수. */
  eligibleCount: number
}

export interface BrickPickCancelEvent {
  schemaVersion: string
  sessionId: string
  status: 'cancelled'
  /** 취소 시점까지의 진행 정보 (참고용, 순위·선정 없음). */
  cancelledAt: string
  reason: 'user' | 'host' | 'destroy'
}

export type BrickPickErrorCode =
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'UNSUPPORTED_PROTOCOL_VERSION'
  | 'INVALID_INPUT'
  | 'DUPLICATE_PARTICIPANT_ID'
  | 'TOO_MANY_PARTICIPANTS'
  | 'TOO_FEW_PARTICIPANTS'
  | 'INVALID_SELECTION_RULE'
  | 'NOT_ENOUGH_CANDIDATES'
  | 'ORIGIN_NOT_ALLOWED'
  | 'SESSION_MISMATCH'
  | 'ALREADY_STARTED'
  | 'NOT_STARTED'
  | 'INTERNAL'

export interface BrickPickErrorEvent {
  schemaVersion: string
  sessionId: string | null
  status: 'error'
  code: BrickPickErrorCode
  /** 한국어 안내 문구. 화면에 그대로 띄워도 된다. */
  message: string
  /** 항목별 상세 오류 (검증 실패 시). */
  details?: string[]
}

export interface BrickPickProgress {
  schemaVersion: string
  sessionId: string
  phase: 'preparing' | 'running' | 'paused' | 'between-players' | 'finished'
  /** 남은 시간(ms). 직접 조작 모드는 현재 참가자 기준. */
  remainingMs: number
  elapsedMs: number
  /** 0 ~ 1. */
  progress: number
  /** 직접 조작 모드에서 지금 순서인 참가자. */
  currentParticipantId: string | null
  /** 지금까지 끝난 참가자 수 / 전체. 자동 경기는 0/N → N/N. */
  completedCount: number
  totalCount: number
  /** 현재 상위 몇 명의 점수 (실시간 순위 표시용). */
  leaderboard: Array<{ id: string; nickname: string; score: number; livesRemaining: number }>
}

// ────────────────────────────────────────────────────────────────────────────
// 검증
// ────────────────────────────────────────────────────────────────────────────

export interface ValidationFailure {
  code: BrickPickErrorCode
  message: string
  details: string[]
}

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; error: ValidationFailure }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

function fail(
  code: BrickPickErrorCode,
  message: string,
  details: string[] = [],
): ValidationResult<never> {
  return { ok: false, error: { code, message, details } }
}

/** 선정 규칙만 따로 검증한다. 후보 수를 알면 범위까지 본다. */
export function validateSelectionRule(
  rule: unknown,
  candidateCount?: number,
): ValidationResult<SelectionRule> {
  if (!isPlainObject(rule)) {
    return fail('INVALID_SELECTION_RULE', '선정 규칙이 비어 있습니다.', ['selectionRule 없음'])
  }
  const kind = rule.kind
  if (kind === 'top' || kind === 'bottom') {
    const count = rule.count
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      return fail('INVALID_SELECTION_RULE', '선정 인원은 1명 이상의 정수여야 합니다.', [
        `count=${String(count)}`,
      ])
    }
    if (candidateCount !== undefined && count > candidateCount) {
      return fail(
        'NOT_ENOUGH_CANDIDATES',
        `선정 가능한 참가자가 ${candidateCount}명인데 ${count}명을 뽑으려고 합니다.`,
        [`count=${count}`, `candidates=${candidateCount}`],
      )
    }
    return { ok: true, value: { kind, count }, warnings: [] }
  }
  if (kind === 'ranks') {
    const ranks = rule.ranks
    if (!Array.isArray(ranks) || ranks.length === 0) {
      return fail('INVALID_SELECTION_RULE', '지정할 순위를 하나 이상 골라 주세요.', ['ranks 비었음'])
    }
    const details: string[] = []
    const seen = new Set<number>()
    for (const r of ranks) {
      if (typeof r !== 'number' || !Number.isInteger(r) || r < 1) {
        details.push(`순위 값이 올바르지 않습니다: ${String(r)}`)
        continue
      }
      if (seen.has(r)) {
        details.push(`${r}위가 중복으로 지정됐습니다.`)
        continue
      }
      seen.add(r)
    }
    if (details.length > 0) {
      return fail('INVALID_SELECTION_RULE', '지정한 순위를 확인해 주세요.', details)
    }
    if (candidateCount !== undefined) {
      const over = [...seen].filter((r) => r > candidateCount)
      if (over.length > 0) {
        return fail(
          'NOT_ENOUGH_CANDIDATES',
          `선정 가능한 참가자가 ${candidateCount}명이라 ${over.join('위, ')}위를 뽑을 수 없습니다.`,
          over.map((r) => `rank ${r} > candidates ${candidateCount}`),
        )
      }
    }
    return { ok: true, value: { kind: 'ranks', ranks: [...seen].sort((a, b) => a - b) }, warnings: [] }
  }
  return fail('INVALID_SELECTION_RULE', '알 수 없는 선정 규칙입니다.', [`kind=${String(kind)}`])
}

/** 참가자 목록 검증 — 빈 이름 거절, 중복 ID 거절, 같은 닉네임은 허용. */
export function validateParticipants(value: unknown): ValidationResult<Participant[]> {
  if (!Array.isArray(value)) {
    return fail('INVALID_INPUT', '참가자 목록이 배열이 아닙니다.', ['participants'])
  }
  if (value.length < MIN_PARTICIPANTS) {
    return fail('TOO_FEW_PARTICIPANTS', '참가자를 한 명 이상 입력해 주세요.', [
      `participants=${value.length}`,
    ])
  }
  if (value.length > MAX_PARTICIPANTS) {
    return fail(
      'TOO_MANY_PARTICIPANTS',
      `참가자는 최대 ${MAX_PARTICIPANTS}명까지 지원합니다. 지금 ${value.length}명입니다.`,
      [`participants=${value.length}`, `max=${MAX_PARTICIPANTS}`],
    )
  }
  const details: string[] = []
  const seen = new Set<string>()
  const out: Participant[] = []
  value.forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      details.push(`${index + 1}번째 참가자의 형식이 올바르지 않습니다.`)
      return
    }
    if (!isNonEmptyString(raw.id)) {
      details.push(`${index + 1}번째 참가자에게 id 가 없습니다.`)
      return
    }
    if (!isNonEmptyString(raw.nickname)) {
      details.push(`${index + 1}번째 참가자의 이름이 비어 있습니다.`)
      return
    }
    if (seen.has(raw.id)) {
      details.push(`참가자 ID 가 중복됩니다: ${raw.id}`)
      return
    }
    seen.add(raw.id)
    out.push({ id: raw.id, nickname: raw.nickname.trim() })
  })
  if (details.length > 0) {
    const dup = details.some((d) => d.includes('중복'))
    return fail(
      dup ? 'DUPLICATE_PARTICIPANT_ID' : 'INVALID_INPUT',
      '참가자 목록을 확인해 주세요.',
      details,
    )
  }
  return { ok: true, value: out, warnings: [] }
}

/**
 * 외부에서 받은 원본 입력을 검증하고 기본값을 채워 정규화한다.
 * 실패하면 화면에 그대로 띄울 수 있는 한국어 메시지를 담아 돌려준다.
 */
export function parseBrickPickInput(raw: unknown): ValidationResult<BrickPickInput> {
  if (!isPlainObject(raw)) {
    return fail('INVALID_INPUT', '입력 데이터가 객체가 아닙니다.', [])
  }

  const schemaVersion = typeof raw.schemaVersion === 'string' ? raw.schemaVersion : SCHEMA_VERSION
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
    return fail(
      'UNSUPPORTED_SCHEMA_VERSION',
      `지원하지 않는 데이터 버전입니다: ${schemaVersion} (지원: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')})`,
      [`schemaVersion=${schemaVersion}`],
    )
  }

  const warnings: string[] = []

  const participants = validateParticipants(raw.participants)
  if (!participants.ok) return participants

  const mode: GameMode = raw.mode === 'manual' ? 'manual' : 'auto'
  if (raw.mode !== undefined && raw.mode !== 'auto' && raw.mode !== 'manual') {
    warnings.push(`알 수 없는 mode "${String(raw.mode)}" → auto 로 진행합니다.`)
  }

  const knownDifficulty =
    raw.difficulty === 'easy' ||
    raw.difficulty === 'hard' ||
    raw.difficulty === 'custom' ||
    raw.difficulty === 'normal'
  if (raw.difficulty !== undefined && !knownDifficulty) {
    warnings.push(`알 수 없는 난이도 "${String(raw.difficulty)}" → 보통으로 진행합니다.`)
  }
  const difficulty: DifficultyPreset =
    raw.difficulty === 'easy' || raw.difficulty === 'hard' || raw.difficulty === 'custom'
      ? raw.difficulty
      : 'normal'

  let roundDurationMs =
    typeof raw.roundDurationMs === 'number' && Number.isFinite(raw.roundDurationMs)
      ? Math.round(raw.roundDurationMs)
      : 30_000
  if (roundDurationMs < MIN_ROUND_DURATION_MS || roundDurationMs > MAX_ROUND_DURATION_MS) {
    const clamped = Math.min(MAX_ROUND_DURATION_MS, Math.max(MIN_ROUND_DURATION_MS, roundDurationMs))
    warnings.push(`경기 시간 ${roundDurationMs}ms 를 ${clamped}ms 로 조정했습니다.`)
    roundDurationMs = clamped
  }

  const excludedRaw = Array.isArray(raw.excludedParticipantIds) ? raw.excludedParticipantIds : []
  const knownIds = new Set(participants.value.map((p) => p.id))
  const excludedParticipantIds: string[] = []
  for (const id of excludedRaw) {
    if (typeof id !== 'string') continue
    if (!knownIds.has(id)) {
      warnings.push(`제외 목록의 "${id}" 가 참가자 명단에 없어 무시합니다.`)
      continue
    }
    if (!excludedParticipantIds.includes(id)) excludedParticipantIds.push(id)
  }

  const candidateCount = participants.value.length - excludedParticipantIds.length
  const rule = validateSelectionRule(
    raw.selectionRule ?? { kind: 'ranks', ranks: [1] },
    candidateCount,
  )
  if (!rule.ok) return rule

  const seed = isNonEmptyString(raw.seed) ? raw.seed : 'BRICKPICK'
  const locale: Locale = raw.locale === 'en' ? 'en' : 'ko'

  const difficultySettings = isPlainObject(raw.difficultySettings)
    ? (raw.difficultySettings as Partial<DifficultySettings>)
    : undefined

  return {
    ok: true,
    warnings,
    value: {
      schemaVersion,
      sessionId: isNonEmptyString(raw.sessionId) ? raw.sessionId : `bp-${hashSessionFallback(seed)}`,
      participants: participants.value,
      mode,
      difficulty,
      difficultySettings,
      roundDurationMs,
      selectionRule: rule.value,
      excludedParticipantIds,
      seed,
      locale,
      soundEnabled: raw.soundEnabled !== false,
      reducedMotion: raw.reducedMotion === true,
      hideParticipantEditor: raw.hideParticipantEditor !== false,
      replayOf: typeof raw.replayOf === 'string' ? raw.replayOf : null,
    },
  }
}

/** sessionId 가 없을 때 seed 에서 결정적으로 만들어 준다 (임의 난수를 쓰지 않는다). */
function hashSessionFallback(seed: string): string {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}
