/**
 * 아이템 규칙 시험.
 *
 * 엔진 코드를 그대로 베끼지 않고 "규칙 문서에 적힌 약속"이 지켜지는지 본다.
 * Arena 의 필드가 공개돼 있으므로 상황을 직접 만들어 놓고 몇 스텝만 돌린다.
 *
 * 공통 장치
 *  - holdServe()  : 서브 공을 패들에 붙잡아 경기장을 "정지" 시킨다. 공이 돌아다니며
 *                   벽돌을 깨거나 목숨을 잃어 효과가 초기화되는 것을 막는다.
 *  - keepOnly()   : 벽돌 하나만 표적으로 남긴다. 판 전멸(웨이브 클리어)이 끼어들지
 *                   않도록 구석 벽돌 하나는 항상 살려 둔다.
 *  - putCapsuleOnPaddle() : 캡슐을 패들 바로 위에 놓는다. 한 스텝이면 획득된다.
 */

import { describe, expect, it } from 'vitest'
import {
  ARENA,
  Arena,
  BRICK_TYPES,
  ITEM_KINDS,
  PLAY_LEFT,
  STEP_MS,
  activeEffects,
  computeScore,
  createLevel,
  isCatchActive,
  isExpandActive,
  isLaserActive,
  isSlowActive,
  resolveDifficulty,
  usableItemKinds,
} from '../../src/core'
import type {
  ArenaEvent,
  ArenaEventType,
  ArenaInput,
  Ball,
  Brick,
  BrickTypeId,
  DifficultySettings,
  GameMode,
  ItemKind,
} from '../../src/core'

// ────────────────────────────────────────────────────────────────────────────
// 시험 장치
// ────────────────────────────────────────────────────────────────────────────

const NO_INPUT: ArenaInput = { pointerX: null, direction: 0, firePressed: false, fireHeld: false }
const FIRE_PRESSED: ArenaInput = { ...NO_INPUT, firePressed: true }
const FIRE_HELD: ArenaInput = { ...NO_INPUT, fireHeld: true }

interface Rig {
  arena: Arena
  difficulty: DifficultySettings
  events: ArenaEvent[]
  step(times?: number, input?: ArenaInput): void
  count(type: ArenaEventType): number
  eventsOf(type: ArenaEventType): ArenaEvent[]
}

function makeRig(
  tune?: (d: DifficultySettings) => void,
  options: { mode?: GameMode; seed?: string } = {},
): Rig {
  const difficulty = resolveDifficulty('normal')
  tune?.(difficulty)
  const arena = new Arena({
    participantId: 'p1',
    nickname: '테스터',
    index: 0,
    seed: options.seed ?? 'ITEM-RULES',
    mode: options.mode ?? 'auto',
    difficulty,
  })
  const events: ArenaEvent[] = []
  arena.eventSink = (event) => {
    events.push(event)
  }
  return {
    arena,
    difficulty,
    events,
    step(times = 1, input: ArenaInput = NO_INPUT) {
      for (let i = 0; i < times; i += 1) arena.step(input)
    },
    count(type) {
      return events.filter((e) => e.type === type).length
    },
    eventsOf(type) {
      return events.filter((e) => e.type === type)
    },
  }
}

/** 서브 공을 영원히 붙잡아 둔다 (now - Infinity 는 결코 SERVE_HOLD_MS 를 넘지 못한다). */
function holdServe(arena: Arena): void {
  for (const ball of arena.balls) {
    if (ball.serving) ball.stuckSince = Number.POSITIVE_INFINITY
  }
}

/** 표적 벽돌 하나 + 구석 예비 벽돌 하나만 남긴다. */
function keepOnly(
  arena: Arena,
  row: number,
  col: number,
  typeId: BrickTypeId,
  item: ItemKind | null,
): Brick {
  const level = arena.level
  const target = level.bricks[row * level.cols + col]
  const spare = level.bricks[0] === target ? level.bricks[1] : level.bricks[0]
  let alive = 0
  for (const brick of level.bricks) {
    brick.alive = brick === target || brick === spare
    if (brick.alive) alive += 1
    brick.item = brick === target ? item : null
    brick.itemSpawned = false
  }
  level.aliveCount = alive
  const def = BRICK_TYPES[typeId]
  target.typeId = typeId
  target.hp = def.durability
  target.maxHp = def.durability
  return target
}

