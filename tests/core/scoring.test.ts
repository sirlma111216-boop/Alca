/**
 * 점수 규칙 검증 — computeScore / computeScoreFromEvents / scoreTable
 *
 * 핵심은 **교차 검증**이다. 엔진이 실시간으로 더한 점수를, 경기 이벤트 로그만 보고
 * 엔진과 독립적으로 다시 계산해 같은 값이 나오는지 확인한다.
 * (벽돌 파괴 점수 합 + 타격 점수 합 + 판 보너스 = 최종 점수)
 */

import { describe, expect, it } from 'vitest'
import {
  BRICK_TYPES,
  ITEM_PICKUP_SCORE,
  Match,
  WAVE_CLEAR_BONUS,
  computeScore,
  computeScoreFromEvents,
  parseBrickPickInput,
  scoreTable,
} from '../../src/core'
import type { ArenaEvent, BrickPickInput, BrickTypeId } from '../../src/core'

const ALL_TYPES = Object.keys(BRICK_TYPES) as BrickTypeId[]

// ── computeScore ─────────────────────────────────────────────────────────────

describe('computeScore — 점수표와 일치한다', () => {
  it('부서지지 않은 타격은 hitScore, 부순 타격은 breakScore 를 준다', () => {
    for (const typeId of ALL_TYPES) {
      const def = BRICK_TYPES[typeId]
      expect(computeScore({ hits: [{ typeId, destroyed: false }], wavesCleared: 0 })).toMatchObject({
        fromHits: def.hitScore,
        fromBreaks: 0,
        total: def.hitScore,
      })
      expect(computeScore({ hits: [{ typeId, destroyed: true }], wavesCleared: 0 })).toMatchObject({
        fromHits: 0,
        fromBreaks: def.breakScore,
        total: def.breakScore,
      })
    }
  })

  it('내구도만큼 때려 부순 벽돌의 점수는 hitScore×(내구도-1) + breakScore 다', () => {
    for (const typeId of ALL_TYPES) {
      const def = BRICK_TYPES[typeId]
      const hits = [
        ...Array.from({ length: def.durability - 1 }, () => ({ typeId, destroyed: false })),
        { typeId, destroyed: true },
      ]
      const expected = def.hitScore * (def.durability - 1) + def.breakScore
      expect(computeScore({ hits, wavesCleared: 0 }).total).toBe(expected)
    }
  })

  it('여러 종류를 섞어도 표를 그대로 합산한 값이 나온다', () => {
    const hits = [
      { typeId: 'mint' as BrickTypeId, destroyed: true },
      { typeId: 'periwinkle' as BrickTypeId, destroyed: true },
      { typeId: 'magenta' as BrickTypeId, destroyed: false },
      { typeId: 'magenta' as BrickTypeId, destroyed: true },
      { typeId: 'pearl' as BrickTypeId, destroyed: false },
      { typeId: 'pearl' as BrickTypeId, destroyed: false },
      { typeId: 'pearl' as BrickTypeId, destroyed: true },
    ]
    // 표를 손으로 다시 읽어 계산한다 — 구현을 베끼지 않는다.
    const expected =
      BRICK_TYPES.mint.breakScore +
      BRICK_TYPES.periwinkle.breakScore +
      BRICK_TYPES.magenta.hitScore +
      BRICK_TYPES.magenta.breakScore +
      BRICK_TYPES.pearl.hitScore * 2 +
      BRICK_TYPES.pearl.breakScore

    const out = computeScore({ hits, wavesCleared: 0 })
    expect(out.total).toBe(expected)
    expect(out.fromHits + out.fromBreaks + out.fromWaves + out.fromItems).toBe(out.total)
  })

  it('판을 전멸시키면 판마다 보너스가 붙는다', () => {
    expect(computeScore({ hits: [], wavesCleared: 0 }).fromWaves).toBe(0)
    expect(computeScore({ hits: [], wavesCleared: 1 }).fromWaves).toBe(WAVE_CLEAR_BONUS)
    expect(computeScore({ hits: [], wavesCleared: 3 }).total).toBe(WAVE_CLEAR_BONUS * 3)
  })

  it('벽돌을 하나도 못 부수고 판도 못 깨면 0점이다', () => {
    expect(computeScore({ hits: [], wavesCleared: 0 }).total).toBe(0)
  })

  it('아이템 획득 자체에는 점수가 없다', () => {
    expect(ITEM_PICKUP_SCORE).toBe(0)
    const without = computeScore({ hits: [{ typeId: 'mint', destroyed: true }], wavesCleared: 1 })
    const with20 = computeScore({
      hits: [{ typeId: 'mint', destroyed: true }],
      wavesCleared: 1,
      itemsCollected: 20,
    })
    expect(with20.fromItems).toBe(0)
    expect(with20.total).toBe(without.total)
  })
})

