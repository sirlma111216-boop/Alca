/**
 * 아이템 설정 편집기.
 *
 * 아이템 이름·표시 글자·설명은 core 의 ITEM_DEFS 를 그대로 쓴다.
 * 값의 허용 범위는 ITEM_SETTING_RANGES 를 그대로 쓴다.
 */

import { ITEM_DEFS, ITEM_KINDS, ITEM_SETTING_RANGES } from '../../core'
import type { ItemKind, ItemSettings } from '../../core'
import { RangeField } from './Field'
import { Card } from './ScreenShell'
import { Toggle } from './Toggle'

export interface ItemSettingsEditorProps {
  items: ItemSettings
  onPatch: (patch: Partial<ItemSettings>) => void
}

const seconds = (v: number): string => `${(v / 1000).toFixed(1)}초`
const percent = (v: number): string => `${Math.round(v * 100)}%`

/** 가중치 합계 대비 비율. 어떤 아이템이 얼마나 자주 나오는지 눈으로 보이게 한다. */
function shareText(items: ItemSettings, kind: ItemKind): string {
  const total = ITEM_KINDS.reduce(
    (sum, k) => sum + (items.enabledKinds[k] ? items.weights[k] : 0),
    0,
  )
  if (!items.enabledKinds[kind]) return '꺼짐'
  if (total <= 0) return '—'
  return `${Math.round((items.weights[kind] / total) * 100)}%`
}

