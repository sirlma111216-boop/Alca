/**
 * 게임의 모든 수치를 한곳에 모은 설정 데이터.
 *
 * 여기 있는 값은 전부 "설명할 수 있는 규칙"이다. docs/game-rules.md 가 이 파일을 근거로 쓰였다.
 * 수치를 바꾸려면 이 파일만 고치면 되고, 엔진 코드는 건드릴 필요가 없다.
 */

import type {
  DifficultyPreset,
  DifficultySettings,
  ItemKind,
  ItemSettings,
} from './contract'
import { ITEM_KINDS } from './contract'

// ────────────────────────────────────────────────────────────────────────────
// 논리 좌표계 — 화면 크기와 무관한 고정 단위
// ────────────────────────────────────────────────────────────────────────────

/**
 * 경기장은 항상 320 × 440 논리 단위다. 렌더러가 화면 크기에 맞춰 배율만 조정하므로
 * 창 크기를 바꾸거나 모바일로 봐도 물리적 난이도가 달라지지 않는다.
 */
export const ARENA = {
  width: 320,
  height: 440,
  /** 좌·우·위 벽 두께. */
  wallThickness: 8,
  /** 벽돌 열 수. */
  brickCols: 11,
  /** 벽돌 한 칸의 높이. */
  brickHeight: 12,
  /** 벽돌 사이 간격. */
  brickGap: 1,
  /** 첫 벽돌 행의 y 좌표. */
  brickTop: 52,
  /** 패들 윗면 y 좌표. */
  paddleY: 404,
  /** 패들 두께. */
  paddleHeight: 9,
  /** 공 반지름. */
  ballRadius: 3.6,
  /** 캡슐 크기. */
  capsuleWidth: 22,
  capsuleHeight: 11,
  /** 레이저 탄환 크기. */
  bulletWidth: 3,
  bulletHeight: 10,
  /** 레이저 탄환 속도 (단위/초). */
  bulletSpeed: 420,
  /** 패들이 움직일 수 있는 x 범위는 [wallThickness, width - wallThickness]. */
} as const

/** 놀이 공간의 좌우 경계. */
export const PLAY_LEFT = ARENA.wallThickness
export const PLAY_RIGHT = ARENA.width - ARENA.wallThickness
export const PLAY_TOP = ARENA.wallThickness
export const PLAY_WIDTH = PLAY_RIGHT - PLAY_LEFT

/** 고정 시간 간격 — 물리는 항상 1/120초 단위로 계산한다. */
export const STEP_HZ = 120
export const STEP_MS = 1000 / STEP_HZ
export const STEP_SECONDS = 1 / STEP_HZ

/**
 * 한 번의 렌더 프레임에서 따라잡을 수 있는 최대 스텝 수.
 * 프레임이 밀려도 스텝을 건너뛰지 않는다 — 실시간만 길어지고 시뮬레이션 결과는 동일하다.
 */
export const MAX_STEPS_PER_FRAME = 16

/** 패들 반사각 제한 — 수평으로 영원히 왕복하는 것을 막는다. */
export const MIN_BOUNCE_ANGLE_DEG = 22
/** 패들 끝에 맞았을 때의 최대 반사각. */
export const MAX_BOUNCE_ANGLE_DEG = 70
/** 공의 수직 성분이 이보다 작은 상태가 이어지면 억지로 각도를 세운다. */
export const MIN_VERTICAL_RATIO = 0.14

/**
 * 공이 패들에 붙어 있다가 자동으로 발사되기까지의 시간(ms).
 *
 * 경기 시작과 목숨을 잃은 뒤의 "서브"는 **항상 이 시간에 자동 발사**된다.
 * 발사 버튼으로 앞당길 수 없게 해서, 직접 조작 모드에서 참가자마다
 * 초기 조건이 완전히 같도록 보장한다. (캐치 아이템으로 붙인 공은 다르다 —
 * 그건 플레이 중의 선택이므로 원하는 순간에 발사할 수 있다.)
 */
export const SERVE_HOLD_MS = 1200

