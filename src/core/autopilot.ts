/**
 * 자동 경기용 패들 조종기.
 *
 * **모든 참가자가 글자 그대로 같은 정책을 쓴다.** 참가자마다 다른 것은 난수 스트림뿐이고,
 * 오차의 분포(조준 오차 표준편차·빗나갈 확률·반응 지연·이동 속도)는 전원 동일하다.
 * 현재 순위를 보거나 특정 참가자를 밀어 주는 숨겨진 보정은 없다 — 이 파일에는 점수나
 * 순위를 읽는 코드가 아예 없다.
 *
 * 핵심 설계: 공이 내려올 때마다 **패들의 어느 지점으로 받을지**를 한 번 뽑는다.
 * 늘 패들 한가운데로 받으면 공이 수직으로만 오가며 벽돌을 한 개씩만 깨게 된다.
 * 받는 지점을 흩뜨리면 반사각이 다양해져 실제 경기처럼 벽과 벽돌 사이를 누빈다.
 * 빗나갈지 여부도 "공이 내려올 때마다 한 번"만 뽑으므로 난이도의 확률이 그대로 반영된다.
 *
 * 이 결과는 실력 평가가 아니라 "게임으로 진행하는 추첨"이다.
 */

import { ARENA, PLAY_LEFT, PLAY_RIGHT } from './config'
import type { Arena, ArenaInput } from './engine'
import { isCatchActive, isLaserActive } from './items'
import { clamp } from './geometry'

/** 목표 위치에 이 정도까지 가까우면 움직이지 않는다 (덜덜 떨림 방지). */
const DEADZONE = 2.0

/** 받는 지점을 흩뜨리는 폭. 패들 반너비 기준 표준편차. */
const CONTACT_SPREAD = 0.46
/** 받는 지점의 한계 — 이보다 끝으로는 노리지 않는다. */
const CONTACT_LIMIT = 0.82

interface BallPrediction {
  /** 패들 선에 도달할 때의 x. */
  x: number
  /** 도달까지 남은 시간(초). */
  t: number
  ballId: number
}

export class AutoPilot {
  private targetX: number
  private nextDecisionAt = 0

  /** 지금 쫓고 있는 공. 새로 내려오기 시작하면 판단값을 다시 뽑는다. */
  private approachBallId = -1
  /** 패들 반너비 기준, 공을 받을 지점. */
  private contactRatio = 0
  /** 패들 반너비 기준, 위치 오차. */
  private errorRatio = 0
  /** 공별 직전 수직 방향 — 위로 가다 아래로 바뀌는 순간을 잡는다. */
  private readonly prevDy = new Map<number, number>()
  /** 캐치로 붙은 공별 발사 예정 시각(ms). */
  private readonly releaseAt = new Map<number, number>()

  constructor(private readonly arena: Arena) {
    this.targetX = ARENA.width / 2
  }

  /** 이번 스텝의 입력을 만든다. */
  decide(): ArenaInput {
    const arena = this.arena
    const now = arena.simTimeMs

    // 반응 지연 — 이 간격으로만 판단을 갱신한다. 사이에는 직전 목표로 계속 움직인다.
    if (now >= this.nextDecisionAt) {
      this.nextDecisionAt = now + arena.difficulty.autoReactionMs
      this.refreshTarget()
    }

    const diff = this.targetX - arena.paddleX
    const direction: -1 | 0 | 1 = Math.abs(diff) <= DEADZONE ? 0 : diff > 0 ? 1 : -1

    return {
      pointerX: null,
      direction,
      firePressed: this.shouldRelease(now),
      // 레이저는 켜져 있으면 계속 쏜다. 발사 간격 제한은 엔진이 건다.
      fireHeld: isLaserActive(arena.effects, now),
    }
  }

  /** 경기가 끝나거나 다시 시작할 때 내부 상태를 비운다. */
  reset(): void {
    this.releaseAt.clear()
    this.prevDy.clear()
    this.nextDecisionAt = 0
    this.approachBallId = -1
    this.contactRatio = 0
    this.errorRatio = 0
    this.targetX = ARENA.width / 2
  }

  // ── 목표 결정 ─────────────────────────────────────────────────────────────

  private refreshTarget(): void {
    const arena = this.arena
    const half = Math.max(1, arena.paddleWidth / 2)
    const speed = Math.max(1, arena.difficulty.autoPaddleSpeed)

    const ball = this.predictNearestBall()
    const capsule = this.predictNearestCapsule()

    if (ball) {
      // 공이 새로 내려오기 시작했다면 이번 차례의 판단값을 새로 뽑는다.
      if (ball.ballId !== this.approachBallId) {
        this.approachBallId = ball.ballId
        this.sampleApproach()
      }

      const wantX = ball.x - this.contactRatio * half + this.errorRatio * half

      if (capsule) {
        // 캡슐을 받고 공 자리로 돌아올 여유가 있을 때만 아이템을 노린다.
        const goCapsule = Math.abs(capsule.x - arena.paddleX) / speed
        const comeBack = Math.abs(wantX - capsule.x) / speed
        if (capsule.t >= goCapsule && capsule.t + comeBack < ball.t - 0.15) {
          this.targetX = clamp(capsule.x, PLAY_LEFT + half, PLAY_RIGHT - half)
          return
        }
      }
      this.targetX = clamp(wantX, PLAY_LEFT + half, PLAY_RIGHT - half)
      return
    }

    // 내려오는 공이 없다 — 이번 차례는 끝났다.
    this.approachBallId = -1

    if (capsule) {
      this.targetX = clamp(capsule.x, PLAY_LEFT + half, PLAY_RIGHT - half)
      return
    }

    // 받을 것이 없으면 붙어 있는 공 아래 또는 가운데에서 기다린다.
    const stuck = arena.balls.find((b) => b.stuck)
    this.targetX = stuck ? clamp(stuck.x, PLAY_LEFT + half, PLAY_RIGHT - half) : ARENA.width / 2
  }

