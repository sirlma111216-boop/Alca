/**
 * 경기장 물리 — 서브·반사·끼임·관통·결정성.
 *
 * Arena 를 직접 만들고 public 필드(balls, level, paddleX ...)를 건드려
 * "이 상황에서 이 규칙이 지켜지는가" 만 본다. 엔진 내부 계산을 따라 적지 않고
 * 설정값(BRICK_TYPES, SERVE_HOLD_MS, WAVE_CLEAR_BONUS ...)으로 기대값을 다시 만든다.
 */

import { describe, expect, it } from 'vitest'
import {
  ARENA,
  Arena,
  BRICK_TYPES,
  MIN_VERTICAL_RATIO,
  NEUTRAL_INPUT,
  PLAY_LEFT,
  PLAY_RIGHT,
  PLAY_TOP,
  SERVE_HOLD_MS,
  STEP_MS,
  WAVE_CLEAR_BONUS,
  resolveDifficulty,
} from '../../src/core'
import type { ArenaInput, Ball, Brick, DifficultySettings, GameMode } from '../../src/core'

const RADIUS = ARENA.ballRadius

/** 시험용 경기장. 난이도 수치는 프리셋 위에 직접 덮어쓴다(범위 제한을 받지 않는다). */
function makeArena(
  over: Partial<DifficultySettings> = {},
  mode: GameMode = 'manual',
  participantId = 'a',
  seed = 'S',
): Arena {
  return new Arena({
    participantId,
    nickname: 'A',
    index: 0,
    seed,
    mode,
    difficulty: { ...resolveDifficulty('normal'), ...over },
  })
}

/** 붙어 있는 첫 공을 떼어 원하는 자리·방향에 놓는다. */
function placeBall(arena: Arena, x: number, y: number, dx: number, dy: number): Ball {
  const ball = arena.balls[0]
  const len = Math.hypot(dx, dy)
  ball.stuck = false
  ball.serving = false
  ball.x = x
  ball.y = y
  ball.dx = dx / len
  ball.dy = dy / len
  return ball
}

const input = (over: Partial<ArenaInput> = {}): ArenaInput => ({ ...NEUTRAL_INPUT, ...over })

// ────────────────────────────────────────────────────────────────────────────
// 서브
// ────────────────────────────────────────────────────────────────────────────