export function ItemSettingsEditor({ items, onPatch }: ItemSettingsEditorProps) {
  const allOn = ITEM_KINDS.every((k) => items.enabledKinds[k])
  const off = !items.enabled

  const setAll = (on: boolean) => {
    const next = ITEM_KINDS.reduce(
      (acc, k) => {
        acc[k] = on
        return acc
      },
      {} as Record<ItemKind, boolean>,
    )
    onPatch({ enabledKinds: next })
  }

  return (
    <div className="bp-editor">
      <Card
        title="아이템 전체"
        hint="끄면 캡슐이 아예 떨어지지 않습니다. 순수하게 벽돌만 부수는 경기가 됩니다."
      >
        <Toggle
          label="아이템 사용"
          checked={items.enabled}
          onChange={(v) => onPatch({ enabled: v })}
        />
        <div className="bp-row-buttons">
          <button
            type="button"
            className="bpx-btn bpx-btn--small"
            disabled={off || allOn}
            onClick={() => setAll(true)}
          >
            아이템 7종 모두 켜기
          </button>
          <button
            type="button"
            className="bpx-btn bpx-btn--small"
            disabled={off}
            onClick={() => setAll(false)}
          >
            아이템 7종 모두 끄기
          </button>
        </div>
      </Card>

      <Card
        title="아이템 종류와 등장 비율"
        hint="가중치가 클수록 자주 나옵니다. 전부 0이면 아이템이 배치되지 않습니다."
      >
        <ul className="bp-item-list">
          {ITEM_KINDS.map((kind) => {
            const def = ITEM_DEFS[kind]
            const enabled = items.enabledKinds[kind]
            return (
              <li key={kind} className={`bp-item${enabled && !off ? '' : ' is-off'}`}>
                <div className="bp-item__head">
                  <span className="bp-item__glyph" aria-hidden="true" style={{ color: def.color }}>
                    {def.glyph}
                  </span>
                  <div className="bp-item__text">
                    <span className="bp-item__name">{def.label}</span>
                    <span className="bp-item__desc">{def.description}</span>
                  </div>
                  <span className="bp-item__share">{off ? '꺼짐' : shareText(items, kind)}</span>
                </div>
                <div className="bp-item__controls">
                  <Toggle
                    label={`${def.label} 사용`}
                    checked={enabled}
                    disabled={off}
                    showState={false}
                    onChange={(v) =>
                      onPatch({ enabledKinds: { ...items.enabledKinds, [kind]: v } })
                    }
                  />
                  <RangeField
                    label={`${def.label} 등장 가중치`}
                    value={items.weights[kind]}
                    range={ITEM_SETTING_RANGES.weight}
                    disabled={off || !enabled}
                    onChange={(v) => onPatch({ weights: { ...items.weights, [kind]: v } })}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      <Card title="캡슐">
        <RangeField
          label="아이템이 든 벽돌의 비율"
          value={items.brickRatio}
          range={ITEM_SETTING_RANGES.brickRatio}
          display={percent}
          disabled={off}
          onChange={(v) => onPatch({ brickRatio: v })}
          hint="이 비율만큼의 벽돌 안에 캡슐이 들어 있습니다."
        />
        <RangeField
          label="캡슐 낙하 속도"
          value={items.capsuleSpeed}
          range={ITEM_SETTING_RANGES.capsuleSpeed}
          display={(v) => `${Math.round(v)} 단위/초`}
          disabled={off}
          onChange={(v) => onPatch({ capsuleSpeed: v })}
          hint="느릴수록 받기 쉽습니다."
        />
      </Card>

      <Card title="지속 시간과 세기">
        <RangeField
          label="패들 확장 배율"
          value={items.expandFactor}
          range={ITEM_SETTING_RANGES.expandFactor}
          display={(v) => `${v.toFixed(2)}배`}
          disabled={off}
          onChange={(v) => onPatch({ expandFactor: v })}
        />
        <RangeField
          label="패들 확장 지속 시간"
          value={items.expandDurationMs}
          range={ITEM_SETTING_RANGES.expandDurationMs}
          display={seconds}
          disabled={off}
          onChange={(v) => onPatch({ expandDurationMs: v })}
        />
        <RangeField
          label="캐치 지속 시간"
          value={items.catchDurationMs}
          range={ITEM_SETTING_RANGES.catchDurationMs}
          display={seconds}
          disabled={off}
          onChange={(v) => onPatch({ catchDurationMs: v })}
        />
        <RangeField
          label="공이 패들에 붙어 있는 최대 시간"
          value={items.catchHoldMs}
          range={ITEM_SETTING_RANGES.catchHoldMs}
          display={seconds}
          disabled={off}
          onChange={(v) => onPatch({ catchHoldMs: v })}
          hint="이 시간이 지나면 자동으로 발사됩니다."
        />
        <RangeField
          label="슬로우 지속 시간"
          value={items.slowDurationMs}
          range={ITEM_SETTING_RANGES.slowDurationMs}
          display={seconds}
          disabled={off}
          onChange={(v) => onPatch({ slowDurationMs: v })}
        />
        <RangeField
          label="슬로우 속도 배율"
          value={items.slowFactor}
          range={ITEM_SETTING_RANGES.slowFactor}
          display={(v) => `${v.toFixed(2)}배`}
          disabled={off}
          onChange={(v) => onPatch({ slowFactor: v })}
          hint="작을수록 더 느려집니다."
        />
        <RangeField
          label="레이저 지속 시간"
          value={items.laserDurationMs}
          range={ITEM_SETTING_RANGES.laserDurationMs}
          display={seconds}
          disabled={off}
          onChange={(v) => onPatch({ laserDurationMs: v })}
        />
        <RangeField
          label="레이저 발사 간격"
          value={items.laserIntervalMs}
          range={ITEM_SETTING_RANGES.laserIntervalMs}
          display={(v) => `${Math.round(v)}ms`}
          disabled={off}
          onChange={(v) => onPatch({ laserIntervalMs: v })}
        />
      </Card>

      <Card title="한계값" hint="아이템이 꺼져 있어도 목숨 상한은 적용됩니다.">
        <RangeField
          label="동시에 존재할 수 있는 공의 최대 개수"
          value={items.maxBalls}
          range={ITEM_SETTING_RANGES.maxBalls}
          unit="개"
          disabled={off}
          onChange={(v) => onPatch({ maxBalls: v })}
        />
        <RangeField
          label="보유할 수 있는 보호막 횟수"
          value={items.maxShieldCharges}
          range={ITEM_SETTING_RANGES.maxShieldCharges}
          unit="회"
          disabled={off}
          onChange={(v) => onPatch({ maxShieldCharges: v })}
        />
        <RangeField
          label="목숨 상한"
          value={items.maxLives}
          range={ITEM_SETTING_RANGES.maxLives}
          unit="개"
          onChange={(v) => onPatch({ maxLives: v })}
          hint="시작 목숨보다 작게 넣으면 시작 목숨에 맞춰집니다."
        />
      </Card>
    </div>
  )
}