  /**
   * 공이 한 번 내려올 때마다 딱 한 번 뽑는다.
   *  - 어디로 받을지 (반사각을 다양하게)
   *  - 얼마나 빗나갈지 (난이도의 표준편차)
   *  - 아예 놓칠지 (난이도의 확률 — 차례당 한 번이므로 확률이 그대로 반영된다)
   */
  private sampleApproach(): void {
    const rng = this.arena.behaviorRng
    const d = this.arena.difficulty

    this.contactRatio = clamp(rng.gaussian() * CONTACT_SPREAD, -CONTACT_LIMIT, CONTACT_LIMIT)
    this.errorRatio = rng.gaussian() * d.autoAimErrorSigma

    const missRoll = rng.next()
    const missAmount = rng.range(1.15, 2.4)
    if (missRoll < d.autoMissChance) {
      this.errorRatio += (this.errorRatio >= 0 ? 1 : -1) * missAmount
    }
  }

  /** 가장 먼저 패들 선에 닿을 공을 찾는다. 벽 반사는 계산하고 벽돌 충돌은 무시한다. */
  private predictNearestBall(): BallPrediction | null {
    const arena = this.arena
    const speed = arena.ballSpeed
    const radius = ARENA.ballRadius
    let best: BallPrediction | null = null
    const liveIds = new Set<number>()

    for (const ball of arena.balls) {
      liveIds.add(ball.id)
      const prev = this.prevDy.get(ball.id)
      this.prevDy.set(ball.id, ball.dy)
      if (ball.stuck) continue
      const vy = ball.dy * speed
      if (vy <= 0) continue
      // 위로 가다 아래로 바뀐 순간이면 새 차례로 본다 (같은 공이어도 다시 뽑는다).
      if (prev !== undefined && prev <= 0 && ball.dy > 0 && this.approachBallId === ball.id) {
        this.approachBallId = -1
      }
      const t = (ARENA.paddleY - radius - ball.y) / vy
      if (t < 0) continue
      const rawX = ball.x + ball.dx * speed * t
      const x = foldIntoWalls(rawX, radius)
      if (best === null || t < best.t) best = { x, t, ballId: ball.id }
    }
    for (const id of [...this.prevDy.keys()]) {
      if (!liveIds.has(id)) this.prevDy.delete(id)
    }
    return best
  }

  /** 지금 받을 수 있는 캡슐 중 가장 먼저 닿을 것. */
  private predictNearestCapsule(): { x: number; t: number } | null {
    const arena = this.arena
    if (arena.capsules.length === 0) return null
    const speed = arena.difficulty.items.capsuleSpeed
    if (speed <= 0) return null
    let best: { x: number; t: number } | null = null
    for (const capsule of arena.capsules) {
      const t = (ARENA.paddleY - capsule.y) / speed
      if (t < 0) continue
      if (best === null || t < best.t) best = { x: capsule.x, t }
    }
    return best
  }

  // ── 캐치 발사 판단 ────────────────────────────────────────────────────────

  /** 캐치로 붙은 공을 언제 놓을지. 참가자마다 대기 시간이 조금씩 다르다. */
  private shouldRelease(now: number): boolean {
    const arena = this.arena
    if (!isCatchActive(arena.effects, now)) {
      if (this.releaseAt.size > 0) this.releaseAt.clear()
      return false
    }
    const maxHold = Math.max(200, arena.difficulty.items.catchHoldMs * 0.85)
    let fire = false
    const liveIds = new Set<number>()

    for (const ball of arena.balls) {
      if (!ball.stuck || ball.serving) continue
      liveIds.add(ball.id)
      let at = this.releaseAt.get(ball.id)
      if (at === undefined) {
        at = ball.stuckSince + arena.behaviorRng.range(200, maxHold)
        this.releaseAt.set(ball.id, at)
      }
      if (now >= at) fire = true
    }
    // 이미 사라진 공의 기록은 지운다.
    for (const id of [...this.releaseAt.keys()]) {
      if (!liveIds.has(id)) this.releaseAt.delete(id)
    }
    return fire
  }
}

/** 벽 반사를 접어서 [왼쪽, 오른쪽] 안의 실제 도달 위치로 바꾼다. */
export function foldIntoWalls(x: number, radius: number): number {
  const lo = PLAY_LEFT + radius
  const hi = PLAY_RIGHT - radius
  const span = hi - lo
  if (span <= 0) return lo
  const period = span * 2
  let m = (x - lo) % period
  if (m < 0) m += period
  return m <= span ? lo + m : lo + (period - m)
}
