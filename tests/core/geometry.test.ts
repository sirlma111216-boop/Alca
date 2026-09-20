/**
 * 충돌 기하 — sweepCircleRect / normalize / clamp / rectsOverlap.
 *
 * 여기서는 엔진을 쓰지 않고 순수 함수만 시험한다. 구현을 베끼지 않고
 * "충돌 시각 t 와 법선 (nx, ny) 가 손으로 계산한 값과 같은가" 를 본다.
 *
 * 민코프스키 합 방식이므로 사각형은 반지름만큼 부풀려진 것으로 보면 된다.
 *   minX = rx - r, maxX = rx + rw + r, minY = ry - r, maxY = ry + rh + r
 */

import { describe, expect, it } from 'vitest'
import { clamp, normalize, rectsOverlap, sweepCircleRect } from '../../src/core'

/** 시험용 사각형 하나 — 벽돌과 비슷한 납작한 판. */
const RECT = { x: 100, y: 100, w: 60, h: 12 }
const R = 4

describe('sweepCircleRect — 정면 충돌', () => {
  it('위로 가는 원이 사각형 아래 면에 닿으면 법선은 아래쪽(ny = 1)이고 t 는 거리 비율과 같다', () => {
    // 부풀린 사각형의 아랫변은 y = 100 + 12 + 4 = 116.
    // (130, 200) 에서 위로 100 만큼 가면 84 만큼 진행했을 때 닿는다 → t = 0.84
    const hit = sweepCircleRect(130, 200, 0, -100, R, RECT.x, RECT.y, RECT.w, RECT.h)
    expect(hit).not.toBeNull()
    expect(hit?.ny).toBe(1)
    expect(hit?.nx).toBe(0)
    expect(hit?.t).toBeCloseTo(0.84, 10)
    // 충돌 지점의 y 는 정확히 부풀린 아랫변 위에 있어야 한다.
    expect(200 + -100 * (hit?.t ?? 0)).toBeCloseTo(116, 9)
  })

  it('아래로 가는 원이 사각형 윗면에 닿으면 법선은 위쪽(ny = -1)', () => {
    // 부풀린 사각형의 윗변은 y = 100 - 4 = 96. (130, 46) 에서 아래로 100 → t = 0.5
    const hit = sweepCircleRect(130, 46, 0, 100, R, RECT.x, RECT.y, RECT.w, RECT.h)
    expect(hit).not.toBeNull()
    expect(hit?.ny).toBe(-1)
    expect(hit?.nx).toBe(0)
    expect(hit?.t).toBeCloseTo(0.5, 10)
  })
})

describe('sweepCircleRect — 좌우 면 법선 부호', () => {
  it('오른쪽으로 가다 왼쪽 면에 맞으면 nx = -1', () => {
    // 부풀린 왼쪽 변은 x = 96. (0, 106) 에서 오른쪽으로 200 → t = 0.48
    const hit = sweepCircleRect(0, 106, 200, 0, R, RECT.x, RECT.y, RECT.w, RECT.h)
    expect(hit).not.toBeNull()
    expect(hit?.nx).toBe(-1)
    expect(hit?.ny).toBe(0)
    expect(hit?.t).toBeCloseTo(0.48, 10)
  })

  it('왼쪽으로 가다 오른쪽 면에 맞으면 nx = 1', () => {
    // 부풀린 오른쪽 변은 x = 100 + 60 + 4 = 164. (300, 106) 에서 왼쪽으로 200 → t = 0.68
    const hit = sweepCircleRect(300, 106, -200, 0, R, RECT.x, RECT.y, RECT.w, RECT.h)
    expect(hit).not.toBeNull()
    expect(hit?.nx).toBe(1)
    expect(hit?.ny).toBe(0)
    expect(hit?.t).toBeCloseTo(0.68, 10)
  })

  it('법선은 항상 "온 방향의 반대" — 진행 방향과 내적이 음수다', () => {
    const cases = [
      { vx: 200, vy: 0, px: 0, py: 106 },
      { vx: -200, vy: 0, px: 300, py: 106 },
      { vx: 0, vy: 100, px: 130, py: 46 },
      { vx: 0, vy: -100, px: 130, py: 200 },
    ]
    for (const c of cases) {
      const hit = sweepCircleRect(c.px, c.py, c.vx, c.vy, R, RECT.x, RECT.y, RECT.w, RECT.h)
      expect(hit).not.toBeNull()
      const dot = (hit?.nx ?? 0) * c.vx + (hit?.ny ?? 0) * c.vy
      expect(dot).toBeLessThan(0)
    }
  })
})

