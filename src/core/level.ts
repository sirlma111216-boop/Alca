/**
 * 벽돌 배치 생성.
 *
 * 핵심 규칙: **벽돌 배치와 아이템 배치는 매치 seed 에서만 파생한다.**
 * 참가자 ID 를 섞지 않으므로 자동 경기든 직접 조작이든 모든 참가자가
 * 글자 그대로 같은 판에서 시작하고, 벽돌을 깨는 순서가 달라도
 * 같은 벽돌에서는 항상 같은 아이템이 나온다.
 */

import {
  ARENA,
  BRICK_TYPES,
  BRICK_TYPE_ORDER,
  PLAY_LEFT,
  PLAY_WIDTH,
  TOUGH_BAND_RATIO,
} from './config'
import type { BrickTypeId } from './config'
import type { DifficultySettings, ItemKind } from './contract'
import { ITEM_KINDS } from './contract'
import { createRng, matchSeedFor } from './rng'

export interface Brick {
  id: number
  col: number
  row: number
  x: number
  y: number
  w: number
  h: number
  typeId: BrickTypeId
  /** 남은 내구도. */
  hp: number
  maxHp: number
  /** 이 벽돌이 품고 있는 아이템. null 이면 없음. */
  item: ItemKind | null
  alive: boolean
  /** 캡슐을 이미 내보냈는지 — 같은 벽돌에서 캡슐이 두 번 나오지 않게 한다. */
  itemSpawned: boolean
  /** 마지막으로 맞은 시뮬레이션 시각(ms). 연출용이며 물리에는 영향이 없다. */
  lastHitAt: number
}

export interface Level {
  bricks: Brick[]
  /** 살아 있는 벽돌 수. */
  aliveCount: number
  cols: number
  rows: number
  brickW: number
  brickH: number
}

/**
 * 행마다 어떤 벽돌을 놓을지 정한다 — 맨 위 행부터 차례로.
 *
 * **단단한 벽돌은 가운데 띠에만 둔다.** 위아래 행은 전부 한 번에 깨진다.
 * 위를 무르게 두는 것이 핵심이다 — 공이 벽을 뚫고 위 빈 공간(hudBottom~brickTop)으로
 * 올라가면 천장과 벽돌 윗면 사이를 튀어 다니며 여러 줄을 한꺼번에 걷어낸다.
 *
 * 띠 안에서는 **가운데가 가장 단단**하고, 바깥으로 갈수록 무르다.
 * 띠 밖에서도 가운데에 가까운 행이 더 값지다 — 닿기 어려운 자리가 더 값진 게 자연스럽다.
 *
 * 예) 보통(7행, 최대 내구도 3)
 *     민트 · 연보라 · 주황 · 은백 · 자홍 · 연보라 · 민트
 *     → 두 번 이상 맞아야 하는 행은 7줄 중 3줄뿐이고, 맨 위 두 줄은 한 번에 깨진다.
 */
export function rowTypesFor(rows: number, maxDurability: number): BrickTypeId[] {
  const durability = (id: BrickTypeId): number => BRICK_TYPES[id].durability
  // BRICK_TYPE_ORDER 는 단단한 것부터다.
  const tough = BRICK_TYPE_ORDER.filter(
    (id) => durability(id) >= 2 && durability(id) <= maxDurability,
  )
  const soft = BRICK_TYPE_ORDER.filter((id) => durability(id) === 1)

  // 위아래로 무른 행을 최소 한 줄씩 남긴다. 행이 둘 이하면 띠를 만들지 않는다.
  const bandSize =
    tough.length === 0 || rows <= 2
      ? 0
      : Math.max(1, Math.min(rows - 2, Math.round(rows * TOUGH_BAND_RATIO)))
  const bandStart = Math.round((rows - bandSize) / 2)
  const bandEnd = bandStart + bandSize - 1

  // 띠 안: 가운데 행부터 바깥으로 번갈아 가며 단단한 순서대로 채운다.
  const bandType = new Map<number, BrickTypeId>()
  if (bandSize > 0) {
    const center = bandStart + Math.floor((bandSize - 1) / 2)
    const visiting: number[] = [center]
    for (let step = 1; visiting.length < bandSize; step += 1) {
      if (center - step >= bandStart) visiting.push(center - step)
      if (visiting.length < bandSize && center + step <= bandEnd) visiting.push(center + step)
    }
    visiting.forEach((row, i) => bandType.set(row, tough[Math.min(tough.length - 1, i)]))
  }

  const out: BrickTypeId[] = []
  for (let row = 0; row < rows; row += 1) {
    const inBand = bandType.get(row)
    if (inBand) {
      out.push(inBand)
      continue
    }
    // 띠에서 멀어질수록 무르고 값도 싸다 — 맨 위·맨 아래가 가장 싸다.
    const gap =
      bandSize > 0
        ? row < bandStart
          ? bandStart - row
          : row - bandEnd
        : Math.round(Math.abs(row - (rows - 1) / 2)) + 1
    out.push(soft[Math.min(soft.length - 1, gap - 1)])
  }
  return out
}

