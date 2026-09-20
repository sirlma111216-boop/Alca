/**
 * 한 참가자의 경기장 시뮬레이션.
 *
 * - DOM·React·오디오를 전혀 모른다. 렌더러가 상태를 읽어 그릴 뿐이다.
 * - 항상 1/120초 고정 스텝으로만 전진한다. 실시간이 아니라 시뮬레이션 시간이 기준이다.
 * - 같은 seed·설정·입력이면 몇 번을 돌려도 같은 결과가 나온다.
 */

import {
  ARENA,
  BRICK_TYPES,
  MANUAL_PADDLE_SPEED,
  MAX_BOUNCE_ANGLE_DEG,
  MIN_VERTICAL_RATIO,
  PLAY_LEFT,
  PLAY_RIGHT,
  PLAY_TOP,
  SERVE_HOLD_MS,
  SHIELD_Y,
  STEP_MS,
  STEP_SECONDS,
  WAVE_CLEAR_BONUS,
} from './config'
import type { DifficultySettings, GameMode, ItemKind } from './contract'
import { ITEM_KINDS } from './contract'
import { DEG, clamp, normalize, rectsOverlap, sweepCircleRect } from './geometry'
import type { Brick, Level } from './level'
import { brickIndexAt, createLevel, levelBottom } from './level'
import type { ArenaEffects } from './items'
import {
  applyItemEffect,
  createEffects,
  expireEffects,
  isCatchActive,
  isExpandActive,
  isLaserActive,
  isSlowActive,
  resetEffects,
} from './items'
import type { Rng } from './rng'
import { createRng, matchSeedFor, participantSeed } from './rng'

// ────────────────────────────────────────────────────────────────────────────
// 상태 모양
// ────────────────────────────────────────────────────────────────────────────

export interface Ball {
  id: number
  x: number
  y: number
  /** 단위 방향 벡터. 속도는 경기장 전체의 현재 속도와 슬로우 배율에서 온다. */
  dx: number
  dy: number
  /** 패들에 붙어 있는지. */
  stuck: boolean
  /** 붙었을 때 패들 중심으로부터의 x 오프셋. */
  stuckOffset: number
  /** 붙은 시각(ms). */
  stuckSince: number
  /** 경기 시작/목숨 손실 직후의 서브 상태인지. 서브는 발사 버튼으로 앞당길 수 없다. */
  serving: boolean
}

export interface Capsule {
  id: number
  x: number
  y: number
  kind: ItemKind
}

export interface Bullet {
  id: number
  x: number
  y: number
}

export type ArenaEventType =
  | 'brick-hit'
  | 'brick-break'
  | 'paddle-hit'
  | 'wall-hit'
  | 'ball-launch'
  | 'ball-catch'
  | 'item-spawn'
  | 'item-collect'
  | 'item-miss'
  | 'item-expire'
  | 'laser-fire'
  | 'shield-bounce'
  | 'life-lost'
  | 'wave-clear'
  | 'game-over'

export interface ArenaEvent {
  type: ArenaEventType
  /** 시뮬레이션 시각(ms). */
  at: number
  x: number
  y: number
  /** 아이템 관련 이벤트의 종류. */
  kind?: ItemKind
  /** 점수 변화가 있으면 그 값. */
  score?: number
  /** 벽돌 색(연출용). */
  color?: string
}

/** 한 스텝에 엔진에 들어가는 조작 입력. */
export interface ArenaInput {
  /** 마우스/터치로 지정한 절대 x (논리 좌표). null 이면 방향키만 쓴다. */
  pointerX: number | null
  /** 키보드 방향. -1 왼쪽, 0 정지, 1 오른쪽. */
  direction: -1 | 0 | 1
  /** 이번 스텝에 발사가 새로 눌렸는지(엣지 입력). */
  firePressed: boolean
  /** 발사를 누르고 있는지(레이저 연사용). */
  fireHeld: boolean
}

export const NEUTRAL_INPUT: ArenaInput = {
  pointerX: null,
  direction: 0,
  firePressed: false,
  fireHeld: false,
}

