/**
 * 아이템 효과 상태 기계.
 *
 * 여기서는 "언제 켜지고 언제 꺼지는가"만 다룬다. 공을 실제로 나누거나 목숨을 더하는
 * 세계 변경은 engine.ts 가 한다. 이렇게 나누면 지속 시간·중첩·교체 규칙만 따로 시험할 수 있다.
 *
 * 규칙 요약
 *  - 같은 시간제 아이템을 다시 얻으면 남은 시간을 "기본값으로 갱신"한다. 더하지 않는다.
 *  - 캐치와 레이저는 하나뿐인 패들 무기 슬롯을 공유한다. 나중 것이 앞의 것을 교체한다.
 *  - 확장·슬로우·보호막은 무기와 동시에 쓸 수 있다.
 *  - 슬로우는 배율이므로 반복 획득해도 속도가 영구적으로 변하지 않는다.
 */

import type { ItemKind, ItemSettings } from './contract'
import { ITEM_DEFS } from './config'

export type WeaponSlot = 'none' | 'catch' | 'laser'

export interface ArenaEffects {
  /** 패들 확장이 끝나는 시뮬레이션 시각(ms). null 이면 꺼짐. */
  expandUntil: number | null
  /** 슬로우가 끝나는 시각(ms). */
  slowUntil: number | null
  /** 패들 무기 슬롯 — 캐치와 레이저가 공유한다. */
  weapon: WeaponSlot
  /** 무기가 끝나는 시각(ms). */
  weaponUntil: number | null
  /** 남은 보호막 횟수. */
  shieldCharges: number
  /** 마지막 레이저 발사 시각(ms). 발사 간격 제한에 쓴다. */
  lastLaserAt: number
}

export function createEffects(): ArenaEffects {
  return {
    expandUntil: null,
    slowUntil: null,
    weapon: 'none',
    weaponUntil: null,
    shieldCharges: 0,
    lastLaserAt: Number.NEGATIVE_INFINITY,
  }
}

/** 목숨을 잃었을 때 — 시간제 효과·보호막·무기를 전부 기본 상태로 되돌린다. */
export function resetEffects(effects: ArenaEffects): void {
  effects.expandUntil = null
  effects.slowUntil = null
  effects.weapon = 'none'
  effects.weaponUntil = null
  effects.shieldCharges = 0
  effects.lastLaserAt = Number.NEGATIVE_INFINITY
}

export const isExpandActive = (e: ArenaEffects, now: number): boolean =>
  e.expandUntil !== null && now < e.expandUntil

export const isSlowActive = (e: ArenaEffects, now: number): boolean =>
  e.slowUntil !== null && now < e.slowUntil

export const isCatchActive = (e: ArenaEffects, now: number): boolean =>
  e.weapon === 'catch' && e.weaponUntil !== null && now < e.weaponUntil

export const isLaserActive = (e: ArenaEffects, now: number): boolean =>
  e.weapon === 'laser' && e.weaponUntil !== null && now < e.weaponUntil

/**
 * 아이템을 받았을 때 상태를 갱신하고, engine 이 처리해야 할 "세계 변경 요청"을 돌려준다.
 *
 * 반환값
 *  - 'launch-stuck' : 붙어 있는 공을 지금 정상 발사해야 한다 (캐치 → 레이저 교체, 멀티볼).
 *  - 'split'        : 공을 나눠야 한다.
 *  - 'life'         : 목숨을 하나 더해야 한다.
 */
export type ItemAction = 'launch-stuck' | 'split' | 'life'

export function applyItemEffect(
  effects: ArenaEffects,
  kind: ItemKind,
  now: number,
  settings: ItemSettings,
): ItemAction[] {
  const actions: ItemAction[] = []
  switch (kind) {
    case 'expand':
      // 갱신 — 남은 시간에 더하지 않고 기본 지속 시간으로 다시 맞춘다.
      effects.expandUntil = now + settings.expandDurationMs
      break

    case 'slow':
      effects.slowUntil = now + settings.slowDurationMs
      break

    case 'catch':
      // 레이저였다면 캐치로 바뀐다. 이미 캐치였다면 시간만 갱신된다.
      effects.weapon = 'catch'
      effects.weaponUntil = now + settings.catchDurationMs
      break

    case 'laser':
      // 캐치에서 레이저로 바뀔 때 붙어 있던 공은 정상 발사한다.
      if (effects.weapon === 'catch') actions.push('launch-stuck')
      effects.weapon = 'laser'
      effects.weaponUntil = now + settings.laserDurationMs
      // 갱신 직후 바로 한 발 나가도록 쿨다운을 비운다.
      effects.lastLaserAt = Number.NEGATIVE_INFINITY
      break

    case 'shield':
      effects.shieldCharges = Math.min(settings.maxShieldCharges, effects.shieldCharges + 1)
      break

    case 'multiball':
      // 공이 전부 붙어 있으면 먼저 정상 발사한 뒤 나눈다.
      actions.push('launch-stuck', 'split')
      break

    case 'life':
      actions.push('life')
      break
  }
  return actions
}

/** 시간이 지난 효과를 끈다. 이번 스텝에 꺼진 효과 목록을 돌려준다(연출·안내용). */
export function expireEffects(effects: ArenaEffects, now: number): ItemKind[] {
  const expired: ItemKind[] = []
  if (effects.expandUntil !== null && now >= effects.expandUntil) {
    effects.expandUntil = null
    expired.push('expand')
  }
  if (effects.slowUntil !== null && now >= effects.slowUntil) {
    effects.slowUntil = null
    expired.push('slow')
  }
  if (effects.weaponUntil !== null && now >= effects.weaponUntil) {
    expired.push(effects.weapon === 'laser' ? 'laser' : 'catch')
    effects.weapon = 'none'
    effects.weaponUntil = null
  }
  return expired
}

export interface ActiveEffectView {
  kind: ItemKind
  label: string
  glyph: string
  color: string
  /** 남은 시간(ms). 횟수제 아이템은 null. */
  remainingMs: number | null
  /** 남은 횟수. 시간제 아이템은 null. */
  charges: number | null
}

/** 화면 옆에 "지금 켜진 효과와 남은 시간"을 그리기 위한 목록. */
export function activeEffects(effects: ArenaEffects, now: number): ActiveEffectView[] {
  const out: ActiveEffectView[] = []
  const push = (kind: ItemKind, remainingMs: number | null, charges: number | null): void => {
    const def = ITEM_DEFS[kind]
    out.push({ kind, label: def.label, glyph: def.glyph, color: def.color, remainingMs, charges })
  }
  if (isExpandActive(effects, now)) push('expand', (effects.expandUntil as number) - now, null)
  if (isSlowActive(effects, now)) push('slow', (effects.slowUntil as number) - now, null)
  if (effects.weapon !== 'none' && effects.weaponUntil !== null && now < effects.weaponUntil) {
    push(effects.weapon, effects.weaponUntil - now, null)
  }
  if (effects.shieldCharges > 0) push('shield', null, effects.shieldCharges)
  return out
}
