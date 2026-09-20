/**
 * 점수 계산 — 순수 함수.
 *
 * 엔진이 실시간으로 더하는 점수와 **정확히 같은 규칙**을 여기서 다시 계산할 수 있다.
 * 테스트는 이 함수로 엔진 점수를 교차 검증한다(경기 이벤트 로그 → 점수).
 *
 * 점수 규칙은 경기 전 "규칙 요약" 화면에 그대로 표시된다. 숨겨진 보정은 없다.
 */

import { BRICK_TYPES, WAVE_CLEAR_BONUS, ITEM_PICKUP_SCORE } from './config'
import type { BrickTypeId } from './config'
import type { ArenaEvent } from './engine'

export interface BrickHitRecord {
  typeId: BrickTypeId
  /** 이 타격으로 벽돌이 부서졌는지. */
  destroyed: boolean
}

export interface ScoreInput {
  hits: BrickHitRecord[]
  wavesCleared: number
  /** 받은 아이템 개수. 기본 규칙에서는 점수에 영향이 없다(ITEM_PICKUP_SCORE = 0). */
  itemsCollected?: number
}

export interface ScoreBreakdown {
  /** 부서지지 않은 타격으로 얻은 점수. */
  fromHits: number
  /** 벽돌을 부숴 얻은 점수. */
  fromBreaks: number
  /** 판을 전멸시켜 얻은 보너스. */
  fromWaves: number
  /** 아이템 획득 점수 (기본 0). */
  fromItems: number
  total: number
}

export function computeScore(input: ScoreInput): ScoreBreakdown {
  let fromHits = 0
  let fromBreaks = 0
  for (const hit of input.hits) {
    const def = BRICK_TYPES[hit.typeId]
    // 모르는 벽돌 종류를 조용히 건너뛰면 점수가 적게 세어진다 — 바로 드러나게 던진다.
    if (!def) throw new Error(`알 수 없는 벽돌 종류입니다: ${String(hit.typeId)}`)
    if (hit.destroyed) fromBreaks += def.breakScore
    else fromHits += def.hitScore
  }
  const fromWaves = Math.max(0, input.wavesCleared) * WAVE_CLEAR_BONUS
  const fromItems = (input.itemsCollected ?? 0) * ITEM_PICKUP_SCORE
  return { fromHits, fromBreaks, fromWaves, fromItems, total: fromHits + fromBreaks + fromWaves + fromItems }
}

/** 경기 이벤트 로그만 보고 점수를 다시 계산한다. 엔진 점수와 같아야 한다. */
export function computeScoreFromEvents(events: readonly ArenaEvent[]): number {
  let total = 0
  for (const event of events) {
    if (event.type === 'brick-hit' || event.type === 'brick-break' || event.type === 'wave-clear') {
      total += event.score ?? 0
    }
  }
  return total
}

export interface ScoreTableRow {
  label: string
  durability: number
  hitScore: number
  breakScore: number
  color: string
}

/** 규칙 요약 화면에 그대로 그릴 수 있는 점수표. */
export function scoreTable(maxDurability = 3): ScoreTableRow[] {
  return Object.values(BRICK_TYPES)
    .filter((def) => def.durability <= maxDurability)
    .sort((a, b) => a.breakScore - b.breakScore)
    .map((def) => ({
      label: def.label,
      durability: def.durability,
      hitScore: def.hitScore,
      breakScore: def.breakScore,
      color: def.color,
    }))
}

export const WAVE_CLEAR_BONUS_SCORE = WAVE_CLEAR_BONUS
