/**
 * 파티클 시스템.
 *
 * 규칙
 *  - 풀(pool)을 미리 잡아 두고 재사용한다. 경기 중에는 객체를 새로 만들지 않는다.
 *    (40명 경기에서 매 프레임 수백 개를 새로 만들면 쓰레기 수집이 끼어들어 화면이 끊긴다.)
 *  - 좌표는 경기장 논리 좌표(0~320, 0~440)다. 그리는 쪽에서 배율과 위치를 준다.
 *  - 모션 감소 상태에서는 한 번에 살아 있을 수 있는 수를 크게 줄이고, 튀는 거리도 줄인다.
 *  - 공·캡슐·벽돌을 가리지 않도록 작게, 가산 합성은 약하게만 쓴다.
 */

import { FONTS, withAlpha } from './palette'

/** 스파크(0) 와 글자 팝업(1). 숫자로 두어 분기 비용을 줄인다. */
const KIND_SPARK = 0
const KIND_TEXT = 1

interface Particle {
  active: boolean
  kind: 0 | 1
  /** 어느 참가자의 경기장에 속한 파티클인지. 격자 보기에서 칸을 구분한다. */
  owner: string
  x: number
  y: number
  vx: number
  vy: number
  /** 남은 수명(ms). */
  life: number
  maxLife: number
  /** 논리 단위 크기. */
  size: number
  color: string
  text: string
}

export interface ParticleSystemOptions {
  /** 풀 크기. 기본 400. */
  maxParticles?: number
  /** 모션 감소 — 동시에 살아 있는 수를 80개로 제한하고 움직임을 줄인다. */
  reducedMotion?: boolean
}

export interface ParticleSystem {
  /** 풀 크기(고정). */
  readonly capacity: number
  /** 지금 살아 있는 수. */
  readonly activeCount: number
  setReducedMotion(reduced: boolean): void
  /** 벽돌이 깨졌을 때 등 짧은 파티클 묶음. */
  spawnBurst(x: number, y: number, color: string, count: number, owner?: string): void
  /** 점수·획득 안내처럼 위로 떠오르며 사라지는 짧은 글자. */
  spawnScorePopup(x: number, y: number, text: string, color: string, owner?: string): void
  update(dtMs: number): void
  /**
   * @param scale  논리 단위 → 화면 픽셀 배율
   * @param offsetX 경기장 왼쪽 위 모서리의 화면 x
   * @param owner  이 참가자의 파티클만 그린다. 생략하면 전부.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    scale: number,
    offsetX: number,
    offsetY: number,
    owner?: string,
  ): void
  clear(): void
}

const DEFAULT_CAPACITY = 400
const REDUCED_BUDGET = 80
const SPARK_GRAVITY = 260 // 논리 단위/초²

export function createParticleSystem(options: ParticleSystemOptions = {}): ParticleSystem {
  const capacity = Math.max(16, Math.round(options.maxParticles ?? DEFAULT_CAPACITY))
  const pool: Particle[] = new Array(capacity)
  for (let i = 0; i < capacity; i += 1) {
    pool[i] = {
      active: false,
      kind: KIND_SPARK,
      owner: '',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 2,
      color: '#ffffff',
      text: '',
    }
  }

  let reduced = options.reducedMotion ?? false
  let budget = reduced ? Math.min(REDUCED_BUDGET, capacity) : capacity
  let active = 0
  let cursor = 0

  /** 비어 있는 슬롯을 찾는다. 예산이 다 찼으면 null (새 파티클을 버린다). */
  function acquire(): Particle | null {
    if (active >= budget) return null
    for (let i = 0; i < capacity; i += 1) {
      const idx = (cursor + i) % capacity
      const p = pool[idx]
      if (!p.active) {
        cursor = (idx + 1) % capacity
        p.active = true
        active += 1
        return p
      }
    }
    return null
  }

  function release(p: Particle): void {
    if (!p.active) return
    p.active = false
    p.text = ''
    p.owner = ''
    active -= 1
  }