export interface ArenaOptions {
  participantId: string
  nickname: string
  /** 화면 배치용 인덱스. 시뮬레이션에는 전혀 쓰이지 않는다. */
  index: number
  seed: string
  mode: GameMode
  difficulty: DifficultySettings
}

const MAX_EVENT_BUFFER = 512
const MAX_SWEEP_ITERATIONS = 6

// ────────────────────────────────────────────────────────────────────────────
// 경기장
// ────────────────────────────────────────────────────────────────────────────

export class Arena {
  readonly participantId: string
  readonly nickname: string
  readonly index: number
  readonly mode: GameMode
  readonly difficulty: DifficultySettings

  level: Level
  balls: Ball[] = []
  capsules: Capsule[] = []
  bullets: Bullet[] = []
  effects: ArenaEffects = createEffects()

  /** 패들 중심 x. */
  paddleX: number
  /** 현재 패들 너비 (확장 반영). */
  paddleWidth: number

  score = 0
  lives: number
  bricksDestroyed = 0
  wave = 1
  wavesCleared = 0
  /** 시뮬레이션 시간(ms). 스텝 수 × STEP_MS 와 정확히 같다. */
  simTimeMs = 0
  stepCount = 0
  /** 목숨을 모두 잃었는지. 이 뒤에도 시간은 흐르지만 점수는 늘지 않는다. */
  gameOver = false
  /** 목숨을 모두 잃은 시각(ms). 실제 플레이 시간 계산에 쓴다. */
  gameOverAt: number | null = null
  /**
   * 벽돌을 처음으로 전부 깬 시각(ms). 한 번도 못 깼으면 null.
   * "다 깰 때까지" 경기 방식에서 경기를 끝내는 신호이자 순위를 가르는 값이다.
   */
  firstClearAt: number | null = null

  /** 아이템 통계 — 떨어진 횟수와 실제로 받은 횟수. */
  readonly itemStats: Record<ItemKind, { dropped: number; collected: number }>

  /** 자동 경기 패들이 쓰는 난수 스트림. 직접 조작 모드에서는 쓰이지 않는다. */
  readonly behaviorRng: Rng
  /** 서브 각도용 난수. 직접 조작 모드에서는 매치 seed 만 써서 전원 동일하다. */
  private readonly launchRng: Rng

  private readonly seed: string
  private events: ArenaEvent[] = []
  private nextBallId = 1
  private nextCapsuleId = 1
  private nextBulletId = 1
  private lastPointerX: number | null = null

  constructor(options: ArenaOptions) {
    this.participantId = options.participantId
    this.nickname = options.nickname
    this.index = options.index
    this.mode = options.mode
    this.difficulty = options.difficulty
    this.seed = options.seed

    this.lives = options.difficulty.lives
    this.paddleWidth = options.difficulty.paddleWidth
    this.paddleX = ARENA.width / 2

    this.level = createLevel(options.seed, 1, options.difficulty)

    // 직접 조작 모드는 전원 같은 판·같은 서브 각도를 써야 하므로 참가자 salt 를 섞지 않는다.
    this.launchRng = createRng(
      options.mode === 'manual'
        ? matchSeedFor(options.seed, 'serve')
        : participantSeed(options.seed, options.participantId, 'serve'),
    )
    this.behaviorRng = createRng(participantSeed(options.seed, options.participantId, 'auto'))

    this.itemStats = ITEM_KINDS.reduce(
      (acc, k) => {
        acc[k] = { dropped: 0, collected: 0 }
        return acc
      },
      {} as Record<ItemKind, { dropped: number; collected: number }>,
    )

    this.serveBall()
  }

  // ── 조회 ──────────────────────────────────────────────────────────────────

  /** 가속을 반영한 현재 "정상" 속도. 슬로우는 여기에 배율로 곱해진다. */
  get normalSpeed(): number {
    const d = this.difficulty
    const minutes = this.simTimeMs / 60_000
    return Math.min(d.ballMaxSpeed, d.ballBaseSpeed * (1 + d.ballAccelPerMinute * minutes))
  }

  /** 슬로우까지 반영한 실제 속도. */
  get ballSpeed(): number {
    const slow = isSlowActive(this.effects, this.simTimeMs) ? this.difficulty.items.slowFactor : 1
    return Math.max(40, this.normalSpeed * slow)
  }

