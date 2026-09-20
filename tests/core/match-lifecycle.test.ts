/**
 * 매치 수명주기 시험 — 시작 · 일시정지 · 취소 · 차례 넘기기 · 정리.
 *
 * 시간은 절대 벽시계로 재지 않는다. Match 는 now/random 을 주입받고, 진행은 스텝 수로만 센다.
 * 여기서 확인하는 것은 "교실에서 실제로 누르는 버튼들이 규칙을 깨지 않는가" 이다.
 *  - 건너뛴 사람이 0점 취급돼 얼떨결에 발표자가 되는 일은 절대 없어야 한다.
 *  - 멈춰 둔 동안 아이템 효과가 줄어들면 잠깐 멈춘 참가자만 손해를 본다.
 */

import { describe, expect, it } from 'vitest'
import {
  Match,
  STEP_MS,
  applyItemEffect,
  isExpandActive,
  parseBrickPickInput,
} from '../../src/core'
import type { BrickPickInput, Participant } from '../../src/core'

const people = (n: number): Participant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, nickname: `참가자${i + 1}` }))

function makeInput(over: Record<string, unknown>): BrickPickInput {
  const parsed = parseBrickPickInput({
    participants: people(4),
    mode: 'auto',
    difficulty: 'normal',
    roundDurationMs: 30_000,
    selectionRule: { kind: 'top', count: 1 },
    seed: 'LIFECYCLE',
    sessionId: 'life-1',
    ...over,
  })
  if (!parsed.ok) throw new Error(`검증 실패: ${JSON.stringify(parsed.error)}`)
  return parsed.value
}

/** 새 매치를 만들어 끝까지 돌린다. */
function runToEnd(input: BrickPickInput): Match {
  const match = new Match({ input, now: () => 1, random: () => 0.5 })
  match.start()
  let guard = 0
  while (!match.isFinished && guard < 500_000) {
    match.step()
    guard += 1
  }
  expect(match.isFinished).toBe(true)
  return match
}

