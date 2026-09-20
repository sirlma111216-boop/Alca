/** 안내·오류 알림. 오류는 aria-live 로 스크린리더에 바로 읽힌다. */

import type { ReactNode } from 'react'

export type CalloutTone = 'info' | 'error' | 'ok' | 'warn'

const TONE_PREFIX: Record<CalloutTone, string> = {
  info: '안내',
  error: '확인 필요',
  ok: '완료',
  warn: '주의',
}

export interface CalloutProps {
  tone?: CalloutTone
  children: ReactNode
  /** 닫기 버튼을 붙인다. */
  onDismiss?: () => void
}

export function Callout({ tone = 'info', children, onDismiss }: CalloutProps) {
  const isError = tone === 'error'
  return (
    <div
      className={`bp-callout bp-callout--${tone}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <span className="bp-callout__tag">{TONE_PREFIX[tone]}</span>
      <div className="bp-callout__body">{children}</div>
      {onDismiss ? (
        <button type="button" className="bp-callout__close" onClick={onDismiss}>
          <span aria-hidden="true">×</span>
          <span className="bp-sr-only">알림 닫기</span>
        </button>
      ) : null}
    </div>
  )
}

/**
 * 화면에 표시할 내용이 없어도 항상 DOM 에 남아 있는 알림 자리.
 * 내용이 나중에 채워져도 보조기기가 읽어 준다.
 */
export function LiveRegion({
  notice,
  error,
  onDismissNotice,
  onDismissError,
}: {
  notice?: string | null
  error?: string | null
  onDismissNotice?: () => void
  onDismissError?: () => void
}) {
  return (
    <div className="bp-live">
      {error ? (
        <Callout tone="error" onDismiss={onDismissError}>
          {error}
        </Callout>
      ) : null}
      {notice ? (
        <Callout tone="info" onDismiss={onDismissNotice}>
          {notice}
        </Callout>
      ) : null}
    </div>
  )
}