  get aliveBricks(): number {
    return this.level.aliveCount
  }

  /** 렌더러가 소비할 이벤트를 꺼낸다. 시뮬레이션에는 영향이 없다. */
  drainEvents(): ArenaEvent[] {
    if (this.events.length === 0) return []
    const out = this.events
    this.events = []
    return out
  }

  /**
   * 재현 로그 수집용 출구. 렌더러의 drainEvents() 와 독립적이라
   * 둘이 서로의 이벤트를 빼앗지 않는다.
   */
  eventSink: ((event: ArenaEvent) => void) | null = null

  private emit(event: ArenaEvent): void {
    if (this.events.length >= MAX_EVENT_BUFFER) this.events.shift()
    this.events.push(event)
    this.eventSink?.(event)
  }

  // ── 한 스텝 전진 ──────────────────────────────────────────────────────────

  /**
   * 정확히 1/120초를 전진시킨다.
   * @param input 직접 조작 모드의 입력. 자동 경기에서는 autopilot 이 만든 입력이 들어온다.
   */
  step(input: ArenaInput = NEUTRAL_INPUT): void {
    this.stepCount += 1
    this.simTimeMs = this.stepCount * STEP_MS
    const now = this.simTimeMs

    this.updateEffects(now)
    this.updatePaddle(input)
    this.updateStuckBalls(now, input)
    this.updateLaser(now, input)
    this.updateBullets()
    this.updateCapsules(now)
    if (!this.gameOver) this.updateBalls(now)
    this.checkLifeLoss(now)
    this.checkWaveClear(now)
  }

  // ── 효과 ──────────────────────────────────────────────────────────────────

  private updateEffects(now: number): void {
    const expired = expireEffects(this.effects, now)
    for (const kind of expired) {
      this.emit({ type: 'item-expire', at: now, x: this.paddleX, y: ARENA.paddleY, kind })
      // 캐치가 끝나면 붙어 있던 공을 전부 정상 발사한다.
      if (kind === 'catch') this.launchStuckBalls(now, true)
    }
    const targetWidth = Math.min(
      this.difficulty.paddleMaxWidth,
      isExpandActive(this.effects, now)
        ? this.difficulty.paddleWidth * this.difficulty.items.expandFactor
        : this.difficulty.paddleWidth,
    )
    if (targetWidth !== this.paddleWidth) {
      this.paddleWidth = targetWidth
      this.clampPaddle()
    }
  }

  // ── 패들 ──────────────────────────────────────────────────────────────────

  private updatePaddle(input: ArenaInput): void {
    if (input.pointerX !== null && input.pointerX !== this.lastPointerX) {
      this.paddleX = input.pointerX
      this.lastPointerX = input.pointerX
    } else if (input.direction !== 0) {
      const speed = this.mode === 'auto' ? this.difficulty.autoPaddleSpeed : MANUAL_PADDLE_SPEED
      this.paddleX += input.direction * speed * STEP_SECONDS
      this.lastPointerX = null
    } else if (input.pointerX !== null) {
      this.paddleX = input.pointerX
    }
    this.clampPaddle()
  }

  private clampPaddle(): void {
    const half = this.paddleWidth / 2
    this.paddleX = clamp(this.paddleX, PLAY_LEFT + half, PLAY_RIGHT - half)
  }

  // ── 공: 서브와 캐치 ───────────────────────────────────────────────────────

  private serveBall(): void {
    // 서브 각도는 난수 스트림에서 뽑는다. 너무 눕지 않도록 ±38도로 제한.
    const angle = this.launchRng.range(-38, 38) * DEG
    const dir = normalize(Math.sin(angle), -Math.cos(angle))
    this.balls.push({
      id: this.nextBallId++,
      x: this.paddleX,
      y: ARENA.paddleY - ARENA.ballRadius - 0.5,
      dx: dir.dx,
      dy: dir.dy,
      stuck: true,
      stuckOffset: 0,
      stuckSince: this.simTimeMs,
      serving: true,
    })
  }