/** 벽돌 바로 아래에 탄환을 둔다. 한 스텝이면 벽돌에 닿는다. */
function putBulletUnder(arena: Arena, brick: Brick): void {
  arena.bullets.push({
    id: 5000 + arena.bullets.length,
    x: brick.x + brick.w / 2,
    y: brick.y + brick.h + 2,
  })
}

/** 캡슐을 패들 바로 위에 둔다. 한 스텝이면 패들에 닿는다. */
function putCapsuleOnPaddle(arena: Arena, kind: ItemKind): void {
  arena.capsules.push({
    id: 7000 + arena.capsules.length,
    x: arena.paddleX,
    y: ARENA.paddleY - 5,
    kind,
  })
}

/** 움직이는 공 하나만 남긴다. */
function onlyMovingBall(arena: Arena, x: number, y: number, dx: number, dy: number): Ball {
  const ball: Ball = {
    id: 900,
    x,
    y,
    dx,
    dy,
    stuck: false,
    stuckOffset: 0,
    stuckSince: arena.simTimeMs,
    serving: false,
  }
  arena.balls = [ball]
  return ball
}

/** 캐치로 붙은 상태의 공을 만든다 (서브가 아니다). */
function stuckBall(arena: Arena, id: number, offset: number): Ball {
  return {
    id,
    x: arena.paddleX + offset,
    y: ARENA.paddleY - ARENA.ballRadius - 0.5,
    dx: 0,
    dy: 1,
    stuck: true,
    stuckOffset: offset,
    stuckSince: arena.simTimeMs,
    serving: false,
  }
}

function enableCatch(arena: Arena, durationMs = 12_000): void {
  arena.effects.weapon = 'catch'
  arena.effects.weaponUntil = arena.simTimeMs + durationMs
}

function enableLaser(arena: Arena, durationMs = 8_000): void {
  arena.effects.weapon = 'laser'
  arena.effects.weaponUntil = arena.simTimeMs + durationMs
  arena.effects.lastLaserAt = Number.NEGATIVE_INFINITY
}

// ────────────────────────────────────────────────────────────────────────────

describe('캡슐 생성과 획득', () => {
  it('아이템이 든 벽돌을 부수면 캡슐이 정확히 한 번만 생긴다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0 // 자동 배치는 끄고 손으로 심는다
    })
    holdServe(rig.arena)
    const brick = keepOnly(rig.arena, 3, 5, 'mint', 'multiball')

    putBulletUnder(rig.arena, brick)
    rig.step(1)

    expect(brick.alive).toBe(false)
    expect(rig.count('brick-break')).toBe(1)
    expect(rig.count('item-spawn')).toBe(1)
    expect(rig.arena.capsules).toHaveLength(1)
    expect(rig.arena.capsules[0].kind).toBe('multiball')
    expect(rig.arena.itemStats.multiball.dropped).toBe(1)

    // 같은 벽돌을 되살려 다시 부숴도 캡슐은 늘지 않는다 (itemSpawned 표시).
    brick.alive = true
    brick.hp = BRICK_TYPES.mint.durability
    rig.arena.level.aliveCount += 1
    putBulletUnder(rig.arena, brick)
    rig.step(1)

    expect(rig.count('brick-break')).toBe(2)
    expect(rig.count('item-spawn')).toBe(1)
    expect(rig.arena.capsules).toHaveLength(1)
    expect(rig.arena.itemStats.multiball.dropped).toBe(1)
  })

  it('패들로 받지 못한 캡슐은 item-miss 로 사라지고 효과가 켜지지 않는다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    holdServe(arena)

    // 패들(가운데)에서 멀리 떨어진 왼쪽에 놓는다.
    arena.capsules.push({ id: 1, x: PLAY_LEFT + 20, y: 120, kind: 'expand' })
    let guard = 0
    while (arena.capsules.length > 0 && guard < 3000) {
      rig.step(1)
      guard += 1
    }

    expect(rig.count('item-miss')).toBe(1)
    expect(rig.count('item-collect')).toBe(0)
    expect(arena.effects.expandUntil).toBeNull()
    expect(arena.paddleWidth).toBe(rig.difficulty.paddleWidth)
    expect(arena.itemStats.expand.collected).toBe(0)
  })

  it('패들 위에서 받은 캡슐은 item-collect 뒤 효과가 켜진다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    holdServe(arena)

    putCapsuleOnPaddle(arena, 'expand')
    rig.step(1)

    expect(rig.count('item-collect')).toBe(1)
    expect(rig.count('item-miss')).toBe(0)
    expect(isExpandActive(arena.effects, arena.simTimeMs)).toBe(true)
    expect(arena.itemStats.expand.collected).toBe(1)
    expect(arena.capsules).toHaveLength(0)
  })
})

