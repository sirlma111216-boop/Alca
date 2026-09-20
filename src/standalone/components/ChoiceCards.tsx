/**
 * 카드 모양 라디오 그룹.
 *
 * 고른 항목을 색으로만 표시하지 않는다 — 테두리·체크 표시·"선택됨" 글자를 함께 쓴다.
 * 실제 요소는 radio 라서 화살표 키로 이동하고 Space 로 고를 수 있다.
 */

import { useId } from 'react'
import type { ReactNode } from 'react'

export interface Choice<T extends string> {
  value: T
  label: string
  hint?: ReactNode
  /** 오른쪽 위에 붙는 짧은 꼬리표 (예: 예상 40초). */
  badge?: ReactNode
  disabled?: boolean
}

export interface ChoiceCardsProps<T extends string> {
  legend: string
  /** 설명 문장. legend 아래에 놓는다. */
  description?: ReactNode
  value: T
  options: ReadonlyArray<Choice<T>>
  onChange: (value: T) => void
  /** 'cards' 는 큰 카드, 'chips' 는 한 줄짜리 작은 버튼. */
  variant?: 'cards' | 'chips'
}

export function ChoiceCards<T extends string>({
  legend,
  description,
  value,
  options,
  onChange,
  variant = 'cards',
}: ChoiceCardsProps<T>) {
  const name = useId()
  return (
    <fieldset className="bp-choice">
      <legend className="bp-choice__legend">{legend}</legend>
      {description ? <p className="bp-choice__desc">{description}</p> : null}
      <div className={`bp-choice__list bp-choice__list--${variant}`}>
        {options.map((option) => {
          const id = `${name}-${option.value}`
          const selected = option.value === value
          return (
            <div
              key={option.value}
              className={`bp-choice__item${selected ? ' is-selected' : ''}${
                option.disabled ? ' is-disabled' : ''
              }`}
            >
              <input
                id={id}
                className="bp-choice__input"
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
              />
              <label className="bp-choice__label" htmlFor={id}>
                <span className="bp-choice__row">
                  <span className="bp-choice__mark" aria-hidden="true">
                    {selected ? '✓' : ''}
                  </span>
                  <span className="bp-choice__name">{option.label}</span>
                  {option.badge ? <span className="bp-choice__badge">{option.badge}</span> : null}
                </span>
                {option.hint ? <span className="bp-choice__hint">{option.hint}</span> : null}
                {selected ? <span className="bp-sr-only"> 선택됨</span> : null}
              </label>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
