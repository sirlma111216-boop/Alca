/**
 * 실시간 수업의 **집계** 검증.
 *
 * Durable Object 를 그대로 띄우기는 어렵다. 그럴 필요도 없다 —
 * 서버(worker/room-do.ts)는 점수를 모으기만 하고, **순위와 발표자는 교사 화면이
 * core 의 순수 함수로 낸다.** 그래서 여기서는 서버가 내려 주는 finals 모양
 *   { token, nick, status, final }
 * 을 손으로 만들어, 교사 화면이 하는 변환 + computeRanking + selectPresenters 를 시험한다.
 *
 * ★ 지키려는 것
 *  "끝까지 못 한 학생이 0점으로 처리되어, 최저 성적 1명 규칙에 **그 학생이 뽑히는**" 사고.
 *  끝내지 못한 학생은 0점이 아니라 **기록 없음(not_played)** 이고, 후보에서 빠져야 한다.
 */

import { describe, expect, it } from 'vitest'
import { computeRanking, selectPresenters } from '../../src/core'
import type { ParticipantResult, RankingEntry, SelectionRule } from '../../src/core'
import { ROOM_MAX_MEMBERS } from '../../worker/protocol'
import type { FinalReport, MemberStatus } from '../../worker/protocol'

const SEED = 'brickpick-live-2026'

/** worker/room-do.ts 의 finals() 가 내려 주는 한 줄. */
interface FinalRow {
  token: string
  nick: string
  status: MemberStatus
  final: FinalReport | null
}

/** 경기를 마친 학생 한 줄. */
function done(token: string, nick: string, score: number, lives = 2): FinalRow {
  return {
    token,
    nick,
    status: 'done',
    final: {
      token,
      matchId: 'm1',
      score,
      livesRemaining: lives,
      bricksDestroyed: Math.round(score / 20),
      playedMs: 60_000,
      wavesCleared: 0,
      clearedAtMs: null,
      items: [],
    },
  }
}

/** 끝내지 못한 학생 한 줄. 서버에는 최종 기록이 없다. */
function unfinished(token: string, nick: string, status: MemberStatus = 'playing'): FinalRow {
  return { token, nick, status, final: null }
}

/**
 * ★ 교사 화면이 하는 변환. 이 매핑이 집계의 전부다.
 *  - 최종 기록(final)이 없으면 score 는 **null**(0 이 아니다) 이고 playStatus 는 'not_played'.
 *  - 제외 명단(닉네임 기준)에 들면 excluded 로 표시한다. 전체 순위에는 그대로 남는다.
 *  - 실시간 모드에는 외부 참가자 ID 가 없으므로 기기 토큰을 id 로 쓴다.
 */
function toEntries(rows: readonly FinalRow[], excludedNicks: readonly string[] = []): RankingEntry[] {
  const excludedSet = new Set(excludedNicks)
  return rows.map((row) => {
    const excluded = excludedSet.has(row.nick)
    const f = row.final
    return {
      id: row.token,
      nickname: row.nick,
      score: f ? f.score : null,
      livesRemaining: f ? f.livesRemaining : null,
      playStatus: f ? (excluded ? 'excluded' : 'played') : 'not_played',
      excluded,
      bricksDestroyed: f ? f.bricksDestroyed : 0,
      playedMs: f ? f.playedMs : 0,
      wavesCleared: f ? f.wavesCleared : 0,
      items: [],
    } satisfies RankingEntry
  })
}

function rankingOf(rows: readonly FinalRow[], excludedNicks: readonly string[] = []) {
  return computeRanking(toEntries(rows, excludedNicks), { seed: SEED })
}

const byNick = (rows: readonly ParticipantResult[], nick: string): ParticipantResult => {
  const found = rows.find((r) => r.nickname === nick)
  if (!found) throw new Error(`명단에 없다: ${nick}`)
  return found
}

const WORST_ONE: SelectionRule = { kind: 'bottom', count: 1 }
const BEST_ONE: SelectionRule = { kind: 'top', count: 1 }

// ─────────────────────────────────────────────────────────────────────────────