describe('확장', () => {
  it('획득하면 패들이 1.5배가 되고 12초 뒤 원래 너비로 돌아온다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    const base = rig.difficulty.paddleWidth
    holdServe(arena)

    putCapsuleOnPaddle(arena, 'expand')
    rig.step(2) // 획득 스텝 + 너비가 반영되는 다음 스텝

    expect(arena.paddleWidth).toBeCloseTo(base * rig.difficulty.items.expandFactor, 6)
    const until = arena.effects.expandUntil
    expect(until).not.toBeNull()
    expect((until as number) - arena.simTimeMs).toBeGreaterThan(
      rig.difficulty.items.expandDurationMs - 3 * STEP_MS,
    )

    // 만료 직전까지는 넓은 채로 있다.
    while (arena.simTimeMs < (until as number) - 2 * STEP_MS) rig.step(1)
    expect(arena.paddleWidth).toBeCloseTo(base * rig.difficulty.items.expandFactor, 6)

    // 만료되면 기본 너비로 돌아온다.
    while (arena.simTimeMs < (until as number) + STEP_MS) rig.step(1)
    expect(arena.effects.expandUntil).toBeNull()
    expect(arena.paddleWidth).toBe(base)
    expect(rig.eventsOf('item-expire').some((e) => e.kind === 'expand')).toBe(true)
  })

  it('확장 상한(paddleMaxWidth)을 넘지 않는다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
      d.paddleWidth = 100
      d.paddleMaxWidth = 120 // 100 × 1.5 = 150 이지만 120 에서 잘려야 한다
    })
    const arena = rig.arena
    holdServe(arena)

    putCapsuleOnPaddle(arena, 'expand')
    rig.step(2)

    expect(arena.paddleWidth).toBe(120)
  })

  it('다시 먹어도 배율은 누적되지 않고 남은 시간만 다시 채워진다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    const base = rig.difficulty.paddleWidth
    const duration = rig.difficulty.items.expandDurationMs
    holdServe(arena)

    putCapsuleOnPaddle(arena, 'expand')
    rig.step(2)
    const widthOnce = arena.paddleWidth

    // 절반쯤 흘려보낸 뒤 다시 획득한다.
    rig.step(Math.round(duration / 2 / STEP_MS))
    const remainingBefore = (arena.effects.expandUntil as number) - arena.simTimeMs
    expect(remainingBefore).toBeLessThan(duration * 0.6)

    putCapsuleOnPaddle(arena, 'expand')
    rig.step(2)

    // 배율은 그대로 (1.5 × 1.5 가 되면 안 된다)
    expect(arena.paddleWidth).toBe(widthOnce)
    expect(arena.paddleWidth).toBeCloseTo(base * rig.difficulty.items.expandFactor, 6)
    // 남은 시간은 12초로 다시 찬다 (더해지는 것이 아니다)
    const remainingAfter = (arena.effects.expandUntil as number) - arena.simTimeMs
    expect(remainingAfter).toBeGreaterThan(duration - 3 * STEP_MS)
    expect(remainingAfter).toBeLessThanOrEqual(duration)
  })
})

