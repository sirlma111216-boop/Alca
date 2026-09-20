import { describe, expect, it } from 'vitest'
import { Match, parseBrickPickInput, describeShortfall, selectPresenters } from '../../src/core'
import type { BrickPickInput, ParticipantResult, SelectionRule } from '../../src/core'

/**
 * 경기 **도중** 후보가 줄어드는 경우.
 *
 * 시작 전에는 후보 수로 선정 규칙을 검증하지만, 직접 조작 모드에서는 경기 중에
 * 참가자를 건너뛰거나(미플레이) 중도 취소해 후보가 줄어들 수 있다.
 * 그때 게임이 **조용히 아무도 뽑지 않고 "완료" 로 끝나면 안 된다** —
 * 결과의 selectionIssue 에 기계가 읽을 수 있는 이유가 남아야 한다.
 */

function manualInput(count: number, rule: SelectionRule): BrickPickInput {
  const parsed = parseBrickPickInput({
    schemaVersion: '1.0',
    sessionId: 'shortfall',
    participants: Array.from({ length: count }, (_, i) => ({
      id: `p${i + 1}`,
      nickname: `학생${i + 1}`,
    })),
    mode: 'manual',
    difficulty: 'normal',
    roundDurationMs: 5_000,
    selectionRule: rule,
    excludedParticipantIds: [],
    seed: 'SHORTFALL',
    locale: 'ko',
    soundEnabled: false,
    reducedMotion: false,
  })
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

/** 첫 참가자를 건너뛰고 나머지를 끝까지 돌린다. */
function runSkippingFirst(input: BrickPickInput): Match {
  const match = new Match({ input, now: () => 1, random: () => 0.5 })
  match.start()
  match.skipCurrent()
  let guard = 0
  while (!match.isFinished && guard < 200_000) {
    if (match.phase === 'between-players') match.continueToNext()
    else match.step()
    guard += 1
  }
  return match
}

describe('경기 중 후보가 줄어 규칙을 못 채우는 경우', () => {
  it('지정 순위가 후보 수를 넘어가면 결과에 이유가 남는다 (조용히 완료되지 않는다)', () => {
    // 5명으로 시작 → 시작 전 검증은 통과한다(후보 5명, 5위 지정).
    const input = manualInput(5, { kind: 'ranks', ranks: [5] })
    const match = runSkippingFirst(input)
    const result = match.buildResult()

    // 한 명을 건너뛰었으니 후보는 4명.
    expect(result.eligibleCount).toBe(4)
    expect(result.selectedParticipantIds).toEqual([])

    // 여기가 핵심 — 아무도 안 뽑혔다는 사실이 데이터에 분명히 남아야 한다.
    expect(result.selectionIssue).not.toBeNull()
    expect(result.selectionIssue?.code).toBe('NOT_ENOUGH_CANDIDATES')
    expect(result.selectionIssue?.candidateCount).toBe(4)
    expect(result.selectionIssue?.requestedCount).toBe(1)
    expect(result.selectionIssue?.selectedCount).toBe(0)
    expect(result.selectionIssue?.missingRanks).toEqual([5])
    // 화면에 그대로 띄울 수 있는 한국어여야 한다.
    expect(result.selectionIssue?.message).toMatch(/[가-힣]/)
    expect(result.selectionIssue?.message).toContain('4명')
  })

  it('상위 N명도 요청보다 적게 뽑혔으면 조용히 넘어가지 않는다', () => {
    const input = manualInput(3, { kind: 'top', count: 3 })
    const match = runSkippingFirst(input)
    const result = match.buildResult()

    expect(result.eligibleCount).toBe(2)
    expect(result.selectedParticipantIds).toHaveLength(2)
    expect(result.selectionIssue).not.toBeNull()
    expect(result.selectionIssue?.requestedCount).toBe(3)
    expect(result.selectionIssue?.selectedCount).toBe(2)
    expect(result.selectionIssue?.missingRanks).toEqual([])
  })

  it('규칙을 그대로 채웠으면 selectionIssue 는 null 이다', () => {
    const input = manualInput(4, { kind: 'ranks', ranks: [2] })
    const match = runSkippingFirst(input)
    const result = match.buildResult()

    expect(result.eligibleCount).toBe(3)
    expect(result.selectedParticipantIds).toHaveLength(1)
    expect(result.selectionIssue).toBeNull()
  })

  it('자동 경기처럼 아무도 빠지지 않으면 언제나 null 이다', () => {
    const parsed = parseBrickPickInput({
      schemaVersion: '1.0',
      sessionId: 'ok',
      participants: Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, nickname: `A${i}` })),
      mode: 'auto',
      roundDurationMs: 15_000,
      selectionRule: { kind: 'ranks', ranks: [1, 3, 6] },
      excludedParticipantIds: [],
      seed: 'OK',
    })
    if (!parsed.ok) throw new Error('bad')
    const match = new Match({ input: parsed.value, now: () => 1, random: () => 0.5 })
    match.start()
    while (!match.isFinished) match.step()
    const result = match.buildResult()
    expect(result.selectedParticipantIds).toHaveLength(3)
    expect(result.selectionIssue).toBeNull()
  })
})

describe('describeShortfall — 순수 함수', () => {
  it('후보가 0명이면 미플레이·중도 취소·제외를 확인하라고 안내한다', () => {
    const issue = describeShortfall({ kind: 'top', count: 1 }, 0, 0)
    expect(issue?.code).toBe('NOT_ENOUGH_CANDIDATES')
    expect(issue?.message).toContain('없어')
  })

  it('다 채웠으면 null', () => {
    expect(describeShortfall({ kind: 'top', count: 2 }, 5, 2)).toBeNull()
    expect(describeShortfall({ kind: 'ranks', ranks: [1, 2] }, 5, 2)).toBeNull()
  })

  it('중복 순위는 한 명으로 세어 요청 인원을 계산한다', () => {
    expect(describeShortfall({ kind: 'ranks', ranks: [2, 2, 2] }, 5, 1)).toBeNull()
  })
})

describe('selectPresenters 가 issue 를 함께 낸다', () => {
  const person = (id: string, eligibleRank: number | null): ParticipantResult => ({
    id,
    nickname: id,
    score: 100,
    rank: 1,
    eligibleRank,
    excluded: false,
    playStatus: 'played',
    livesRemaining: 3,
    bricksDestroyed: 1,
    playedMs: 1000,
    wavesCleared: 0,
    items: [],
    tie: { tied: false, tiedWith: [], resolvedBy: 'none' },
  })

  it('후보 2명인데 5위를 지정하면 issue 가 붙는다', () => {
    const out = selectPresenters([person('a', 1), person('b', 2)], {
      kind: 'ranks',
      ranks: [5],
    })
    expect(out.selectedParticipantIds).toEqual([])
    expect(out.issue?.missingRanks).toEqual([5])
    expect(out.eligibleCount).toBe(2)
  })
})
