/**
 * 벽돌 배치 — 단단한 벽돌은 가운데 띠에만.
 *
 * 이 배치가 게임의 난이도를 거의 다 정한다.
 * 맨 위 줄이 단단하면 공이 벽을 못 뚫고, 못 뚫으면 위 빈 공간으로 올라가지 못하며,
 * 그러면 짧은 경기에서 점수가 거의 안 난다. 그래서 여기를 못 박아 둔다.
 */

import { describe, expect, it } from 'vitest'
import { ARENA, BRICK_TYPES, DIFFICULTY_PRESETS } from '../../src/core/config'
import type { BrickTypeId } from '../../src/core/config'
import { rowTypesFor } from '../../src/core/level'
import { scoreTable } from '../../src/core/scoring'

const dur = (id: BrickTypeId): number => BRICK_TYPES[id].durability
const PRESETS = ['easy', 'normal', 'hard'] as const

describe('단단한 벽돌은 가운데 띠에만 모인다', () => {
  for (const name of PRESETS) {
    const preset = DIFFICULTY_PRESETS[name]
    const rows = Math.round(preset.brickRows)
    const layout = rowTypesFor(rows, preset.maxBrickDurability)

    it(`${name}: 맨 위와 맨 아래 줄은 한 번에 깨진다`, () => {
      expect(dur(layout[0])).toBe(1)
      expect(dur(layout[rows - 1])).toBe(1)
    })

    it(`${name}: 두 번 이상 맞아야 하는 줄이 **끊기지 않은 한 덩어리**다`, () => {
      const tough = layout.map((id) => dur(id) >= 2)
      const first = tough.indexOf(true)
      const last = tough.lastIndexOf(true)
      expect(first).toBeGreaterThan(-1)
      // 처음부터 끝까지 사이에 무른 줄이 끼어 있으면 안 된다.
      expect(tough.slice(first, last + 1).every(Boolean)).toBe(true)
    })

    it(`${name}: 단단한 띠가 전체의 절반을 넘지 않는다`, () => {
      const toughRows = layout.filter((id) => dur(id) >= 2).length
      expect(toughRows * 2).toBeLessThanOrEqual(rows)
    })

    it(`${name}: 띠가 가운데에 있다 (위아래 무른 줄 수가 한 줄 이내로 같다)`, () => {
      const tough = layout.map((id) => dur(id) >= 2)
      const above = tough.indexOf(true)
      const below = rows - 1 - tough.lastIndexOf(true)
      expect(Math.abs(above - below)).toBeLessThanOrEqual(1)
    })

    it(`${name}: 점수표에 적힌 벽돌이 전부 실제로 나온다`, () => {
      const shown = scoreTable(preset.maxBrickDurability).map((r) => r.label).sort()
      const placed = [...new Set(layout)].map((id) => BRICK_TYPES[id].label).sort()
      expect(placed).toEqual(shown)
    })
  }
})

describe('위쪽에 공이 돌아다닐 공간이 있다', () => {
  it('점수판 아래와 첫 벽돌 줄 사이가 공 지름의 두 배보다 넓다', () => {
    const gap = ARENA.brickTop - ARENA.hudBottom
    expect(gap).toBeGreaterThan(ARENA.ballRadius * 4)
  })

  it('벽돌 벽이 패들까지 내려오지 않는다', () => {
    const rows = Math.round(DIFFICULTY_PRESETS.hard.brickRows)
    const bottom = ARENA.brickTop + rows * (ARENA.brickHeight + ARENA.brickGap)
    expect(bottom).toBeLessThan(ARENA.paddleY - 100)
  })
})

describe('가장자리로 갈수록 무르고 싸다', () => {
  it('보통 배치가 가운데를 꼭짓점으로 하는 산 모양이다', () => {
    const layout = rowTypesFor(7, 3)
    const d = layout.map(dur)
    const peak = d.indexOf(Math.max(...d))
    // 꼭짓점까지 줄곧 오르고, 그 뒤로 줄곧 내린다.
    for (let i = 1; i <= peak; i += 1) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1])
    for (let i = peak + 1; i < d.length; i += 1) expect(d[i]).toBeLessThanOrEqual(d[i - 1])
  })

  it('맨 윗줄이 가장 싼 벽돌이다 — 뚫고 올라가도 점수가 거저 생기지 않는다', () => {
    const layout = rowTypesFor(7, 3)
    const cheapest = Math.min(...layout.map((id) => BRICK_TYPES[id].breakScore))
    expect(BRICK_TYPES[layout[0]].breakScore).toBe(cheapest)
  })
})

describe('가장자리 설정에서도 터지지 않는다', () => {
  it('한 줄짜리', () => {
    expect(rowTypesFor(1, 3)).toHaveLength(1)
    expect(dur(rowTypesFor(1, 3)[0])).toBe(1)
  })

  it('두 줄짜리는 전부 한 번에 깨진다 (띠를 만들 자리가 없다)', () => {
    expect(rowTypesFor(2, 3).every((id) => dur(id) === 1)).toBe(true)
  })

  it('최대 내구도가 1 이면 단단한 줄이 아예 없다', () => {
    expect(rowTypesFor(12, 1).every((id) => dur(id) === 1)).toBe(true)
  })

  it('가장 많은 줄(12)에서도 위아래가 무르다', () => {
    const layout = rowTypesFor(12, 3)
    expect(dur(layout[0])).toBe(1)
    expect(dur(layout[11])).toBe(1)
  })
})