describe('끝까지 못 한 학생은 후보가 아니다', () => {
  const rows: FinalRow[] = [
    done('t1', '하늘', 2400),
    done('t2', '바다', 1200),
    done('t3', '마루', 600),
    unfinished('t4', '나래'),
    unfinished('t5', '해든', 'waiting'),
  ]

  it('미완료 학생의 점수는 0 이 아니라 null 이다', () => {
    const results = rankingOf(rows)
    expect(byNick(results, '나래').score).toBeNull()
    expect(byNick(results, '해든').score).toBeNull()
  })

  it("미완료 학생의 상태는 'not_played' 다", () => {
    const results = rankingOf(rows)
    expect(byNick(results, '나래').playStatus).toBe('not_played')
    expect(byNick(results, '해든').playStatus).toBe('not_played')
  })

  it('미완료 학생은 후보 순위(eligibleRank)가 없다', () => {
    const results = rankingOf(rows)
    expect(byNick(results, '나래').eligibleRank).toBeNull()
    expect(byNick(results, '해든').eligibleRank).toBeNull()
    // 경기를 마친 세 명만 후보 1·2·3위
    expect(byNick(results, '하늘').eligibleRank).toBe(1)
    expect(byNick(results, '바다').eligibleRank).toBe(2)
    expect(byNick(results, '마루').eligibleRank).toBe(3)
  })

  it('미완료 학생은 전체 순위에서 항상 뒤에 놓인다', () => {
    const results = rankingOf(rows)
    expect(byNick(results, '나래').rank).toBeGreaterThan(byNick(results, '마루').rank)
    expect(byNick(results, '해든').rank).toBeGreaterThan(byNick(results, '마루').rank)
  })

  it('★ "최저 성적 1명" 으로 뽑아도 미완료 학생이 뽑히지 않는다', () => {
    const results = rankingOf(rows)
    const outcome = selectPresenters(results, WORST_ONE)
    expect(outcome.selectedParticipantIds).toEqual(['t3']) // 마루 — 경기를 마친 사람 중 최저
    expect(outcome.eligibleCount).toBe(3)
    expect(outcome.issue).toBeNull()
  })

  it('"최고 성적 1명" 도 마찬가지로 경기를 마친 사람 중에서 나온다', () => {
    const outcome = selectPresenters(rankingOf(rows), BEST_ONE)
    expect(outcome.selectedParticipantIds).toEqual(['t1'])
  })
})

describe('제외한 학생 — 전체 순위에는 남고 후보에서만 빠진다', () => {
  const rows: FinalRow[] = [
    done('t1', '하늘', 2400),
    done('t2', '바다', 1800),
    done('t3', '마루', 900),
  ]

  it('제외해도 전체 순위표에서 사라지지 않는다', () => {
    const results = rankingOf(rows, ['하늘'])
    expect(results).toHaveLength(3)
    expect(byNick(results, '하늘').rank).toBe(1) // 점수가 가장 높으니 전체 1위 그대로
    expect(byNick(results, '하늘').score).toBe(2400)
    expect(byNick(results, '하늘').excluded).toBe(true)
  })

  it('제외한 학생은 후보 순위가 없고, 나머지가 1위부터 다시 매겨진다', () => {
    const results = rankingOf(rows, ['하늘'])
    expect(byNick(results, '하늘').eligibleRank).toBeNull()
    expect(byNick(results, '바다').eligibleRank).toBe(1)
    expect(byNick(results, '마루').eligibleRank).toBe(2)
  })

  it('이미 발표한 학생은 다시 뽑히지 않는다', () => {
    const outcome = selectPresenters(rankingOf(rows, ['하늘']), BEST_ONE)
    expect(outcome.selectedParticipantIds).toEqual(['t2']) // 바다
    expect(outcome.eligibleCount).toBe(2)
  })

  it('제외와 미완료가 섞여도 후보는 나머지뿐이다', () => {
    const mixed: FinalRow[] = [...rows, unfinished('t4', '나래')]
    const outcome = selectPresenters(rankingOf(mixed, ['하늘']), WORST_ONE)
    expect(outcome.eligibleCount).toBe(2)
    expect(outcome.selectedParticipantIds).toEqual(['t3']) // 마루
  })
})