/** 아이템 배치에 쓸 수 있는 종류 목록 (전체 스위치 + 개별 스위치 + 가중치 > 0). */
export function usableItemKinds(settings: DifficultySettings['items']): ItemKind[] {
  if (!settings.enabled) return []
  return ITEM_KINDS.filter((k) => settings.enabledKinds[k] && settings.weights[k] > 0)
}

/**
 * 한 판(wave)의 벽돌을 만든다.
 *
 * @param seed   매치 seed (참가자별로 달라지지 않는다)
 * @param wave   1부터 시작하는 판 번호. 전멸시키면 같은 배치로 다음 판이 생기되
 *               아이템 배치는 판마다 새로 뽑는다.
 */
export function createLevel(
  seed: string,
  wave: number,
  difficulty: DifficultySettings,
): Level {
  const cols = ARENA.brickCols
  const rows = Math.max(1, Math.round(difficulty.brickRows))
  const brickW = PLAY_WIDTH / cols
  const brickH = ARENA.brickHeight
  const rowType = rowTypesFor(rows, difficulty.maxBrickDurability)

  const bricks: Brick[] = []
  for (let row = 0; row < rows; row += 1) {
    const typeId = rowType[row]
    const def = BRICK_TYPES[typeId]
    for (let col = 0; col < cols; col += 1) {
      bricks.push({
        id: row * cols + col,
        col,
        row,
        x: PLAY_LEFT + col * brickW,
        y: ARENA.brickTop + row * (brickH + ARENA.brickGap),
        w: brickW - ARENA.brickGap,
        h: brickH,
        typeId,
        hp: def.durability,
        maxHp: def.durability,
        item: null,
        alive: true,
        itemSpawned: false,
        lastHitAt: -1,
      })
    }
  }

  assignItems(bricks, seed, wave, difficulty)

  return { bricks, aliveCount: bricks.length, cols, rows, brickW, brickH }
}

/**
 * 아이템이 든 벽돌을 정한다. 매치 seed + 판 번호만 쓰므로 전원 동일하다.
 */
function assignItems(
  bricks: Brick[],
  seed: string,
  wave: number,
  difficulty: DifficultySettings,
): void {
  const items = difficulty.items
  const kinds = usableItemKinds(items)
  if (kinds.length === 0 || items.brickRatio <= 0) return

  const rng = createRng(matchSeedFor(seed, `items:wave:${wave}`))
  const count = Math.min(bricks.length, Math.round(bricks.length * items.brickRatio))
  if (count <= 0) return

  // 어느 벽돌이 아이템을 품는지 — 섞은 뒤 앞에서 count 개.
  const order = rng.shuffled(bricks.map((b) => b.id))
  const weights = kinds.map((k) => items.weights[k])
  const byId = new Map(bricks.map((b) => [b.id, b]))

  for (let i = 0; i < count; i += 1) {
    const brick = byId.get(order[i])
    if (!brick) continue
    const idx = rng.weightedIndex(weights)
    if (idx < 0) break
    brick.item = kinds[idx]
  }
}

/** 논리 좌표 → 벽돌 격자 인덱스. 범위를 벗어나면 -1. */
export function brickIndexAt(level: Level, x: number, y: number): number {
  const col = Math.floor((x - PLAY_LEFT) / level.brickW)
  const row = Math.floor((y - ARENA.brickTop) / (level.brickH + ARENA.brickGap))
  if (col < 0 || col >= level.cols || row < 0 || row >= level.rows) return -1
  return row * level.cols + col
}

/** 벽돌 격자의 전체 높이 (충돌 후보를 추릴 때 쓴다). */
export function levelBottom(level: Level): number {
  return ARENA.brickTop + level.rows * (level.brickH + ARENA.brickGap)
}