// ── scoreTable ───────────────────────────────────────────────────────────────

describe('scoreTable — 난이도에 맞는 행만 낸다', () => {
  it('maxDurability 보다 단단한 벽돌은 표에 넣지 않는다', () => {
    for (const max of [1, 2, 3]) {
      const rows = scoreTable(max)
      const expected = ALL_TYPES.filter((t) => BRICK_TYPES[t].durability <= max)
      expect(rows).toHaveLength(expected.length)
      for (const row of rows) expect(row.durability).toBeLessThanOrEqual(max)
    }
  })

  it('내구도 1 이면 1타에 깨지는 벽돌만, 3 이면 전부 나온다', () => {
    expect(scoreTable(1).map((r) => r.label)).toEqual([BRICK_TYPES.mint.label, BRICK_TYPES.periwinkle.label])
    expect(scoreTable(3)).toHaveLength(ALL_TYPES.length)
  })

  it('파괴 점수 오름차순으로 정렬돼 있다', () => {
    const rows = scoreTable(3)
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].breakScore).toBeLessThanOrEqual(rows[i].breakScore)
    }
  })

  it('각 행의 값이 BRICK_TYPES 원본과 같다', () => {
    for (const row of scoreTable(3)) {
      const def = ALL_TYPES.map((t) => BRICK_TYPES[t]).find((d) => d.label === row.label)
      expect(def).toBeDefined()
      expect(row.durability).toBe(def?.durability)
      expect(row.hitScore).toBe(def?.hitScore)
      expect(row.breakScore).toBe(def?.breakScore)
      expect(row.color).toBe(def?.color)
    }
  })

  it('기본값은 전체 표다', () => {
    expect(scoreTable()).toEqual(scoreTable(3))
  })
})

// ── 교차 검증 ────────────────────────────────────────────────────────────────

