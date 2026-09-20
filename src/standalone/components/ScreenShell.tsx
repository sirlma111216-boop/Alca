/** 설정 화면의 공통 뼈대 — 제목 / 설명 / 본문 / 아래쪽 이동 버튼. */

import type { ReactNode } from 'react'

export interface ScreenShellProps {
  title: string
  lead?: ReactNode
  children: ReactNode
  /** 아래쪽 이동 버튼 영역. */
  footer?: ReactNode
  /** 게임판이 중심인 화면에서 여백을 줄인다. */
  wide?: boolean
}

export function ScreenShell({ title, lead, children, footer, wide = false }: ScreenShellProps) {
  return (
    <section className={`bp-screen${wide ? ' bp-screen--wide' : ''}`} aria-labelledby="bp-screen-title">
      <header className="bp-screen__head">
        <h1 id="bp-screen-title" className="bp-screen__title">
          {title}
        </h1>
        {lead ? <p className="bp-screen__lead">{lead}</p> : null}
      </header>
      <div className="bp-screen__body">{children}</div>
      {footer ? <div className="bp-screen__nav">{footer}</div> : null}
    </section>
  )
}

export interface CardProps {
  title?: ReactNode
  hint?: ReactNode
  children: ReactNode
  /** 접었다 펼 수 있게 한다. */
  collapsible?: boolean
  defaultOpen?: boolean
  actions?: ReactNode
}

export function Card({
  title,
  hint,
  children,
  collapsible = false,
  defaultOpen = true,
  actions,
}: CardProps) {
  if (collapsible) {
    return (
      <details className="bp-card bp-card--collapsible" open={defaultOpen}>
        <summary className="bp-card__summary">
          <span className="bp-card__title">{title}</span>
          {hint ? <span className="bp-card__hint">{hint}</span> : null}
        </summary>
        <div className="bp-card__body">{children}</div>
      </details>
    )
  }
  return (
    <section className="bp-card">
      {title || actions ? (
        <header className="bp-card__head">
          <div>
            {title ? <h2 className="bp-card__title">{title}</h2> : null}
            {hint ? <p className="bp-card__hint">{hint}</p> : null}
          </div>
          {actions ? <div className="bp-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="bp-card__body">{children}</div>
    </section>
  )
}

export interface NavButtonsProps {
  backLabel?: string
  onBack?: () => void
  nextLabel?: string
  onNext?: () => void
  nextDisabled?: boolean
  /** 다음으로 못 가는 이유. 버튼 옆에 적고 보조기기에도 연결한다. */
  nextBlockedReason?: string | null
  extra?: ReactNode
}

export function NavButtons({
  backLabel = '이전',
  onBack,
  nextLabel = '다음',
  onNext,
  nextDisabled = false,
  nextBlockedReason = null,
  extra,
}: NavButtonsProps) {
  const reasonId = nextBlockedReason ? 'bp-next-reason' : undefined
  return (
    <div className="bp-nav">
      <div className="bp-nav__left">
        {onBack ? (
          <button type="button" className="bpx-btn bpx-btn--ghost" onClick={onBack}>
            ← {backLabel}
          </button>
        ) : null}
        {extra}
      </div>
      <div className="bp-nav__right">
        {nextBlockedReason ? (
          <p id={reasonId} className="bp-nav__reason">
            {nextBlockedReason}
          </p>
        ) : null}
        {onNext ? (
          <button
            type="button"
            className="bpx-btn bpx-btn--primary"
            onClick={onNext}
            disabled={nextDisabled}
            aria-describedby={reasonId}
          >
            {nextLabel} →
          </button>
        ) : null}
      </div>
    </div>
  )
}
