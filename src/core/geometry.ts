/**
 * 충돌 판정 — 전부 "쓸고 지나가는(swept)" 방식이다.
 *
 * 공을 한 스텝치 이동시킨 뒤 겹쳤는지 보는 방식은 공이 빠르면 벽돌을 관통한다.
 * 여기서는 이동 경로 전체를 선분으로 보고 **가장 먼저 닿는 면**을 찾으므로
 * 속도와 무관하게 관통이 생기지 않는다. 모서리에 정확히 맞으면 두 축을 함께 반사한다.
 */

export interface SweepHit {
  /** 0~1 사이의 진행 비율. 0이면 이미 겹쳐 있던 상태. */
  t: number
  /** 충돌면의 법선 x (-1, 0, 1). */
  nx: number
  /** 충돌면의 법선 y (-1, 0, 1). */
  ny: number
}

const EPS = 1e-9

/**
 * 반지름 radius 인 원이 (px,py) 에서 (px+vx, py+vy) 로 갈 때
 * 사각형 (rx,ry,rw,rh) 와 처음 닿는 지점을 찾는다.
 *
 * 원을 점으로 보고 사각형을 반지름만큼 부풀리는 민코프스키 합 방식이다.
 * 정확히는 모서리가 둥글어야 하지만, 벽돌 크기에 비해 반지름이 작아
 * 체감 차이가 없고 계산이 훨씬 싸며 완전히 결정적이다.
 */
export function sweepCircleRect(
  px: number,
  py: number,
  vx: number,
  vy: number,
  radius: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): SweepHit | null {
  const minX = rx - radius
  const maxX = rx + rw + radius
  const minY = ry - radius
  const maxY = ry + rh + radius

  // 이미 겹쳐 있으면 가장 얕게 박힌 축으로 밀어낸다 (패들 안에 끼이는 것을 막는다).
  if (px > minX && px < maxX && py > minY && py < maxY) {
    const dLeft = px - minX
    const dRight = maxX - px
    const dTop = py - minY
    const dBottom = maxY - py
    const m = Math.min(dLeft, dRight, dTop, dBottom)
    if (m === dLeft) return { t: 0, nx: -1, ny: 0 }
    if (m === dRight) return { t: 0, nx: 1, ny: 0 }
    if (m === dTop) return { t: 0, nx: 0, ny: -1 }
    return { t: 0, nx: 0, ny: 1 }
  }

  let txEnter = Number.NEGATIVE_INFINITY
  let txExit = Number.POSITIVE_INFINITY
  let sx = 0
  if (vx !== 0) {
    const t1 = (minX - px) / vx
    const t2 = (maxX - px) / vx
    txEnter = Math.min(t1, t2)
    txExit = Math.max(t1, t2)
    sx = vx > 0 ? -1 : 1
  } else if (px <= minX || px >= maxX) {
    return null
  }

  let tyEnter = Number.NEGATIVE_INFINITY
  let tyExit = Number.POSITIVE_INFINITY
  let sy = 0
  if (vy !== 0) {
    const t1 = (minY - py) / vy
    const t2 = (maxY - py) / vy
    tyEnter = Math.min(t1, t2)
    tyExit = Math.max(t1, t2)
    sy = vy > 0 ? -1 : 1
  } else if (py <= minY || py >= maxY) {
    return null
  }

  const tEnter = Math.max(txEnter, tyEnter)
  const tExit = Math.min(txExit, tyExit)
  if (tEnter > tExit) return null
  if (tEnter < 0 || tEnter > 1) return null

  // 두 축의 진입 시각이 같으면 모서리 — 양쪽을 함께 반사한다.
  let nx = 0
  let ny = 0
  if (vx !== 0 && txEnter >= tEnter - 1e-7) nx = sx
  if (vy !== 0 && tyEnter >= tEnter - 1e-7) ny = sy
  if (nx === 0 && ny === 0) return null

  return { t: tEnter, nx, ny }
}

/** 두 사각형이 겹치는지. */
export function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}

/** 방향 벡터를 길이 1로 맞춘다. 길이가 0이면 위쪽을 향하게 한다. */
export function normalize(dx: number, dy: number): { dx: number; dy: number } {
  const len = Math.hypot(dx, dy)
  if (len < EPS) return { dx: 0, dy: -1 }
  return { dx: dx / len, dy: dy / len }
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v

export const DEG = Math.PI / 180