  private updateStuckBalls(now: number, input: ArenaInput): void {
    const catchActive = isCatchActive(this.effects, now)
    const holdMs = this.difficulty.items.catchHoldMs
    for (const ball of this.balls) {
      if (!ball.stuck) continue
      const half = this.paddleWidth / 2
      ball.stuckOffset = clamp(ball.stuckOffset, -half + 2, half - 2)
      ball.x = this.paddleX + ball.stuckOffset
      ball.y = ARENA.paddleY - ARENA.ballRadius - 0.5

      if (ball.serving) {
        // 서브는 항상 같은 시간에 자동 발사된다 — 발사 버튼으로 앞당길 수 없다.
        if (now - ball.stuckSince >= SERVE_HOLD_MS) this.launchBall(ball, now)
        continue
      }
      // 캐치로 붙은 공: 발사 입력 · 최대 대기 시간 · 효과 종료 중 먼저 오는 것으로 발사.
      if (input.firePressed || now - ball.stuckSince >= holdMs || !catchActive) {
        this.launchBall(ball, now)
      }
    }
  }

  /** 붙어 있는 공을 전부 발사한다. 각 공은 자기 오프셋에 맞는 방향으로 나간다. */
  private launchStuckBalls(now: number, includeServing = false): void {
    for (const ball of this.balls) {
      if (!ball.stuck) continue
      if (ball.serving && !includeServing) continue
      this.launchBall(ball, now)
    }
  }

  private launchBall(ball: Ball, now: number): void {
    // 서브는 serveBall() 이 난수 스트림에서 뽑아 둔 각도를 그대로 쓴다.
    // 캐치로 붙인 공만 "붙은 위치"에 따라 방향이 정해진다.
    if (!ball.serving) {
      const half = Math.max(1, this.paddleWidth / 2)
      const offset = clamp(ball.stuckOffset / half, -1, 1)
      const angle = offset * MAX_BOUNCE_ANGLE_DEG * DEG
      const dir = normalize(Math.sin(angle), -Math.cos(angle))
      ball.dx = dir.dx
      ball.dy = dir.dy
    }
    ball.stuck = false
    ball.serving = false
    ball.y = ARENA.paddleY - ARENA.ballRadius - 1
    this.emit({ type: 'ball-launch', at: now, x: ball.x, y: ball.y })
  }

  // ── 레이저 ────────────────────────────────────────────────────────────────

  private updateLaser(now: number, input: ArenaInput): void {
    if (this.gameOver) return
    if (!isLaserActive(this.effects, now)) return
    if (!input.fireHeld && !input.firePressed) return
    if (now - this.effects.lastLaserAt < this.difficulty.items.laserIntervalMs) return
    this.effects.lastLaserAt = now
    const half = this.paddleWidth / 2
    const y = ARENA.paddleY - ARENA.bulletHeight
    for (const dx of [-half + 2, half - 2]) {
      this.bullets.push({ id: this.nextBulletId++, x: this.paddleX + dx, y })
    }
    this.emit({ type: 'laser-fire', at: now, x: this.paddleX, y })
  }

  private updateBullets(): void {
    if (this.bullets.length === 0) return
    const dy = ARENA.bulletSpeed * STEP_SECONDS
    const remaining: Bullet[] = []
    for (const bullet of this.bullets) {
      bullet.y -= dy
      if (bullet.y + ARENA.bulletHeight < PLAY_TOP) continue
      const brick = this.findBrickAtRect(
        bullet.x - ARENA.bulletWidth / 2,
        bullet.y,
        ARENA.bulletWidth,
        ARENA.bulletHeight,
      )
      if (brick) {
        // 탄환은 피해 1을 주고 사라진다. 벽돌이 이미 죽었다면 여기까지 오지 않는다.
        this.damageBrick(brick, 1, this.simTimeMs)
        continue
      }
      remaining.push(bullet)
    }
    this.bullets = remaining
  }

  // ── 캡슐 ──────────────────────────────────────────────────────────────────

