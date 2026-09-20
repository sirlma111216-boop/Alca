/**
 * 그라디언트 리본 — 이 디자인의 **유일한** 장식.
 *
 * 디자인 문서는 주황→자홍→연보라 3색 그라디언트 하나만을 장식으로 허용한다.
 * 색을 하나만 떼어 쓰거나, 순서를 바꾸거나, 네 번째 색을 더하면 안 된다.
 * 아이콘 크기로 줄여서도 안 된다 — 큰 크기로만 쓴다.
 *
 * 브릭픽에서는 그 그라디언트를 **게임의 벽돌 벽**을 통해 보여 준다.
 * 장식용 그림을 따로 그리지 않고 제품 자체를 장식으로 쓰는 것이다.
 * 겹친 벽돌 층이 반투명하게 깊이를 만들고, 아래쪽의 공과 패들이
 * "이건 벽돌깨기다" 를 한눈에 말해 준다.
 *
 * 장식일 뿐이므로 보조기기에는 읽히지 않는다 (aria-hidden).
 */

/** 줄마다 어느 칸이 비어 있는지. 고정 배열이다 — 매번 다르게 그리지 않는다. */
const GAPS: readonly (readonly number[])[] = [
  [],
  [3],
  [1, 6],
  [0, 4, 7],
  [2, 3, 5, 8],
  [0, 1, 4, 5, 6, 8],
]

const COLS = 9
const ROWS = GAPS.length
const BRICK_W = 56
const BRICK_H = 20
const GAP_X = 6
const GAP_Y = 6
const LEFT = 18
const TOP = 44

/** 앞 층 — 벽돌 벽 본체. 빈칸은 비워 둔다. */
function frontBricks() {
  const out = []
  for (let r = 0; r < ROWS; r += 1) {
    const holes = GAPS[r]
    for (let c = 0; c < COLS; c += 1) {
      if (holes.includes(c)) continue
      out.push({
        key: `front-${r}-${c}`,
        x: LEFT + c * (BRICK_W + GAP_X),
        y: TOP + r * (BRICK_H + GAP_Y),
        // 아래로 갈수록 옅어진다 — 층이 멀어지는 것처럼 보인다.
        opacity: 1 - r * 0.085,
      })
    }
  }
  return out
}

/** 뒤 층은 앞 층의 빈칸을 메우는 벽돌이다 — 그래서 겹쳐 있는 것처럼 보인다. */
function backBricks() {
  const out = []
  for (let r = 0; r < ROWS; r += 1) {
    for (const c of GAPS[r]) {
      out.push({
        key: `back-${r}-${c}`,
        x: LEFT + c * (BRICK_W + GAP_X),
        y: TOP + r * (BRICK_H + GAP_Y),
        opacity: 0.32 - r * 0.03,
      })
    }
  }
  return out
}

export function GradientRibbon() {
  const front = frontBricks()
  const back = backBricks()

  return (
    <svg
      className="t-ribbon"
      viewBox="0 0 600 440"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {/*
          3색 그라디언트 — 하나의 덩어리다. 순서를 바꾸지 않는다.
          userSpaceOnUse 가 핵심이다. 이걸 빼면 그라디언트가 **벽돌 하나하나마다**
          따로 그려져서, 큰 크기로만 쓰라는 이 디자인의 규칙을 정면으로 어긴다.
          좌표는 리본 전체를 가로지른다 — 왼쪽 아래 주황에서 오른쪽 위 연보라까지.
        */}
        <linearGradient
          id="bp-ribbon-grad"
          gradientUnits="userSpaceOnUse"
          x1="10"
          y1="330"
          x2="590"
          y2="40"
        >
          <stop offset="0%" stopColor="#fc4c02" />
          <stop offset="52%" stopColor="#ef2cc1" />
          <stop offset="100%" stopColor="#bdbbff" />
        </linearGradient>
        {/* 리본 뒤의 옅은 빛 번짐 — 이 페이지에서 유일하게 허용되는 분위기 효과다. */}
        <radialGradient id="bp-ribbon-glow" cx="50%" cy="34%" r="62%">
          <stop offset="0%" stopColor="#ef2cc1" stopOpacity="0.34" />
          <stop offset="60%" stopColor="#fc4c02" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#010120" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="300" cy="180" rx="290" ry="200" fill="url(#bp-ribbon-glow)" />

      {/* 뒤 층 — 살짝 비틀어 겹쳐 깊이를 만든다. */}
      <g transform="rotate(5 300 200) translate(-16 16)" fill="url(#bp-ribbon-grad)">
        {back.map((b) => (
          <rect
            key={b.key}
            x={b.x}
            y={b.y}
            width={BRICK_W}
            height={BRICK_H}
            rx="4"
            opacity={Math.max(0.14, b.opacity)}
          />
        ))}
      </g>

      {/* 앞 층 — 벽돌 벽 본체. */}
      <g transform="rotate(-6 300 200)" fill="url(#bp-ribbon-grad)">
        {front.map((b) => (
          <rect
            key={b.key}
            x={b.x}
            y={b.y}
            width={BRICK_W}
            height={BRICK_H}
            rx="4"
            opacity={Math.max(0.5, b.opacity)}
          />
        ))}
      </g>

      {/* 공과 패들 — 이게 벽돌깨기라는 표시. 그라디언트 밖의 색은 흰색과 연보라뿐이다. */}
      <circle cx="356" cy="292" r="10" fill="#ffffff" />
      <rect x="300" y="360" width="128" height="14" rx="4" fill="#bdbbff" />
      <rect x="300" y="360" width="128" height="5" rx="2.5" fill="#ffffff" opacity="0.55" />
    </svg>
  )
}

/**
 * 바닥 워드마크 — 페이지 맨 아래의 거대한 글자.
 * 배경에 거의 잠기도록 연하게 칠해 "여기서 끝" 이라는 표시 겸 구분선 역할을 한다.
 * 장식이므로 화면 낭독기는 건너뛴다 (같은 이름이 머리말에 이미 있다).
 */
export function WordmarkBanner() {
  return (
    <p className="t-wordmark" aria-hidden="true">
      brickpick
    </p>
  )
}