describe('캐치', () => {
  it('공이 패들에 닿으면 붙고, 패들을 움직이면 함께 움직인다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    enableCatch(arena)
    const ball = onlyMovingBall(arena, arena.paddleX, ARENA.paddleY - 40, 0, 1)

    let guard = 0
    while (!ball.stuck && guard < 60) {
      rig.step(1)
      guard += 1
    }

    expect(ball.stuck).toBe(true)
    expect(ball.serving).toBe(false)
    expect(rig.count('ball-catch')).toBe(1)

    // 패들을 오른쪽으로 옮기면 공도 따라온다.
    const before = ball.x
    const movedTo = arena.paddleX + 20
    rig.step(1, { ...NO_INPUT, pointerX: movedTo })
    expect(arena.paddleX).toBeCloseTo(movedTo, 6)
    expect(ball.x).toBeCloseTo(arena.paddleX + ball.stuckOffset, 6)
    expect(ball.x - before).toBeCloseTo(20, 6)
    expect(ball.stuck).toBe(true)
  })

  it('발사 입력을 주면 붙어 있던 공이 나간다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    enableCatch(arena)
    const ball = stuckBall(arena, 901, 0)
    arena.balls = [ball]

    rig.step(1)
    expect(ball.stuck).toBe(true) // 아직 발사하지 않았다

    rig.step(1, FIRE_PRESSED)
    expect(ball.stuck).toBe(false)
    expect(ball.dy).toBeLessThan(0)
    expect(rig.count('ball-launch')).toBe(1)
  })

  it('발사하지 않으면 catchHoldMs 에 자동으로 나간다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    enableCatch(arena, 30_000) // 효과 만료가 아니라 대기 시간으로 나가야 한다
    const ball = stuckBall(arena, 902, 0)
    arena.balls = [ball]
    const stuckSince = ball.stuckSince
    const hold = rig.difficulty.items.catchHoldMs

    let guard = 0
    while (ball.stuck && guard < 10_000) {
      rig.step(1)
      guard += 1
    }

    const heldFor = arena.simTimeMs - stuckSince
    expect(ball.stuck).toBe(false)
    expect(heldFor).toBeGreaterThanOrEqual(hold)
    expect(heldFor).toBeLessThan(hold + 2 * STEP_MS)
  })

  it('캐치 효과가 끝나면 붙어 있던 공이 정상 발사된다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    enableCatch(arena, 1_000) // 대기 시간(3초)보다 짧게 — 만료가 먼저 온다
    const ball = stuckBall(arena, 903, 6)
    arena.balls = [ball]

    let guard = 0
    while (ball.stuck && guard < 1_000) {
      rig.step(1)
      guard += 1
    }

    expect(ball.stuck).toBe(false)
    expect(ball.dy).toBeLessThan(0)
    expect(arena.simTimeMs).toBeLessThan(rig.difficulty.items.catchHoldMs)
    expect(rig.eventsOf('item-expire').some((e) => e.kind === 'catch')).toBe(true)
    expect(arena.effects.weapon).toBe('none')
  })

  it('붙은 공은 각자 자기 오프셋에 맞는 방향으로 나간다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    enableCatch(arena)
    const left = stuckBall(arena, 904, -15)
    const right = stuckBall(arena, 905, 15)
    arena.balls = [left, right]

    rig.step(1, FIRE_PRESSED)

    expect(left.stuck).toBe(false)
    expect(right.stuck).toBe(false)
    expect(left.dx).toBeLessThan(0)
    expect(right.dx).toBeGreaterThan(0)
    expect(left.dx).not.toBeCloseTo(right.dx, 6)
    // 좌우 대칭 — 같은 크기의 오프셋이면 같은 크기의 수평 성분
    expect(Math.abs(left.dx)).toBeCloseTo(Math.abs(right.dx), 6)
    expect(left.dy).toBeLessThan(0)
    expect(right.dy).toBeLessThan(0)
  })
})

