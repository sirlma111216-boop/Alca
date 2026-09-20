/**
 * 설정 입력 부품.
 *
 * 모든 입력은 label 과 id 로 연결한다. 슬라이더에는 같은 값을 직접 칠 수 있는
 * 숫자 칸을 함께 둬서, 마우스가 없어도 정확한 값을 넣을 수 있게 했다.
 */

import { useId } from 'react'
import type { ReactNode } from 'react'

export interface Range {
  min: number
  max: number
  step: number
}

function decimalsOf(step: number): number {
  const text = String(step)
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

export function formatNumber(value: number, step: number): string {
  const d = decimalsOf(step)
  return d === 0 ? String(Math.round(value)) : value.toFixed(d)
}

function clampToRange(value: number, range: Range): number {
  if (!Number.isFinite(value)) return range.min
  const clamped = Math.min(range.max, Math.max(range.min, value))
  const steps = Math.round((clamped - range.min) / range.step)
  const snapped = range.min + steps * range.step
  const d = decimalsOf(range.step)
  return Number(Math.min(range.max, Math.max(range.min, snapped)).toFixed(d + 2))
}

export interface RangeFieldProps {
  label: string
  value: number
  range: Range
  onChange: (value: number) => void
  /** 값 뒤에 붙는 단위. 예: 'ms', '%', '개' */
  unit?: string
  hint?: ReactNode
  disabled?: boolean
  /** 값을 사람이 읽기 좋은 문장으로 바꿔 보여 준다(예: 12000 → 12.0초). */
  display?: (value: number) => string
}

export function RangeField({
  label,
  value,
  range,
  onChange,
  unit,
  hint,
  disabled = false,
  display,
}: RangeFieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const shown = display ? display(value) : `${formatNumber(value, range.step)}${unit ?? ''}`
  return (
    <div className={`bp-field bp-field--range${disabled ? ' is-disabled' : ''}`}>
      <div className="bp-field__top">
        <label className="bp-field__label" htmlFor={id}>
          {label}
        </label>
        <output className="bp-field__value" htmlFor={id}>
          {shown}
        </output>
      </div>
      <div className="bp-field__controls">
        <input
          id={id}
          className="bp-range"
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          disabled={disabled}
          aria-describedby={hintId}
          onChange={(e) => onChange(clampToRange(Number(e.target.value), range))}
        />
        <input
          className="bp-input bp-input--num"
          type="number"
          min={range.min}
          max={range.max}
          step={range.step}
          value={formatNumber(value, range.step)}
          disabled={disabled}
          aria-label={`${label} 값 직접 입력`}
          onChange={(e) => onChange(clampToRange(Number(e.target.value), range))}
        />
      </div>
      {hint ? (
        <p id={hintId} className="bp-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export interface NumberFieldProps {
  label: string
  value: number
  range: Range
  onChange: (value: number) => void
  hint?: ReactNode
  disabled?: boolean
  unit?: string
}

export function NumberField({
  label,
  value,
  range,
  onChange,
  hint,
  disabled = false,
  unit,
}: NumberFieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div className={`bp-field${disabled ? ' is-disabled' : ''}`}>
      <label className="bp-field__label" htmlFor={id}>
        {label}
        {unit ? <span className="bp-field__unit"> ({unit})</span> : null}
      </label>
      <input
        id={id}
        className="bp-input bp-input--num"
        type="number"
        min={range.min}
        max={range.max}
        step={range.step}
        value={formatNumber(value, range.step)}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(e) => onChange(clampToRange(Number(e.target.value), range))}
      />
      {hint ? (
        <p id={hintId} className="bp-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export interface TextFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  placeholder?: string
  maxLength?: number
  /** 라벨을 화면에서 숨기고 보조기기에만 남긴다. */
  hiddenLabel?: boolean
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  maxLength,
  hiddenLabel = false,
}: TextFieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div className="bp-field">
      <label className={`bp-field__label${hiddenLabel ? ' bp-sr-only' : ''}`} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="bp-input"
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? (
        <p id={hintId} className="bp-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="bp-field-grid">{children}</div>
}
