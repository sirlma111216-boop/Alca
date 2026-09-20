/**
 * 순위 계산 규칙 검증 — computeRanking / tieBreakDraw / isCandidate / candidateCount
 *
 * 구현을 그대로 베끼지 않고 "문서에 적힌 규칙"만 보고 확인한다.
 *  1. 점수 내림차순
 *  2. 같으면 남은 목숨이 많은 쪽이 앞 (tie.resolvedBy === 'lives')
 *  3. 그마저 같으면 seed 추첨 (tie.resolvedBy === 'seed', drawValue 존재)
 *  4. 미플레이는 0점이 아니라 "기록 없음" 이라 항상 뒤
 *  5. 이름순·입력순으로는 절대 가르지 않는다
 */

import { describe, expect, it } from 'vitest'
import { candidateCount, computeRanking, createRng, isCandidate, tieBreakDraw } from '../../src/core'
import type { ParticipantResult, PlayStatus, RankingEntry } from '../../src/core'

// ── 도우미 ────────────────────────────────────────────────────────────────────

/** 기본값이 채워진 순위 입력 하나. 필요한 항목만 덮어쓴다. */
function entry(id: string, over: Partial<RankingEntry> = {}): RankingEntry {
  return {
    id,
    nickname: `학생-${id}`,
    score: 0,
    livesRemaining: 1,
    playStatus: 'played',
    excluded: false,
    bricksDestroyed: 0,
    playedMs: 30_000,
    wavesCleared: 0,
    items: [],
    ...over,
  }
}

/** 참가자 ID → 전체 순위 매핑. 입력 순서를 바꿔도 이 매핑은 같아야 한다. */
function rankMap(rows: readonly ParticipantResult[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) out[row.id] = row.rank
  return out
}

const orderedIds = (rows: readonly ParticipantResult[]): string[] => rows.map((r) => r.id)

/** 시간·전역 난수에 기대지 않는 결정적 뒤섞기. */
function shuffled<T>(items: readonly T[], salt: string): T[] {
  return createRng(`shuffle:${salt}`).shuffled(items)
}

const SEED = 'RANK-SEED'

// ── 기본 정렬 ─────────────────────────────────────────────────────────────────

describe('computeRanking — 기본 정렬', () => {
  it('점수가 높은 사람이 앞에 온다', () => {
    const rows = computeRanking(
      [
        entry('a', { score: 120 }),
        entry('b', { score: 350 }),
        entry('c', { score: 40 }),
        entry('d', { score: 200 }),
      ],
      { seed: SEED },
    )

    expect(orderedIds(rows)).toEqual(['b', 'd', 'a', 'c'])
    // 순위 번호가 점수 내림차순과 어긋나지 않는지 직접 다시 확인한다.
    const scores = rows.map((r) => r.score ?? Number.NEGATIVE_INFINITY)
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i])
    }
  })

  it('rank 는 1..N 으로 유일하고, eligibleRank 는 1..M 으로 유일하다', () => {
    const rows = computeRanking(
      [
        entry('a', { score: 100 }),
        entry('b', { score: 90 }),
        entry('c', { score: 80, excluded: true }),
        entry('d', { score: 70 }),
        entry('e', { score: null, playStatus: 'not_played', livesRemaining: null }),
      ],
      { seed: SEED },
    )

    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5])

    const eligible = rows.filter((r) => r.eligibleRank !== null)
    expect(eligible).toHaveLength(3)
    expect(eligible.map((r) => r.eligibleRank)).toEqual([1, 2, 3])
    expect(candidateCount(rows)).toBe(3)

    // 후보가 아닌 사람은 반드시 null 이다.
    for (const row of rows) {
      if (!isCandidate(row)) expect(row.eligibleRank).toBeNull()
    }
  })

  it('eligibleRank 의 순서는 전체 순위의 순서를 그대로 따라간다', () => {
    const rows = computeRanking(
      [
        entry('a', { score: 100, excluded: true }),
        entry('b', { score: 90 }),
        entry('c', { score: 80 }),
        entry('d', { score: 70, excluded: true }),
        entry('e', { score: 60 }),
      ],
      { seed: SEED },
    )

    const eligible = rows.filter((r) => r.eligibleRank !== null)
    // 후보만 추려 낸 순서와 eligibleRank 순서가 같아야 한다.
    expect(eligible.map((r) => r.id)).toEqual(['b', 'c', 'e'])
    expect(eligible.map((r) => r.eligibleRank)).toEqual([1, 2, 3])
  })
})