describe('sweepCircleRect — 빠른 공의 관통', () => {
  it('사각형 두께(12)보다 훨씬 큰 이동 벡터(2000)로도 히트를 잡는다', () => {
    // 한 스텝에 사각형을 통째로 건너뛰는 속도. "이동 후 겹침 검사" 방식이라면 놓친다.
    const hit = sweepCircleRect(130, 900, 0, -2000, R, RECT.x, RECT.y, RECT.w, RECT.h)
    expect(hit).not.toBeNull()
    expect(hit?.ny).toBe(1)
    expect(hit?.t).toBeCloseTo((900 - 116) / 2000, 10)
  })

  it('경기장을 한 번에 가로지르는 속도로 비스듬히 와도 놓치지 않는다', () => {
    // (30, 500) → (230, -288). 사각형 한가운데를 꿰뚫는 경로이므로 반드시 잡혀야 한다.
    // 한 번의 이동 길이가 800 이 넘는데 사각형 두께는 12 뿐이다.
    const hit = sweepCircleRect(30, 500, 200, -788, R, RECT.x, RECT.y, RECT.w, RECT.h)
    expect(hit).not.toBeNull()
    const t = hit?.t ?? 0
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThanOrEqual(1)
    // 충돌 지점은 부풀린 사각형의 경계 위에 있어야 한다.
    const hx = 30 + 200 * t
    const hy = 500 - 788 * t
    const onEdge =
      Math.abs(hx - 96) < 1e-6 ||
      Math.abs(hx - 164) < 1e-6 ||
      Math.abs(hy - 96) < 1e-6 ||
      Math.abs(hy - 116) < 1e-6
    expect(onEdge).toBe(true)
  })

  it('한 스텝으로 닿지 못할 만큼 멀면 null (t > 1 은 이번 스텝의 충돌이 아니다)', () => {
    // 200 만큼 떨어져 있는데 이번 스텝 이동은 10 뿐.
    expect(sweepCircleRect(130, 300, 0, -10, R, RECT.x, RECT.y, RECT.w, RECT.h)).toBeNull()
  })
})

describe('sweepCircleRect — 모서리 동시 충돌', () => {
  it('정확히 45도로 모서리에 들어가면 nx 와 ny 가 둘 다 0이 아니다', () => {
    // 정사각형 (100,100,50,50), 반지름 5 → 부풀린 왼쪽·윗변이 모두 95.
    // (45, 45) 에서 (100, 100) 만큼 가면 두 축의 진입 시각이 정확히 같다(t = 0.5).
    const hit = sweepCircleRect(45, 45, 100, 100, 5, 100, 100, 50, 50)
    expect(hit).not.toBeNull()
    expect(hit?.t).toBeCloseTo(0.5, 12)
    expect(hit?.nx).toBe(-1)
    expect(hit?.ny).toBe(-1)
  })

  it('오른쪽 아래 모서리로 45도 진입도 두 축을 함께 반사한다', () => {
    // 부풀린 오른쪽 변 155, 아랫변 155. (255, 255) 에서 (-100, -100).
    const hit = sweepCircleRect(255, 255, -100, -100, 5, 100, 100, 50, 50)
    expect(hit).not.toBeNull()
    expect(hit?.t).toBeCloseTo(1, 12)
    expect(hit?.nx).toBe(1)
    expect(hit?.ny).toBe(1)
  })

  it('모서리에서 살짝 벗어나면 한 축만 반사한다 (모서리 판정이 아무 데나 붙지 않는다)', () => {
    // x 쪽이 확실히 먼저 들어오는 경로 — ny 는 0 이어야 한다.
    const hit = sweepCircleRect(45, 85, 100, 100, 5, 100, 100, 50, 50)
    expect(hit).not.toBeNull()
    expect(hit?.nx).toBe(-1)
    expect(hit?.ny).toBe(0)
  })
})

describe('sweepCircleRect — 빗나감', () => {
  it('옆으로 스쳐 지나가면 null', () => {
    // 부풀린 왼쪽 변이 95 인데 x = 90 을 따라 수직으로 지나간다.
    expect(sweepCircleRect(90, 0, 0, 300, 5, 100, 100, 50, 50)).toBeNull()
  })

  it('x 구간에는 들어오지만 그 전에 y 구간을 빠져나가면 null', () => {
    // (0, 300) 에서 (200, -100): x 는 t = 0.49 에 들어오지만
    // y 는 t = 1.48 이 되어야 들어온다 — 사각형 아래를 지나쳐 간다.
    expect(sweepCircleRect(0, 300, 200, -100, 2, 100, 100, 50, 50)).toBeNull()
  })

  it('반대 방향으로 멀어지면 null (뒤쪽 충돌을 주워 오지 않는다)', () => {
    // 사각형 아래에 있는 원이 아래로 간다 → 진입 시각이 음수.
    expect(sweepCircleRect(130, 200, 0, 300, R, RECT.x, RECT.y, RECT.w, RECT.h)).toBeNull()
  })

  it('가만히 있으면(이동 0) 겹치지 않는 한 null', () => {
    expect(sweepCircleRect(130, 200, 0, 0, R, RECT.x, RECT.y, RECT.w, RECT.h)).toBeNull()
  })
})