  private updateCapsules(now: number): void {
    if (this.capsules.length === 0) return
    const dy = this.difficulty.items.capsuleSpeed * STEP_SECONDS
    const half = this.paddleWidth / 2
    const remaining: Capsule[] = []
    for (const capsule of this.capsules) {
      capsule.y += dy
      const cx = capsule.x - ARENA.capsuleWidth / 2
      if (
        !this.gameOver &&
        rectsOverlap(
          cx,
          capsule.y,
          ARENA.capsuleWidth,
          ARENA.capsuleHeight,
          this.paddleX - half,
          ARENA.paddleY,
          this.paddleWidth,
          ARENA.paddleHeight,
        )
      ) {
        this.collectItem(capsule.kind, now, capsule.x, capsule.y)
        continue
      }
      if (capsule.y > ARENA.height) {
        this.emit({ type: 'item-miss', at: now, x: capsule.x, y: ARENA.height, kind: capsule.kind })
        continue
      }
      remaining.push(capsule)
    }
    this.capsules = remaining
  }

  /** 패들로 받았을 때만 호출된다. 놓친 캡슐은 아무 효과도 주지 않는다. */
  private collectItem(kind: ItemKind, now: number, x: number, y: number): void {
    this.itemStats[kind].collected += 1
    this.emit({ type: 'item-collect', at: now, x, y, kind })
    const actions = applyItemEffect(this.effects, kind, now, this.difficulty.items)
    for (const action of actions) {
      if (action === 'launch-stuck') this.launchStuckBalls(now)
      else if (action === 'split') this.splitBalls(now)
      else if (action === 'life') {
        this.lives = Math.min(this.difficulty.items.maxLives, this.lives + 1)
      }
    }
  }

  /**
   * 멀티볼 — 움직이는 공 하나를 기준으로 전체가 최대 maxBalls 개가 되도록 나눈다.
   * 무한 증식을 막기 위해 항상 "현재 공 수"를 기준으로 계산한다.
   */
  private splitBalls(now: number): void {
    const max = this.difficulty.items.maxBalls
    const moving = this.balls.filter((b) => !b.stuck)
    if (moving.length === 0) return
    const source = moving[0]
    const spread = [18, -18, 34, -34]
    let spreadIdx = 0
    while (this.balls.length < max && spreadIdx < spread.length) {
      const angle = spread[spreadIdx] * DEG
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const dir = normalize(source.dx * cos - source.dy * sin, source.dx * sin + source.dy * cos)
      this.balls.push({
        id: this.nextBallId++,
        x: source.x,
        y: source.y,
        dx: dir.dx,
        dy: dir.dy,
        stuck: false,
        stuckOffset: 0,
        stuckSince: now,
        serving: false,
      })
      spreadIdx += 1
    }
  }

  // ── 공 이동과 충돌 ────────────────────────────────────────────────────────

  private updateBalls(now: number): void {
    const speed = this.ballSpeed
    const radius = ARENA.ballRadius
    const survivors: Ball[] = []

    for (const ball of this.balls) {
      if (ball.stuck) {
        survivors.push(ball)
        continue
      }
      let remaining = STEP_SECONDS
      let iterations = 0
      let lost = false

      while (remaining > 1e-9 && iterations < MAX_SWEEP_ITERATIONS) {
        iterations += 1
        const vx = ball.dx * speed * remaining
        const vy = ball.dy * speed * remaining

        const hit = this.findEarliestHit(ball, vx, vy, radius)
        if (!hit) {
          ball.x += vx
          ball.y += vy
          break
        }

        ball.x += vx * hit.t
        ball.y += vy * hit.t
        remaining *= 1 - hit.t

        if (hit.target === 'paddle') {
          if (this.bouncePaddle(ball, now)) {
            // 캐치로 붙었다 — 이 스텝의 남은 이동은 없다.
            break
          }
        } else if (hit.target === 'brick' && hit.brick) {
          this.reflect(ball, hit.nx, hit.ny)
          this.damageBrick(hit.brick, 1, now)
        } else if (hit.target === 'shield') {
          this.effects.shieldCharges -= 1
          ball.dy = -Math.abs(ball.dy)
          ball.y = SHIELD_Y - radius - 0.5
          this.emit({ type: 'shield-bounce', at: now, x: ball.x, y: SHIELD_Y })
        } else {
          this.reflect(ball, hit.nx, hit.ny)
          this.emit({ type: 'wall-hit', at: now, x: ball.x, y: ball.y })
        }

        // 충돌면에서 살짝 띄워 같은 면을 다시 잡지 않게 한다.
        ball.x += hit.nx * 0.02
        ball.y += hit.ny * 0.02
      }

      // 패들이 공 위로 움직여 들어와 겹쳤다면 — 위로 밀어내 끼임을 막는다.
      // (공이 위로 가고 있어 쓸기 검사에서 패들을 보지 않은 경우가 여기에 해당한다.)
      if (!ball.stuck && !this.gameOver) {
        const forgive = this.mode === 'manual' ? this.difficulty.manualEdgeForgiveness : 0
        const pw = this.paddleWidth + forgive * 2
        if (
          rectsOverlap(
            ball.x - radius,
            ball.y - radius,
            radius * 2,
            radius * 2,
            this.paddleX - pw / 2,
            ARENA.paddleY,
            pw,
            ARENA.paddleHeight,
          )
        ) {
          this.bouncePaddle(ball, now)
        }
      }

      // 바닥 아래로 나갔는지.
      if (ball.y - radius > ARENA.height) lost = true
      if (!lost) {
        // 안전장치: 어떤 이유로든 경기장 밖으로 나가면 안으로 되돌린다.
        ball.x = clamp(ball.x, PLAY_LEFT + radius, PLAY_RIGHT - radius)
        if (ball.y < PLAY_TOP + radius) ball.y = PLAY_TOP + radius
        survivors.push(ball)
      }
    }
    this.balls = survivors
  }