// ── 동점 처리 ─────────────────────────────────────────────────────────────────

describe('computeRanking — 동점 처리', () => {
  it('점수가 같으면 남은 목숨이 많은 쪽이 앞이고 resolvedBy 는 lives 다', () => {
    const rows = computeRanking(
      [
        entry('few', { score: 500, livesRemaining: 1 }),
        entry('many', { score: 500, livesRemaining: 3 }),
        entry('mid', { score: 500, livesRemaining: 2 }),
      ],
      { seed: SEED },
    )

    expect(orderedIds(rows)).toEqual(['many', 'mid', 'few'])
    for (const row of rows) {
      expect(row.tie.tied).toBe(true)
      expect(row.tie.resolvedBy).toBe('lives')
      expect([...row.tie.tiedWith].sort()).toEqual(['few', 'many', 'mid'])
    }
  })

  it('점수와 목숨이 모두 같으면 seed 추첨으로 가르고 drawValue 를 남긴다', () => {
    const ids = ['p1', 'p2', 'p3', 'p4']
    const rows = computeRanking(
      ids.map((id) => entry(id, { score: 300, livesRemaining: 2 })),
      { seed: SEED },
    )

    for (const row of rows) {
      expect(row.tie.tied).toBe(true)
      expect(row.tie.resolvedBy).toBe('seed')
      expect(typeof row.tie.drawValue).toBe('number')
      // 추첨값은 seed 와 참가자 ID 만으로 다시 계산할 수 있어야 한다.
      expect(row.tie.drawValue).toBe(tieBreakDraw(SEED, row.id))
      expect(row.tie.drawValue).toBeGreaterThanOrEqual(0)
      expect(row.tie.drawValue).toBeLessThan(1)
    }

    // 추첨값이 작을수록 앞이라는 규칙을 독립적으로 다시 확인한다.
    const expected = [...ids].sort((a, b) => tieBreakDraw(SEED, a) - tieBreakDraw(SEED, b))
    expect(orderedIds(rows)).toEqual(expected)
  })

  it('동점자가 없으면 tied 는 false 이고 resolvedBy 는 none 이다', () => {
    const rows = computeRanking(
      [entry('a', { score: 10 }), entry('b', { score: 20 })],
      { seed: SEED },
    )
    for (const row of rows) {
      expect(row.tie.tied).toBe(false)
      expect(row.tie.tiedWith).toEqual([])
      expect(row.tie.resolvedBy).toBe('none')
      expect(row.tie.drawValue).toBeUndefined()
    }
  })

  it('점수는 같지만 목숨이 갈리는 묶음과 완전 동점 묶음이 한 판에 섞여도 각각 맞게 표시된다', () => {
    const rows = computeRanking(
      [
        entry('t1', { score: 200, livesRemaining: 3 }),
        entry('t2', { score: 200, livesRemaining: 3 }),
        entry('t3', { score: 200, livesRemaining: 1 }),
      ],
      { seed: SEED },
    )
    const byId = new Map(rows.map((r) => [r.id, r]))
    // 목숨까지 같은 두 사람은 추첨, 혼자 목숨이 다른 사람은 목숨으로 갈렸다.
    expect(byId.get('t1')?.tie.resolvedBy).toBe('seed')
    expect(byId.get('t2')?.tie.resolvedBy).toBe('seed')
    expect(byId.get('t3')?.tie.resolvedBy).toBe('lives')
    // 목숨이 적은 사람은 반드시 맨 뒤다.
    expect(rows[2]?.id).toBe('t3')
  })
})

// ── 입력 순서·이름에 흔들리지 않는지 ──────────────────────────────────────────

