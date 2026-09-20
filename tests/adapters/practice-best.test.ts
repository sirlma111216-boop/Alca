/**
 * 혼자 연습하기 — 최고 기록.
 *
 * 이 기기에만 남는 내 점수다. 설정이 다르면 다른 기록이고,
 * "다 깰 때까지" 에서는 **빨리 깬 쪽**이 더 좋은 기록이다(점수는 다 깨면 같아지므로).
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearAllStoredData,
  clearPracticeBests,
  loadPracticeBests,
  practiceKey,
  savePracticeBest,
} from '../../src/standalone/state/store'

beforeEach(() => {
  localStorage.clear()
})

const FIXED = practiceKey('normal', 'fixed', 30_000)
const CLEARED = practiceKey('normal', 'until-cleared', 120_000)

describe('설정이 다르면 기록도 따로 센다', () => {
  it('난이도·경기 방식·시간이 하나라도 다르면 다른 칸이다', () => {
    const a = practiceKey('easy', 'fixed', 30_000)
    const b = practiceKey('hard', 'fixed', 30_000)
    const c = practiceKey('easy', 'fixed', 60_000)
    const d = practiceKey('easy', 'until-cleared', 30_000)
    expect(new Set([a, b, c, d]).size).toBe(4)
  })

  it('한쪽에 기록을 세워도 다른 설정의 기록은 비어 있다', () => {
    savePracticeBest(FIXED, { score: 500, clearedAtMs: null }, false)
    const all = loadPracticeBests()
    expect(all[FIXED]?.score).toBe(500)
    expect(all[CLEARED]).toBeUndefined()
  })
})

describe('정해진 시간 — 점수가 높아야 최고 기록', () => {
  it('첫 기록은 언제나 최고 기록이다', () => {
    expect(savePracticeBest(FIXED, { score: 120, clearedAtMs: null }, false)).toBe(true)
  })

  it('더 높으면 갱신, 더 낮으면 그대로', () => {
    savePracticeBest(FIXED, { score: 300, clearedAtMs: null }, false)
    expect(savePracticeBest(FIXED, { score: 500, clearedAtMs: null }, false)).toBe(true)
    expect(loadPracticeBests()[FIXED].score).toBe(500)

    expect(savePracticeBest(FIXED, { score: 200, clearedAtMs: null }, false)).toBe(false)
    expect(loadPracticeBests()[FIXED].score).toBe(500)
  })

  it('같은 점수는 갱신하지 않는다', () => {
    savePracticeBest(FIXED, { score: 400, clearedAtMs: null }, false)
    expect(savePracticeBest(FIXED, { score: 400, clearedAtMs: null }, false)).toBe(false)
  })
})

describe('다 깰 때까지 — 빨리 깬 쪽이 최고 기록', () => {
  it('처음으로 다 깨면 점수가 낮아도 최고 기록이다', () => {
    savePracticeBest(CLEARED, { score: 9_999, clearedAtMs: null }, true) // 점수는 높은데 못 깸
    expect(savePracticeBest(CLEARED, { score: 100, clearedAtMs: 40_000 }, true)).toBe(true)
    expect(loadPracticeBests()[CLEARED].clearedAtMs).toBe(40_000)
  })

  it('더 빨리 깨면 갱신, 느리면 그대로', () => {
    savePracticeBest(CLEARED, { score: 1_000, clearedAtMs: 30_000 }, true)
    expect(savePracticeBest(CLEARED, { score: 1_000, clearedAtMs: 20_000 }, true)).toBe(true)
    expect(loadPracticeBests()[CLEARED].clearedAtMs).toBe(20_000)

    expect(savePracticeBest(CLEARED, { score: 1_000, clearedAtMs: 45_000 }, true)).toBe(false)
    expect(loadPracticeBests()[CLEARED].clearedAtMs).toBe(20_000)
  })

  it('이미 깬 기록이 있으면 못 깬 판은 갱신하지 않는다 — 점수가 아무리 높아도', () => {
    savePracticeBest(CLEARED, { score: 500, clearedAtMs: 25_000 }, true)
    expect(savePracticeBest(CLEARED, { score: 999_999, clearedAtMs: null }, true)).toBe(false)
    expect(loadPracticeBests()[CLEARED].clearedAtMs).toBe(25_000)
  })

  it('둘 다 못 깼으면 점수로 가른다', () => {
    savePracticeBest(CLEARED, { score: 200, clearedAtMs: null }, true)
    expect(savePracticeBest(CLEARED, { score: 350, clearedAtMs: null }, true)).toBe(true)
    expect(loadPracticeBests()[CLEARED].score).toBe(350)
  })
})

describe('지우기', () => {
  it('연습 기록만 지운다', () => {
    savePracticeBest(FIXED, { score: 100, clearedAtMs: null }, false)
    localStorage.setItem('brickpick:prefs', JSON.stringify({ soundEnabled: false }))
    clearPracticeBests()
    expect(loadPracticeBests()).toEqual({})
    expect(localStorage.getItem('brickpick:prefs')).not.toBeNull()
  })

  it('"이 기기에 저장한 내용 모두 지우기" 에 연습 기록도 포함된다', () => {
    savePracticeBest(FIXED, { score: 100, clearedAtMs: null }, false)
    clearAllStoredData()
    expect(loadPracticeBests()).toEqual({})
  })
})

describe('저장이 막혀 있어도 터지지 않는다', () => {
  it('localStorage 가 던져도 게임은 계속된다', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('사생활 보호 모드')
    }
    try {
      expect(() => savePracticeBest(FIXED, { score: 1, clearedAtMs: null }, false)).not.toThrow()
    } finally {
      Storage.prototype.setItem = original
    }
  })
})