  private findEarliestHit(
    ball: Ball,
    vx: number,
    vy: number,
    radius: number,
  ): { t: number; nx: number; ny: number; target: 'wall' | 'brick' | 'paddle' | 'shield'; brick?: Brick } | null {
    let best: {
      t: number
      nx: number
      ny: number
      target: 'wall' | 'brick' | 'paddle' | 'shield'
      brick?: Brick
    } | null = null

    const consider = (
      hit: { t: number; nx: number; ny: number } | null,
      target: 'wall' | 'brick' | 'paddle' | 'shield',
      brick?: Brick,
    ): void => {
      if (!hit) return
      if (best === null || hit.t < best.t) best = { ...hit, target, brick }
    }

    // 벽 — 왼쪽·오른쪽·위. 바깥쪽으로 아주 두꺼운 사각형을 둬 항상 잡히게 한다.
    consider(sweepCircleRect(ball.x, ball.y, vx, vy, radius, PLAY_LEFT - 200, -1000, 200, 3000), 'wall')
    consider(sweepCircleRect(ball.x, ball.y, vx, vy, radius, PLAY_RIGHT, -1000, 200, 3000), 'wall')
    consider(sweepCircleRect(ball.x, ball.y, vx, vy, radius, -1000, PLAY_TOP - 200, 3000, 200), 'wall')

    // 벽돌 — 이동 경로를 감싸는 격자 칸만 본다.
    if (this.level.aliveCount > 0) {
      const minX = Math.min(ball.x, ball.x + vx) - radius
      const maxX = Math.max(ball.x, ball.x + vx) + radius
      const minY = Math.min(ball.y, ball.y + vy) - radius
      const maxY = Math.max(ball.y, ball.y + vy) + radius
      if (maxY >= ARENA.brickTop && minY <= levelBottom(this.level)) {
        const c0 = Math.max(0, Math.floor((minX - PLAY_LEFT) / this.level.brickW))
        const c1 = Math.min(this.level.cols - 1, Math.floor((maxX - PLAY_LEFT) / this.level.brickW))
        const rowH = this.level.brickH + ARENA.brickGap
        const r0 = Math.max(0, Math.floor((minY - ARENA.brickTop) / rowH))
        const r1 = Math.min(this.level.rows - 1, Math.floor((maxY - ARENA.brickTop) / rowH))
        for (let r = r0; r <= r1; r += 1) {
          for (let c = c0; c <= c1; c += 1) {
            const brick = this.level.bricks[r * this.level.cols + c]
            if (!brick || !brick.alive) continue
            consider(
              sweepCircleRect(ball.x, ball.y, vx, vy, radius, brick.x, brick.y, brick.w, brick.h),
              'brick',
              brick,
            )
          }
        }
      }
    }

    // 패들 — 직접 조작 모드에서만 가장자리 보정을 준다. 자동 경기는 항상 0.
    if (!this.gameOver && vy > 0) {
      const forgive = this.mode === 'manual' ? this.difficulty.manualEdgeForgiveness : 0
      const width = this.paddleWidth + forgive * 2
      consider(
        sweepCircleRect(
          ball.x,
          ball.y,
          vx,
          vy,
          radius,
          this.paddleX - width / 2,
          ARENA.paddleY,
          width,
          ARENA.paddleHeight,
        ),
        'paddle',
      )
      // 보호막 — 패들보다 아래에 있으므로 패들을 지나친 공만 닿는다.
      if (this.effects.shieldCharges > 0) {
        consider(
          sweepCircleRect(ball.x, ball.y, vx, vy, radius, PLAY_LEFT, SHIELD_Y, PLAY_RIGHT - PLAY_LEFT, 4),
          'shield',
        )
      }
    }

    return best
  }

