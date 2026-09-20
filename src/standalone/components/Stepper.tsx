/** 상단 단계 표시. 번호와 이름을 함께 써서 색만으로 현재 위치를 알리지 않는다. */

import { SCREEN_LABELS, SCREEN_ORDER } from '../state/store'
import type { ScreenId } from '../state/store'

export interface StepperProps {
  current: ScreenId
  /** 이미 지난 단계를 눌러 되돌아갈 수 있게 한다. 경기 중에는 넘기지 않는다. */
  onJump?: (screen: ScreenId) => void
}

export function Stepper({ current, onJump }: StepperProps) {
  const currentIndex = SCREEN_ORDER.indexOf(current)
  return (
    <nav className="bp-stepper" aria-label="진행 단계">
      <ol className="bp-stepper__list">
        {SCREEN_ORDER.map((screen, index) => {
          const state =
            index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo'
          const canJump = Boolean(onJump) && state === 'done'
          const label = `${index + 1}. ${SCREEN_LABELS[screen]}`
          return (
            <li
              key={screen}
              className={`bp-stepper__item bp-stepper__item--${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {canJump ? (
                <button
                  type="button"
                  className="bp-stepper__button"
                  onClick={() => onJump?.(screen)}
                >
                  {label}
                  <span className="bp-sr-only"> 단계로 돌아가기</span>
                </button>
              ) : (
                <span className="bp-stepper__button" aria-disabled={state === 'todo'}>
                  {label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