describe('멀티볼', () => {
  it('공은 maxBalls 개를 넘지 않는다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    const max = rig.difficulty.items.maxBalls
    onlyMovingBall(arena, arena.paddleX, 300, 0, -1)

    for (let i = 0; i < 4; i += 1) putCapsuleOnPaddle(arena, 'multiball')
    rig.step(1)
    expect(arena.balls.length).toBe(max)

    // 연속으로 더 먹어도 늘지 않는다.
    putCapsuleOnPaddle(arena, 'multiball')
    rig.step(1)
    putCapsuleOnPaddle(arena, 'multiball')
    rig.step(1)
    expect(arena.balls.length).toBe(max)
  })

  it('공이 전부 붙어 있을 때 먹으면 먼저 발사된 뒤 나뉜다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    enableCatch(arena)
    arena.balls = [stuckBall(arena, 906, 0)]

    putCapsuleOnPaddle(arena, 'multiball')
    rig.step(1)

    expect(arena.balls.length).toBe(rig.difficulty.items.maxBalls)
    expect(arena.balls.some((b) => b.stuck)).toBe(false)
    expect(rig.count('ball-launch')).toBe(1)
  })
})

describe('슬로우', () => {
  it('속도가 정상 속도 × slowFactor 가 되고, 끝나면 그 시점의 정상 속도로 돌아온다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    const factor = rig.difficulty.items.slowFactor
    holdServe(arena)

    putCapsuleOnPaddle(arena, 'slow')
    rig.step(1)

    expect(isSlowActive(arena.effects, arena.simTimeMs)).toBe(true)
    expect(arena.ballSpeed).toBeCloseTo(arena.normalSpeed * factor, 6)

    const until = arena.effects.slowUntil as number
    while (arena.simTimeMs < until + STEP_MS) rig.step(1)

    expect(isSlowActive(arena.effects, arena.simTimeMs)).toBe(false)
    // 복원값은 "지금의 정상 속도" — 가속이 반영돼 시작 속도보다 빨라야 한다.
    expect(arena.normalSpeed).toBeGreaterThan(rig.difficulty.ballBaseSpeed)
    expect(arena.ballSpeed).toBeCloseTo(arena.normalSpeed, 6)
    expect(arena.ballSpeed).toBeGreaterThan(rig.difficulty.ballBaseSpeed)
  })

  it('반복해서 먹어도 배율이 누적되지 않는다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    const factor = rig.difficulty.items.slowFactor
    holdServe(arena)

    putCapsuleOnPaddle(arena, 'slow')
    rig.step(1)
    expect(arena.ballSpeed / arena.normalSpeed).toBeCloseTo(factor, 6)

    putCapsuleOnPaddle(arena, 'slow')
    rig.step(1)
    putCapsuleOnPaddle(arena, 'slow')
    rig.step(1)

    // 0.75 × 0.75 = 0.5625 가 되면 안 된다.
    expect(arena.ballSpeed / arena.normalSpeed).toBeCloseTo(factor, 6)
  })
})