describe('computeRanking — 입력 순서·이름으로 가르지 않는다', () => {
  const base: RankingEntry[] = [
    entry('u1', { score: 400, livesRemaining: 2, nickname: '가나다' }),
    entry('u2', { score: 400, livesRemaining: 2, nickname: '하하하' }),
    entry('u3', { score: 400, livesRemaining: 2, nickname: '아무개' }),
    entry('u4', { score: 250, livesRemaining: 3, nickname: '가나다' }),
    entry('u5', { score: 250, livesRemaining: 1, nickname: '나중에' }),
    entry('u6', { score: null, playStatus: 'not_played', livesRemaining: null, nickname: 'ㄱㄱ' }),
    entry('u7', { score: 0, livesRemaining: 0, nickname: 'ㅎㅎ' }),
  ]

  it('같은 입력을 순서만 뒤섞어도 참가자 ID → rank 매핑이 완전히 같다', () => {
    const reference = rankMap(computeRanking(base, { seed: SEED }))

    for (let i = 0; i < 12; i += 1) {
      const scrambled = shuffled(base, `order-${i}`)
      expect(rankMap(computeRanking(scrambled, { seed: SEED }))).toEqual(reference)
    }
  })

  it('입력을 완전히 뒤집어도 결과 순서가 같다', () => {
    const forward = orderedIds(computeRanking(base, { seed: SEED }))
    const backward = orderedIds(computeRanking([...base].reverse(), { seed: SEED }))
    expect(backward).toEqual(forward)
  })

  it('닉네임만 바꿔도(ID 그대로) 순위가 달라지지 않는다', () => {
    const renamed = base.map((e, i) => ({ ...e, nickname: `ZZZ-${base.length - i}` }))
    expect(rankMap(computeRanking(renamed, { seed: SEED }))).toEqual(
      rankMap(computeRanking(base, { seed: SEED })),
    )
  })

  it('같은 닉네임이 여러 명이어도 ID 별로 따로 처리된다', () => {
    const rows = computeRanking(
      [
        entry('dup1', { nickname: '김민준', score: 100 }),
        entry('dup2', { nickname: '김민준', score: 300 }),
        entry('dup3', { nickname: '김민준', score: 200 }),
      ],
      { seed: SEED },
    )
    expect(orderedIds(rows)).toEqual(['dup2', 'dup3', 'dup1'])
    expect(rows.map((r) => r.nickname)).toEqual(['김민준', '김민준', '김민준'])
    expect(new Set(rows.map((r) => r.id)).size).toBe(3)
  })
})

// ── 미플레이·제외 ─────────────────────────────────────────────────────────────

describe('computeRanking — 미플레이와 제외', () => {
  it('미플레이는 0점보다도 뒤에 온다 (0점과 구분된다)', () => {
    const zero = entry('zero', { score: 0, livesRemaining: 0 })
    const none = entry('none', { score: null, playStatus: 'not_played', livesRemaining: null })

    for (const order of [[zero, none], [none, zero]]) {
      const rows = computeRanking(order, { seed: SEED })
      expect(orderedIds(rows)).toEqual(['zero', 'none'])
      expect(rows[0]?.score).toBe(0)
      expect(rows[1]?.score).toBeNull()
    }
  })

  it('점수가 있는 사람은 아무리 낮아도 미플레이보다 앞이다', () => {
    const rows = computeRanking(
      [
        entry('np1', { score: null, playStatus: 'not_played', livesRemaining: null }),
        entry('np2', { score: null, playStatus: 'not_played', livesRemaining: null }),
        entry('low', { score: 0, livesRemaining: 0 }),
        entry('high', { score: 10 }),
      ],
      { seed: SEED },
    )
    const scoredRanks = rows.filter((r) => r.score !== null).map((r) => r.rank)
    const unscoredRanks = rows.filter((r) => r.score === null).map((r) => r.rank)
    expect(Math.max(...scoredRanks)).toBeLessThan(Math.min(...unscoredRanks))
  })

  it('미플레이·중도취소·제외는 후보에서 빠진다 (eligibleRank === null)', () => {
    const rows = computeRanking(
      [
        entry('ok', { score: 100 }),
        entry('gone', { score: null, playStatus: 'not_played', livesRemaining: null }),
        entry('quit', { score: 90, playStatus: 'aborted' }),
        entry('out', { score: 120, excluded: true }),
      ],
      { seed: SEED },
    )
    const byId = new Map(rows.map((r) => [r.id, r]))

    expect(byId.get('ok')?.eligibleRank).toBe(1)
    expect(byId.get('gone')?.eligibleRank).toBeNull()
    expect(byId.get('quit')?.eligibleRank).toBeNull()
    expect(byId.get('out')?.eligibleRank).toBeNull()
    expect(candidateCount(rows)).toBe(1)
  })

  it('제외된 사람도 전체 rank 에는 점수대로 들어간다', () => {
    const rows = computeRanking(
      [
        entry('a', { score: 100 }),
        entry('best-but-out', { score: 999, excluded: true }),
        entry('b', { score: 50 }),
      ],
      { seed: SEED },
    )
    expect(orderedIds(rows)).toEqual(['best-but-out', 'a', 'b'])
    expect(rows[0]?.rank).toBe(1)
    expect(rows[0]?.excluded).toBe(true)
    expect(rows[0]?.eligibleRank).toBeNull()
    // 제외자가 앞자리를 차지해도 후보 순위는 1부터 이어진다.
    expect(rows[1]?.eligibleRank).toBe(1)
    expect(rows[2]?.eligibleRank).toBe(2)
  })

  it('중도취소는 점수를 남기지만 후보는 아니다', () => {
    const rows = computeRanking(
      [entry('q', { score: 700, playStatus: 'aborted' }), entry('p', { score: 10 })],
      { seed: SEED },
    )
    const q = rows.find((r) => r.id === 'q')
    expect(q?.score).toBe(700)
    expect(q?.rank).toBe(1)
    expect(q?.eligibleRank).toBeNull()
    expect(isCandidate({ excluded: false, playStatus: 'aborted' as PlayStatus })).toBe(false)
  })
})

