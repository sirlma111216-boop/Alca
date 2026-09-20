/**
 * 발표자 선정 규칙 검증 — selectPresenters / checkSelectionRule / targetEligibleRanks
 *
 * 핵심 규칙
 *  - 선정은 **항상 후보 순위(eligibleRank)** 로 한다. 전체 순위(rank)가 아니다.
 *  - 하위 N명은 후보 수 M 기준으로 (M-N+1)..M 이다.
 *  - 규칙이 후보 수에 비해 말이 안 되면 경기를 시작하기 전에 한국어 메시지로 막는다.
 */

import { describe, expect, it } from 'vitest'
import {
  SELECTION_PRESETS,
  checkSelectionRule,
  computeRanking,
  describeSelectionRule,
  presetIdForRule,
  selectPresenters,
  targetEligibleRanks,
  validateSelectionRule,
} from '../../src/core'
import type { ParticipantResult, PlayStatus, RankingEntry, SelectionRule } from '../../src/core'

// ── 도우미 ────────────────────────────────────────────────────────────────────

interface PersonSpec {
  id: string
  score: number | null
  lives?: number
  excluded?: boolean
  playStatus?: PlayStatus
}

const SEED = 'SELECT-SEED'

function ranked(specs: readonly PersonSpec[]): ParticipantResult[] {
  const entries: RankingEntry[] = specs.map((s) => ({
    id: s.id,
    nickname: `학생-${s.id}`,
    score: s.score,
    livesRemaining: s.score === null ? null : (s.lives ?? 1),
    playStatus: s.playStatus ?? (s.score === null ? 'not_played' : 'played'),
    excluded: s.excluded ?? false,
    bricksDestroyed: 0,
    playedMs: 30_000,
    wavesCleared: 0,
    items: [],
  }))
  return computeRanking(entries, { seed: SEED })
}

/** 점수가 전부 다른 8명. 전체 순위가 p1..p8 순서로 확정된다. */
const eight = (over: Record<string, Partial<PersonSpec>> = {}): ParticipantResult[] =>
  ranked(
    Array.from({ length: 8 }, (_, i) => {
      const id = `p${i + 1}`
      return { id, score: (8 - i) * 10, ...(over[id] ?? {}) }
    }),
  )

const eligibleRankOf = (rows: readonly ParticipantResult[], id: string): number | null =>
  rows.find((r) => r.id === id)?.eligibleRank ?? null

// ── 6가지 규칙 ────────────────────────────────────────────────────────────────

describe('selectPresenters — 6가지 규칙', () => {
  const rows = eight()

  it('전제: 제외자가 없으면 전체 순위와 후보 순위가 같다', () => {
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'])
    for (const r of rows) expect(r.eligibleRank).toBe(r.rank)
  })

  it('최고 성적 1명 — 후보 1위를 고른다', () => {
    const out = selectPresenters(rows, { kind: 'top', count: 1 })
    expect(out.selectedParticipantIds).toEqual(['p1'])
    expect(out.eligibleCount).toBe(8)
  })

  it('최저 성적 1명 — 후보 마지막 순위를 고른다', () => {
    const out = selectPresenters(rows, { kind: 'bottom', count: 1 })
    expect(out.selectedParticipantIds).toEqual(['p8'])
    expect(out.selectionReasons[0]?.eligibleRank).toBe(8)
  })

  it('지정 순위 1명(3위)', () => {
    const out = selectPresenters(rows, { kind: 'ranks', ranks: [3] })
    expect(out.selectedParticipantIds).toEqual(['p3'])
    expect(out.selectionReasons[0]?.eligibleRank).toBe(3)
  })

  it('상위 N명 — 1..N', () => {
    const out = selectPresenters(rows, { kind: 'top', count: 3 })
    expect(out.selectedParticipantIds).toEqual(['p1', 'p2', 'p3'])
    expect(out.selectionReasons.map((r) => r.eligibleRank)).toEqual([1, 2, 3])
  })

  it('하위 N명 — 후보 수 M 기준 (M-N+1)..M', () => {
    const out = selectPresenters(rows, { kind: 'bottom', count: 3 })
    expect(out.selectedParticipantIds).toEqual(['p6', 'p7', 'p8'])
    expect(out.selectionReasons.map((r) => r.eligibleRank)).toEqual([6, 7, 8])
  })

  it('복수 순위 2·5·8위', () => {
    const out = selectPresenters(rows, { kind: 'ranks', ranks: [2, 5, 8] })
    expect(out.selectedParticipantIds).toEqual(['p2', 'p5', 'p8'])
    expect(out.selectionReasons.map((r) => r.eligibleRank)).toEqual([2, 5, 8])
  })

  it('순위를 뒤죽박죽 적어도 결과는 순위 오름차순으로 나온다', () => {
    const out = selectPresenters(rows, { kind: 'ranks', ranks: [8, 2, 5] })
    expect(out.selectionReasons.map((r) => r.eligibleRank)).toEqual([2, 5, 8])
  })
})

