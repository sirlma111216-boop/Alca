/**
 * 벽돌 배치 생성.
 *
 * 핵심 규칙: **벽돌 배치와 아이템 배치는 매치 seed 에서만 파생한다.**
 * 참가자 ID 를 섞지 않으므로 자동 경기든 직접 조작이든 모든 참가자가
 * 글자 그대로 같은 판에서 시작하고, 벽돌을 깨는 순서가 달라도
 * 같은 벽돌에서는 항상 같은 아이템이 나온다.
 */

import { ARENA, BRICK_TYPES, BRICK_TYPE_ORDER, PLAY_LEFT, PLAY_WIDTH } from './config'
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

/** 난이도에 따라 실제로 쓸 벽돌 종류를 고른다. 위 행일수록 단단하다. */
export function brickTypesFor(maxDurability: number): BrickTypeId[] {
  const usable = BRICK_TYPE_ORDER.filter((id) => BRICK_TYPES[id].durability <= maxDurability)
  return usable.length > 0 ? [...usable] : ['mint']
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
  const types = brickTypesFor(difficulty.maxBrickDurability)

  const bricks: Brick[] = []
  for (let row = 0; row < rows; row += 1) {
    // 위 행 = types[0] (가장 단단함). 행 수가 종류 수보다 많으면 고르게 나눈다.
    const typeIdx = Math.min(types.length - 1, Math.floor((row * types.length) / rows))
    const typeId = types[typeIdx]
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