describe('서브 규칙', () => {
  it('시작할 때 공은 패들에 붙어 있고 서브 상태다', () => {
    const arena = makeArena()
    expect(arena.balls).toHaveLength(1)
    expect(arena.balls[0].stuck).toBe(true)
    expect(arena.balls[0].serving).toBe(true)
    // 패들 바로 위에 놓인다.
    expect(arena.balls[0].x).toBeCloseTo(arena.paddleX, 6)
    expect(arena.balls[0].y).toBeLessThan(ARENA.paddleY)
  })

  it('SERVE_HOLD_MS(1200ms) 가 지나면 자동으로 발사된다', () => {
    const arena = makeArena()
    const lastHeld = Math.ceil(SERVE_HOLD_MS / STEP_MS) - 1 // 아직 1200ms 전인 마지막 스텝
    for (let i = 0; i < lastHeld; i += 1) arena.step()
    expect(arena.simTimeMs).toBeLessThan(SERVE_HOLD_MS)
    expect(arena.balls[0].stuck).toBe(true)

    arena.step()
    expect(arena.simTimeMs).toBeGreaterThanOrEqual(SERVE_HOLD_MS)
    expect(arena.balls[0].stuck).toBe(false)
    expect(arena.balls[0].serving).toBe(false)
    // 위로 나간다.
    expect(arena.balls[0].dy).toBeLessThan(0)
  })

  it('발사 입력으로 서브를 앞당길 수 없다 — 계속 눌러도 같은 스텝에 나간다', () => {
    const spam = makeArena()
    const quiet = makeArena()
    const FIRE = input({ firePressed: true, fireHeld: true })

    let spamLaunchStep = -1
    let quietLaunchStep = -1
    for (let i = 1; i <= 200; i += 1) {
      spam.step(FIRE)
      quiet.step(NEUTRAL_INPUT)
      if (spamLaunchStep < 0 && !spam.balls[0].stuck) spamLaunchStep = i
      if (quietLaunchStep < 0 && !quiet.balls[0].stuck) quietLaunchStep = i
    }
    expect(spamLaunchStep).toBeGreaterThan(0)
    expect(spamLaunchStep).toBe(quietLaunchStep)
    // 발사 시각은 정확히 SERVE_HOLD_MS 를 넘긴 첫 스텝이다.
    expect((spamLaunchStep - 1) * STEP_MS).toBeLessThan(SERVE_HOLD_MS)
    expect(spamLaunchStep * STEP_MS).toBeGreaterThanOrEqual(SERVE_HOLD_MS)
    // 발사 후 방향까지 같아야 한다 — 발사 버튼이 서브에 어떤 영향도 주지 않는다.
    expect(spam.balls[0].dx).toBe(quiet.balls[0].dx)
    expect(spam.balls[0].dy).toBe(quiet.balls[0].dy)
  })

  /**
   * ⚠ 엔진 버그로 보임 — 이 테스트는 일부러 실패한 채로 둔다.
   *
   * engine.ts 의 serveBall() 은 launchRng.range(-38, 38) 로 서브 각도를 뽑아
   * ball.dx/dy 에 넣지만, 1200ms 뒤 launchBall() 이 stuckOffset(서브 때는 항상 0)
   * 으로 각도를 다시 계산해 그 값을 덮어쓴다. 그래서 모든 서브가 정확히 수직(0도)
   * 으로 나가고, 참가자별 'serve' 난수 스트림(participantSeed)은 아무 데도 쓰이지 않는다.
   */
  it('서브 각도는 seed 난수 스트림에서 나온다 (±38도, 참가자마다 다르다)', () => {
    const angles = ['a', 'b', 'c', 'd', 'e', 'f'].map((pid) => {
      const arena = makeArena({}, 'auto', pid)
      const drawn = Math.atan2(arena.balls[0].dx, -arena.balls[0].dy) * (180 / Math.PI)
      for (let i = 0; i < Math.ceil(SERVE_HOLD_MS / STEP_MS); i += 1) arena.step()
      const ball = arena.balls[0]
      expect(ball.stuck).toBe(false)
      return { pid, drawn, launched: Math.atan2(ball.dx, -ball.dy) * (180 / Math.PI) }
    })
    for (const a of angles) expect(Math.abs(a.launched)).toBeLessThanOrEqual(38 + 1e-9)

    // 뽑은 각도는 참가자마다 다르다 — 난수 스트림 자체는 잘 갈린다.
    expect(new Set(angles.map((a) => a.drawn.toFixed(6))).size).toBeGreaterThan(1)

    // 실제로 나간 각도도 그래야 한다. 전원이 정확히 0도면 난수 각도가 버려진 것이다.
    expect(
      new Set(angles.map((a) => a.launched.toFixed(6))).size,
      `서브 각도가 전부 같다 — 뽑힌 각도 [${angles.map((a) => a.drawn.toFixed(1)).join(', ')}] / ` +
        `실제 발사 각도 [${angles.map((a) => a.launched.toFixed(1)).join(', ')}]`,
    ).toBeGreaterThan(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 벽 반사
// ────────────────────────────────────────────────────────────────────────────

describe('벽 반사', () => {
  it('왼쪽 벽에 닿으면 dx 부호가 바뀌고 경기장 밖으로 나가지 않는다', () => {
    const arena = makeArena()
    const ball = placeBall(arena, 160, 200, -0.98, -0.2)
    let flipAtX: number | null = null
    let prevDx = ball.dx
    let minX = Number.POSITIVE_INFINITY

    for (let i = 0; i < 120; i += 1) {
      arena.step()
      const b = arena.balls[0]
      expect(b).toBeDefined()
      minX = Math.min(minX, b.x)
      expect(b.x).toBeGreaterThanOrEqual(PLAY_LEFT)
      expect(b.x).toBeLessThanOrEqual(PLAY_RIGHT)
      expect(b.y).toBeGreaterThanOrEqual(PLAY_TOP)
      if (flipAtX === null && prevDx < 0 && b.dx > 0) flipAtX = b.x
      prevDx = b.dx
    }
    // 반사가 실제로 일어났고, 벽에 닿은 자리에서 일어났다 (안전 클램프로 밀린 것이 아니다).
    expect(flipAtX).not.toBeNull()
    expect(flipAtX as number).toBeLessThan(PLAY_LEFT + RADIUS + 4)
    // 벽을 파고들지 않았다.
    expect(minX).toBeGreaterThanOrEqual(PLAY_LEFT + RADIUS - 0.1)
  })

  it('오른쪽 벽·천장에서도 같은 축만 뒤집힌다', () => {
    const right = makeArena()
    const rb = placeBall(right, 160, 200, 0.98, -0.2)
    const beforeDy = rb.dy
    for (let i = 0; i < 120 && rb.dx > 0; i += 1) right.step()
    expect(rb.dx).toBeLessThan(0)
    expect(Math.sign(rb.dy)).toBe(Math.sign(beforeDy)) // y 방향은 그대로
    expect(rb.x).toBeLessThanOrEqual(PLAY_RIGHT)

    const top = makeArena()
    // 벽돌을 모두 치워 천장까지 그냥 올라가게 한다.
    for (const brick of top.level.bricks) brick.alive = false
    top.level.aliveCount = 2 // 판 클리어가 끼어들지 않게 살아 있는 척만 한다
    const tb = placeBall(top, 160, 200, 0.2, -0.98)
    for (let i = 0; i < 120 && tb.dy < 0; i += 1) top.step()
    expect(tb.dy).toBeGreaterThan(0)
    expect(tb.dx).toBeGreaterThan(0)
    expect(tb.y).toBeGreaterThanOrEqual(PLAY_TOP)
  })

  it('1000스텝을 돌려도 어떤 공도 경기장 밖으로 나가지 않는다', () => {
    const arena = makeArena()
    for (let i = 0; i < 1000; i += 1) {
      const b = arena.balls[0]
      arena.step(input({ pointerX: b ? b.x - 6 : null }))
      for (const ball of arena.balls) {
        expect(ball.x).toBeGreaterThanOrEqual(PLAY_LEFT)
        expect(ball.x).toBeLessThanOrEqual(PLAY_RIGHT)
        expect(ball.y).toBeGreaterThanOrEqual(PLAY_TOP)
      }
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 패들 반사각
// ────────────────────────────────────────────────────────────────────────────

describe('패들 반사각', () => {
  /** 패들 중심에서 ratio(-1 ~ 1) 만큼 떨어진 곳에 공을 떨어뜨리고 반사 후 방향을 돌려준다. */
  function dropOnPaddle(ratio: number): Ball {
    const arena = makeArena()
    const half = arena.paddleWidth / 2
    const ball = placeBall(arena, arena.paddleX + half * ratio, ARENA.paddleY - RADIUS - 2, 0, 1)
    arena.step()
    expect(arena.balls).toHaveLength(1)
    expect(ball.dy).toBeLessThan(0) // 반드시 위로 튄다
    return ball
  }

  it('한가운데로 떨어뜨리면 거의 수직으로 튄다', () => {
    const ball = dropOnPaddle(0)
    expect(Math.abs(ball.dx)).toBeLessThan(0.02)
    expect(ball.dy).toBeCloseTo(-1, 3)
  })

  it('오른쪽 끝으로 떨어뜨리면 dx > 0 이고 각도가 크다', () => {
    const ball = dropOnPaddle(0.9)
    expect(ball.dx).toBeGreaterThan(0.5)
    const deg = Math.atan2(ball.dx, -ball.dy) * (180 / Math.PI)
    expect(deg).toBeGreaterThan(45)
  })

  it('왼쪽 끝은 반대 부호로 같은 크기의 각도', () => {
    const left = dropOnPaddle(-0.9)
    const right = dropOnPaddle(0.9)
    expect(left.dx).toBeLessThan(-0.5)
    expect(left.dx).toBeCloseTo(-right.dx, 9)
    expect(left.dy).toBeCloseTo(right.dy, 9)
  })

  it('맞은 위치가 중심에서 멀수록 각도가 단조증가한다', () => {
    const degs = [0, 0.25, 0.5, 0.75, 1].map((r) => {
      const b = dropOnPaddle(r)
      return Math.atan2(b.dx, -b.dy) * (180 / Math.PI)
    })
    for (let i = 1; i < degs.length; i += 1) expect(degs[i]).toBeGreaterThan(degs[i - 1])
    // 방향 벡터는 항상 길이 1 을 유지한다 (속도는 경기장이 따로 관리한다).
    expect(degs[degs.length - 1]).toBeLessThanOrEqual(70 + 1e-9)
  })

  it('반사해도 방향 벡터의 길이는 1 이다', () => {
    for (const r of [-1, -0.4, 0, 0.4, 1]) {
      const b = dropOnPaddle(r)
      expect(Math.hypot(b.dx, b.dy)).toBeCloseTo(1, 12)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 수평 왕복 방지
// ────────────────────────────────────────────────────────────────────────────

describe('수평 왕복 방지', () => {
  it('거의 수평인 공이 벽에 반사되면 수직 성분이 되살아난다', () => {
    const arena = makeArena()
    const ball = placeBall(arena, 160, 300, Math.sqrt(1 - 0.02 * 0.02), 0.02)
    expect(Math.abs(ball.dy)).toBeCloseTo(0.02, 6)

    // 오른쪽 벽까지 보낸다.
    for (let i = 0; i < 200 && ball.dx > 0; i += 1) arena.step()
    expect(ball.dx).toBeLessThan(0) // 반사됐다

    // MIN_VERTICAL_RATIO 로 다시 세운다. 엔진은 (dx, ±MIN) 을 다시 정규화하므로
    // 실제 값은 MIN / hypot(dx, MIN) ≈ 0.9902 × MIN 이 된다 — 그 오차까지만 허용한다.
    expect(Math.abs(ball.dy)).toBeGreaterThan(MIN_VERTICAL_RATIO * 0.98)
    expect(Math.abs(ball.dy)).toBeGreaterThan(0.02 * 5)
    expect(Math.hypot(ball.dx, ball.dy)).toBeCloseTo(1, 12)
  })

  it('2000스텝을 돌려도 dy 가 계속 0 근처에 머물지 않는다', () => {
    const arena = makeArena()
    const ball = placeBall(arena, 160, 300, Math.sqrt(1 - 0.02 * 0.02), 0.02)
    const id = ball.id

    let maxAbsDy = 0
    let nearHorizontalSteps = 0
    let yMin = Number.POSITIVE_INFINITY
    let yMax = Number.NEGATIVE_INFINITY
    let alive = 0

    for (let i = 0; i < 2000; i += 1) {
      arena.step()
      const b = arena.balls.find((x) => x.id === id)
      if (!b) break // 이 공이 바닥으로 사라지면 추적 종료
      alive += 1
      maxAbsDy = Math.max(maxAbsDy, Math.abs(b.dy))
      if (Math.abs(b.dy) < 0.05) nearHorizontalSteps += 1
      yMin = Math.min(yMin, b.y)
      yMax = Math.max(yMax, b.y)
    }

    expect(maxAbsDy).toBeGreaterThan(MIN_VERTICAL_RATIO * 0.98)
    // 거의 수평인 상태는 첫 벽 반사까지의 짧은 구간뿐이어야 한다.
    expect(nearHorizontalSteps).toBeLessThan(alive / 2)
    expect(nearHorizontalSteps * STEP_MS).toBeLessThan(2_000)
    // 위아래로 실제로 움직였다 — 한 높이에서 좌우로만 튀지 않았다.
    expect(yMax - yMin).toBeGreaterThan(50)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 패들 끼임 방지
// ────────────────────────────────────────────────────────────────────────────

describe('패들 끼임 방지', () => {
  it('패들 사각형 안쪽에 놓인 공은 다음 스텝에 패들 밖 위쪽으로 나온다', () => {
    const arena = makeArena()
    const ball = placeBall(arena, arena.paddleX, ARENA.paddleY + ARENA.paddleHeight / 2, 0, 1)
    arena.step()

    expect(arena.balls).toHaveLength(1)
    expect(ball.dy).toBeLessThan(0)
    expect(ball.y + RADIUS).toBeLessThanOrEqual(ARENA.paddleY)
  })

  it('패들 안쪽 어느 자리에 놓아도, 어느 방향이어도 빠져나온다', () => {
    const offsets = [-0.9, -0.5, 0, 0.5, 0.9]
    const dirs: Array<[number, number]> = [
      [0, 1],
      [0, -1],
      [1, 0.2],
      [-1, 0.2],
      [1, -0.2],
      [-1, -0.2],
    ]
    for (const off of offsets) {
      for (const [dx, dy] of dirs) {
        const arena = makeArena()
        const half = arena.paddleWidth / 2
        const ball = placeBall(
          arena,
          arena.paddleX + half * off,
          ARENA.paddleY + ARENA.paddleHeight / 2,
          dx,
          dy,
        )
        const tag = `off=${off} dir=${dx},${dy}`
        // 위로 가는 공은 튕기지 않고 그대로 빠져나가면 된다. 각도가 얕으면
        // 빠져나오는 데 여러 스텝이 걸리므로 1/3초(40스텝) 의 여유를 준다.
        let escaped = false
        for (let i = 0; i < 40 && !escaped; i += 1) {
          arena.step()
          const cur = arena.balls.find((x) => x.id === ball.id)
          escaped = !!cur && cur.dy < 0 && cur.y + RADIUS <= ARENA.paddleY
        }
        const b = arena.balls.find((x) => x.id === ball.id)
        expect(b, `${tag} — 공이 사라졌다`).toBeDefined()
        expect(escaped, `${tag} — 패들 안에 끼였다 (y=${(b as Ball)?.y}, dy=${(b as Ball)?.dy})`).toBe(
          true,
        )
      }
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 관통 방지
// ────────────────────────────────────────────────────────────────────────────

describe('빠른 공의 벽돌 관통', () => {
  it('한 스텝에 벽돌 두 줄을 건너뛸 속도로도 벽돌이 실제로 줄어든다', () => {
    const fast = makeArena({ ballBaseSpeed: 4000, ballMaxSpeed: 4000, ballAccelPerMinute: 0 })
    // 한 스텝 이동량이 벽돌 높이(12)의 두 배를 넘는지 먼저 확인한다.
    const perStep = fast.ballSpeed / (1000 / STEP_MS)
    expect(perStep).toBeGreaterThan(ARENA.brickHeight * 2)

    const before = fast.level.aliveCount
    placeBall(fast, 160, 150, 0, -1) // 벽돌 맨 아랫줄 바로 밑에서 위로
    fast.step()

    expect(fast.level.aliveCount).toBeLessThan(before)
    expect(fast.score).toBeGreaterThan(0)
  })

  it('벽돌을 뚫고 지나가지 않고 그 자리에서 튕겨 나온다', () => {
    const fast = makeArena({ ballBaseSpeed: 4000, ballMaxSpeed: 4000, ballAccelPerMinute: 0 })
    const bottom = ARENA.brickTop + fast.level.rows * (fast.level.brickH + ARENA.brickGap)
    placeBall(fast, 160, 150, 0, -1)
    fast.step()
    const ball = fast.balls[0]
    expect(ball).toBeDefined()
    // 위로 쐈는데 아래로 되돌아오고 있어야 한다 — 관통했다면 계속 위로 갔을 것이다.
    expect(ball.dy).toBeGreaterThan(0)
    expect(ball.y).toBeGreaterThan(bottom - ARENA.brickHeight)
  })

  it('아주 빠른 공을 패들로 계속 받아치면 벽돌이 꾸준히 줄어든다', () => {
    const fast = makeArena({ ballBaseSpeed: 4000, ballMaxSpeed: 4000, ballAccelPerMinute: 0 })
    const before = fast.level.aliveCount
    placeBall(fast, 160, 150, 0.3, -1)
    for (let i = 0; i < 120; i += 1) fast.step(input({ pointerX: fast.balls[0]?.x ?? null }))
    expect(before - fast.level.aliveCount).toBeGreaterThanOrEqual(3)
  })

  it('보통 속도의 공도 벽돌 줄을 통과해 지나가지 않는다', () => {
    const arena = makeArena()
    const before = arena.level.aliveCount
    placeBall(arena, 160, 150, 0, -1)
    for (let i = 0; i < 60; i += 1) arena.step()
    // 벽돌이 줄었고, 공은 여전히 벽돌 아래(또는 반사돼 내려오는 중)에 있다.
    expect(arena.level.aliveCount).toBeLessThan(before)
    expect(arena.balls[0]?.y ?? 999).toBeGreaterThan(ARENA.brickTop)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 프레임 속도 무관 · 결정성
// ────────────────────────────────────────────────────────────────────────────

/** 공을 계속 따라가는 결정적 입력 — 상태만 보고 만들어 매 실행에서 똑같다. */
function trackingInput(arena: Arena): ArenaInput {
  const ball = arena.balls[0]
  return {
    pointerX: ball ? ball.x - 6 : null,
    direction: 0,
    firePressed: false,
    fireHeld: false,
  }
}

function runSteps(arena: Arena, n: number): void {
  for (let i = 0; i < n; i += 1) arena.step(trackingInput(arena))
}

function snapshot(arena: Arena): unknown {
  return {
    simTimeMs: arena.simTimeMs,
    stepCount: arena.stepCount,
    score: arena.score,
    lives: arena.lives,
    wave: arena.wave,
    wavesCleared: arena.wavesCleared,
    bricksDestroyed: arena.bricksDestroyed,
    aliveBricks: arena.level.aliveCount,
    paddleX: arena.paddleX,
    paddleWidth: arena.paddleWidth,
    capsules: arena.capsules.map((c) => [c.id, c.x, c.y, c.kind]),
    balls: arena.balls.map((b) => [b.id, b.x, b.y, b.dx, b.dy, b.stuck]),
  }
}

describe('프레임 속도 무관', () => {
  it('3600스텝을 한 번에 돌린 것과 여러 덩어리로 나눠 돌린 것이 완전히 같다', () => {
    const whole = makeArena()
    runSteps(whole, 3600)

    const chunked = makeArena()
    for (const n of [1, 7, 120, 1, 952, 2000, 519]) runSteps(chunked, n)
    expect(chunked.stepCount).toBe(3600)

    expect(snapshot(chunked)).toEqual(snapshot(whole))
    // 30초를 실제로 "플레이"했는지 확인 — 빈 상태를 비교하고 끝내지 않는다.
    expect(whole.score).toBeGreaterThan(0)
    expect(whole.simTimeMs).toBeCloseTo(3600 * STEP_MS, 9)
  })
})

describe('결정적 재현', () => {
  it('같은 seed·설정·입력이면 100스텝마다 공 좌표와 점수가 정확히 일치한다', () => {
    const a = makeArena({}, 'manual', 'a', 'REPEAT')
    const b = makeArena({}, 'manual', 'a', 'REPEAT')

    for (let i = 0; i < 3600; i += 1) {
      runSteps(a, 1)
      runSteps(b, 1)
      if ((i + 1) % 100 === 0) {
        expect(
          b.balls.map((x) => [x.id, x.x, x.y, x.dx, x.dy]),
          `${i + 1}스텝에서 공 상태가 갈렸다`,
        ).toEqual(a.balls.map((x) => [x.id, x.x, x.y, x.dx, x.dy]))
        expect(b.score, `${i + 1}스텝에서 점수가 갈렸다`).toBe(a.score)
        expect(b.level.aliveCount).toBe(a.level.aliveCount)
      }
    }
    expect(a.score).toBeGreaterThan(0)
  })

  it('seed 가 다르면 벽돌·아이템 배치가 달라진다', () => {
    const a = makeArena({}, 'manual', 'a', 'SEED-A')
    const b = makeArena({}, 'manual', 'a', 'SEED-B')
    const layout = (arena: Arena) => arena.level.bricks.map((x) => x.item ?? '-').join('')
    expect(layout(b)).not.toEqual(layout(a))
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 점수
// ────────────────────────────────────────────────────────────────────────────

/** 지정한 벽돌만 남기고(+판 클리어를 막을 예비 벽돌 하나) 나머지를 죽인다. */
function keepOnly(arena: Arena, target: Brick, spare: Brick): void {
  for (const brick of arena.level.bricks) {
    brick.alive = brick === target || brick === spare
  }
  arena.level.aliveCount = 2
}

/** 벽돌 바로 밑에서 위로 쏴, 벽돌 상태가 바뀔 때까지 돌리고 점수 변화를 돌려준다. */
function shootUp(arena: Arena, brick: Brick, maxSteps = 200): number {
  const before = arena.score
  const hpBefore = brick.hp
  placeBall(arena, brick.x + brick.w / 2, brick.y + brick.h + 12, 0, -1)
  for (let i = 0; i < maxSteps; i += 1) {
    arena.step()
    if (brick.hp !== hpBefore || !brick.alive) break
  }
  return arena.score - before
}

describe('벽돌 점수', () => {
  it('내구도 1 벽돌을 부수면 BRICK_TYPES 의 breakScore 만큼 오른다', () => {
    const arena = makeArena()
    const target = arena.level.bricks.find((b) => BRICK_TYPES[b.typeId].durability === 1 && b.col === 5)
    const spare = arena.level.bricks.find((b) => b !== target && b.col === 0)
    expect(target).toBeDefined()
    expect(spare).toBeDefined()
    keepOnly(arena, target as Brick, spare as Brick)

    const def = BRICK_TYPES[(target as Brick).typeId]
    const gained = shootUp(arena, target as Brick)

    expect((target as Brick).alive).toBe(false)
    expect(gained).toBe(def.breakScore)
    expect(arena.bricksDestroyed).toBe(1)
    expect(arena.level.aliveCount).toBe(1)
  })

  it('내구도 2 벽돌은 첫 타격에 hitScore, 부술 때 breakScore 를 준다', () => {
    const arena = makeArena()
    const target = arena.level.bricks.find((b) => BRICK_TYPES[b.typeId].durability === 2 && b.col === 5)
    const spare = arena.level.bricks.find((b) => b !== target && b.col === 0)
    expect(target).toBeDefined()
    keepOnly(arena, target as Brick, spare as Brick)

    const def = BRICK_TYPES[(target as Brick).typeId]
    const first = shootUp(arena, target as Brick)
    expect((target as Brick).alive).toBe(true)
    expect((target as Brick).hp).toBe(def.durability - 1)
    expect(first).toBe(def.hitScore)

    const second = shootUp(arena, target as Brick)
    expect((target as Brick).alive).toBe(false)
    expect(second).toBe(def.breakScore)
    expect(arena.score).toBe(def.hitScore + def.breakScore)
  })

  it('죽은 벽돌은 다시 점수를 주지 않는다', () => {
    const arena = makeArena()
    const target = arena.level.bricks.find((b) => BRICK_TYPES[b.typeId].durability === 1 && b.col === 5)
    const spare = arena.level.bricks.find((b) => b !== target && b.col === 0)
    keepOnly(arena, target as Brick, spare as Brick)
    shootUp(arena, target as Brick)

    const after = arena.score
    placeBall(arena, (target as Brick).x + (target as Brick).w / 2, (target as Brick).y + 40, 0, -1)
    for (let i = 0; i < 60; i += 1) arena.step()
    expect(arena.score).toBe(after)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 판 클리어
// ────────────────────────────────────────────────────────────────────────────

describe('판 클리어', () => {
  it('벽돌이 모두 사라지면 WAVE_CLEAR_BONUS 를 주고 새 판이 생긴다', () => {
    const arena = makeArena()
    const firstLayout = arena.level.bricks.map((b) => b.typeId).join(',')
    for (const brick of arena.level.bricks) brick.alive = false
    arena.level.aliveCount = 0

    const before = arena.score
    arena.step()

    expect(arena.score - before).toBe(WAVE_CLEAR_BONUS)
    expect(arena.wavesCleared).toBe(1)
    expect(arena.wave).toBe(2)
    expect(arena.level.aliveCount).toBeGreaterThan(0)
    expect(arena.level.bricks.every((b) => b.alive)).toBe(true)
    // 배치는 그대로, 아이템만 새로 뽑힌다.
    expect(arena.level.bricks.map((b) => b.typeId).join(',')).toBe(firstLayout)
  })

  it('판 클리어 보너스는 한 판에 한 번만 붙는다', () => {
    const arena = makeArena()
    for (const brick of arena.level.bricks) brick.alive = false
    arena.level.aliveCount = 0
    arena.step()
    const after = arena.score
    arena.step()
    arena.step()
    expect(arena.score).toBe(after)
    expect(arena.wavesCleared).toBe(1)
  })
})