// ── 핵심: 후보 순위 기준 ──────────────────────────────────────────────────────

describe('selectPresenters — 선정은 전체 순위가 아니라 후보 순위 기준이다', () => {
  // p1(제외), p3(제외), p5(미플레이) 를 빼면 후보는 p2·p4·p6·p7·p8 (후보 1..5위).
  const rows = eight({
    p1: { excluded: true },
    p3: { excluded: true },
    p5: { score: null },
  })

  it('전제: 제외·미플레이가 후보에서 빠지고 후보 순위가 1..5 로 다시 매겨진다', () => {
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p6', 'p7', 'p8', 'p5'])
    expect(eligibleRankOf(rows, 'p1')).toBeNull()
    expect(eligibleRankOf(rows, 'p3')).toBeNull()
    expect(eligibleRankOf(rows, 'p5')).toBeNull()
    expect(eligibleRankOf(rows, 'p2')).toBe(1)
    expect(eligibleRankOf(rows, 'p4')).toBe(2)
    expect(eligibleRankOf(rows, 'p6')).toBe(3)
    expect(eligibleRankOf(rows, 'p7')).toBe(4)
    expect(eligibleRankOf(rows, 'p8')).toBe(5)
  })

  it('지정 순위 3위는 전체 3위(p3)가 아니라 후보 3위(p6)를 고른다', () => {
    const out = selectPresenters(rows, { kind: 'ranks', ranks: [3] })
    expect(out.selectedParticipantIds).toEqual(['p6'])
    expect(out.selectedParticipantIds).not.toContain('p3')
    expect(out.eligibleCount).toBe(5)
  })

  it('최고 성적 1명은 전체 1위(제외된 p1)가 아니라 후보 1위(p2)다', () => {
    const out = selectPresenters(rows, { kind: 'top', count: 1 })
    expect(out.selectedParticipantIds).toEqual(['p2'])
  })

  it('최저 성적 1명은 맨 뒤의 미플레이(p5)가 아니라 후보 마지막(p8)이다', () => {
    const out = selectPresenters(rows, { kind: 'bottom', count: 1 })
    expect(out.selectedParticipantIds).toEqual(['p8'])
  })

  it('하위 2명은 후보 수 5 기준 4·5위(p7·p8)다', () => {
    const out = selectPresenters(rows, { kind: 'bottom', count: 2 })
    expect(out.selectedParticipantIds).toEqual(['p7', 'p8'])
    expect(out.selectionReasons.map((r) => r.eligibleRank)).toEqual([4, 5])
  })

  it('선정된 사람은 언제나 후보다 — 제외·미플레이·중도취소는 절대 뽑히지 않는다', () => {
    const wide = eight({
      p2: { excluded: true },
      p4: { playStatus: 'aborted' },
      p6: { score: null },
    })
    const rules: SelectionRule[] = [
      { kind: 'top', count: 5 },
      { kind: 'bottom', count: 5 },
      { kind: 'ranks', ranks: [1, 2, 3, 4, 5] },
    ]
    for (const rule of rules) {
      const out = selectPresenters(wide, rule)
      for (const id of out.selectedParticipantIds) {
        const row = wide.find((r) => r.id === id)
        expect(row?.eligibleRank).not.toBeNull()
        expect(row?.excluded).toBe(false)
        expect(row?.playStatus).toBe('played')
      }
    }
  })
})

// ── selectionReasons ──────────────────────────────────────────────────────────