describe('전원이 끝내지 못했을 때 — 조용히 넘어가지 않는다', () => {
  const rows: FinalRow[] = [
    unfinished('t1', '하늘'),
    unfinished('t2', '바다'),
    unfinished('t3', '마루', 'waiting'),
  ]

  it('후보가 0명이다', () => {
    const results = rankingOf(rows)
    expect(results.filter((r) => r.eligibleRank !== null)).toHaveLength(0)
  })

  it('아무도 뽑히지 않고 이유가 남는다 (NOT_ENOUGH_CANDIDATES)', () => {
    const outcome = selectPresenters(rankingOf(rows), WORST_ONE)
    expect(outcome.selectedParticipantIds).toEqual([])
    expect(outcome.eligibleCount).toBe(0)
    expect(outcome.issue?.code).toBe('NOT_ENOUGH_CANDIDATES')
    // 교사 화면에 그대로 띄울 한국어 안내가 들어 있어야 한다.
    expect(outcome.issue?.message.length ?? 0).toBeGreaterThan(0)
  })

  it('전체 순위는 그래도 매겨진다 (모두 1위부터 유일하게)', () => {
    const results = rankingOf(rows)
    expect([...results.map((r) => r.rank)].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })
})

describe('같은 seed 면 동점자 순서가 재현된다', () => {
  // 넷이 같은 점수, 목숨까지 같다 — seed 추첨으로만 갈린다.
  const rows: FinalRow[] = [
    done('t1', '하늘', 1500, 2),
    done('t2', '바다', 1500, 2),
    done('t3', '마루', 1500, 2),
    done('t4', '나래', 1500, 2),
  ]
  const order = (rs: readonly ParticipantResult[]): string[] =>
    [...rs].sort((a, b) => a.rank - b.rank).map((r) => r.id)

  it('같은 seed 로 두 번 계산하면 순서가 같다', () => {
    expect(order(rankingOf(rows))).toEqual(order(rankingOf(rows)))
  })

  it('입력 순서를 뒤집어도 같은 순서가 나온다 (먼저 들어온 사람이 유리하지 않다)', () => {
    const reversed = [...rows].reverse()
    expect(order(rankingOf(reversed))).toEqual(order(rankingOf(rows)))
  })

  it('동점 처리 근거가 결과에 남는다', () => {
    const results = rankingOf(rows)
    const one = byNick(results, '하늘')
    expect(one.tie.tied).toBe(true)
    expect(one.tie.resolvedBy).toBe('seed')
    expect(typeof one.tie.drawValue).toBe('number')
  })

  it('점수가 같아도 목숨이 많으면 앞에 선다', () => {
    const withLives: FinalRow[] = [done('a', '하늘', 1500, 1), done('b', '바다', 1500, 3)]
    const results = rankingOf(withLives)
    expect(byNick(results, '바다').rank).toBe(1)
    expect(byNick(results, '바다').tie.resolvedBy).toBe('lives')
  })

  it('같은 seed 면 발표자도 같은 사람이 나온다', () => {
    const a = selectPresenters(rankingOf(rows), WORST_ONE).selectedParticipantIds
    const b = selectPresenters(rankingOf(rows), WORST_ONE).selectedParticipantIds
    expect(a).toEqual(b)
    expect(a).toHaveLength(1)
  })
})

describe('40명 — 한 방의 최대 인원', () => {
  const full: FinalRow[] = Array.from({ length: ROOM_MAX_MEMBERS }, (_, i) =>
    done(`t${i}`, `학생${i + 1}`, (ROOM_MAX_MEMBERS - i) * 50, 2),
  )

  it('방 정원은 40명이다', () => {
    expect(ROOM_MAX_MEMBERS).toBe(40)
    expect(full).toHaveLength(40)
  })

  it('전체 순위가 1위부터 40위까지 빠짐없이, 겹치지 않게 매겨진다', () => {
    const results = rankingOf(full)
    const ranks = results.map((r) => r.rank).sort((a, b) => a - b)
    expect(ranks).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
  })

  it('후보 순위도 1위부터 40위까지 유일하다', () => {
    const results = rankingOf(full)
    const eligible = results.map((r) => r.eligibleRank).filter((r): r is number => r !== null)
    expect(eligible.sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
  })

  it('40명 중 하위 3명을 뽑으면 후보 38·39·40위가 나온다', () => {
    const outcome = selectPresenters(rankingOf(full), { kind: 'bottom', count: 3 })
    expect(outcome.eligibleCount).toBe(40)
    expect(outcome.selectionReasons.map((r) => r.eligibleRank)).toEqual([38, 39, 40])
    expect(outcome.issue).toBeNull()
  })

  it('40명 중 절반이 못 끝내면 후보는 20명이고, 41위는 없다', () => {
    const half: FinalRow[] = full.map((row, i) =>
      i % 2 === 0 ? row : unfinished(row.token, row.nick),
    )
    const results = rankingOf(half)
    expect(results).toHaveLength(40)
    const outcome = selectPresenters(results, WORST_ONE)
    expect(outcome.eligibleCount).toBe(20)
    expect(outcome.selectionReasons[0]?.eligibleRank).toBe(20)
  })

  it('41명을 뽑으려 하면 모자란 이유가 남는다', () => {
    const outcome = selectPresenters(rankingOf(full), { kind: 'top', count: 41 })
    expect(outcome.selectedParticipantIds).toHaveLength(40)
    expect(outcome.issue?.code).toBe('NOT_ENOUGH_CANDIDATES')
    expect(outcome.issue?.requestedCount).toBe(41)
    expect(outcome.issue?.selectedCount).toBe(40)
  })
})