/** 직접 조작 모드에서 키보드로 패들을 움직이는 속도 (논리 단위/초). */
export const MANUAL_PADDLE_SPEED = 520

/** 바닥 보호막이 놓이는 y 좌표. */
export const SHIELD_Y = ARENA.height - 7

// ────────────────────────────────────────────────────────────────────────────
// 점수표
// ────────────────────────────────────────────────────────────────────────────

export type BrickTypeId = 'sky' | 'cyan' | 'magenta' | 'amber' | 'silver'

export interface BrickTypeDef {
  id: BrickTypeId
  /** 화면에 보이는 이름. */
  label: string
  /** 내구도 — 이만큼 맞아야 부서진다. */
  durability: number
  /** 부서지지 않은 타격 1회당 점수. */
  hitScore: number
  /** 부술 때 주는 점수. */
  breakScore: number
  /** 색 이름(렌더러의 팔레트 키). 색만으로 구분하지 않도록 무늬도 함께 그린다. */
  color: string
}

/** 벽돌 종류와 점수. 경기 전 "규칙 요약" 화면에 그대로 표시된다. */
export const BRICK_TYPES: Record<BrickTypeId, BrickTypeDef> = {
  sky: { id: 'sky', label: '하늘', durability: 1, hitScore: 0, breakScore: 10, color: '#38bdf8' },
  cyan: { id: 'cyan', label: '청록', durability: 1, hitScore: 0, breakScore: 20, color: '#22d3ee' },
  magenta: {
    id: 'magenta',
    label: '자홍',
    durability: 2,
    hitScore: 5,
    breakScore: 40,
    color: '#e879f9',
  },
  amber: { id: 'amber', label: '노랑', durability: 2, hitScore: 5, breakScore: 50, color: '#fbbf24' },
  silver: {
    id: 'silver',
    label: '은색',
    durability: 3,
    hitScore: 5,
    breakScore: 80,
    color: '#cbd5e1',
  },
}

/** 위 행일수록 단단하다. 난이도의 maxBrickDurability 로 잘라 쓴다. */
export const BRICK_TYPE_ORDER: readonly BrickTypeId[] = ['silver', 'amber', 'magenta', 'cyan', 'sky']

/** 한 판(웨이브)의 벽돌을 전부 부쉈을 때 주는 보너스. */
export const WAVE_CLEAR_BONUS = 500

/**
 * 아이템 획득 자체에는 점수를 주지 않는다.
 * 아이템으로 부순 벽돌도 똑같은 기본 점수로 계산한다.
 */
export const ITEM_PICKUP_SCORE = 0

// ────────────────────────────────────────────────────────────────────────────
// 아이템 정의
// ────────────────────────────────────────────────────────────────────────────

export interface ItemDef {
  kind: ItemKind
  /** 화면 안내에 쓰는 한국어 이름. */
  label: string
  /** 캡슐에 찍는 짧은 글자 (색맹 대응 — 색만으로 구분하지 않는다). */
  glyph: string
  /** 팔레트 색. */
  color: string
  /** 한 줄 설명. 규칙 요약 화면에 쓴다. */
  description: string
  /** 시간제 아이템인지. */
  timed: boolean
}

export const ITEM_DEFS: Record<ItemKind, ItemDef> = {
  expand: {
    kind: 'expand',
    label: '패들 확장',
    glyph: 'E',
    color: '#4ade80',
    description: '패들이 1.5배 넓어집니다.',
    timed: true,
  },
  catch: {
    kind: 'catch',
    label: '캐치',
    glyph: 'C',
    color: '#38bdf8',
    description: '공이 패들에 붙습니다. 원하는 순간에 발사하세요.',
    timed: true,
  },
  multiball: {
    kind: 'multiball',
    label: '멀티볼',
    glyph: 'M',
    color: '#e879f9',
    description: '공이 갈라집니다. 최대 3개.',
    timed: false,
  },
  slow: {
    kind: 'slow',
    label: '슬로우',
    glyph: 'S',
    color: '#a78bfa',
    description: '공이 느려집니다.',
    timed: true,
  },
  laser: {
    kind: 'laser',
    label: '레이저',
    glyph: 'L',
    color: '#f87171',
    description: '패들 양쪽에서 탄환을 쏩니다.',
    timed: true,
  },
  shield: {
    kind: 'shield',
    label: '보호막',
    glyph: 'B',
    color: '#facc15',
    description: '바닥으로 떨어지는 공을 한 번 튕겨 올립니다.',
    timed: false,
  },
  life: {
    kind: 'life',
    label: '추가 목숨',
    glyph: '+',
    color: '#fb923c',
    description: '목숨이 1개 늘어납니다.',
    timed: false,
  },
}