  return {
    get capacity(): number {
      return capacity
    },
    get activeCount(): number {
      return active
    },

    setReducedMotion(next: boolean): void {
      if (next === reduced) return
      reduced = next
      budget = reduced ? Math.min(REDUCED_BUDGET, capacity) : capacity
      if (reduced) {
        // 예산이 줄었으면 넘치는 만큼 오래된 것부터 정리한다.
        for (let i = 0; i < capacity && active > budget; i += 1) {
          if (pool[i].active && pool[i].kind === KIND_SPARK) release(pool[i])
        }
      }
    },

    spawnBurst(x: number, y: number, color: string, count: number, owner = ''): void {
      const n = Math.max(1, Math.round(reduced ? Math.min(3, count * 0.3) : count))
      const spread = reduced ? 34 : 90
      for (let i = 0; i < n; i += 1) {
        const p = acquire()
        if (!p) return
        const angle = (Math.PI * 2 * i) / n + Math.random() * 0.6
        const speed = spread * (0.45 + Math.random() * 0.75)
        p.kind = KIND_SPARK
        p.owner = owner
        p.x = x
        p.y = y
        p.vx = Math.cos(angle) * speed
        p.vy = Math.sin(angle) * speed - 18
        p.maxLife = reduced ? 220 : 320 + Math.random() * 220
        p.life = p.maxLife
        p.size = 1.4 + Math.random() * 1.4
        p.color = color
        p.text = ''
      }
    },

    spawnScorePopup(x: number, y: number, text: string, color: string, owner = ''): void {
      const p = acquire()
      if (!p) return
      p.kind = KIND_TEXT
      p.owner = owner
      p.x = x
      p.y = y
      p.vx = 0
      p.vy = reduced ? -12 : -26
      p.maxLife = reduced ? 600 : 850
      p.life = p.maxLife
      p.size = 11
      p.color = color
      p.text = text
    },

    update(dtMs: number): void {
      if (active === 0) return
      const dt = Math.min(64, Math.max(0, dtMs)) / 1000
      for (let i = 0; i < capacity; i += 1) {
        const p = pool[i]
        if (!p.active) continue
        p.life -= dtMs
        if (p.life <= 0) {
          release(p)
          continue
        }
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.kind === KIND_SPARK) {
          p.vy += SPARK_GRAVITY * dt
          p.vx *= 1 - 1.4 * dt
        }
      }
    },

    draw(
      ctx: CanvasRenderingContext2D,
      scale: number,
      offsetX: number,
      offsetY: number,
      owner?: string,
    ): void {
      if (active === 0) return
      let drewSpark = false
      ctx.save()
      // 스파크 — 작게, 약한 가산 합성. 공과 벽돌을 덮지 않도록 크기를 제한한다.
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < capacity; i += 1) {
        const p = pool[i]
        if (!p.active || p.kind !== KIND_SPARK) continue
        if (owner !== undefined && p.owner !== owner) continue
        const t = p.life / p.maxLife
        const s = Math.max(1, p.size * scale * (0.5 + t * 0.5))
        ctx.fillStyle = withAlpha(p.color, Math.min(0.75, t * 0.75))
        ctx.fillRect(offsetX + p.x * scale - s / 2, offsetY + p.y * scale - s / 2, s, s)
        drewSpark = true
      }
      ctx.restore()

      // 글자 팝업 — 합성 없이 또렷하게.
      let fontPx = -1
      for (let i = 0; i < capacity; i += 1) {
        const p = pool[i]
        if (!p.active || p.kind !== KIND_TEXT) continue
        if (owner !== undefined && p.owner !== owner) continue
        const t = p.life / p.maxLife
        const px = Math.max(9, Math.round(p.size * scale))
        if (px !== fontPx) {
          fontPx = px
          ctx.font = `700 ${px}px ${FONTS.numeric}`
        }
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const x = offsetX + p.x * scale
        const y = offsetY + p.y * scale
        ctx.fillStyle = withAlpha('#070b18', Math.min(0.6, t))
        ctx.fillText(p.text, x + 1, y + 1)
        ctx.fillStyle = withAlpha(p.color, Math.min(1, t * 1.3))
        ctx.fillText(p.text, x, y)
      }
      if (drewSpark) {
        ctx.globalAlpha = 1
      }
    },

    clear(): void {
      for (let i = 0; i < capacity; i += 1) {
        if (pool[i].active) release(pool[i])
      }
      active = 0
      cursor = 0
    },
  }
}