describe('레이저', () => {
  it('발사 간격(laserIntervalMs)보다 자주 나가지 않는다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    holdServe(arena)
    enableLaser(arena, 8_000)
    const interval = rig.difficulty.items.laserIntervalMs

    const durationMs = 2_000
    rig.step(Math.round(durationMs / STEP_MS), FIRE_HELD)

    const times = rig.eventsOf('laser-fire').map((e) => e.at)
    expect(times.length).toBeGreaterThan(3)
    // 간격보다 자주 나가면 안 된다.
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(interval)
    }
    // 이론상 최대 발사 횟수를 넘을 수 없다.
    expect(times.length).toBeLessThanOrEqual(Math.floor(durationMs / interval) + 1)
  })

  it('레이저가 꺼져 있으면 아무리 눌러도 나가지 않는다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    holdServe(rig.arena)
    rig.step(240, FIRE_HELD)
    expect(rig.count('laser-fire')).toBe(0)
    expect(rig.arena.bullets).toHaveLength(0)
  })

  it('탄환은 벽돌에 피해 1을 주고 사라진다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    holdServe(arena)
    const brick = keepOnly(arena, 3, 5, 'pearl', null) // 내구도 3

    putBulletUnder(arena, brick)
    rig.step(1)

    expect(brick.alive).toBe(true)
    expect(brick.hp).toBe(BRICK_TYPES.pearl.durability - 1)
    expect(arena.bullets).toHaveLength(0)
    expect(rig.count('brick-hit')).toBe(1)
    expect(rig.count('brick-break')).toBe(0)
    expect(arena.score).toBe(BRICK_TYPES.pearl.hitScore)
  })

  it('레이저로 부순 벽돌도 점수가 같고 캡슐도 나온다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    holdServe(arena)
    const brick = keepOnly(arena, 3, 5, 'periwinkle', 'shield') // 내구도 1

    putBulletUnder(arena, brick)
    rig.step(1)

    // 점수는 점수표를 독립적으로 다시 계산한 값과 같아야 한다.
    const expected = computeScore({ hits: [{ typeId: 'periwinkle', destroyed: true }], wavesCleared: 0 })
    expect(arena.score).toBe(expected.total)
    expect(arena.score).toBe(BRICK_TYPES.periwinkle.breakScore)
    expect(arena.bricksDestroyed).toBe(1)
    expect(arena.capsules).toHaveLength(1)
    expect(arena.capsules[0].kind).toBe('shield')
  })
})

describe('효과 조합', () => {
  it('캐치 중 레이저를 먹으면 무기가 바뀌고 붙어 있던 공이 발사된다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    enableCatch(arena)
    const ball = stuckBall(arena, 907, 4)
    arena.balls = [ball]

    putCapsuleOnPaddle(arena, 'laser')
    rig.step(1)

    expect(arena.effects.weapon).toBe('laser')
    expect(isLaserActive(arena.effects, arena.simTimeMs)).toBe(true)
    expect(isCatchActive(arena.effects, arena.simTimeMs)).toBe(false)
    expect(ball.stuck).toBe(false)
    expect(ball.dy).toBeLessThan(0)
    expect(rig.count('ball-launch')).toBe(1)
  })

  it('레이저 중 캐치를 먹으면 무기가 캐치로 바뀐다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    holdServe(arena)
    enableLaser(arena)

    putCapsuleOnPaddle(arena, 'catch')
    rig.step(1)

    expect(arena.effects.weapon).toBe('catch')
    expect(isCatchActive(arena.effects, arena.simTimeMs)).toBe(true)
    expect(isLaserActive(arena.effects, arena.simTimeMs)).toBe(false)
  })

  it('확장·슬로우·보호막은 무기와 함께 켜진다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    holdServe(arena)

    for (const kind of ['expand', 'slow', 'shield', 'laser'] as ItemKind[]) {
      putCapsuleOnPaddle(arena, kind)
    }
    rig.step(1)

    expect(isExpandActive(arena.effects, arena.simTimeMs)).toBe(true)
    expect(isSlowActive(arena.effects, arena.simTimeMs)).toBe(true)
    expect(isLaserActive(arena.effects, arena.simTimeMs)).toBe(true)
    expect(arena.effects.shieldCharges).toBe(1)

    const shown = activeEffects(arena.effects, arena.simTimeMs).map((v) => v.kind)
    expect(new Set(shown)).toEqual(new Set(['expand', 'slow', 'laser', 'shield']))
  })
})