/** 아이템 설정 값의 허용 범위. 사용자 설정 화면이 이 표를 그대로 쓴다. */
export const ITEM_SETTING_RANGES = {
  brickRatio: { min: 0, max: 0.6, step: 0.01 },
  capsuleSpeed: { min: 20, max: 260, step: 5 },
  expandFactor: { min: 1, max: 2.5, step: 0.05 },
  expandDurationMs: { min: 2000, max: 30_000, step: 500 },
  catchDurationMs: { min: 2000, max: 30_000, step: 500 },
  catchHoldMs: { min: 500, max: 10_000, step: 100 },
  slowDurationMs: { min: 2000, max: 30_000, step: 500 },
  slowFactor: { min: 0.4, max: 1, step: 0.05 },
  laserDurationMs: { min: 2000, max: 30_000, step: 500 },
  laserIntervalMs: { min: 80, max: 1500, step: 10 },
  maxBalls: { min: 1, max: 5, step: 1 },
  maxShieldCharges: { min: 0, max: 3, step: 1 },
  maxLives: { min: 1, max: 9, step: 1 },
  weight: { min: 0, max: 100, step: 1 },
} as const

/** 난이도 수치의 허용 범위. */
export const DIFFICULTY_RANGES = {
  ballBaseSpeed: { min: 80, max: 400, step: 5 },
  ballMaxSpeed: { min: 100, max: 560, step: 5 },
  ballAccelPerMinute: { min: 0, max: 1.2, step: 0.02 },
  paddleWidth: { min: 24, max: 120, step: 2 },
  paddleMaxWidth: { min: 30, max: 160, step: 2 },
  lives: { min: 1, max: 9, step: 1 },
  brickRows: { min: 1, max: 12, step: 1 },
  maxBrickDurability: { min: 1, max: 3, step: 1 },
  manualEdgeForgiveness: { min: 0, max: 12, step: 1 },
  autoReactionMs: { min: 20, max: 400, step: 5 },
  autoAimErrorSigma: { min: 0, max: 1.5, step: 0.01 },
  autoMissChance: { min: 0, max: 0.5, step: 0.01 },
  autoPaddleSpeed: { min: 80, max: 600, step: 10 },
} as const

function itemSettings(overrides: Partial<ItemSettings> & { weights: Record<ItemKind, number> }): ItemSettings {
  const allOn = ITEM_KINDS.reduce(
    (acc, k) => {
      acc[k] = true
      return acc
    },
    {} as Record<ItemKind, boolean>,
  )
  return {
    enabled: true,
    enabledKinds: allOn,
    brickRatio: 0.16,
    capsuleSpeed: 90,
    expandFactor: 1.5,
    expandDurationMs: 12_000,
    catchDurationMs: 12_000,
    catchHoldMs: 3_000,
    slowDurationMs: 8_000,
    slowFactor: 0.75,
    laserDurationMs: 8_000,
    laserIntervalMs: 340,
    maxBalls: 3,
    maxShieldCharges: 1,
    maxLives: 5,
    ...overrides,
  }
}

/**
 * 난이도 프리셋.
 *
 * 쉬움 — 캡슐이 천천히 떨어지고, 도움이 되는 아이템(확장·슬로우·캐치·목숨)의 비중이 높다.
 * 보통 — 기준값.
 * 어려움 — 공이 빠르고 목숨이 적으며, 멀티볼·레이저처럼 다루기 까다로운 아이템 비중이 높다.
 *          그래도 아이템 자체는 충분히 얻을 수 있는 수준을 유지한다.
 */
