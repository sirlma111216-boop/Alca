/**
 * 캔버스 렌더러.
 *
 * 설계 원칙
 *  1. **캔버스는 하나다.** 40명이 동시에 뛰어도 경기장은 한 캔버스 위의 격자 칸으로 그린다.
 *     참가자마다 캔버스를 만들면 합성 비용이 급격히 늘고 모바일에서 멈춘다.
 *  2. **엔진을 절대 건드리지 않는다.** 읽기만 한다. 유일한 예외가 arena.drainEvents() 인데,
 *     이것은 엔진이 렌더러에게 주려고 만든 출구이고 시뮬레이션에 영향이 없다
 *     (재현 로그는 eventSink 라는 독립 출구로 간다).
 *  3. **고정된 것은 한 번만 그린다.** 바닥·벽·격자는 오프스크린 캔버스에 한 번 그려 두고
 *     매 프레임 복사한다. 매 프레임 그리는 것은 벽돌·공·캡슐·탄환·글자뿐이다.
 *  4. **색만으로 구분하지 않는다.** 참가자는 번호와 닉네임, 아이템은 글자, 벽돌은 입체감과
 *     문양으로도 구분된다.
 */

import {
  ARENA,
  BRICK_TYPES,
  ITEM_DEFS,
  PLAY_LEFT,
  PLAY_RIGHT,
  PLAY_STATUS_LABELS,
  PLAY_TOP,
  SHIELD_Y,
  STEP_MS,
  STEP_SECONDS,
  activeEffects,
} from '../core'
import type { Arena, ItemKind, ParticipantRun } from '../core'
import {
  FONTS,
  PALETTE,
  brickShades,
  damagedShade,
  mix,
  participantAccent,
  withAlpha,
} from './palette'
import type { ArenaLayoutBox, DetailLevel, MatchRenderer, RendererOptions } from './types'
import { createParticleSystem } from './particles'
import type { ParticleSystem } from './particles'

// ────────────────────────────────────────────────────────────────────────────
// 내부 자료 구조
// ────────────────────────────────────────────────────────────────────────────

interface Cell extends ArenaLayoutBox {
  runIndex: number
  /** 경기장(논리 320×440)이 실제로 그려지는 화면 사각형 — CSS 픽셀. */
  ax: number
  ay: number
  aw: number
  ah: number
  /** 논리 단위 → CSS 픽셀 배율. */
  scale: number
  /** mini 에서 닉네임 줄에 쓰는 높이. full 은 0 (경기장 안에 그린다). */
  labelH: number
  /** 칸 안쪽 여백 — 닉네임 줄과 경기장이 같은 값을 쓴다. */
  pad: number
}

interface Toast {
  text: string
  color: string
  /** 사라질 실제 시각(ms). */
  until: number
}

const ARENA_ASPECT = ARENA.width / ARENA.height
/** 이 크기보다 작은 칸은 mini 로 그린다 (교실 프로젝터에서 읽히는 하한). */
const FULL_MIN_W = 200
const FULL_MIN_H = 260
/** full 로 그릴 칸의 최대 개수 — 더 많으면 전부 mini 로 낮춰 60fps 를 지킨다. */
const FULL_MAX_CELLS = 9
const TOAST_MS = 1400
const MAX_TOASTS = 3

const STATUS_TEXT: Record<ParticipantRun['status'], string> = {
  pending: '대기 중',
  playing: '진행 중',
  played: PLAY_STATUS_LABELS.played,
  not_played: PLAY_STATUS_LABELS.not_played,
  aborted: PLAY_STATUS_LABELS.aborted,
}