function makeInput(seed: string): BrickPickInput {
  const parsed = parseBrickPickInput({
    schemaVersion: '1.0',
    sessionId: `score-${seed}`,
    participants: Array.from({ length: 6 }, (_, i) => ({ id: `u${i + 1}`, nickname: `학생${i + 1}` })),
    mode: 'auto',
    difficulty: 'normal',
    roundDurationMs: 30_000,
    selectionRule: { kind: 'top', count: 1 },
    excludedParticipantIds: [],
    seed,
    locale: 'ko',
    soundEnabled: false,
    reducedMotion: false,
  })
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

interface RunOutcome {
  seed: string
  rows: Array<{
    id: string
    engineScore: number
    bricksDestroyed: number
    wavesCleared: number
    itemsCollected: number
    events: ArenaEvent[]
  }>
}

/** 자동 경기를 끝까지 돌리고, 참가자별 최종 점수와 이벤트 로그를 함께 꺼낸다. */
function runMatch(seed: string): RunOutcome {
  const match = new Match({
    input: makeInput(seed),
    now: () => 1,
    random: () => 0.5,
    collectArenaEvents: true,
  })
  match.start()
  while (!match.isFinished) match.step()

  const result = match.buildResult()
  const log = match.exportReplayLog()
  const byId = new Map((log.arenaEvents ?? []).map((e) => [e.participantId, e.events]))

  return {
    seed,
    rows: result.participants.map((p) => ({
      id: p.id,
      engineScore: p.score ?? -1,
      bricksDestroyed: p.bricksDestroyed,
      wavesCleared: p.wavesCleared,
      itemsCollected: p.items.reduce((n, i) => n + i.collected, 0),
      events: byId.get(p.id) ?? [],
    })),
  }
}

/** 색 → 벽돌 종류. 이벤트 로그만으로 종류를 되짚기 위한 역표. */
const COLOR_TO_TYPE = new Map<string, BrickTypeId>(
  ALL_TYPES.map((t) => [BRICK_TYPES[t].color, t]),
)

const SEEDS = ['XR-1', 'XR-2', 'XR-3', 'XR-4', 'XR-5', 'XR-6']

describe('교차 검증 — 엔진 점수 = 이벤트로 다시 계산한 점수', () => {
  const runs = SEEDS.map(runMatch)

  it('경기가 실제로 진행돼 점수가 나온다 (빈 경기로 통과하지 않는다)', () => {
    for (const run of runs) {
      const max = Math.max(...run.rows.map((r) => r.engineScore))
      // 교차 검증이 "0점 = 0점" 으로 통과해 버리지 않게, 실제로 벽돌이 깨졌는지 본다.
      expect(max, `seed=${run.seed}`).toBeGreaterThan(100)
      for (const row of run.rows) {
        expect(row.events.length, `${run.seed}/${row.id} 이벤트 없음`).toBeGreaterThan(0)
        expect(row.bricksDestroyed, `${run.seed}/${row.id} 벽돌 0개`).toBeGreaterThan(0)
      }
    }
    console.log(
      '교차 검증 점수:',
      runs.map((r) => `${r.seed}[${r.rows.map((x) => x.engineScore).join('/')}]`).join(' '),
    )
  })

  it('computeScoreFromEvents(이벤트) 가 엔진 최종 점수와 정확히 같다', () => {
    for (const run of runs) {
      for (const row of run.rows) {
        expect(computeScoreFromEvents(row.events), `${run.seed}/${row.id}`).toBe(row.engineScore)
      }
    }
  })

  it('이벤트를 점수표로 직접 합산해도(computeScore) 엔진 점수와 같다', () => {
    for (const run of runs) {
      for (const row of run.rows) {
        const hits = row.events
          .filter((e) => e.type === 'brick-hit' || e.type === 'brick-break')
          .map((e) => {
            const typeId = COLOR_TO_TYPE.get(e.color ?? '')
            expect(typeId, `알 수 없는 벽돌 색: ${String(e.color)}`).toBeDefined()
            return { typeId: typeId as BrickTypeId, destroyed: e.type === 'brick-break' }
          })
        const wavesCleared = row.events.filter((e) => e.type === 'wave-clear').length

        const recomputed = computeScore({
          hits,
          wavesCleared,
          itemsCollected: row.itemsCollected,
        })
        expect(recomputed.total, `${run.seed}/${row.id}`).toBe(row.engineScore)
      }
    }
  })

  it('파괴 이벤트 수와 판 클리어 수가 결과 통계와 맞는다', () => {
    for (const run of runs) {
      for (const row of run.rows) {
        const breaks = row.events.filter((e) => e.type === 'brick-break').length
        const waves = row.events.filter((e) => e.type === 'wave-clear').length
        expect(breaks, `${run.seed}/${row.id} bricksDestroyed`).toBe(row.bricksDestroyed)
        expect(waves, `${run.seed}/${row.id} wavesCleared`).toBe(row.wavesCleared)
      }
    }
  })

  it('점수는 벽돌 파괴·타격·판 보너스에서만 나온다 (아이템 이벤트에는 점수가 없다)', () => {
    for (const run of runs) {
      for (const row of run.rows) {
        for (const event of row.events) {
          if (event.type === 'brick-hit' || event.type === 'brick-break' || event.type === 'wave-clear') continue
          expect(event.score ?? 0, `${event.type} 에 점수가 붙어 있다`).toBe(0)
        }
      }
    }
  })

  it('같은 seed 를 다시 돌려도 점수가 같다 (결정적)', () => {
    const again = runMatch(SEEDS[0])
    const shape = (r: RunOutcome) => r.rows.map((row) => [row.id, row.engineScore])
    expect(shape(again)).toEqual(shape(runs[0]))
  })
})
