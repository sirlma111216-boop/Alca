import { describe, it, expect } from 'vitest'
import { ITEM_KINDS, Match, parseBrickPickInput } from '../../src/core'
import type { ItemKind } from '../../src/core'

function forced(kind: ItemKind, seed = 'X', rounds = 30_000) {
  const weights = ITEM_KINDS.reduce((a, k) => ({ ...a, [k]: k === kind ? 100 : 0 }), {} as Record<ItemKind, number>)
  const parsed = parseBrickPickInput({
    schemaVersion: '1.0',
    sessionId: 'f',
    participants: [{ id: 'a', nickname: 'A' }],
    mode: 'auto',
    difficulty: 'normal',
    difficultySettings: { items: { weights, brickRatio: 0.6 } },
    roundDurationMs: rounds,
    selectionRule: { kind: 'top', count: 1 },
    excludedParticipantIds: [],
    seed,
    locale: 'ko',
    soundEnabled: false,
    reducedMotion: false,
  })
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const match = new Match({ input: parsed.value, now: () => 1, random: () => 0.5, collectArenaEvents: true })
  match.start()
  while (!match.isFinished) match.step()
  const ev = match.exportReplayLog().arenaEvents?.[0]?.events ?? []
  const n = (t: string) => ev.filter((e) => e.type === t).length
  const run = match.runs[0]
  return { ev, n, run, maxBalls: 0 }
}

describe('아이템 개별 동작', () => {
  for (const kind of ITEM_KINDS) {
    it(`${kind}`, () => {
      const { n, run, ev } = forced(kind)
      const collected = run.items.find((i) => i.kind === kind)?.collected ?? 0
      const dropped = run.items.find((i) => i.kind === kind)?.dropped ?? 0
      console.log(
        `${kind}: 떨어짐=${dropped} 획득=${collected} 점수=${run.score} 벽돌=${run.bricksDestroyed}` +
          ` 레이저발사=${n('laser-fire')} 캐치=${n('ball-catch')} 보호막=${n('shield-bounce')} 목숨=${run.livesRemaining}`,
      )
      expect(dropped).toBeGreaterThan(0)
      // 다른 종류의 캡슐이 섞이지 않아야 한다.
      const otherKinds = ev.filter((e) => e.type === 'item-spawn' && e.kind !== kind)
      expect(otherKinds).toHaveLength(0)
    })
  }
})