describe('selectPresenters — selectionReasons', () => {
  const rows = eight({ p1: { excluded: true } })

  it('근거 개수가 선정자 수와 같고 ID·닉네임·후보 순위가 맞는다', () => {
    const out = selectPresenters(rows, { kind: 'ranks', ranks: [1, 4] })
    expect(out.selectionReasons).toHaveLength(out.selectedParticipantIds.length)
    expect(out.selectionReasons.map((r) => r.participantId)).toEqual(out.selectedParticipantIds)

    for (const reason of out.selectionReasons) {
      const row = rows.find((r) => r.id === reason.participantId)
      expect(row).toBeDefined()
      expect(reason.eligibleRank).toBe(row?.eligibleRank)
      expect(reason.nickname).toBe(row?.nickname)
      // 사람이 읽을 한국어 한 줄이고, 후보 수와 순위가 들어 있다.
      expect(reason.reason).toMatch(/[가-힣]/)
      expect(reason.reason).toContain(`${out.eligibleCount}명`)
      expect(reason.reason).toContain(`${reason.eligibleRank}위`)
    }
  })

  it('후보가 하나도 없으면 아무도 뽑지 않는다', () => {
    const none = ranked([
      { id: 'x', score: 10, excluded: true },
      { id: 'y', score: null },
    ])
    const out = selectPresenters(none, { kind: 'top', count: 1 })
    expect(out.eligibleCount).toBe(0)
    expect(out.selectedParticipantIds).toEqual([])
    expect(out.selectionReasons).toEqual([])
  })

  /**
   * 경계 계약 — selectPresenters 는 스스로 규칙을 막지 않는다.
   *
   * 경기가 끝난 뒤 후보가 줄어들 수 있다(직접 조작 모드에서 건너뛰면 미플레이가 된다).
   * 그때 지정 순위가 후보 수를 넘으면 selectPresenters 는 조용히 **아무도 뽑지 않는다**.
   * 그러므로 호출자는 결과를 내보내기 전에 checkSelectionRule 을 후보 수로 다시 돌려야 한다.
   */
  it('후보가 줄어 지정 순위가 범위를 벗어나면 조용히 0명을 뽑는다 — 호출자가 다시 검증해야 한다', () => {
    const shrunk = eight({ p7: { score: null }, p8: { score: null } }) // 후보 6명
    const rule: SelectionRule = { kind: 'ranks', ranks: [8] }

    const out = selectPresenters(shrunk, rule)
    expect(out.eligibleCount).toBe(6)
    expect(out.selectedParticipantIds).toEqual([])
    expect(out.selectionReasons).toEqual([])

    // 같은 상황을 checkSelectionRule 은 분명히 막아 준다 — 이 검증을 건너뛰면 안 된다.
    const problem = checkSelectionRule(rule, out.eligibleCount)
    expect(problem?.code).toBe('NOT_ENOUGH_CANDIDATES')
  })

  it('후보보다 많은 상위/하위 N명은 후보 수만큼만 뽑힌다 — 이 또한 사전 검증 대상이다', () => {
    const shrunk = eight({ p7: { score: null }, p8: { score: null } }) // 후보 6명
    const rule: SelectionRule = { kind: 'top', count: 7 }
    expect(selectPresenters(shrunk, rule).selectedParticipantIds).toHaveLength(6)
    expect(checkSelectionRule(rule, 6)?.code).toBe('NOT_ENOUGH_CANDIDATES')
  })

  it('참가자 목록이 비어 있어도 터지지 않는다', () => {
    const out = selectPresenters([], { kind: 'bottom', count: 1 })
    expect(out.selectedParticipantIds).toEqual([])
    expect(out.selectionReasons).toEqual([])
    expect(out.eligibleCount).toBe(0)
    // 후보가 0명이면 "왜 아무도 안 뽑혔는지" 가 데이터에 남아야 한다.
    expect(out.issue?.code).toBe('NOT_ENOUGH_CANDIDATES')
  })
})

// ── targetEligibleRanks ───────────────────────────────────────────────────────

describe('targetEligibleRanks', () => {
  it('상위 N명 → 1..N', () => {
    expect(targetEligibleRanks({ kind: 'top', count: 3 }, 10)).toEqual([1, 2, 3])
    expect(targetEligibleRanks({ kind: 'top', count: 1 }, 10)).toEqual([1])
  })

  it('하위 N명 → (M-N+1)..M', () => {
    expect(targetEligibleRanks({ kind: 'bottom', count: 3 }, 10)).toEqual([8, 9, 10])
    expect(targetEligibleRanks({ kind: 'bottom', count: 1 }, 7)).toEqual([7])
    expect(targetEligibleRanks({ kind: 'bottom', count: 2 }, 2)).toEqual([1, 2])
  })

  it('후보 수보다 많이 요구하면 후보 수만큼만 낸다', () => {
    expect(targetEligibleRanks({ kind: 'top', count: 99 }, 4)).toEqual([1, 2, 3, 4])
    expect(targetEligibleRanks({ kind: 'bottom', count: 99 }, 4)).toEqual([1, 2, 3, 4])
  })

  it('지정 순위는 중복을 없애고 오름차순으로 낸다', () => {
    expect(targetEligibleRanks({ kind: 'ranks', ranks: [5, 2, 8, 2] }, 10)).toEqual([2, 5, 8])
  })

  it('범위를 벗어난 지정 순위는 버린다', () => {
    expect(targetEligibleRanks({ kind: 'ranks', ranks: [1, 12] }, 5)).toEqual([1])
    expect(targetEligibleRanks({ kind: 'ranks', ranks: [0, -3] }, 5)).toEqual([])
  })

  it('후보가 0명이면 빈 목록이다', () => {
    expect(targetEligibleRanks({ kind: 'top', count: 1 }, 0)).toEqual([])
    expect(targetEligibleRanks({ kind: 'bottom', count: 1 }, 0)).toEqual([])
    expect(targetEligibleRanks({ kind: 'ranks', ranks: [1] }, 0)).toEqual([])
  })

  it('상위 N명과 하위 N명은 M = N 일 때 같은 집합이 된다', () => {
    expect(targetEligibleRanks({ kind: 'top', count: 5 }, 5)).toEqual(
      targetEligibleRanks({ kind: 'bottom', count: 5 }, 5),
    )
  })
})