export const DIFFICULTY_PRESETS: Record<Exclude<DifficultyPreset, 'custom'>, DifficultySettings> = {
  easy: {
    ballBaseSpeed: 250,
    ballMaxSpeed: 360,
    ballAccelPerMinute: 0.25,
    paddleWidth: 68,
    paddleMaxWidth: 128,
    lives: 4,
    brickRows: 6,
    maxBrickDurability: 2,
    manualEdgeForgiveness: 4,
    autoReactionMs: 90,
    autoAimErrorSigma: 0.3,
    autoMissChance: 0.04,
    autoPaddleSpeed: 440,
    items: itemSettings({
      brickRatio: 0.32,
      capsuleSpeed: 70,
      weights: { expand: 26, catch: 16, multiball: 12, slow: 18, laser: 12, shield: 8, life: 8 },
    }),
  },
  normal: {
    ballBaseSpeed: 300,
    ballMaxSpeed: 440,
    ballAccelPerMinute: 0.4,
    paddleWidth: 56,
    paddleMaxWidth: 112,
    lives: 3,
    brickRows: 7,
    maxBrickDurability: 3,
    manualEdgeForgiveness: 2,
    autoReactionMs: 120,
    autoAimErrorSigma: 0.42,
    autoMissChance: 0.08,
    autoPaddleSpeed: 400,
    items: itemSettings({
      brickRatio: 0.26,
      capsuleSpeed: 90,
      weights: { expand: 22, catch: 14, multiball: 16, slow: 14, laser: 16, shield: 10, life: 8 },
    }),
  },
  hard: {
    ballBaseSpeed: 340,
    ballMaxSpeed: 500,
    ballAccelPerMinute: 0.6,
    paddleWidth: 46,
    paddleMaxWidth: 96,
    lives: 2,
    brickRows: 8,
    maxBrickDurability: 3,
    manualEdgeForgiveness: 0,
    autoReactionMs: 155,
    autoAimErrorSigma: 0.55,
    autoMissChance: 0.13,
    autoPaddleSpeed: 360,
    items: itemSettings({
      brickRatio: 0.2,
      capsuleSpeed: 110,
      weights: { expand: 18, catch: 12, multiball: 20, slow: 10, laser: 20, shield: 12, life: 8 },
    }),
  },
}

export const DIFFICULTY_LABELS: Record<DifficultyPreset, string> = {
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
  custom: '사용자 설정',
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** 값이 숫자가 아니면 기본값을, 범위를 벗어나면 잘라 낸 값을 돌려준다. */
function num(value: unknown, fallback: number, range: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return clamp(value, range.min, range.max)
}

/** 아이템 설정을 기본값 위에 덮어쓰고 유효 범위로 자른다. */
export function resolveItemSettings(
  base: ItemSettings,
  overrides?: Partial<ItemSettings>,
): ItemSettings {
  const o = overrides ?? {}
  const R = ITEM_SETTING_RANGES
  const weights = { ...base.weights }
  if (o.weights) {
    for (const kind of ITEM_KINDS) {
      if (typeof o.weights[kind] === 'number') {
        weights[kind] = num(o.weights[kind], base.weights[kind], R.weight)
      }
    }
  }
  const enabledKinds = { ...base.enabledKinds }
  if (o.enabledKinds) {
    for (const kind of ITEM_KINDS) {
      if (typeof o.enabledKinds[kind] === 'boolean') enabledKinds[kind] = o.enabledKinds[kind]
    }
  }
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    enabledKinds,
    weights,
    brickRatio: num(o.brickRatio, base.brickRatio, R.brickRatio),
    capsuleSpeed: num(o.capsuleSpeed, base.capsuleSpeed, R.capsuleSpeed),
    expandFactor: num(o.expandFactor, base.expandFactor, R.expandFactor),
    expandDurationMs: num(o.expandDurationMs, base.expandDurationMs, R.expandDurationMs),
    catchDurationMs: num(o.catchDurationMs, base.catchDurationMs, R.catchDurationMs),
    catchHoldMs: num(o.catchHoldMs, base.catchHoldMs, R.catchHoldMs),
    slowDurationMs: num(o.slowDurationMs, base.slowDurationMs, R.slowDurationMs),
    slowFactor: num(o.slowFactor, base.slowFactor, R.slowFactor),
    laserDurationMs: num(o.laserDurationMs, base.laserDurationMs, R.laserDurationMs),
    laserIntervalMs: num(o.laserIntervalMs, base.laserIntervalMs, R.laserIntervalMs),
    maxBalls: Math.round(num(o.maxBalls, base.maxBalls, R.maxBalls)),
    maxShieldCharges: Math.round(num(o.maxShieldCharges, base.maxShieldCharges, R.maxShieldCharges)),
    maxLives: Math.round(num(o.maxLives, base.maxLives, R.maxLives)),
  }
}