describe('보호막', () => {
  it('두 번 먹어도 1회분만 남는다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    holdServe(arena)

    putCapsuleOnPaddle(arena, 'shield')
    putCapsuleOnPaddle(arena, 'shield')
    rig.step(1)
    putCapsuleOnPaddle(arena, 'shield')
    rig.step(1)

    expect(arena.effects.shieldCharges).toBe(rig.difficulty.items.maxShieldCharges)
    expect(arena.effects.shieldCharges).toBe(1)
  })

  it('바닥으로 가는 공을 한 번 튕기고 소모된다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    const lives = arena.lives
    arena.effects.shieldCharges = 1
    // 패들을 이미 지나친(= 패들보다 아래) 공을 만든다.
    const ball = onlyMovingBall(arena, arena.paddleX, ARENA.paddleY + 15, 0, 1)

    let guard = 0
    while (rig.count('shield-bounce') === 0 && guard < 60) {
      rig.step(1)
      guard += 1
    }

    expect(rig.count('shield-bounce')).toBe(1)
    expect(arena.effects.shieldCharges).toBe(0)
    expect(ball.dy).toBeLessThan(0)
    expect(arena.lives).toBe(lives)
    expect(rig.count('life-lost')).toBe(0)
  })
})

describe('목숨', () => {
  it('추가 목숨은 +1 이고 maxLives 를 넘지 않는다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    holdServe(arena)
    const start = arena.lives
    const max = rig.difficulty.items.maxLives
    expect(start).toBeLessThan(max)

    putCapsuleOnPaddle(arena, 'life')
    rig.step(1)
    expect(arena.lives).toBe(start + 1)

    for (let i = 0; i < max + 2; i += 1) {
      putCapsuleOnPaddle(arena, 'life')
      rig.step(1)
    }
    expect(arena.lives).toBe(max)
  })

  it('멀티볼 중 일부를 잃어도 목숨은 줄지 않고, 전부 없어졌을 때 한 번만 줄어든다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    const lives = arena.lives
    arena.balls = [
      { ...stuckBall(arena, 911, 0), stuck: false, y: 300, dy: -1 },
      { ...stuckBall(arena, 912, 0), stuck: false, y: 300, dy: -1 },
      { ...stuckBall(arena, 913, 0), stuck: false, y: 300, dy: -1 },
    ]

    // 3개 중 2개를 없앤다 — 목숨은 그대로여야 한다.
    arena.balls.splice(1, 2)
    rig.step(1)
    expect(arena.balls.length).toBe(1)
    expect(arena.lives).toBe(lives)
    expect(rig.count('life-lost')).toBe(0)

    // 마지막 하나까지 없어지면 그때 한 번만 줄어든다.
    arena.balls = []
    rig.step(1)
    expect(arena.lives).toBe(lives - 1)
    expect(rig.count('life-lost')).toBe(1)

    // 새 공이 서브됐으므로 계속 돌려도 또 줄지 않는다.
    rig.step(30)
    expect(arena.lives).toBe(lives - 1)
    expect(rig.count('life-lost')).toBe(1)
  })

  it('목숨을 잃으면 효과·보호막·탄환·캡슐이 모두 정리되고 새 공이 서브된다', () => {
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const arena = rig.arena
    const base = rig.difficulty.paddleWidth
    holdServe(arena)

    for (const kind of ['expand', 'slow', 'shield', 'laser'] as ItemKind[]) {
      putCapsuleOnPaddle(arena, kind)
    }
    rig.step(2)
    expect(arena.paddleWidth).toBeGreaterThan(base)

    arena.bullets.push({ id: 1, x: arena.paddleX, y: 300 })
    arena.capsules.push({ id: 2, x: PLAY_LEFT + 20, y: 100, kind: 'life' })

    arena.balls = []
    rig.step(1)

    expect(arena.effects.expandUntil).toBeNull()
    expect(arena.effects.slowUntil).toBeNull()
    expect(arena.effects.weapon).toBe('none')
    expect(arena.effects.weaponUntil).toBeNull()
    expect(arena.effects.shieldCharges).toBe(0)
    expect(arena.bullets).toHaveLength(0)
    expect(arena.capsules).toHaveLength(0)
    expect(arena.paddleWidth).toBe(base)
    expect(arena.balls).toHaveLength(1)
    expect(arena.balls[0].serving).toBe(true)
    expect(arena.balls[0].stuck).toBe(true)
  })
})