// ── checkSelectionRule ────────────────────────────────────────────────────────

describe('checkSelectionRule — 경기 전 검증', () => {
  const korean = (s: string): boolean => /[가-힣]/.test(s)

  it('말이 되는 규칙은 null 을 돌려준다', () => {
    expect(checkSelectionRule({ kind: 'top', count: 1 }, 5)).toBeNull()
    expect(checkSelectionRule({ kind: 'bottom', count: 5 }, 5)).toBeNull()
    expect(checkSelectionRule({ kind: 'ranks', ranks: [1, 3, 5] }, 5)).toBeNull()
  })

  it('후보가 0명이면 NOT_ENOUGH_CANDIDATES', () => {
    for (const rule of [
      { kind: 'top', count: 1 },
      { kind: 'bottom', count: 1 },
      { kind: 'ranks', ranks: [1] },
    ] as SelectionRule[]) {
      const problem = checkSelectionRule(rule, 0)
      expect(problem?.code).toBe('NOT_ENOUGH_CANDIDATES')
      expect(korean(problem?.message ?? '')).toBe(true)
    }
  })

  it('후보보다 많이 뽑으려 하면 NOT_ENOUGH_CANDIDATES 이고 숫자가 메시지에 들어간다', () => {
    const problem = checkSelectionRule({ kind: 'top', count: 4 }, 3)
    expect(problem?.code).toBe('NOT_ENOUGH_CANDIDATES')
    expect(problem?.message).toContain('3명')
    expect(problem?.message).toContain('4명')

    const bottom = checkSelectionRule({ kind: 'bottom', count: 10 }, 2)
    expect(bottom?.code).toBe('NOT_ENOUGH_CANDIDATES')
  })

  it('범위를 벗어난 지정 순위는 NOT_ENOUGH_CANDIDATES 이고 그 순위를 알려 준다', () => {
    const problem = checkSelectionRule({ kind: 'ranks', ranks: [2, 9] }, 5)
    expect(problem?.code).toBe('NOT_ENOUGH_CANDIDATES')
    expect(problem?.message).toContain('9위')
    expect(problem?.details.join(' ')).toContain('9')
  })

  it('중복 순위는 INVALID_SELECTION_RULE', () => {
    const problem = checkSelectionRule({ kind: 'ranks', ranks: [3, 3] }, 5)
    expect(problem?.code).toBe('INVALID_SELECTION_RULE')
    expect(korean(problem?.message ?? '')).toBe(true)
    expect(problem?.details.some((d) => d.includes('중복'))).toBe(true)
  })

  it('0 이하·소수 순위는 INVALID_SELECTION_RULE', () => {
    for (const ranks of [[0], [-1], [1.5], [2, 0], [Number.NaN]]) {
      const problem = checkSelectionRule({ kind: 'ranks', ranks }, 5)
      expect(problem?.code).toBe('INVALID_SELECTION_RULE')
      expect(korean(problem?.message ?? '')).toBe(true)
    }
  })

  it('빈 순위 목록은 INVALID_SELECTION_RULE', () => {
    const problem = checkSelectionRule({ kind: 'ranks', ranks: [] }, 5)
    expect(problem?.code).toBe('INVALID_SELECTION_RULE')
    expect(korean(problem?.message ?? '')).toBe(true)
  })

  it('상위/하위 인원이 0 이하이거나 소수면 INVALID_SELECTION_RULE', () => {
    for (const count of [0, -2, 1.5]) {
      expect(checkSelectionRule({ kind: 'top', count }, 5)?.code).toBe('INVALID_SELECTION_RULE')
      expect(checkSelectionRule({ kind: 'bottom', count }, 5)?.code).toBe('INVALID_SELECTION_RULE')
    }
  })

  it('경기 전 검증을 통과한 규칙은 실제로 요청한 인원을 뽑아 낸다', () => {
    const rows = eight({ p2: { excluded: true } }) // 후보 7명
    const rules: SelectionRule[] = [
      { kind: 'top', count: 1 },
      { kind: 'bottom', count: 1 },
      { kind: 'top', count: 7 },
      { kind: 'bottom', count: 7 },
      { kind: 'ranks', ranks: [1] },
      { kind: 'ranks', ranks: [2, 5, 7] },
    ]
    for (const rule of rules) {
      expect(checkSelectionRule(rule, 7)).toBeNull()
      const out = selectPresenters(rows, rule)
      const expected = targetEligibleRanks(rule, 7).length
      expect(out.selectedParticipantIds).toHaveLength(expected)
      expect(new Set(out.selectedParticipantIds).size).toBe(expected)
    }
  })
})