/**
 * 프리셋 + 덮어쓴 값 → 최종 난이도 설정.
 * 결과 JSON 의 appliedSettings.difficultySettings 에 이 값이 그대로 실린다.
 */
export function resolveDifficulty(
  preset: DifficultyPreset,
  overrides?: Partial<DifficultySettings>,
): DifficultySettings {
  const base = DIFFICULTY_PRESETS[preset === 'custom' ? 'normal' : preset]
  const o = overrides ?? {}
  const R = DIFFICULTY_RANGES
  const settings: DifficultySettings = {
    ballBaseSpeed: num(o.ballBaseSpeed, base.ballBaseSpeed, R.ballBaseSpeed),
    ballMaxSpeed: num(o.ballMaxSpeed, base.ballMaxSpeed, R.ballMaxSpeed),
    ballAccelPerMinute: num(o.ballAccelPerMinute, base.ballAccelPerMinute, R.ballAccelPerMinute),
    paddleWidth: num(o.paddleWidth, base.paddleWidth, R.paddleWidth),
    paddleMaxWidth: num(o.paddleMaxWidth, base.paddleMaxWidth, R.paddleMaxWidth),
    lives: Math.round(num(o.lives, base.lives, R.lives)),
    brickRows: Math.round(num(o.brickRows, base.brickRows, R.brickRows)),
    maxBrickDurability: Math.round(num(o.maxBrickDurability, base.maxBrickDurability, R.maxBrickDurability)),
    manualEdgeForgiveness: num(o.manualEdgeForgiveness, base.manualEdgeForgiveness, R.manualEdgeForgiveness),
    autoReactionMs: num(o.autoReactionMs, base.autoReactionMs, R.autoReactionMs),
    autoAimErrorSigma: num(o.autoAimErrorSigma, base.autoAimErrorSigma, R.autoAimErrorSigma),
    autoMissChance: num(o.autoMissChance, base.autoMissChance, R.autoMissChance),
    autoPaddleSpeed: num(o.autoPaddleSpeed, base.autoPaddleSpeed, R.autoPaddleSpeed),
    items: resolveItemSettings(base.items, o.items),
  }
  // 최대 속도가 기본 속도보다 작으면 뜻이 없다.
  if (settings.ballMaxSpeed < settings.ballBaseSpeed) settings.ballMaxSpeed = settings.ballBaseSpeed
  // 확장 상한이 기본 너비보다 작으면 확장 아이템이 무의미해진다.
  if (settings.paddleMaxWidth < settings.paddleWidth) settings.paddleMaxWidth = settings.paddleWidth
  // 목숨 상한보다 시작 목숨이 많을 수 없다.
  if (settings.lives > settings.items.maxLives) settings.items.maxLives = settings.lives
  return settings
}

/** 사용자 설정을 기본값으로 되돌릴 때 쓴다. */
export function defaultDifficultySettings(preset: DifficultyPreset): DifficultySettings {
  return resolveDifficulty(preset === 'custom' ? 'normal' : preset)
}
