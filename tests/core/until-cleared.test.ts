import { describe, expect, it } from 'vitest'
import { Match, computeRanking, parseBrickPickInput, STEP_MS } from '../../src/core'
import type { BrickPickInput, GameMode, RankingEntry } from '../../src/core'

/**
 * "다 깰 때까지" 경기 방식.
 *
 *  - 벽돌을 전부 깨면 그 참가자의 경기가 끝난다.
 *  - 아무도 못 깨면 roundDurationMs 가 **최대 시간**으로 끊어 준다.
 *  - 순위는 **다 깬 사람 먼저, 그중 빨리 깬 순**. 못 깬 사람끼리는 점수 순.
 *    (다 깨면 점수가 전부 같아져 점수로는 갈리지 않기 때문이다)
 */

function input(over: Partial<BrickPickInput> & { participants: BrickPickInput['participants'] }): BrickPickInput {
  const parsed = parseBrickPickInput({
    schemaVersion: '1.0',
    sessionId: 'uc',
    mode: 'auto' as GameMode,
    difficulty: 'normal',
    roundMode: 'until-cleared',
    roundDurationMs: 120_000,
    selectionRule: { kind: 'top', count: 1 },
    excludedParticipantIds: [],
    seed: 'UNTIL-CLEARED',
    locale: 'ko',
    soundEnabled: false,
    reducedMotion: false,
    ...over,
  })
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

function runToEnd(inp: BrickPickInput): Match {
  const m = new Match({ input: inp, now: () => 1, random: () => 0.5 })
  m.start()
  let guard = 0
  while (!m.isFinished && guard < 2_000_000) {
    if (m.phase === 'between-players') m.continueToNext()
    else m.step()
    guard += 1
  }
  expect(m.isFinished).toBe(true)
  return m
}

/** 쉽게 깨지도록 벽돌을 1행만 두고 아이템을 많이 깐 판. */
const EASY_BOARD = {
  difficultySettings: {
    brickRows: 1,
    maxBrickDurability: 1,
    lives: 9,
    items: { brickRatio: 0.5 },
  },
} as Partial<BrickPickInput>

const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i + 1}`, nickname: `학생${i + 1}` }))

describe('계약 — roundMode', () => {
  it('생략하면 fixed 이고 기존 동작 그대로다', () => {
    const parsed = parseBrickPickInput({ participants: people(2) })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.roundMode).toBe('fixed')
    expect(parsed.value.roundDurationMs).toBe(30_000)
  })

  it('until-cleared 인데 시간을 안 주면 기본 최대 시간(2분)이 들어간다', () => {
    const parsed = parseBrickPickInput({ participants: people(2), roundMode: 'until-cleared' })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.roundMode).toBe('until-cleared')
    expect(parsed.value.roundDurationMs).toBe(120_000)
  })

  it('알 수 없는 값은 fixed 로 되돌리고 안내한다', () => {
    const parsed = parseBrickPickInput({ participants: people(2), roundMode: '아무거나' })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.roundMode).toBe('fixed')
    expect(parsed.warnings.join(' ')).toContain('경기 방식')
  })
})

describe('자동 경기 — 누군가 다 깨면 전원의 경기가 끝난다', () => {
  it('최대 시간보다 훨씬 일찍 끝나고, 깬 사람이 1위가 된다', () => {
    const match = runToEnd(input({ participants: people(6), ...EASY_BOARD }))
    const result = match.buildResult()

    // 최대 시간(2분)을 다 쓰지 않고 끝났어야 한다.
    const elapsed = match.stepsDone * STEP_MS
    expect(elapsed).toBeLessThan(120_000)

    const cleared = result.participants.filter((p) => p.clearedAtMs !== null)
    expect(cleared.length).toBeGreaterThan(0)
    // 1위는 반드시 깬 사람이다.
    expect(result.participants[0].clearedAtMs).not.toBeNull()
    expect(result.participants[0].rank).toBe(1)
    // 경기가 끝난 시각과 1위가 깬 시각이 사실상 같다(그 순간 끝냈으므로).
    expect(Math.abs((result.participants[0].clearedAtMs as number) - elapsed)).toBeLessThan(50)

    console.log(
      `자동 "다 깰 때까지": ${(elapsed / 1000).toFixed(1)}초에 종료 · 1위 ${result.participants[0].nickname} ` +
        `(${((result.participants[0].clearedAtMs as number) / 1000).toFixed(1)}초에 클리어)`,
    )
  })

  it('appliedSettings 에 roundMode 가 그대로 실린다', () => {
    const match = runToEnd(input({ participants: people(3), ...EASY_BOARD }))
    expect(match.buildResult().appliedSettings.roundMode).toBe('until-cleared')
  })

  it('아무도 못 깨면 최대 시간에 끊긴다 (무한히 돌지 않는다)', () => {
    // 벽돌을 아주 두껍게 깔고 시간을 짧게 줘서 못 깨게 만든다.
    const match = runToEnd(
      input({
        participants: people(3),
        roundDurationMs: 8_000,
        difficultySettings: { brickRows: 12, maxBrickDurability: 3 },
      }),
    )
    const result = match.buildResult()
    expect(match.stepsDone * STEP_MS).toBeCloseTo(8_000, 0)
    expect(result.participants.every((p) => p.clearedAtMs === null)).toBe(true)
    // 아무도 못 깼으면 평소대로 점수 순이다.
    const scores = result.participants.map((p) => p.score ?? 0)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })
})

describe('직접 조작 — 각자 다 깨면 그 차례가 끝난다', () => {
  it('다 깬 참가자의 playedMs 가 최대 시간보다 짧다', () => {
    const match = runToEnd(
      input({
        participants: people(3),
        mode: 'manual',
        roundDurationMs: 60_000,
        ...EASY_BOARD,
      }),
    )
    const result = match.buildResult()
    const cleared = result.participants.filter((p) => p.clearedAtMs !== null)
    // 직접 조작인데 입력을 안 줬으므로 못 깰 수도 있다. 깬 사람이 있다면 시간이 맞아야 한다.
    for (const p of cleared) {
      expect(p.playedMs).toBe(p.clearedAtMs)
      expect(p.playedMs).toBeLessThan(60_000)
    }
    expect(result.appliedSettings.roundMode).toBe('until-cleared')
  })
})

describe('순위 규칙 — 빨리 깬 순', () => {
  const entry = (
    id: string,
    score: number,
    clearedAtMs: number | null,
    lives = 3,
  ): RankingEntry => ({
    id,
    nickname: id,
    score,
    livesRemaining: lives,
    playStatus: 'played',
    excluded: false,
    bricksDestroyed: 10,
    playedMs: clearedAtMs ?? 60_000,
    wavesCleared: clearedAtMs === null ? 0 : 1,
    clearedAtMs,
    items: [],
  })

  it('다 깬 사람이 못 깬 사람보다 앞이다 — 점수가 낮아도', () => {
    const out = computeRanking(
      [entry('느리지만깬사람', 100, 40_000), entry('점수높은데못깬사람', 9_999, null)],
      { seed: 'S', rankBy: 'clear-time' },
    )
    expect(out[0].id).toBe('느리지만깬사람')
    expect(out[1].id).toBe('점수높은데못깬사람')
  })

  it('다 깬 사람끼리는 빨리 깬 순', () => {
    const out = computeRanking(
      [entry('c', 500, 30_000), entry('a', 500, 10_000), entry('b', 500, 20_000)],
      { seed: 'S', rankBy: 'clear-time' },
    )
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    // 깬 시각이 다르면 동점이 아니다.
    expect(out.every((p) => p.tie.tied === false)).toBe(true)
  })

  it('못 깬 사람끼리는 평소대로 점수 순', () => {
    const out = computeRanking(
      [entry('낮음', 100, null), entry('높음', 900, null), entry('중간', 400, null)],
      { seed: 'S', rankBy: 'clear-time' },
    )
    expect(out.map((p) => p.id)).toEqual(['높음', '중간', '낮음'])
  })

  it('같은 시각에 깼으면 목숨 → seed 추첨으로 간다', () => {
    const out = computeRanking(
      [entry('목숨적음', 500, 10_000, 1), entry('목숨많음', 500, 10_000, 3)],
      { seed: 'S', rankBy: 'clear-time' },
    )
    expect(out[0].id).toBe('목숨많음')
    expect(out[0].tie.tied).toBe(true)
    expect(out[0].tie.resolvedBy).toBe('lives')
  })

  it("rankBy 를 안 주면(기본) 예전처럼 점수 순이다 — 기존 동작이 변하지 않는다", () => {
    const out = computeRanking(
      [entry('느리지만깬사람', 100, 40_000), entry('점수높은데못깬사람', 9_999, null)],
      { seed: 'S' },
    )
    expect(out[0].id).toBe('점수높은데못깬사람')
  })

  it('미플레이는 여전히 맨 뒤이고 후보에서 빠진다', () => {
    const notPlayed: RankingEntry = {
      ...entry('미플레이', 0, null),
      score: null,
      livesRemaining: null,
      playStatus: 'not_played',
      clearedAtMs: null,
    }
    const out = computeRanking([notPlayed, entry('깬사람', 500, 10_000)], {
      seed: 'S',
      rankBy: 'clear-time',
    })
    expect(out[0].id).toBe('깬사람')
    expect(out[1].id).toBe('미플레이')
    expect(out[1].eligibleRank).toBeNull()
  })
})