// ── 경계 인원수 ───────────────────────────────────────────────────────────────

describe('computeRanking — 참가자 수 경계', () => {
  it('0명이면 빈 배열이다', () => {
    const rows = computeRanking([], { seed: SEED })
    expect(rows).toEqual([])
    expect(candidateCount(rows)).toBe(0)
  })

  it('1명이면 1위이자 후보 1위이고 동점자가 없다', () => {
    const rows = computeRanking([entry('solo', { score: 42 })], { seed: SEED })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.rank).toBe(1)
    expect(rows[0]?.eligibleRank).toBe(1)
    expect(rows[0]?.tie.tied).toBe(false)
    expect(rows[0]?.tie.resolvedBy).toBe('none')
  })

  it('40명이어도 rank 는 1..40 으로 유일하다', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      // 일부러 점수를 겹치게 만들어 동점 처리까지 함께 태운다.
      entry(`u${i + 1}`, { score: (i % 8) * 50, livesRemaining: i % 3 }),
    )
    const rows = computeRanking(many, { seed: SEED })

    expect(rows).toHaveLength(40)
    expect(new Set(rows.map((r) => r.rank))).toEqual(new Set(Array.from({ length: 40 }, (_, i) => i + 1)))
    expect(new Set(rows.map((r) => r.eligibleRank))).toEqual(
      new Set(Array.from({ length: 40 }, (_, i) => i + 1)),
    )
    expect(new Set(rows.map((r) => r.id)).size).toBe(40)
    // 순서를 뒤섞어도 결과가 같다.
    expect(rankMap(computeRanking(shuffled(many, '40'), { seed: SEED }))).toEqual(rankMap(rows))
  })
})

// ── seed 결정성 ───────────────────────────────────────────────────────────────

describe('tieBreakDraw / seed 결정성', () => {
  it('같은 seed·같은 ID 면 추첨값이 항상 같다', () => {
    const first = tieBreakDraw('S', 'abc')
    for (let i = 0; i < 20; i += 1) expect(tieBreakDraw('S', 'abc')).toBe(first)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(1)
  })

  it('같은 seed 로 몇 번을 돌려도 완전 동점자의 순서가 같다', () => {
    const tied = Array.from({ length: 10 }, (_, i) => entry(`t${i + 1}`, { score: 100, livesRemaining: 2 }))
    const first = orderedIds(computeRanking(tied, { seed: 'FIXED' }))
    for (let i = 0; i < 5; i += 1) {
      expect(orderedIds(computeRanking(shuffled(tied, `s${i}`), { seed: 'FIXED' }))).toEqual(first)
    }
  })

  it('seed 가 다르면 동점자 순서가 바뀔 수 있다', () => {
    const tied = Array.from({ length: 10 }, (_, i) => entry(`t${i + 1}`, { score: 100, livesRemaining: 2 }))
    const baseline = orderedIds(computeRanking(tied, { seed: 'SEED-000' })).join(',')

    const changed = Array.from({ length: 20 }, (_, i) => `SEED-${i + 1}`).some(
      (seed) => orderedIds(computeRanking(tied, { seed })).join(',') !== baseline,
    )
    expect(changed).toBe(true)
  })

  it('seed 를 바꿔도 점수가 다르면 순서는 그대로다 (추첨이 점수를 뒤집지 못한다)', () => {
    const rows = [entry('a', { score: 30 }), entry('b', { score: 20 }), entry('c', { score: 10 })]
    for (const seed of ['S1', 'S2', 'S3', 'S4', 'S5']) {
      expect(orderedIds(computeRanking(rows, { seed }))).toEqual(['a', 'b', 'c'])
    }
  })
})