/** 시간제 아이템의 기준 지속 시간 — 남은 시간 막대의 분모. */
function effectDurationMs(arena: Arena, kind: ItemKind): number {
  const s = arena.difficulty.items
  switch (kind) {
    case 'expand':
      return s.expandDurationMs
    case 'slow':
      return s.slowDurationMs
    case 'catch':
      return s.catchDurationMs
    case 'laser':
      return s.laserDurationMs
    default:
      return 1
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 렌더러
// ────────────────────────────────────────────────────────────────────────────

export function createMatchRenderer(options: RendererOptions): MatchRenderer {
  const canvas = options.canvas
  const match = options.match
  const ctx = canvas.getContext('2d', { alpha: false })

  let reducedMotion = options.reducedMotion
  let scanlines = options.scanlines
  let focusParticipantId = options.focusParticipantId
  let highlightIds: string[] = options.highlightParticipantIds ? [...options.highlightParticipantIds] : []

  let cssWidth = Math.max(1, canvas.clientWidth || canvas.width || 320)
  let cssHeight = Math.max(1, canvas.clientHeight || canvas.height || 440)
  let dpr = 1
  let sized = false
  let destroyed = false

  let cells: Cell[] = []
  let layoutDirty = true
  /** 자리가 모자라 화면에 못 그린 참가자 수. 경기는 그대로 진행된다. */
  let hiddenCount = 0

  const particles: ParticleSystem = createParticleSystem({ reducedMotion })
  const toasts = new Map<string, Toast[]>()
  const celebrated = new Set<string>()
  const cellByParticipant = new Map<string, Cell>()

  /** 배경 타일 캐시 — 같은 크기·같은 상세도면 다시 그리지 않는다. */
  const tiles = new Map<string, HTMLCanvasElement>()
  /** 스캔라인 무늬 — 한 번 만들어 재사용한다. */
  let scanlinePattern: CanvasPattern | null = null
  let scanlineTile: HTMLCanvasElement | null = null

  const shadeCache = new Map<string, { top: string; body: string; bottom: string }>()
  const fitCache = new Map<string, string>()
  const measureCache = new Map<string, number>()

  /**
   * 글자 폭 — 매 프레임 measureText 를 부르지 않도록 캐시한다.
   * 숫자가 든 글자는 자리수만 같으면 같은 폭으로 쳐서 캐시가 무한히 늘지 않게 한다.
   */
  function measureCached(c: CanvasRenderingContext2D, text: string, font: string): number {
    const key = `${font}|${text}`
    const hit = measureCache.get(key)
    if (hit !== undefined) return hit
    c.font = font
    const width = c.measureText(text).width
    if (measureCache.size > 400) measureCache.clear()
    measureCache.set(key, width)
    return width
  }

  let lastFrameAt = 0

  /** 현재 순위 — 매 프레임 한 번만 계산해 모든 칸이 나눠 쓴다. 배열을 재사용한다. */
  let rankOrder: number[] = []
  let rankOf: number[] = []

  function liveScore(run: ParticipantRun): number {
    return run.arena ? run.arena.score : (run.score ?? 0)
  }

  function updateRanks(): void {
    const runs = match.runs
    if (rankOrder.length !== runs.length) {
      rankOrder = runs.map((_, i) => i)
      rankOf = new Array(runs.length).fill(1)
    }
    rankOrder.sort((a, b) => liveScore(runs[b]) - liveScore(runs[a]))
    let lastScore = Number.NaN
    let lastRank = 0
    for (let i = 0; i < rankOrder.length; i += 1) {
      const score = liveScore(runs[rankOrder[i]])
      // 점수가 같으면 같은 순위 — 화면에서 억지로 순서를 매기지 않는다.
      if (score !== lastScore) {
        lastRank = i + 1
        lastScore = score
      }
      rankOf[rankOrder[i]] = lastRank
    }
  }

  // ── 색·글자 도우미 ────────────────────────────────────────────────────────

  function shadesFor(typeId: string, hp: number, maxHp: number): {
    top: string
    body: string
    bottom: string
  } {
    const key = `${typeId}:${hp}/${maxHp}`
    const hit = shadeCache.get(key)
    if (hit) return hit
    const base = BRICK_TYPES[typeId as keyof typeof BRICK_TYPES].color
    const shades = brickShades(damagedShade(base, hp, maxHp))
    shadeCache.set(key, shades)
    return shades
  }

  /** 폭에 맞춰 잘라 낸 글자 (필요하면 말줄임). measureText 결과를 캐시한다. */
  function fitText(c: CanvasRenderingContext2D, text: string, font: string, maxWidth: number): string {
    if (maxWidth <= 0) return ''
    const key = `${font}|${Math.round(maxWidth)}|${text}`
    const hit = fitCache.get(key)
    if (hit !== undefined) return hit
    c.font = font
    let out = text
    if (c.measureText(text).width > maxWidth) {
      let lo = 0
      let hi = text.length
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (c.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid
        else hi = mid - 1
      }
      out = lo <= 0 ? '' : `${text.slice(0, lo)}…`
    }
    if (fitCache.size > 800) fitCache.clear()
    fitCache.set(key, out)
    return out
  }

  function roundRectPath(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2))
    c.beginPath()
    c.moveTo(x + rr, y)
    c.lineTo(x + w - rr, y)
    c.quadraticCurveTo(x + w, y, x + w, y + rr)
    c.lineTo(x + w, y + h - rr)
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
    c.lineTo(x + rr, y + h)
    c.quadraticCurveTo(x, y + h, x, y + h - rr)
    c.lineTo(x, y + rr)
    c.quadraticCurveTo(x, y, x + rr, y)
    c.closePath()
  }

  // ── 배치 ──────────────────────────────────────────────────────────────────

  function computeLayout(): void {
    cells = []
    hiddenCount = 0
    cellByParticipant.clear()
    const runs = match.runs
    const n = runs.length
    if (n === 0 || cssWidth <= 0 || cssHeight <= 0) {
      layoutDirty = false
      return
    }

    const focusIndex =
      focusParticipantId === null
        ? -1
        : runs.findIndex((r) => r.participant.id === focusParticipantId)

    if (n === 1) {
      pushCell(0, 0, 0, cssWidth, cssHeight, 'full')
    } else if (focusIndex >= 0) {
      layoutFocus(focusIndex)
    } else {
      layoutGrid()
    }

    for (const cell of cells) cellByParticipant.set(cell.participantId, cell)
    layoutDirty = false
  }

  /** 한 명을 크게 보고 나머지는 작은 줄로. */
  function layoutFocus(focusIndex: number): void {
    const runs = match.runs
    const wide = cssWidth >= cssHeight * 1.15
    const stripSize = wide
      ? Math.min(220, Math.max(96, cssWidth * 0.2))
      : Math.min(150, Math.max(72, cssHeight * 0.18))

    const mainW = wide ? cssWidth - stripSize : cssWidth
    const mainH = wide ? cssHeight : cssHeight - stripSize
    pushCell(focusIndex, 0, 0, mainW, mainH, 'full')

    // 작은 줄 — 들어가는 만큼만 그린다. 넘치면 숨기고 몇 명이 더 있는지 알린다
    // (숨겨도 엔진은 그대로 돌기 때문에 결과는 달라지지 않는다).
    const others = runs.length - 1
    if (wide) {
      const capacity = Math.max(1, Math.min(others, Math.floor(cssHeight / 86)))
      const cellH = cssHeight / capacity
      let slot = 0
      for (let i = 0; i < runs.length && slot < capacity; i += 1) {
        if (i === focusIndex) continue
        pushCell(i, mainW, slot * cellH, stripSize, cellH, 'mini')
        slot += 1
      }
      hiddenCount = others - slot
    } else {
      const capacity = Math.max(1, Math.min(others, Math.floor(cssWidth / 116)))
      const cellW = cssWidth / capacity
      let slot = 0
      for (let i = 0; i < runs.length && slot < capacity; i += 1) {
        if (i === focusIndex) continue
        pushCell(i, slot * cellW, mainH, cellW, stripSize, 'mini')
        slot += 1
      }
      hiddenCount = others - slot
    }
  }

  /** 전체 격자 — 칸 크기가 가장 커지는 열 수를 고른다. */
  function layoutGrid(): void {
    const runs = match.runs
    const n = runs.length
    let bestCols = 1
    let bestScale = 0
    for (let cols = 1; cols <= n; cols += 1) {
      const rows = Math.ceil(n / cols)
      const cw = cssWidth / cols
      const ch = cssHeight / rows
      const s = Math.min(cw / ARENA.width, ch / ARENA.height)
      if (s > bestScale) {
        bestScale = s
        bestCols = cols
      }
    }
    const cols = bestCols
    const rows = Math.ceil(n / cols)
    const cellW = cssWidth / cols
    const cellH = cssHeight / rows
    const pad = Math.min(12, Math.max(2, Math.min(cellW, cellH) * 0.06))
    const detail: DetailLevel =
      n <= FULL_MAX_CELLS && cellW - pad * 2 >= FULL_MIN_W && cellH - pad * 2 >= FULL_MIN_H
        ? 'full'
        : 'mini'

    for (let i = 0; i < n; i += 1) {
      const row = Math.floor(i / cols)
      const col = i % cols
      const inRow = Math.min(cols, n - row * cols)
      const rowOffset = (cssWidth - inRow * cellW) / 2
      pushCell(i, rowOffset + col * cellW, row * cellH, cellW, cellH, detail)
    }
  }

  function miniLabelHeight(cellSize: number): number {
    return Math.min(22, Math.max(12, cellSize * 0.16))
  }

  function pushCell(
    runIndex: number,
    x: number,
    y: number,
    width: number,
    height: number,
    detail: DetailLevel,
  ): void {
    const run = match.runs[runIndex]
    if (!run) return
    const pad = Math.min(12, Math.max(2, Math.min(width, height) * 0.05))
    const labelH = detail === 'mini' ? miniLabelHeight(Math.min(width, height)) : 0
    const innerW = Math.max(8, width - pad * 2)
    const innerH = Math.max(8, height - pad * 2 - labelH)
    let aw = innerW
    let ah = aw / ARENA_ASPECT
    if (ah > innerH) {
      ah = innerH
      aw = ah * ARENA_ASPECT
    }
    cells.push({
      participantId: run.participant.id,
      runIndex,
      x,
      y,
      width,
      height,
      detail,
      ax: x + (width - aw) / 2,
      ay: y + pad + labelH + (innerH - ah) / 2,
      aw,
      ah,
      scale: aw / ARENA.width,
      labelH,
      pad,
    })
  }

  // ── 오프스크린 배경 ───────────────────────────────────────────────────────

  function arenaTile(aw: number, ah: number, detail: DetailLevel): HTMLCanvasElement | null {
    const key = `${detail}:${Math.round(aw)}x${Math.round(ah)}@${dpr.toFixed(2)}`
    const hit = tiles.get(key)
    if (hit) return hit
    if (tiles.size > 6) tiles.clear()

    const tile = document.createElement('canvas')
    tile.width = Math.max(1, Math.round(aw * dpr))
    tile.height = Math.max(1, Math.round(ah * dpr))
    const tc = tile.getContext('2d')
    if (!tc) return null
    tc.setTransform(dpr, 0, 0, dpr, 0, 0)
    const s = aw / ARENA.width

    // 바닥
    tc.fillStyle = PALETTE.arenaBackground
    tc.fillRect(0, 0, aw, ah)

    // 미세 격자 (full 에서만 — mini 에서는 잡음이 된다)
    if (detail === 'full') {
      tc.strokeStyle = withAlpha(PALETTE.arenaGrid, 0.9)
      tc.lineWidth = Math.max(0.5, s * 0.5)
      tc.beginPath()
      for (let gx = PLAY_LEFT; gx <= PLAY_RIGHT; gx += 32) {
        tc.moveTo(Math.round(gx * s) + 0.5, PLAY_TOP * s)
        tc.lineTo(Math.round(gx * s) + 0.5, ah)
      }
      for (let gy = PLAY_TOP; gy <= ARENA.height; gy += 32) {
        tc.moveTo(PLAY_LEFT * s, Math.round(gy * s) + 0.5)
        tc.lineTo(PLAY_RIGHT * s, Math.round(gy * s) + 0.5)
      }
      tc.stroke()
    }

    // 금속 벽 — 바깥은 어둡고 안쪽 모서리에 밝은 선.
    const t = ARENA.wallThickness * s
    tc.fillStyle = PALETTE.wall
    tc.fillRect(0, 0, t, ah)
    tc.fillRect(aw - t, 0, t, ah)
    tc.fillRect(0, 0, aw, t)
    tc.fillStyle = PALETTE.wallHighlight
    const edge = Math.max(1, s * 1.2)
    tc.fillRect(t - edge, t - edge, edge, ah - t + edge)
    tc.fillRect(aw - t, t - edge, edge, ah - t + edge)
    tc.fillRect(t - edge, t - edge, aw - t * 2 + edge * 2, edge)

    // 바닥 경계 — 여기 아래로 떨어지면 목숨이 준다는 것을 보이게.
    // 0.22 로는 짙은 바닥에 묻혀 안 보였다. 기능적인 선이므로 확실히 보이게 한다.
    tc.fillStyle = withAlpha(PALETTE.danger, 0.55)
    tc.fillRect(t, ah - Math.max(1, s * 1.5), aw - t * 2, Math.max(1, s * 1.5))

    if (detail === 'full') {
      // 점수판과 경기장을 가르는 선
      tc.strokeStyle = withAlpha(PALETTE.wallHighlight, 0.45)
      tc.lineWidth = Math.max(0.5, s * 0.6)
      tc.beginPath()
      tc.moveTo(t, Math.round((ARENA.brickTop - 4) * s) + 0.5)
      tc.lineTo(aw - t, Math.round((ARENA.brickTop - 4) * s) + 0.5)
      tc.stroke()
    }

    tiles.set(key, tile)
    return tile
  }

  function scanlinePatternFor(c: CanvasRenderingContext2D): CanvasPattern | null {
    if (scanlinePattern) return scanlinePattern
    const tile = document.createElement('canvas')
    tile.width = 1
    tile.height = 3
    const tc = tile.getContext('2d')
    if (!tc) return null
    tc.fillStyle = 'rgba(0, 0, 0, 1)'
    tc.fillRect(0, 0, 1, 1)
    scanlineTile = tile
    scanlinePattern = c.createPattern(tile, 'repeat')
    return scanlinePattern
  }

  // ── 이벤트 → 연출 ─────────────────────────────────────────────────────────

  function pushToast(participantId: string, text: string, color: string, nowReal: number): void {
    let list = toasts.get(participantId)
    if (!list) {
      list = []
      toasts.set(participantId, list)
    }
    list.push({ text, color, until: nowReal + TOAST_MS })
    while (list.length > MAX_TOASTS) list.shift()
  }

  /**
   * 모든 경기장의 이벤트를 비운다.
   * 화면에 안 보이는 참가자도 반드시 비워야 이벤트 버퍼가 낡은 값으로 차지 않는다.
   */
  function consumeEvents(nowReal: number): void {
    for (const run of match.runs) {
      const arena = run.arena
      if (!arena) continue
      const events = arena.drainEvents()
      if (events.length === 0) continue
      const cell = cellByParticipant.get(run.participant.id)
      const visible = cell !== undefined && cell.detail === 'full'
      if (!visible) continue
      const id = run.participant.id
      for (let i = 0; i < events.length; i += 1) {
        const ev = events[i]
        switch (ev.type) {
          case 'brick-break': {
            particles.spawnBurst(ev.x, ev.y, ev.color ?? PALETTE.accent, 9, id)
            if (ev.score && ev.score > 0) {
              particles.spawnScorePopup(ev.x, ev.y, `+${ev.score}`, ev.color ?? PALETTE.text, id)
            }
            break
          }
          case 'brick-hit':
            particles.spawnBurst(ev.x, ev.y, ev.color ?? PALETTE.text, 3, id)
            break
          case 'paddle-hit':
            particles.spawnBurst(ev.x, ev.y, PALETTE.paddle, 3, id)
            break
          case 'shield-bounce':
            particles.spawnBurst(ev.x, ev.y, PALETTE.shield, 8, id)
            break
          case 'item-collect': {
            const def = ev.kind ? ITEM_DEFS[ev.kind] : null
            if (def) {
              particles.spawnBurst(ev.x, ev.y, def.color, 8, id)
              pushToast(id, def.label, def.color, nowReal)
            }
            break
          }
          case 'item-spawn':
            if (ev.kind) particles.spawnBurst(ev.x, ev.y, ITEM_DEFS[ev.kind].color, 3, id)
            break
          case 'item-expire':
            if (ev.kind) pushToast(id, `${ITEM_DEFS[ev.kind].label} 종료`, PALETTE.textDim, nowReal)
            break
          case 'life-lost':
            particles.spawnBurst(ev.x, ev.y, PALETTE.danger, 12, id)
            pushToast(id, '목숨 1개 감소', PALETTE.danger, nowReal)
            break
          case 'wave-clear':
            particles.spawnBurst(ARENA.width / 2, ARENA.brickTop + 20, PALETTE.accentWarm, 14, id)
            particles.spawnScorePopup(
              ARENA.width / 2,
              ARENA.brickTop + 30,
              `판 클리어 +${ev.score ?? 0}`,
              PALETTE.accentWarm,
              id,
            )
            break
          default:
            break
        }
      }
    }
  }

  /** 결과 공개 — 새로 뽑힌 참가자에게 딱 한 번 축하 파티클. */
  function celebrateNewHighlights(): void {
    for (const id of highlightIds) {
      if (celebrated.has(id)) continue
      celebrated.add(id)
      const cell = cellByParticipant.get(id)
      if (!cell || cell.detail !== 'full') continue
      particles.spawnBurst(ARENA.width / 2, ARENA.height / 2, PALETTE.accentWarm, 18, id)
    }
  }

  // ── 그리기 ────────────────────────────────────────────────────────────────

  function drawArenaContents(
    c: CanvasRenderingContext2D,
    cell: Cell,
    arena: Arena,
    alpha: number,
  ): void {
    const s = cell.scale
    const ax = cell.ax
    const ay = cell.ay
    const full = cell.detail === 'full'

    // 벽돌 — 색이 같은 것끼리 모아 그려 상태 변경을 줄인다.
    const level = arena.level
    const bricks = level.bricks
    if (full) {
      for (let i = 0; i < bricks.length; i += 1) {
        const b = bricks[i]
        if (!b.alive) continue
        const shades = shadesFor(b.typeId, b.hp, b.maxHp)
        const bx = ax + b.x * s
        const by = ay + b.y * s
        const bw = b.w * s
        const bh = b.h * s
        const lip = Math.max(1, bh * 0.18)
        c.fillStyle = shades.body
        c.fillRect(bx, by, bw, bh)
        c.fillStyle = shades.top
        c.fillRect(bx, by, bw, lip)
        c.fillStyle = shades.bottom
        c.fillRect(bx, by + bh - lip, bw, lip)
        // 내구도가 닳으면 금 간 선을 함께 그린다 (색만으로 구분하지 않기).
        if (b.hp < b.maxHp) {
          c.strokeStyle = withAlpha('#070b18', 0.55)
          c.lineWidth = Math.max(1, s * 0.7)
          c.beginPath()
          c.moveTo(bx + bw * 0.22, by + bh * 0.2)
          c.lineTo(bx + bw * 0.44, by + bh * 0.62)
          c.lineTo(bx + bw * 0.66, by + bh * 0.3)
          c.lineTo(bx + bw * 0.84, by + bh * 0.78)
          c.stroke()
        }
        // 아이템을 품은 벽돌 — 작은 마름모
        if (b.item && !b.itemSpawned) {
          const cx = bx + bw / 2
          const cy = by + bh / 2
          const r = Math.max(1.5, bh * 0.26)
          c.fillStyle = PALETTE.itemMark
          c.beginPath()
          c.moveTo(cx, cy - r)
          c.lineTo(cx + r, cy)
          c.lineTo(cx, cy + r)
          c.lineTo(cx - r, cy)
          c.closePath()
          c.fill()
        }
      }
    } else {
      // mini — 색별로 한 번에 채운다.
      let currentType = ''
      c.beginPath()
      for (let i = 0; i < bricks.length; i += 1) {
        const b = bricks[i]
        if (!b.alive) continue
        if (b.typeId !== currentType) {
          if (currentType !== '') {
            c.fillStyle = BRICK_TYPES[currentType as keyof typeof BRICK_TYPES].color
            c.fill()
            c.beginPath()
          }
          currentType = b.typeId
        }
        c.rect(ax + b.x * s, ay + b.y * s, Math.max(1, b.w * s), Math.max(1, b.h * s))
      }
      if (currentType !== '') {
        c.fillStyle = BRICK_TYPES[currentType as keyof typeof BRICK_TYPES].color
        c.fill()
      }
    }

    // 바닥 보호막
    if (arena.effects.shieldCharges > 0) {
      const y = ay + SHIELD_Y * s
      const h = Math.max(1.5, s * 2.5)
      c.fillStyle = withAlpha(PALETTE.shield, 0.75)
      if (full) {
        const step = 10 * s
        for (let x = PLAY_LEFT * s; x < PLAY_RIGHT * s; x += step) {
          c.fillRect(ax + x, y, step * 0.6, h)
        }
      } else {
        c.fillRect(ax + PLAY_LEFT * s, y, (PLAY_RIGHT - PLAY_LEFT) * s, h)
      }
    }

    // 캡슐
    const capsules = arena.capsules
    for (let i = 0; i < capsules.length; i += 1) {
      const cap = capsules[i]
      const def = ITEM_DEFS[cap.kind]
      const w = ARENA.capsuleWidth * s
      const h = ARENA.capsuleHeight * s
      const x = ax + (cap.x - ARENA.capsuleWidth / 2) * s
      const y = ay + cap.y * s
      if (full) {
        roundRectPath(c, x, y, w, h, h * 0.45)
        c.fillStyle = def.color
        c.fill()
        c.fillStyle = mix(def.color, '#ffffff', 0.45)
        c.fillRect(x + w * 0.1, y + h * 0.12, w * 0.8, Math.max(1, h * 0.18))
        // 글자 — 색맹 대응. 캡슐 안에 아이템 머리글자를 찍는다.
        const fontPx = Math.max(7, h * 0.72)
        c.font = `700 ${fontPx}px ${FONTS.numeric}`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillStyle = PALETTE.itemMark
        c.fillText(def.glyph, x + w / 2, y + h / 2 + fontPx * 0.05)
      } else {
        c.fillStyle = def.color
        c.fillRect(x, y, Math.max(2, w), Math.max(1.5, h))
      }
    }

    // 레이저 탄환
    const bullets = arena.bullets
    if (bullets.length > 0) {
      c.fillStyle = PALETTE.bullet
      for (let i = 0; i < bullets.length; i += 1) {
        const bu = bullets[i]
        c.fillRect(
          ax + (bu.x - ARENA.bulletWidth / 2) * s,
          ay + bu.y * s,
          Math.max(1, ARENA.bulletWidth * s),
          Math.max(2, ARENA.bulletHeight * s),
        )
      }
    }

    // 패들
    drawPaddle(c, cell, arena)

    // 공 — 마지막 스텝 이후의 남은 시간만큼만 앞당겨 그린다(보간).
    const balls = arena.balls
    const advance = arena.ballSpeed * STEP_SECONDS * alpha
    for (let i = 0; i < balls.length; i += 1) {
      const ball = balls[i]
      const bx = ball.stuck ? ball.x : ball.x + ball.dx * advance
      const by = ball.stuck ? ball.y : ball.y + ball.dy * advance
      const px = ax + bx * s
      const py = ay + by * s
      const r = Math.max(full ? 1.6 : 1, ARENA.ballRadius * s)
      if (full && !reducedMotion && !ball.stuck) {
        // 짧은 잔상 — 진행 방향 뒤로 2칸.
        for (let k = 1; k <= 2; k += 1) {
          const tx = px - ball.dx * advance * s * k * 1.6
          const ty = py - ball.dy * advance * s * k * 1.6
          c.fillStyle = withAlpha(PALETTE.ballTrail, 0.26 / k)
          c.beginPath()
          c.arc(tx, ty, r * (1 - k * 0.22), 0, Math.PI * 2)
          c.fill()
        }
      }
      if (full) {
        c.fillStyle = withAlpha(PALETTE.ballTrail, 0.22)
        c.beginPath()
        c.arc(px, py, r * 1.9, 0, Math.PI * 2)
        c.fill()
      }
      c.fillStyle = PALETTE.ball
      c.beginPath()
      c.arc(px, py, r, 0, Math.PI * 2)
      c.fill()
    }
  }

  function drawPaddle(c: CanvasRenderingContext2D, cell: Cell, arena: Arena): void {
    const s = cell.scale
    const w = arena.paddleWidth * s
    const h = ARENA.paddleHeight * s
    const x = cell.ax + (arena.paddleX - arena.paddleWidth / 2) * s
    const y = cell.ay + ARENA.paddleY * s
    const now = arena.simTimeMs
    const weapon = arena.effects.weapon
    const weaponOn = arena.effects.weaponUntil !== null && now < arena.effects.weaponUntil

    if (cell.detail === 'mini') {
      c.fillStyle = weaponOn && weapon === 'laser' ? PALETTE.paddleLaser : PALETTE.paddle
      c.fillRect(x, y, Math.max(3, w), Math.max(1.5, h))
      return
    }

    const grad = c.createLinearGradient(0, y, 0, y + h)
    grad.addColorStop(0, PALETTE.paddleCore)
    grad.addColorStop(0.45, PALETTE.paddle)
    grad.addColorStop(1, PALETTE.paddleEdge)
    roundRectPath(c, x, y, w, h, Math.min(h / 2, s * 3))
    c.fillStyle = grad
    c.fill()
    // 금속 광택 한 줄
    c.fillStyle = withAlpha('#ffffff', 0.5)
    c.fillRect(x + w * 0.08, y + h * 0.16, w * 0.84, Math.max(0.6, h * 0.12))

    if (weaponOn && weapon === 'laser') {
      // 레이저 — 빨간 총구 2개
      const mw = Math.max(2, s * 3)
      c.fillStyle = PALETTE.paddleLaser
      c.fillRect(x + s * 1.5, y - h * 0.45, mw, h * 0.5)
      c.fillRect(x + w - s * 1.5 - mw, y - h * 0.45, mw, h * 0.5)
    } else if (weaponOn && weapon === 'catch') {
      // 캐치 — 청록 접착면
      c.fillStyle = withAlpha(PALETTE.paddleCatch, 0.9)
      c.fillRect(x + w * 0.05, y - Math.max(1, h * 0.22), w * 0.9, Math.max(1, h * 0.22))
    }
  }

  /** full 상세도의 점수판 — 닉네임·번호·점수·목숨·남은 시간·효과. */
  function drawFullHud(
    c: CanvasRenderingContext2D,
    cell: Cell,
    run: ParticipantRun,
    arena: Arena,
    rank: number,
    nowReal: number,
  ): void {
    const s = cell.scale
    const ax = cell.ax
    const ay = cell.ay
    const accent = participantAccent(cell.runIndex)
    const left = PLAY_LEFT * s + ax + 4 * s
    const right = ax + PLAY_RIGHT * s - 4 * s

    // 번호 표식 — 색만으로 구분하지 않도록 번호를 함께 그린다.
    const tagH = 14 * s
    const tagW = 18 * s
    roundRectPath(c, left, ay + 12 * s, tagW, tagH, 3 * s)
    c.fillStyle = withAlpha(accent, 0.9)
    c.fill()
    c.font = `700 ${Math.max(8, 9.5 * s)}px ${FONTS.numeric}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillStyle = '#070b18'
    c.fillText(String(cell.runIndex + 1), left + tagW / 2, ay + 12 * s + tagH / 2)

    // 닉네임
    const nameFont = `700 ${Math.max(10, 13 * s)}px ${FONTS.ui}`
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    c.fillStyle = PALETTE.textStrong
    const nameMax = (right - left - tagW - 8 * s) * 0.62
    c.font = nameFont
    c.fillText(
      fitText(c, run.participant.nickname, nameFont, nameMax),
      left + tagW + 5 * s,
      ay + 12 * s + tagH / 2,
    )

    // 점수 (오른쪽 정렬, 고정폭)
    const scoreFont = `700 ${Math.max(11, 16 * s)}px ${FONTS.numeric}`
    c.font = scoreFont
    c.textAlign = 'right'
    c.fillStyle = PALETTE.text
    c.fillText(String(arena.score), right, ay + 12 * s + tagH / 2)

    // 둘째 줄 — 목숨과 남은 시간
    const rowY = ay + 32 * s
    const smallFont = `600 ${Math.max(8, 10 * s)}px ${FONTS.ui}`
    c.font = smallFont
    c.textAlign = 'left'
    c.fillStyle = PALETTE.textDim
    c.fillText('목숨', left, rowY)
    const lifeX = left + 22 * s
    for (let i = 0; i < arena.lives; i += 1) {
      c.fillStyle = i < 6 ? PALETTE.ok : PALETTE.textDim
      c.fillRect(lifeX + i * 7 * s, rowY - 2.5 * s, 5 * s, 3 * s)
    }
    c.fillStyle = PALETTE.textDim
    c.textAlign = 'left'
    c.fillText(`×${arena.lives}`, lifeX + Math.min(arena.lives, 6) * 7 * s + 3 * s, rowY)

    const remainingMs = Math.max(0, (match.totalSteps - match.stepsDone) * STEP_MS)
    const timeFontPx = Math.max(9, 11 * s)
    const timeFont = `700 ${timeFontPx}px ${FONTS.numeric}`
    const timeText = `${(remainingMs / 1000).toFixed(1)}초`
    c.textAlign = 'right'
    c.font = timeFont
    c.fillStyle = remainingMs <= 5000 ? PALETTE.danger : PALETTE.accent
    c.fillText(timeText, right, rowY)

    // 현재 순위 — 교실 뒤에서도 읽히도록 시간 왼쪽에.
    const timeWidth = measureCached(c, timeText.replace(/\d/g, '0'), timeFont)
    c.font = `700 ${timeFontPx}px ${FONTS.ui}`
    c.fillStyle = PALETTE.accentWarm
    c.fillText(`${rank}위`, right - timeWidth - 6 * s, rowY)

    // 활성 효과 — 글자 + 남은 시간 막대
    const views = activeEffects(arena.effects, arena.simTimeMs)
    if (views.length > 0) {
      const chipW = 34 * s
      const chipH = 11 * s
      const chipY = ay + (ARENA.height - 22) * s
      for (let i = 0; i < views.length; i += 1) {
        const v = views[i]
        const cx = left + i * (chipW + 3 * s)
        if (cx + chipW > right) break
        roundRectPath(c, cx, chipY, chipW, chipH, 2 * s)
        c.fillStyle = withAlpha(v.color, 0.22)
        c.fill()
        c.font = `700 ${Math.max(7, 8 * s)}px ${FONTS.numeric}`
        c.textAlign = 'left'
        c.textBaseline = 'middle'
        c.fillStyle = v.color
        c.fillText(v.glyph, cx + 3 * s, chipY + chipH / 2)
        if (v.remainingMs !== null) {
          const total = effectDurationMs(arena, v.kind)
          const ratio = Math.max(0, Math.min(1, v.remainingMs / Math.max(1, total)))
          const barX = cx + 11 * s
          const barW = chipW - 14 * s
          c.fillStyle = withAlpha(PALETTE.text, 0.18)
          c.fillRect(barX, chipY + chipH * 0.38, barW, chipH * 0.24)
          c.fillStyle = v.color
          c.fillRect(barX, chipY + chipH * 0.38, barW * ratio, chipH * 0.24)
        } else if (v.charges !== null) {
          c.font = `700 ${Math.max(7, 8 * s)}px ${FONTS.numeric}`
          c.fillStyle = v.color
          c.fillText(`×${v.charges}`, cx + 12 * s, chipY + chipH / 2)
        }
      }
    }

    // 획득 안내 (짧은 문구)
    const list = toasts.get(run.participant.id)
    if (list && list.length > 0) {
      let line = 0
      for (let i = 0; i < list.length; i += 1) {
        const toast = list[i]
        const left2 = toast.until - nowReal
        if (left2 <= 0) continue
        const a = Math.min(1, left2 / 420)
        c.font = `700 ${Math.max(9, 11 * s)}px ${FONTS.ui}`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        const ty = ay + (ARENA.height * 0.56 + line * 15) * s
        c.fillStyle = withAlpha('#070b18', a * 0.6)
        c.fillText(toast.text, ax + (ARENA.width / 2) * s + 1, ty + 1)
        c.fillStyle = withAlpha(toast.color, a)
        c.fillText(toast.text, ax + (ARENA.width / 2) * s, ty)
        line += 1
      }
      if (list.length > 0 && list[0].until <= nowReal) list.shift()
    }

    if (arena.gameOver) {
      c.fillStyle = withAlpha('#070b18', 0.55)
      c.fillRect(ax, ay, cell.aw, cell.ah)
      c.font = `700 ${Math.max(12, 18 * s)}px ${FONTS.ui}`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillStyle = PALETTE.danger
      c.fillText('게임 오버', ax + cell.aw / 2, ay + cell.ah / 2)
    }
  }

  /** mini 상세도 — 닉네임·점수는 반드시 읽히게, 효과는 글자 한 줄로 요약. */
  function drawMiniHud(
    c: CanvasRenderingContext2D,
    cell: Cell,
    run: ParticipantRun,
    arena: Arena | null,
    rank: number,
  ): void {
    const labelFontPx = Math.max(9, Math.min(15, cell.labelH * 0.78))
    const labelFont = `700 ${labelFontPx}px ${FONTS.ui}`
    const numFont = `700 ${labelFontPx}px ${FONTS.numeric}`
    const y = cell.y + cell.pad + cell.labelH / 2
    const accent = participantAccent(cell.runIndex)
    // 닉네임 줄은 칸 전체 폭을 쓴다 — 경기장이 좁아도 이름은 읽혀야 한다.
    const rowLeft = cell.x + cell.pad
    const rowRight = cell.x + cell.width - cell.pad
    const rowWidth = rowRight - rowLeft

    // 번호 — 색만으로 참가자를 구분하지 않도록 항상 함께 그린다.
    c.font = numFont
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    c.fillStyle = accent
    const tag = `${cell.runIndex + 1}`
    c.fillText(tag, rowLeft, y)
    const tagW = measureCached(c, tag.replace(/\d/g, '0'), numFont) + labelFontPx * 0.4

    // 점수 (오른쪽)
    const score = arena ? arena.score : (run.score ?? 0)
    const scoreText = String(score)
    c.font = numFont
    c.textAlign = 'right'
    c.fillStyle = PALETTE.text
    c.fillText(scoreText, rowRight, y)
    const scoreW = measureCached(c, scoreText.replace(/\d/g, '0'), numFont) + labelFontPx * 0.4

    // 닉네임 (가운데 남은 자리)
    const nameMax = rowWidth - tagW - scoreW - 6
    c.textAlign = 'left'
    c.fillStyle = PALETTE.textStrong
    c.font = labelFont
    c.fillText(fitText(c, run.participant.nickname, labelFont, nameMax), rowLeft + tagW, y)

    if (!arena) return

    // 아래 내용은 전부 경기장 사각형 안에만 그린다 — 좁은 칸에서 옆 칸을 침범하지 않게.
    c.save()
    c.beginPath()
    c.rect(cell.ax, cell.ay, cell.aw, cell.ah)
    c.clip()

    // 순위와 목숨 — 경기장 위쪽 빈 띠(벽돌이 시작되기 전)에 그린다.
    const s = cell.scale
    const bandY = cell.ay + (ARENA.brickTop - 30) * s
    const bandH = 22 * s
    const rankPx = Math.max(8, Math.min(16, bandH))
    c.font = `700 ${rankPx}px ${FONTS.ui}`
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    c.fillStyle = PALETTE.accentWarm
    c.fillText(`${rank}위`, cell.ax + (PLAY_LEFT + 3) * s, bandY + bandH / 2)
    const lifeW = Math.max(2, 4 * s)
    for (let i = 0; i < Math.min(arena.lives, 6); i += 1) {
      c.fillStyle = PALETTE.ok
      c.fillRect(
        cell.ax + cell.aw - (PLAY_LEFT + 3) * s - (i + 1) * (lifeW + 2),
        bandY + bandH / 2 - lifeW / 2,
        lifeW,
        Math.max(1.5, lifeW * 0.6),
      )
    }

    // 효과 요약 — 글자만. 색 위에 글자를 얹어 색맹도 구분할 수 있게 한다.
    const now = arena.simTimeMs
    const e = arena.effects
    let slot = 0
    const glyphPx = Math.max(7, labelFontPx * 0.8)
    c.font = `700 ${glyphPx}px ${FONTS.numeric}`
    c.textAlign = 'left'
    c.textBaseline = 'alphabetic'
    const gy = cell.ay + cell.ah - Math.max(2, cell.scale * 3)
    const drawGlyph = (kind: ItemKind): void => {
      const def = ITEM_DEFS[kind]
      c.fillStyle = def.color
      c.fillText(def.glyph, cell.ax + Math.max(2, cell.scale * 10) + slot * (glyphPx + 2), gy)
      slot += 1
    }
    if (e.expandUntil !== null && now < e.expandUntil) drawGlyph('expand')
    if (e.slowUntil !== null && now < e.slowUntil) drawGlyph('slow')
    if (e.weapon !== 'none' && e.weaponUntil !== null && now < e.weaponUntil) drawGlyph(e.weapon)
    if (e.shieldCharges > 0) drawGlyph('shield')

    if (arena.gameOver) {
      c.fillStyle = withAlpha('#070b18', 0.55)
      c.fillRect(cell.ax, cell.ay, cell.aw, cell.ah)
      c.font = `700 ${Math.max(8, cell.aw * 0.11)}px ${FONTS.ui}`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillStyle = PALETTE.danger
      c.fillText('종료', cell.ax + cell.aw / 2, cell.ay + cell.ah / 2)
    }
    c.restore()
  }

  /** 아직 시작하지 않았거나 건너뛴 참가자의 칸. */
  function drawIdleCell(c: CanvasRenderingContext2D, cell: Cell, run: ParticipantRun): void {
    c.fillStyle = withAlpha('#070b18', 0.45)
    c.fillRect(cell.ax, cell.ay, cell.aw, cell.ah)
    const fontPx = Math.max(9, Math.min(18, cell.aw * 0.1))
    c.font = `600 ${fontPx}px ${FONTS.ui}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillStyle = PALETTE.textDim
    c.fillText(
      run.excluded ? PLAY_STATUS_LABELS.excluded : STATUS_TEXT[run.status],
      cell.ax + cell.aw / 2,
      cell.ay + cell.ah / 2,
    )
  }

  /** 결과 공개 — 테두리 광채와 배지. 반복 섬광은 쓰지 않는다. */
  function drawHighlight(c: CanvasRenderingContext2D, cell: Cell, nowReal: number): void {
    const pulse = reducedMotion ? 0.45 : 0.4 + Math.sin(nowReal / 520) * 0.12
    c.save()
    c.strokeStyle = withAlpha(PALETTE.accentWarm, Math.min(0.85, pulse + 0.35))
    c.lineWidth = Math.max(2, Math.min(6, cell.aw * 0.012))
    c.shadowColor = withAlpha(PALETTE.accentWarm, pulse)
    c.shadowBlur = Math.max(6, cell.aw * 0.05)
    c.strokeRect(cell.ax + 1, cell.ay + 1, cell.aw - 2, cell.ah - 2)
    c.restore()

    const label = '이번 발표자'
    const fontPx = Math.max(9, Math.min(16, cell.aw * 0.075))
    const font = `700 ${fontPx}px ${FONTS.ui}`
    c.font = font
    const w = measureCached(c, label, font) + fontPx * 1.2
    const h = fontPx * 1.7
    const x = cell.ax + (cell.aw - w) / 2
    const y = cell.ay - h / 2 + Math.max(4, cell.ah * 0.02)
    roundRectPath(c, x, y, w, h, h / 2)
    c.fillStyle = PALETTE.accentWarm
    c.fill()
    c.fillStyle = '#070b18'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(label, x + w / 2, y + h / 2)
  }

  // ── 공개 API ──────────────────────────────────────────────────────────────

  function render(alpha: number): void {
    if (destroyed || !ctx) return
    const c = ctx
    const nowReal = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const dt = lastFrameAt === 0 ? 16 : Math.min(64, nowReal - lastFrameAt)
    lastFrameAt = nowReal
    const a = Math.max(0, Math.min(1, alpha))

    if (!sized) syncSizeFromCss()
    if (layoutDirty) computeLayout()

    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.fillStyle = PALETTE.background
    c.fillRect(0, 0, cssWidth, cssHeight)

    consumeEvents(nowReal)
    celebrateNewHighlights()
    particles.update(dt)
    updateRanks()

    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i]
      const run = match.runs[cell.runIndex]
      if (!run) continue
      const arena = run.arena

      const tile = arenaTile(cell.aw, cell.ah, cell.detail)
      if (tile) c.drawImage(tile, cell.ax, cell.ay, cell.aw, cell.ah)

      if (arena) {
        c.save()
        c.beginPath()
        c.rect(cell.ax, cell.ay, cell.aw, cell.ah)
        c.clip()
        drawArenaContents(c, cell, arena, a)
        if (cell.detail === 'full') {
          particles.draw(c, cell.scale, cell.ax, cell.ay, cell.participantId)
          drawFullHud(c, cell, run, arena, rankOf[cell.runIndex] ?? 1, nowReal)
        }
        c.restore()
      } else {
        drawIdleCell(c, cell, run)
      }

      if (cell.detail === 'mini') drawMiniHud(c, cell, run, arena, rankOf[cell.runIndex] ?? 1)

      if (highlightIds.indexOf(cell.participantId) >= 0) drawHighlight(c, cell, nowReal)
    }

    // 화면에 자리가 없어 못 그린 참가자 안내 — 경기는 전원 그대로 진행된다.
    if (hiddenCount > 0) {
      c.font = `600 ${Math.max(10, Math.min(14, cssWidth * 0.012))}px ${FONTS.ui}`
      c.textAlign = 'right'
      c.textBaseline = 'bottom'
      c.fillStyle = PALETTE.textDim
      c.fillText(`+${hiddenCount}명 더 경기 중`, cssWidth - 8, cssHeight - 6)
    }

    if (scanlines) {
      const pattern = scanlinePatternFor(c)
      if (pattern) {
        c.save()
        c.globalAlpha = 0.06
        c.fillStyle = pattern
        c.fillRect(0, 0, cssWidth, cssHeight)
        c.restore()
      }
    }
  }

  function applySize(w: number, h: number, d: number, setStyle: boolean): void {
    cssWidth = w
    cssHeight = h
    dpr = d
    const backingW = Math.max(1, Math.round(w * d))
    const backingH = Math.max(1, Math.round(h * d))
    // 같은 값을 다시 넣으면 캔버스가 지워지므로 달라졌을 때만 쓴다.
    if (canvas.width !== backingW) canvas.width = backingW
    if (canvas.height !== backingH) canvas.height = backingH
    if (setStyle) {
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    // 기기 픽셀 비율이 바뀌면 오프스크린 타일도 다시 만들어야 선명하다.
    tiles.clear()
    scanlinePattern = null
    scanlineTile = null
    layoutDirty = true
  }

  function resize(nextCssWidth: number, nextCssHeight: number, nextDpr: number): void {
    if (destroyed) return
    const w = Math.max(1, Math.round(nextCssWidth))
    const h = Math.max(1, Math.round(nextCssHeight))
    const d = Math.max(0.5, Math.min(4, nextDpr || 1))
    // 첫 호출은 값이 같아 보여도 반드시 적용한다 — 캔버스의 실제 버퍼는 아직 기본값(300×150)이다.
    if (sized && w === cssWidth && h === cssHeight && d === dpr) return
    sized = true
    applySize(w, h, d, true)
  }

  /** 호스트가 resize() 를 한 번도 부르지 않는 경우의 안전망. CSS 크기는 건드리지 않는다. */
  function syncSizeFromCss(): void {
    const w = Math.max(1, Math.round(canvas.clientWidth || cssWidth))
    const h = Math.max(1, Math.round(canvas.clientHeight || cssHeight))
    const d = Math.max(0.5, Math.min(4, (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1))
    if (w === cssWidth && h === cssHeight && d === dpr && canvas.width === Math.round(w * d)) return
    applySize(w, h, d, false)
  }

  function pointerToLocal(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: (clientX - rect.left) * (cssWidth / rect.width),
      y: (clientY - rect.top) * (cssHeight / rect.height),
    }
  }

  return {
    render,
    resize,

    setOptions(patch): void {
      if (destroyed) return
      let relayout = false
      if (patch.reducedMotion !== undefined && patch.reducedMotion !== reducedMotion) {
        reducedMotion = patch.reducedMotion
        particles.setReducedMotion(reducedMotion)
      }
      if (patch.scanlines !== undefined) scanlines = patch.scanlines
      if (patch.focusParticipantId !== undefined && patch.focusParticipantId !== focusParticipantId) {
        focusParticipantId = patch.focusParticipantId
        relayout = true
      }
      if (patch.highlightParticipantIds !== undefined) {
        highlightIds = [...patch.highlightParticipantIds]
      }
      if (relayout) layoutDirty = true
    },

    pointerToArenaX(clientX: number, clientY: number): number | null {
      if (destroyed) return null
      if (layoutDirty) computeLayout()
      // 확대 보기(또는 1인 경기)에서만 값을 낸다 — 격자 보기에서는 어느 칸인지 알 수 없다.
      let target: Cell | null = null
      let ambiguous = false
      for (let i = 0; i < cells.length; i += 1) {
        if (cells[i].detail !== 'full') continue
        if (target !== null) ambiguous = true
        target = cells[i]
      }
      if (ambiguous) {
        // full 이 여러 개면 지금 플레이 중인 칸 하나만 조작 대상으로 인정한다.
        target = null
        for (let i = 0; i < cells.length; i += 1) {
          const cell = cells[i]
          if (cell.detail !== 'full') continue
          const run = match.runs[cell.runIndex]
          if (!run || run.status !== 'playing' || !run.arena) continue
          if (target !== null) return null
          target = cell
        }
      }
      if (!target) return null
      const local = pointerToLocal(clientX, clientY)
      if (!local) return null
      const logical = (local.x - target.ax) / target.scale
      return Math.max(PLAY_LEFT, Math.min(PLAY_RIGHT, logical))
    },

    participantAt(clientX: number, clientY: number): string | null {
      if (destroyed) return null
      if (layoutDirty) computeLayout()
      const local = pointerToLocal(clientX, clientY)
      if (!local) return null
      for (let i = 0; i < cells.length; i += 1) {
        const cell = cells[i]
        if (
          local.x >= cell.x &&
          local.x <= cell.x + cell.width &&
          local.y >= cell.y &&
          local.y <= cell.y + cell.height
        ) {
          return cell.participantId
        }
      }
      return null
    },

    layout(): ArenaLayoutBox[] {
      if (destroyed) return []
      if (layoutDirty) computeLayout()
      return cells.map((cell) => ({
        participantId: cell.participantId,
        x: cell.x,
        y: cell.y,
        width: cell.width,
        height: cell.height,
        detail: cell.detail,
      }))
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true
      particles.clear()
      toasts.clear()
      celebrated.clear()
      cellByParticipant.clear()
      cells = []
      shadeCache.clear()
      fitCache.clear()
      measureCache.clear()
      // 오프스크린 캔버스를 0×0 으로 줄여 메모리를 바로 돌려준다.
      for (const tile of tiles.values()) {
        tile.width = 0
        tile.height = 0
      }
      tiles.clear()
      if (scanlineTile) {
        scanlineTile.width = 0
        scanlineTile.height = 0
        scanlineTile = null
      }
      scanlinePattern = null
    },
  }
}
