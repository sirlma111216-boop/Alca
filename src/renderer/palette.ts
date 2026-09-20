/**
 * 색과 글꼴 — 캔버스와 CSS 가 같은 값을 쓰도록 여기 한곳에 모았다.
 *
 * 1980~90년대 아케이드 벽돌깨기의 인상(짙은 배경 + 색으로 정렬된 벽돌 + 금속 패들)을
 * 현대적으로 해석한 것이다. 원작의 로고·스프라이트·음악·효과음은 쓰지 않았고
 * 전부 코드로 그리고 합성한다.
 *
 * 색은 `src/styles/tokens.css` 의 디자인 토큰과 같은 값이다 — 짙은 남색 면 위에
 * 주황→자홍→연보라 그라디언트와 민트만 쓴다. 다섯 번째 강조색을 만들지 않는다.
 * 그래서 벽돌 벽 자체가 이 디자인의 그라디언트를 보여 주는 자리가 된다.
 *
 * 교실 프로젝터 기준으로 닉네임·순위·남은 시간이 읽혀야 하므로
 * 배경과 글자의 명도 차를 크게 잡았다.
 */

export const PALETTE = {
  /** 경기장 바깥 배경 — 디자인의 짙은 면 그대로. */
  background: '#010120',
  /** 경기장 안쪽 바닥. 바깥과 같은 면이고, 경계는 1px 선으로만 긋는다. */
  arenaBackground: '#010120',
  /** 경기장 안쪽 미세 격자. */
  arenaGrid: '#12122f',
  /** 금속 벽 — 짙은 면 위의 1px 선 색과 그보다 한 단계 밝은 면. */
  wall: '#26263a',
  wallHighlight: '#313641',
  /** 패들 — 연보라 금속. */
  paddle: '#bdbbff',
  paddleEdge: '#6f6dc7',
  paddleCore: '#ffffff',
  /** 레이저 패들일 때의 총구. */
  paddleLaser: '#fc4c02',
  /** 캐치 패들일 때의 접착면. */
  paddleCatch: '#c8f6f9',
  /** 공 — 화면에서 가장 밝다. 어떤 벽돌보다도 밝아야 눈이 놓치지 않는다. */
  ball: '#ffffff',
  ballTrail: '#c8f6f9',
  /** 바닥 보호막. */
  shield: '#c8f6f9',
  /** 레이저 탄환. */
  bullet: '#fc4c02',
  /** 글자. */
  text: '#ffffff',
  textDim: 'rgba(255, 255, 255, 0.68)',
  textStrong: '#ffffff',
  /**
   * 강조 — 발표자, 현재 순위 등.
   * 이 디자인에는 성공/경고/오류 색이 따로 없다. 그래서 상태는 글자·기호·번호가 말하고,
   * 색은 거들기만 한다 (원래 프로젝트 규칙과 같은 방향이다).
   */
  accent: '#c8f6f9',
  accentWarm: '#fc4c02',
  accentPink: '#ef2cc1',
  danger: '#fc4c02',
  ok: '#c8f6f9',
  /** 아이템이 든 벽돌에 찍는 작은 문양 색. */
  itemMark: '#010120',
} as const

/**
 * 선택한 참가자를 구분하는 색. 색만으로 구분하지 않도록 번호·이름을 항상 함께 그린다.
 * 전부 브랜드 그라디언트(주황→자홍→연보라) 위에서 고른 점이다 — 새 색을 더하지 않는다.
 */
export const PARTICIPANT_ACCENTS: readonly string[] = [
  '#fc4c02',
  '#f53a6d',
  '#ef2cc1',
  '#db65da',
  '#bdbbff',
  '#c8f6f9',
  '#f131a2',
  '#cc90ec',
]

export function participantAccent(index: number): string {
  return PARTICIPANT_ACCENTS[index % PARTICIPANT_ACCENTS.length]
}

/**
 * 글꼴 — tokens.css 의 두 글꼴과 같은 스택이다.
 *
 * Inter 와 JetBrains Mono 에는 한글이 없다. 라틴 글자와 숫자는 이 둘이 맡고
 * 한글은 뒤따르는 한국어 글꼴이 맡는다 — 의도한 조합이다.
 * 글꼴 파일이 아직 안 왔거나 (수업 앱 안에 들어간 경우처럼) 아예 없어도
 * 뒤의 시스템 글꼴로 그대로 그려진다.
 */
export const FONTS = {
  ui: "'Inter Variable', Inter, 'Pretendard Variable', Pretendard, 'Noto Sans KR', 'Malgun Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  /** 점수·시간 같은 숫자. 고정폭이라 자리수가 흔들리지 않는다. */
  numeric:
    "'JetBrains Mono', ui-monospace, SFMono-Regular, 'Cascadia Mono', Consolas, 'Liberation Mono', monospace",
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
  return mix(base, '#010120', (1 - ratio) * 0.45)
}