  /** 패들 반사. 캐치가 켜져 있으면 붙이고 true 를 돌려준다. */
  private bouncePaddle(ball: Ball, now: number): boolean {
    const half = Math.max(1, this.paddleWidth / 2)
    if (isCatchActive(this.effects, now)) {
      ball.stuck = true
      ball.serving = false
      ball.stuckSince = now
      ball.stuckOffset = clamp(ball.x - this.paddleX, -half + 2, half - 2)
      ball.y = ARENA.paddleY - ARENA.ballRadius - 0.5
      this.emit({ type: 'ball-catch', at: now, x: ball.x, y: ball.y })
      return true
    }
    // 맞은 위치에 따라 반사각이 달라진다. 중앙은 수직, 끝은 최대 70도.
    const offset = clamp((ball.x - this.paddleX) / half, -1, 1)
    const angle = offset * MAX_BOUNCE_ANGLE_DEG * DEG
    const dir = normalize(Math.sin(angle), -Math.cos(angle))
    ball.dx = dir.dx
    ball.dy = dir.dy
    ball.y = ARENA.paddleY - ARENA.ballRadius - 0.5
    this.emit({ type: 'paddle-hit', at: now, x: ball.x, y: ARENA.paddleY })
    return false
  }

  private reflect(ball: Ball, nx: number, ny: number): void {
    if (nx !== 0) ball.dx = Math.abs(ball.dx) * nx
    if (ny !== 0) ball.dy = Math.abs(ball.dy) * ny
    // 수평으로 영원히 왕복하지 않도록 수직 성분의 하한을 지킨다.
    if (Math.abs(ball.dy) < MIN_VERTICAL_RATIO) {
      const sign = ball.dy >= 0 ? 1 : -1
      const dir = normalize(ball.dx, sign * MIN_VERTICAL_RATIO)
      ball.dx = dir.dx
      ball.dy = dir.dy
    }
  }

  // ── 벽돌 피해 ─────────────────────────────────────────────────────────────

  /**
   * 벽돌에 피해를 준다. 공과 탄환이 같은 스텝에 같은 벽돌을 맞혀도
   * 먼저 처리된 쪽에서 alive 가 false 가 되므로 점수·캡슐이 중복되지 않는다.
   */
  private damageBrick(brick: Brick, damage: number, now: number): void {
    if (!brick.alive) return
    const def = BRICK_TYPES[brick.typeId]
    brick.hp -= damage
    brick.lastHitAt = now
    if (brick.hp > 0) {
      this.score += def.hitScore
      this.emit({
        type: 'brick-hit',
        at: now,
        x: brick.x + brick.w / 2,
        y: brick.y + brick.h / 2,
        score: def.hitScore,
        color: def.color,
      })
      return
    }
    brick.alive = false
    brick.hp = 0
    this.level.aliveCount -= 1
    this.bricksDestroyed += 1
    this.score += def.breakScore
    this.emit({
      type: 'brick-break',
      at: now,
      x: brick.x + brick.w / 2,
      y: brick.y + brick.h / 2,
      score: def.breakScore,
      color: def.color,
    })
    // 캡슐은 벽돌 하나당 한 번만 나온다.
    if (brick.item && !brick.itemSpawned && this.difficulty.items.enabled) {
      brick.itemSpawned = true
      this.itemStats[brick.item].dropped += 1
      this.capsules.push({
        id: this.nextCapsuleId++,
        x: brick.x + brick.w / 2,
        y: brick.y + brick.h / 2,
        kind: brick.item,
      })
      this.emit({
        type: 'item-spawn',
        at: now,
        x: brick.x + brick.w / 2,
        y: brick.y + brick.h / 2,
        kind: brick.item,
      })
    }
  }