/** 직접 조작 모드에서 현재 참가자의 차례가 끝날 때까지 흘려보낸다. */
function playOutCurrent(match: Match): void {
  let guard = 0
  while (match.phase === 'running' && guard < 500_000) {
    match.step()
    guard += 1
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 취소
// ────────────────────────────────────────────────────────────────────────────

describe('취소', () => {
  it('경기 중 cancel() 하면 cancelled 가 되고 완료로 치지 않는다', () => {
    const match = new Match({ input: makeInput({}), now: () => 1, random: () => 0.5 })
    match.start()
    for (let i = 0; i < 400; i += 1) match.step()

    expect(match.phase).toBe('running')
    match.cancel()

    expect(match.phase).toBe('cancelled')
    // 취소는 "완료"가 아니다 — 호스트는 buildResult() 를 부르지 않는 흐름을 탄다.
    expect(match.isFinished).toBe(false)
    expect(match.progress().phase).toBe('preparing')
  })

  it('취소 후에는 step() 을 더 불러도 아무 일도 일어나지 않는다', () => {
    const match = new Match({ input: makeInput({}), now: () => 1, random: () => 0.5 })
    match.start()
    for (let i = 0; i < 200; i += 1) match.step()
    match.cancel()

    const stepsAtCancel = match.stepsDone
    for (let i = 0; i < 500; i += 1) match.step()
    expect(match.stepsDone).toBe(stepsAtCancel)
    expect(match.phase).toBe('cancelled')
    expect(match.isFinished).toBe(false)
  })

  it('시작 전 취소도 안전하다', () => {
    const match = new Match({ input: makeInput({}), now: () => 1, random: () => 0.5 })
    expect(() => match.cancel()).not.toThrow()
    expect(match.phase).toBe('cancelled')
    // 취소한 매치는 다시 시작되지 않는다.
    match.start()
    expect(match.phase).toBe('cancelled')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 일시정지 / 재개
// ────────────────────────────────────────────────────────────────────────────

describe('일시정지와 재개', () => {
  it('pause() 중에는 step() 을 100번 불러도 시간이 전혀 흐르지 않는다', () => {
    const match = new Match({ input: makeInput({}), now: () => 1, random: () => 0.5 })
    match.start()
    for (let i = 0; i < 360; i += 1) match.step()

    const arena = match.runs[0].arena
    expect(arena).not.toBeNull()
    if (!arena) return

    const before = {
      steps: match.stepsDone,
      simTimeMs: arena.simTimeMs,
      stepCount: arena.stepCount,
      score: arena.score,
      elapsedMs: match.progress().elapsedMs,
    }

    match.pause()
    expect(match.phase).toBe('paused')
    expect(match.progress().phase).toBe('paused')
    for (let i = 0; i < 100; i += 1) match.step()

    expect(match.stepsDone).toBe(before.steps)
    expect(arena.simTimeMs).toBe(before.simTimeMs)
    expect(arena.stepCount).toBe(before.stepCount)
    expect(arena.score).toBe(before.score)
    expect(match.progress().elapsedMs).toBe(before.elapsedMs)

    match.resume()
    expect(match.phase).toBe('running')
    // 재개하면 멈췄던 자리에서 정확히 한 스텝씩 이어진다.
    match.step()
    expect(match.stepsDone).toBe(before.steps + 1)
    expect(arena.stepCount).toBe(before.stepCount + 1)
    expect(arena.simTimeMs).toBeCloseTo(before.simTimeMs + STEP_MS, 6)
  })

  it('일시정지가 아이템 효과의 남은 시간을 갉아먹지 않는다', () => {
    const match = new Match({ input: makeInput({}), now: () => 1, random: () => 0.5 })
    match.start()
    for (let i = 0; i < 240; i += 1) match.step()

    const arena = match.runs[0].arena
    expect(arena).not.toBeNull()
    if (!arena) return

    // 패들 확장을 켠다 — 지속 시간은 설정값 그대로여야 한다.
    applyItemEffect(arena.effects, 'expand', arena.simTimeMs, match.settings.items)
    expect(arena.effects.expandUntil).not.toBeNull()
    const remainingBefore = (arena.effects.expandUntil as number) - arena.simTimeMs
    expect(remainingBefore).toBe(match.settings.items.expandDurationMs)
    expect(isExpandActive(arena.effects, arena.simTimeMs)).toBe(true)

    match.pause()
    for (let i = 0; i < 600; i += 1) match.step() // 5초어치 — 멈춰 있으므로 흘러선 안 된다
    match.resume()

    // 효과가 만료되지도, 남은 시간이 줄지도 않았다.
    expect(isExpandActive(arena.effects, arena.simTimeMs)).toBe(true)
    expect((arena.effects.expandUntil as number) - arena.simTimeMs).toBe(remainingBefore)
  })

  it('pause/resume 을 끼워 넣어도 최종 결과가 똑같다', () => {
    const input = makeInput({ participants: people(4), roundDurationMs: 15_000 })
    const straight = runToEnd(input).buildResult()

    const paused = new Match({ input, now: () => 1, random: () => 0.5 })
    paused.start()
    let guard = 0
    while (!paused.isFinished && guard < 500_000) {
      if (guard % 200 === 0) {
        paused.pause()
        for (let i = 0; i < 5; i += 1) paused.step()
        paused.resume()
      }
      paused.step()
      guard += 1
    }
    const result = paused.buildResult()

    const shape = (r: typeof result): unknown =>
      r.participants.map((p) => [p.id, p.score, p.rank, p.eligibleRank])
    expect(shape(result)).toEqual(shape(straight))
    expect(result.selectedParticipantIds).toEqual(straight.selectedParticipantIds)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 직접 조작 모드 흐름
// ────────────────────────────────────────────────────────────────────────────

describe('직접 조작 모드 흐름', () => {
  const manualInput = (over: Record<string, unknown> = {}): BrickPickInput =>
    makeInput({
      participants: people(3),
      mode: 'manual',
      roundDurationMs: 15_000,
      ...over,
    })

  it('참가자마다 차례가 돌아가고 between-players 에서 continueToNext() 로 넘어간다', () => {
    const match = new Match({ input: manualInput(), now: () => 1, random: () => 0.5 })
    match.start()

    const turnOrder: string[] = []
    let betweenCount = 0
    let guard = 0
    while (!match.isFinished && guard < 500_000) {
      guard += 1
      if (match.phase === 'between-players') {
        betweenCount += 1
        // 차례 사이에는 시간이 흐르지 않는다.
        const steps = match.stepsDone
        match.step()
        expect(match.stepsDone).toBe(steps)
        match.continueToNext()
        continue
      }
      if (match.phase !== 'running') break
      const id = match.currentRun?.participant.id
      if (id && turnOrder[turnOrder.length - 1] !== id) turnOrder.push(id)
      match.step()
    }

    expect(turnOrder).toEqual(['p1', 'p2', 'p3'])
    expect(betweenCount).toBe(2) // 3명이면 사이가 2번
    expect(match.isFinished).toBe(true)
    expect(match.progress().phase).toBe('finished')
    expect(match.progress().completedCount).toBe(3)
  })

  it('자동 경기에서는 currentRun 이 없고 continueToNext() 가 아무 일도 하지 않는다', () => {
    const match = new Match({ input: makeInput({}), now: () => 1, random: () => 0.5 })
    match.start()
    expect(match.currentRun).toBeNull()
    expect(match.progress().currentParticipantId).toBeNull()
    match.continueToNext()
    expect(match.phase).toBe('running')
  })

  it('skipCurrent() 한 사람은 미플레이로 남고 최저 성적 규칙에도 뽑히지 않는다', () => {
    const match = new Match({
      input: manualInput({ selectionRule: { kind: 'bottom', count: 1 } }),
      now: () => 1,
      random: () => 0.5,
    })
    match.start()

    // 첫 참가자는 사정이 있어 건너뛴다.
    expect(match.currentRun?.participant.id).toBe('p1')
    match.skipCurrent()
    expect(match.phase).toBe('between-players')

    // 나머지 두 명은 끝까지 한다.
    while (!match.isFinished) {
      if (match.phase === 'between-players') match.continueToNext()
      else playOutCurrent(match)
    }

    const result = match.buildResult()
    const skipped = result.participants.find((p) => p.id === 'p1')
    expect(skipped?.playStatus).toBe('not_played')
    expect(skipped?.score).toBeNull() // 0점이 아니라 "기록 없음"
    expect(skipped?.eligibleRank).toBeNull()
    expect(skipped?.livesRemaining).toBeNull()

    // 핵심 — "최저 성적 1명" 으로 뽑았는데 미플레이자가 걸리면 안 된다.
    expect(result.eligibleCount).toBe(2)
    expect(result.selectedParticipantIds).toHaveLength(1)
    expect(result.selectedParticipantIds).not.toContain('p1')
    const picked = result.participants.find((p) => p.id === result.selectedParticipantIds[0])
    expect(picked?.playStatus).toBe('played')
    expect(picked?.eligibleRank).toBe(2) // 후보 2명 중 하위
  })

  it('abortCurrent() 는 점수를 남기되 후보에서 뺀다', () => {
    // 도중에 그만둔 사람은 점수가 낮을 수밖에 없다 — "최저 성적 1명" 규칙이 가장 위험한 방향이다.
    const match = new Match({
      input: manualInput({ selectionRule: { kind: 'bottom', count: 1 } }),
      now: () => 1,
      random: () => 0.5,
    })
    match.start()
    for (let i = 0; i < 600; i += 1) match.step()

    const arena = match.runs[0].arena
    expect(arena).not.toBeNull()
    const scoreAtAbort = arena ? arena.score : -1
    const livesAtAbort = arena ? arena.lives : -1

    match.abortCurrent()
    expect(match.runs[0].status).toBe('aborted')

    while (!match.isFinished) {
      if (match.phase === 'between-players') match.continueToNext()
      else playOutCurrent(match)
    }

    const result = match.buildResult()
    const aborted = result.participants.find((p) => p.id === 'p1')
    expect(aborted?.playStatus).toBe('aborted')
    // 점수는 그때까지의 것이 그대로 남는다 (null 이 아니다).
    expect(aborted?.score).toBe(scoreAtAbort)
    expect(aborted?.livesRemaining).toBe(livesAtAbort)
    // 그래도 후보는 아니다.
    expect(aborted?.eligibleRank).toBeNull()
    expect(result.eligibleCount).toBe(2)
    expect(result.selectedParticipantIds).not.toContain('p1')

    // 중도 취소자가 실제로 꼴찌 점수였는지까지 확인해야 이 시험에 뜻이 있다.
    const others = result.participants.filter((p) => p.id !== 'p1')
    const lowestOther = Math.min(...others.map((p) => p.score ?? 0))
    expect(aborted?.score ?? 0).toBeLessThan(lowestOther)
  })

  it('건너뛴 사람도 전체 순위(rank)에는 자리가 있고, 순위는 1..N 으로 유일하다', () => {
    const match = new Match({ input: manualInput(), now: () => 1, random: () => 0.5 })
    match.start()
    match.skipCurrent()
    while (!match.isFinished) {
      if (match.phase === 'between-players') match.continueToNext()
      else playOutCurrent(match)
    }
    const result = match.buildResult()
    expect(new Set(result.participants.map((p) => p.rank))).toEqual(new Set([1, 2, 3]))
    // 기록 없는 사람은 언제나 맨 뒤다.
    expect(result.participants.find((p) => p.id === 'p1')?.rank).toBe(3)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 재경기 · 재현
// ────────────────────────────────────────────────────────────────────────────

describe('재경기와 재현', () => {
  const shapeOf = (m: Match): unknown =>
    m.buildResult().participants.map((p) => [p.id, p.score, p.rank])

  it('같은 입력·같은 seed 면 결과도 resultId 도 똑같다', () => {
    const input = makeInput({ participants: people(6), seed: 'AGAIN', sessionId: 'again-1' })
    const a = runToEnd(input)
    const b = runToEnd(input)
    expect(shapeOf(b)).toEqual(shapeOf(a))
    expect(b.buildResult().resultId).toBe(a.buildResult().resultId)
  })

  it('sessionId·seed 를 바꾸면 resultId 도 결과도 달라진다', () => {
    const first = runToEnd(
      makeInput({ participants: people(6), seed: 'AGAIN', sessionId: 'again-1' }),
    )
    const second = runToEnd(
      makeInput({ participants: people(6), seed: 'AGAIN-2', sessionId: 'again-2' }),
    )
    expect(second.buildResult().resultId).not.toBe(first.buildResult().resultId)
    expect(JSON.stringify(shapeOf(second))).not.toEqual(JSON.stringify(shapeOf(first)))
    // 호스트가 중복 반영을 막는 데 쓰는 값이므로 모양도 지켜져야 한다.
    expect(second.buildResult().resultId).toMatch(/^bpr_/)
  })

  it('run.kind 는 replayOf 가 있으면 replay, 없으면 live', () => {
    const live = runToEnd(makeInput({ participants: people(3), roundDurationMs: 15_000 }))
      .buildResult()
    expect(live.run.kind).toBe('live')
    expect(live.run.replayOf).toBeNull()

    const replay = runToEnd(
      makeInput({ participants: people(3), roundDurationMs: 15_000, replayOf: 'bpr_abc_0001' }),
    ).buildResult()
    expect(replay.run.kind).toBe('replay')
    expect(replay.run.replayOf).toBe('bpr_abc_0001')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 정리
// ────────────────────────────────────────────────────────────────────────────

describe('destroy', () => {
  it('destroy() 하면 모든 경기장이 정리되고, 두 번 불러도 안전하다', () => {
    const match = new Match({ input: makeInput({}), now: () => 1, random: () => 0.5 })
    match.start()
    for (let i = 0; i < 300; i += 1) match.step()
    expect(match.runs.every((r) => r.arena !== null)).toBe(true)

    match.destroy()
    expect(match.runs.every((r) => r.arena === null)).toBe(true)
    expect(match.runs.every((r) => r.autopilot === null)).toBe(true)

    expect(() => match.destroy()).not.toThrow()
    expect(match.runs.every((r) => r.arena === null)).toBe(true)
    // 정리한 뒤에도 진행 상황을 물어보는 것 자체는 터지지 않아야 한다.
    expect(() => match.progress()).not.toThrow()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 진행 상황과 제한 시간
// ────────────────────────────────────────────────────────────────────────────

describe('progress()', () => {
  it('phase 와 시간 값이 말이 되고, remainingMs 는 단조 감소한다', () => {
    const input = makeInput({ participants: people(4), roundDurationMs: 30_000 })
    const match = new Match({ input, now: () => 1, random: () => 0.5 })

    const atRest = match.progress()
    expect(atRest.phase).toBe('preparing')
    expect(atRest.elapsedMs).toBe(0)
    expect(atRest.progress).toBe(0)
    expect(atRest.totalCount).toBe(4)
    expect(atRest.completedCount).toBe(0)
    expect(atRest.sessionId).toBe(input.sessionId)

    match.start()
    let previousRemaining = match.progress().remainingMs
    let previousProgress = match.progress().progress
    while (!match.isFinished) {
      match.step()
      if (match.stepsDone % 120 !== 0) continue
      const p = match.progress()
      expect(p.remainingMs).toBeLessThanOrEqual(previousRemaining)
      expect(p.progress).toBeGreaterThanOrEqual(previousProgress)
      expect(p.progress).toBeGreaterThanOrEqual(0)
      expect(p.progress).toBeLessThanOrEqual(1)
      // 흐른 시간 + 남은 시간 = 전체 시간
      expect(p.elapsedMs + p.remainingMs).toBeCloseTo(30_000, 6)
      // 순위표는 늘 전원이 들어 있고 점수 내림차순이다.
      expect(p.leaderboard).toHaveLength(4)
      for (let i = 1; i < p.leaderboard.length; i += 1) {
        expect(p.leaderboard[i - 1].score).toBeGreaterThanOrEqual(p.leaderboard[i].score)
      }
      previousRemaining = p.remainingMs
      previousProgress = p.progress
    }

    const done = match.progress()
    expect(done.phase).toBe('finished')
    expect(done.remainingMs).toBe(0)
    expect(done.progress).toBe(1)
    expect(done.completedCount).toBe(4)
  })

  it('제한 시간이 정확하다 — 30초는 3600스텝이고 경기장 시간도 30000ms 다', () => {
    const input = makeInput({ participants: people(3), roundDurationMs: 30_000 })
    expect(input.roundDurationMs).toBe(30_000)

    const match = new Match({ input, now: () => 1, random: () => 0.5 })
    // 30000ms ÷ (1000/120)ms = 3600
    expect(match.totalSteps).toBe(3600)

    match.start()
    while (!match.isFinished) match.step()

    expect(match.stepsDone).toBe(3600)
    for (const run of match.runs) {
      expect(run.arena).not.toBeNull()
      if (!run.arena) continue
      expect(Math.abs(run.arena.simTimeMs - 30_000)).toBeLessThanOrEqual(1)
      expect(run.arena.stepCount).toBe(3600)
    }
    // 결과에 적히는 플레이 시간도 제한 시간을 넘지 않는다.
    for (const p of match.buildResult().participants) {
      expect(p.playedMs).toBeLessThanOrEqual(30_000 + 1)
    }
  })

  it('15초는 1800스텝 — 제한 시간이 바뀌면 스텝 수도 정확히 따라간다', () => {
    const match = new Match({
      input: makeInput({ participants: people(2), roundDurationMs: 15_000 }),
      now: () => 1,
      random: () => 0.5,
    })
    expect(match.totalSteps).toBe(1800)
    match.start()
    while (!match.isFinished) match.step()
    expect(match.stepsDone).toBe(1800)
    expect(Math.abs((match.runs[0].arena?.simTimeMs ?? 0) - 15_000)).toBeLessThanOrEqual(1)
  })
})
