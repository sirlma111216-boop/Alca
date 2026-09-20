/** 켜기/끄기 스위치. 체크박스를 그대로 쓰므로 키보드와 보조기기가 그냥 동작한다. */

import { useId } from 'react'
import type { ReactNode } from 'react'

export interface ToggleProps {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: ReactNode
  disabled?: boolean
  /** 켜짐/꺼짐 글자를 함께 보여 준다. 색만으로 상태를 알리지 않기 위한 것. */
  showState?: boolean
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled = false,
  showState = true,
}: ToggleProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div className={`bp-toggle${disabled ? ' is-disabled' : ''}`}>
      <input
        id={id}
        className="bp-toggle__input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label className="bp-toggle__label" htmlFor={id}>
        <span className="bp-toggle__track" aria-hidden="true">
          <span className="bp-toggle__knob" />
        </span>
        <span className="bp-toggle__text">
          {label}
          {showState ? (
            <span className="bp-toggle__state">{checked ? '켜짐' : '꺼짐'}</span>
          ) : null}
        </span>
      </label>
      {hint ? (
        <p id={hintId} className="bp-field__hint bp-toggle__hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