describe('중복 처리 방지', () => {
  it('탄환과 공이 같은 스텝에 같은 벽돌을 맞혀도 점수·드롭이 중복되지 않는다', () => {
    // 대조군 — 공만으로도 그 한 스텝에 벽돌이 부서지는 배치인지 먼저 확인한다.
    const solo = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const soloBrick = keepOnly(solo.arena, 0, 5, 'mint', 'expand')
    onlyMovingBall(solo.arena, soloBrick.x + soloBrick.w / 2, soloBrick.y + soloBrick.h + 5, 0, -1)
    solo.step(1)
    expect(solo.count('brick-break')).toBe(1)
    const soloScore = solo.arena.score
    const soloCapsules = solo.arena.capsules.length
    expect(soloCapsules).toBe(1)

    // 본 시험 — 같은 배치에 탄환을 하나 더 얹는다.
    const rig = makeRig((d) => {
      d.items.brickRatio = 0
    })
    const brick = keepOnly(rig.arena, 0, 5, 'mint', 'expand')
    onlyMovingBall(rig.arena, brick.x + brick.w / 2, brick.y + brick.h + 5, 0, -1)
    putBulletUnder(rig.arena, brick)
    rig.step(1)

    expect(rig.count('brick-break')).toBe(1)
    expect(rig.count('item-spawn')).toBe(1)
    expect(rig.arena.capsules).toHaveLength(1)
    expect(rig.arena.bricksDestroyed).toBe(1)
    expect(rig.arena.score).toBe(soloScore)
    expect(rig.arena.score).toBe(BRICK_TYPES.mint.breakScore)
    expect(rig.arena.itemStats.expand.dropped).toBe(1)
  })
})

describe('아이템 끄기', () => {
  it('items.enabled = false 면 캡슐이 아예 생기지 않는다', () => {
    const rig = makeRig((d) => {
      d.items.enabled = false
    })
    const arena = rig.arena
    holdServe(arena)

    // (1) 판을 만들 때 아이템이 배치되지 않는다.
    expect(arena.level.bricks.every((b) => b.item === null)).toBe(true)

    // (2) 손으로 아이템을 심어 두어도 캡슐이 나오지 않는다.
    const brick = keepOnly(arena, 3, 5, 'mint', 'multiball')
    putBulletUnder(arena, brick)
    rig.step(1)

    expect(rig.count('brick-break')).toBe(1)
    expect(rig.count('item-spawn')).toBe(0)
    expect(arena.capsules).toHaveLength(0)
    expect(arena.itemStats.multiball.dropped).toBe(0)
  })

  it('꺼 둔 종류와 가중치 0 인 종류는 배치되지 않는다', () => {
    const difficulty = resolveDifficulty('normal')
    difficulty.items.brickRatio = 0.6
    difficulty.items.enabledKinds.laser = false
    difficulty.items.weights.multiball = 0

    const level = createLevel('LEVEL-SEED', 1, difficulty)
    const placed = level.bricks
      .map((b) => b.item)
      .filter((k): k is ItemKind => k !== null)

    expect(placed.length).toBe(Math.round(level.bricks.length * 0.6))
    expect(placed).not.toContain('laser')
    expect(placed).not.toContain('multiball')
    // 나머지 종류는 여전히 나온다 — 검사가 "아무것도 안 나와서" 통과하면 안 된다.
    expect(new Set(placed).size).toBeGreaterThan(1)

    const usable = usableItemKinds(difficulty.items)
    expect(usable).toEqual(ITEM_KINDS.filter((k) => k !== 'laser' && k !== 'multiball'))
    for (const kind of placed) expect(usable).toContain(kind)
  })
})