describe('sweepCircleRect — 이미 겹쳐 있을 때 (패들 끼임 방지)', () => {
  // 패들과 같은 모양: 중심 160, 너비 56, 윗면 404, 두께 9, 공 반지름 3.6
  const PAD = { x: 132, y: 404, w: 56, h: 9 }
  const BR = 3.6

  it('윗면 가까이 박혀 있으면 t = 0 이고 위쪽 법선이 나온다', () => {
    const hit = sweepCircleRect(160, 402, 0, 10, BR, PAD.x, PAD.y, PAD.w, PAD.h)
    expect(hit).toEqual({ t: 0, nx: 0, ny: -1 })
  })

  it('아랫면 가까이 박혀 있으면 아래쪽 법선', () => {
    const hit = sweepCircleRect(160, 415, 0, -10, BR, PAD.x, PAD.y, PAD.w, PAD.h)
    expect(hit).toEqual({ t: 0, nx: 0, ny: 1 })
  })

  it('왼쪽 끝에 박혀 있으면 왼쪽 법선', () => {
    // 부풀린 왼쪽 변 128.4 — 130 은 1.6 만 박혔고 위아래로는 더 깊다.
    const hit = sweepCircleRect(130, 410, 0, 0, BR, PAD.x, PAD.y, PAD.w, PAD.h)
    expect(hit).toEqual({ t: 0, nx: -1, ny: 0 })
  })

  it('오른쪽 끝에 박혀 있으면 오른쪽 법선', () => {
    const hit = sweepCircleRect(190, 410, 0, 0, BR, PAD.x, PAD.y, PAD.w, PAD.h)
    expect(hit).toEqual({ t: 0, nx: 1, ny: 0 })
  })

  it('겹친 상태에서는 진행 방향과 무관하게 "가장 얕은 면"으로 밀어낸다', () => {
    // 같은 자리에서 방향만 바꿔도 결과가 같아야 한다 — 방향에 따라 더 깊이 파고들면 끼인다.
    const up = sweepCircleRect(160, 402, 0, -50, BR, PAD.x, PAD.y, PAD.w, PAD.h)
    const down = sweepCircleRect(160, 402, 0, 50, BR, PAD.x, PAD.y, PAD.w, PAD.h)
    const side = sweepCircleRect(160, 402, 50, 0, BR, PAD.x, PAD.y, PAD.w, PAD.h)
    expect(up).toEqual(down)
    expect(side).toEqual(down)
  })
})

describe('normalize · clamp · rectsOverlap', () => {
  it('normalize(0, 0) 은 위쪽을 향한다 — 방향이 사라져도 공이 멈추지 않는다', () => {
    expect(normalize(0, 0)).toEqual({ dx: 0, dy: -1 })
  })

  it('normalize 는 길이를 1로 맞추고 방향을 유지한다', () => {
    expect(normalize(3, 4)).toEqual({ dx: 0.6, dy: 0.8 })
    const n = normalize(-12, 5)
    expect(Math.hypot(n.dx, n.dy)).toBeCloseTo(1, 12)
    // 방향(각도)이 바뀌지 않았는지 — 외적이 0.
    expect(n.dx * 5 - n.dy * -12).toBeCloseTo(0, 12)
  })

  it('normalize 는 아주 작은 벡터도 위쪽으로 돌린다 (0으로 나누지 않는다)', () => {
    expect(normalize(1e-12, -1e-12)).toEqual({ dx: 0, dy: -1 })
  })

  it('clamp 는 범위 밖을 잘라 내고 안쪽 값은 그대로 둔다', () => {
    expect(clamp(5, 1, 3)).toBe(3)
    expect(clamp(-5, 1, 3)).toBe(1)
    expect(clamp(2, 1, 3)).toBe(2)
    expect(clamp(1, 1, 3)).toBe(1)
    expect(clamp(3, 1, 3)).toBe(3)
  })

  it('rectsOverlap 은 면이 스치기만 하면 겹침이 아니다', () => {
    expect(rectsOverlap(0, 0, 10, 10, 5, 5, 10, 10)).toBe(true)
    // 오른쪽 변과 왼쪽 변이 정확히 닿기만 한 경우.
    expect(rectsOverlap(0, 0, 10, 10, 10, 0, 10, 10)).toBe(false)
    expect(rectsOverlap(0, 0, 10, 10, 20, 20, 10, 10)).toBe(false)
  })
})