  // ── 목숨과 판 ─────────────────────────────────────────────────────────────

  /**
   * 목숨은 **공이 하나도 남지 않았을 때만** 줄어든다.
   * 멀티볼 중 일부만 떨어진 것으로는 줄어들지 않는다.
   */
  private checkLifeLoss(now: number): void {
    if (this.gameOver) return
    if (this.balls.length > 0) return

    this.lives -= 1
    this.emit({ type: 'life-lost', at: now, x: ARENA.width / 2, y: ARENA.paddleY })

    // 목숨을 잃으면 모든 효과·탄환·낙하 중인 캡슐을 정리하고 기본 패들로 돌아간다.
    resetEffects(this.effects)
    this.capsules = []
    this.bullets = []
    this.paddleWidth = this.difficulty.paddleWidth
    this.clampPaddle()

    if (this.lives <= 0) {
      this.lives = 0
      this.gameOver = true
      this.gameOverAt = now
      this.emit({ type: 'game-over', at: now, x: ARENA.width / 2, y: ARENA.height / 2 })
      return
    }
    this.serveBall()
  }

  /** 벽돌을 다 부수면 보너스를 주고 같은 배치의 다음 판을 연다. */
  private checkWaveClear(now: number): void {
    if (this.gameOver) return
    if (this.level.aliveCount > 0) return
    this.score += WAVE_CLEAR_BONUS
    this.wavesCleared += 1
    this.wave += 1
    // 처음 다 깬 순간만 기록한다. 판이 계속 이어져도 이 값은 바뀌지 않는다.
    if (this.firstClearAt === null) this.firstClearAt = now
    this.emit({
      type: 'wave-clear',
      at: now,
      x: ARENA.width / 2,
      y: ARENA.brickTop,
      score: WAVE_CLEAR_BONUS,
    })
    this.level = createLevel(this.seed, this.wave, this.difficulty)
  }

  // ── 정리 ──────────────────────────────────────────────────────────────────

  /** 경기가 끝났을 때 남은 객체를 비운다. 점수·목숨은 그대로 둔다. */
  finish(): void {
    this.capsules = []
    this.bullets = []
    resetEffects(this.effects)
  }

  /** 사각형과 겹치는 살아 있는 벽돌 하나를 찾는다 (탄환용). */
  private findBrickAtRect(x: number, y: number, w: number, h: number): Brick | null {
    const idx = brickIndexAt(this.level, x + w / 2, y)
    if (idx >= 0) {
      const brick = this.level.bricks[idx]
      if (brick && brick.alive && rectsOverlap(x, y, w, h, brick.x, brick.y, brick.w, brick.h)) {
        return brick
      }
    }
    // 격자 경계에 걸친 경우를 대비해 주변 칸도 본다.
    const rowH = this.level.brickH + ARENA.brickGap
    const c0 = Math.max(0, Math.floor((x - PLAY_LEFT) / this.level.brickW))
    const c1 = Math.min(this.level.cols - 1, Math.floor((x + w - PLAY_LEFT) / this.level.brickW))
    const r0 = Math.max(0, Math.floor((y - ARENA.brickTop) / rowH))
    const r1 = Math.min(this.level.rows - 1, Math.floor((y + h - ARENA.brickTop) / rowH))
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const brick = this.level.bricks[r * this.level.cols + c]
        if (!brick || !brick.alive) continue
        if (rectsOverlap(x, y, w, h, brick.x, brick.y, brick.w, brick.h)) return brick
      }
    }
    return null
  }
}