// ── 설명 문구와 프리셋 ────────────────────────────────────────────────────────

describe('describeSelectionRule', () => {
  const cases: Array<{ rule: SelectionRule; must: string }> = [
    { rule: { kind: 'top', count: 1 }, must: '최고' },
    { rule: { kind: 'bottom', count: 1 }, must: '최저' },
    { rule: { kind: 'ranks', ranks: [3] }, must: '3위' },
    { rule: { kind: 'top', count: 4 }, must: '상위' },
    { rule: { kind: 'bottom', count: 4 }, must: '하위' },
    { rule: { kind: 'ranks', ranks: [2, 5, 8] }, must: '8위' },
  ]

  it('6가지 규칙 모두 사람이 읽을 한국어 문장을 낸다', () => {
    const texts = cases.map(({ rule, must }) => {
      const text = describeSelectionRule(rule)
      expect(text.length).toBeGreaterThan(0)
      expect(text).toMatch(/[가-힣]/)
      expect(text).toContain(must)
      return text
    })
    // 6가지가 서로 구분되는 문장이어야 화면에서 헷갈리지 않는다.
    expect(new Set(texts).size).toBe(6)
  })

  it('후보 수를 주면 문장에 기준 인원이 함께 나온다', () => {
    for (const { rule } of cases) {
      expect(describeSelectionRule(rule, 12)).toContain('12명')
    }
  })

  it('복수 순위는 지정한 순위를 모두 담는다', () => {
    const text = describeSelectionRule({ kind: 'ranks', ranks: [8, 2, 5] })
    for (const rank of [2, 5, 8]) expect(text).toContain(`${rank}위`)
  })
})

describe('SELECTION_PRESETS', () => {
  const sample: Record<string, number | number[]> = {
    best: 0,
    worst: 0,
    rank: 3,
    topN: 3,
    bottomN: 2,
    ranks: [2, 5, 8],
  }

  it('교사가 고를 수 있는 6가지가 있고 id 가 겹치지 않는다', () => {
    expect(SELECTION_PRESETS).toHaveLength(6)
    expect(new Set(SELECTION_PRESETS.map((p) => p.id)).size).toBe(6)
    for (const preset of SELECTION_PRESETS) {
      expect(preset.label).toMatch(/[가-힣]/)
      expect(preset.hint).toMatch(/[가-힣]/)
      expect(['count', 'rank', 'ranks', 'none']).toContain(preset.input)
    }
  })

  it('build() 가 검증을 통과하는 유효한 SelectionRule 을 만든다', () => {
    for (const preset of SELECTION_PRESETS) {
      const rule = preset.build(sample[preset.id] ?? 1)
      const parsed = validateSelectionRule(rule, 10)
      expect(parsed.ok, `${preset.id} → ${JSON.stringify(rule)}`).toBe(true)
      expect(checkSelectionRule(rule, 10)).toBeNull()
      // 만들어진 규칙이 후보 10명에서 실제로 누군가를 고를 수 있어야 한다.
      expect(targetEligibleRanks(rule, 10).length).toBeGreaterThan(0)
    }
  })

  it('presetIdForRule 이 왕복한다', () => {
    for (const preset of SELECTION_PRESETS) {
      const rule = preset.build(sample[preset.id] ?? 1)
      expect(presetIdForRule(rule), `${preset.id} → ${JSON.stringify(rule)}`).toBe(preset.id)
    }
  })

  it('build() 는 0 이하·소수 입력도 유효한 값으로 다듬는다', () => {
    for (const preset of SELECTION_PRESETS) {
      const rule = preset.build(preset.input === 'ranks' ? [0, 2.7] : -3)
      expect(checkSelectionRule(rule, 10)).toBeNull()
    }
  })
})
