import { describe, expect, it } from 'vitest'
import { Match, parseBrickPickInput } from '../../src/core'
import type { BrickPickInput, GameMode } from '../../src/core'

function makeInput(over: Partial<BrickPickInput> & { participants: BrickPickInput['participants'] }): BrickPickInput {
  const parsed = parseBrickPickInput({
    schemaVersion: '1.0',
    sessionId: 'smoke',
    mode: 'auto' as GameMode,
    difficulty: 'normal',
    roundDurationMs: 30_000,
    selectionRule: { kind: 'ranks', ranks: [3] },
    excludedParticipantIds: [],
    seed: 'SEED-A',
    locale: 'ko',
    soundEnabled: true,
    reducedMotion: false,
    ...over,
  })
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

function runToEnd(input: BrickPickInput): Match {
  const match = new Match({ input, now: () => 1_700_000_000_000, random: () => 0.5 })
  match.start()
  let guard = 0
  while (!match.isFinished && guard < 500_000) {
    match.step()
    guard += 1
  }
  expect(match.isFinished).toBe(true)
  return match
}

const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i + 1}`, nickname: `학생${i + 1}` }))

describe('엔진 스모크', () => {
  it('자동 경기 6명 30초 — 실제로 벽돌이 깨지고 점수가 갈린다', () => {
    const match = runToEnd(makeInput({ participants: people(6) }))
    const result = match.buildResult()

    expect(result.participants).toHaveLength(6)
    // 점수가 전부 0이면 공이 벽돌에 닿지 않은 것이다.
    const scores = result.participants.map((p) => p.score ?? 0)
    expect(Math.max(...scores)).toBeGreaterThan(200)
    // 순위는 1..N 으로 유일해야 한다.
    expect(new Set(result.participants.map((p) => p.rank))).toEqual(
      new Set([1, 2, 3, 4, 5, 6]),
    )
    expect(new Set(result.participants.map((p) => p.eligibleRank))).toEqual(
      new Set([1, 2, 3, 4, 5, 6]),
    )
    expect(result.selectedParticipantIds).toHaveLength(1)
    const picked = result.participants.find((p) => p.id === result.selectedParticipantIds[0])
    expect(picked?.eligibleRank).toBe(3)

    // 아이템이 실제로 떨어지고 일부는 획득된다.
    const dropped = result.participants.reduce(
      (n, p) => n + p.items.reduce((m, i) => m + i.dropped, 0),
      0,
    )
    const collected = result.participants.reduce(
      (n, p) => n + p.items.reduce((m, i) => m + i.collected, 0),
      0,
    )
    expect(dropped).toBeGreaterThan(0)
    expect(collected).toBeGreaterThan(0)
    expect(collected).toBeLessThanOrEqual(dropped)

    // 참고 출력 — 실제 점수 분포를 눈으로 확인한다.
    console.log(
      '자동 6명:',
      result.participants
        .map((p) => `${p.rank}위 ${p.nickname} ${p.score}점(목숨${p.livesRemaining})`)
        .join(' / '),
    )
  })

  it('같은 seed 는 같은 결과, 다른 seed 는 다른 결과', () => {
    const a = runToEnd(makeInput({ participants: people(6) })).buildResult()
    const b = runToEnd(makeInput({ participants: people(6) })).buildResult()
    const c = runToEnd(makeInput({ participants: people(6), seed: 'SEED-B' })).buildResult()

    const shape = (r: typeof a) => r.participants.map((p) => [p.id, p.score, p.rank])
    expect(shape(b)).toEqual(shape(a))
    expect(JSON.stringify(shape(c))).not.toEqual(JSON.stringify(shape(a)))
  })

  it('40명 자동 경기가 실시간보다 훨씬 빠르게 계산된다', () => {
    const t0 = performance.now()
    const match = runToEnd(makeInput({ participants: people(40), seed: 'BIG', selectionRule: { kind: 'top', count: 1 } }))
    const elapsed = performance.now() - t0
    const result = match.buildResult()

    expect(new Set(result.participants.map((p) => p.rank)).size).toBe(40)
    expect(new Set(result.participants.map((p) => p.eligibleRank)).size).toBe(40)
    console.log(
      `40명 × 30초 시뮬레이션 계산 시간: ${elapsed.toFixed(0)}ms (실시간 30000ms 대비 ${(30000 / elapsed).toFixed(1)}배 여유)`,
    )
    // 실시간보다 최소 3배는 빨라야 브라우저에서 60fps 로 돌릴 여유가 있다.
    expect(elapsed).toBeLessThan(10_000)
  })

  it('직접 조작 모드는 모든 참가자가 같은 판에서 시작한다', () => {
    const input = makeInput({ participants: people(3), mode: 'manual', roundDurationMs: 15_000 })
    const match = new Match({ input, now: () => 1, random: () => 0.5 })
    match.start()

    const layouts: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const arena = match.runs[match.currentIndex].arena
      expect(arena).not.toBeNull()
      layouts.push(
        JSON.stringify(
          arena?.level.bricks.map((b) => [b.id, b.typeId, b.item ?? '-']),
        ),
      )
      // 아무 입력 없이 제한 시간을 흘려보낸다.
      while (match.phase === 'running') match.step()
      if (match.phase === 'between-players') match.continueToNext()
    }
    expect(layouts[1]).toEqual(layouts[0])
    expect(layouts[2]).toEqual(layouts[0])
    expect(match.isFinished).toBe(true)
  })
})
