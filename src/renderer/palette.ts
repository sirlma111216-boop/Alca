/**
 * 색과 글꼴 — 캔버스와 CSS 가 같은 값을 쓰도록 여기 한곳에 모았다.
 *
 * 1980~90년대 아케이드 벽돌깨기의 인상(짙은 배경 + 색으로 정렬된 벽돌 + 금속 패들)을
 * 현대적으로 해석한 것이다. 원작의 로고·스프라이트·음악·효과음은 쓰지 않았고
 * 전부 코드로 그리고 합성한다.
 *
 * 교실 프로젝터 기준으로 닉네임·순위·남은 시간이 읽혀야 하므로
 * 배경과 글자의 명도 차를 크게 잡았다.
 */

export const PALETTE = {
  /** 경기장 바깥 배경 — 짙은 네이비. */
  background: '#070b18',
  /** 경기장 안쪽 바닥. */
  arenaBackground: '#0b1226',
  /** 경기장 안쪽 미세 격자. */
  arenaGrid: '#111c3a',
  /** 금속 벽. */
  wall: '#1e2b52',
  wallHighlight: '#3b4d84',
  /** 패들 — 금속성. */
  paddle: '#cbd5f5',
  paddleEdge: '#7c8fd6',
  paddleCore: '#e8edff',
  /** 레이저 패들일 때의 총구. */
  paddleLaser: '#f87171',
  /** 캐치 패들일 때의 접착면. */
  paddleCatch: '#38bdf8',
  /** 공. */
  ball: '#fdfdff',
  ballTrail: '#7dd3fc',
  /** 바닥 보호막. */
  shield: '#facc15',
  /** 레이저 탄환. */
  bullet: '#fca5a5',
  /** 글자. */
  text: '#e8edff',
  textDim: '#8ea0c9',
  textStrong: '#ffffff',
  /** 강조 — 발표자, 현재 순위 등. */
  accent: '#22d3ee',
  accentWarm: '#fbbf24',
  accentPink: '#e879f9',
  danger: '#f87171',
  ok: '#4ade80',
  /** 아이템이 든 벽돌에 찍는 작은 문양 색. */
  itemMark: '#0b1226',
} as const

/** 선택한 참가자를 구분하는 색. 색만으로 구분하지 않도록 번호·이름을 항상 함께 그린다. */
export const PARTICIPANT_ACCENTS: readonly string[] = [
  '#22d3ee',
  '#e879f9',
  '#fbbf24',
  '#4ade80',
  '#60a5fa',
  '#fb923c',
  '#a78bfa',
  '#f472b6',
]

export function participantAccent(index: number): string {
  return PARTICIPANT_ACCENTS[index % PARTICIPANT_ACCENTS.length]
}

/**
 * 글꼴.
 * 한글은 가독성이 좋은 산세리프를 쓰고, 픽셀풍 느낌은 제목과 숫자에만 제한적으로 준다
 * (자간·굵기·모서리로 표현하며 픽셀 글꼴 파일을 내려받지 않는다).
 */
export const FONTS = {
  ui: "'Pretendard Variable', Pretendard, 'Noto Sans KR', 'Malgun Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  /** 점수·시간 같은 숫자. 고정폭이라 자리수가 흔들리지 않는다. */
  numeric:
    "'DM Mono', ui-monospace, SFMono-Regular, 'Cascadia Mono', Consolas, 'Liberation Mono', monospace",
} as const

/** 벽돌 하나를 그릴 때 쓰는 색 3종 (입체감용). */
export function brickShades(base: string): { top: string; body: string; bottom: string } {
  return {
    top: mix(base, '#ffffff', 0.34),
    body: base,
    bottom: mix(base, '#000000', 0.38),
  }
}

/** 두 색을 섞는다. amount 0 이면 a, 1 이면 b. */
export function mix(a: string, b: string, amount: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  if (!ca || !cb) return a
  const t = Math.min(1, Math.max(0, amount))
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t)
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t)
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t)
  return `rgb(${r}, ${g}, ${bl})`
}

export function withAlpha(color: string, alpha: number): string {
  const c = hexToRgb(color)
  if (!c) return color
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.min(1, Math.max(0, alpha))})`
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) {
    const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(hex.trim())
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    return null
  }
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 내구도가 남은 벽돌은 조금 어둡게 — 색만이 아니라 금 간 무늬도 함께 그린다. */
export function damagedShade(base: string, hp: number, maxHp: number): string {
  if (maxHp <= 1 || hp >= maxHp) return base
  const ratio = hp / maxHp
  return mix(base, '#0b1226', (1 - ratio) * 0.45)
}
