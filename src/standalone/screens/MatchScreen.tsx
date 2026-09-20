/**
 * 5단계 — 경기.
 *
 * 이 화면은 **얇은 껍데기**다. 게임판·조작 버튼·실시간 순위·남은 시간은 전부
 * mountBrickPick 이 자기 DOM 안에 그린다. React 는 마운트할 때 한 번, 나가기 확인을 띄울 때
 * 한 번만 다시 그린다. 경기 프레임마다 React 가 다시 그리는 일은 없다.
 */

import { useEffect, useRef, useState } from 'react'
import { SCHEMA_VERSION } from '../../core'
import type { BrickPickCancelEvent, BrickPickErrorEvent, BrickPickResult } from '../../core'
import { mountBrickPick } from '../../adapters/mount'
import type { BrickPickController } from '../../adapters/types'
import { buildMatchInput } from '../state/store'
import type { StandaloneState } from '../state/store'

export interface MatchScreenProps {
  state: StandaloneState
  onComplete: (result: BrickPickResult) => void
  onCancel: (event: BrickPickCancelEvent) => void
  onError: (event: BrickPickErrorEvent) => void
}

export function MatchScreen({ state, onComplete, onCancel, onError }: MatchScreenProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<BrickPickController | null>(null)
  const [confirmExit, setConfirmExit] = useState(false)

  // 콜백은 ref 로 넘긴다. 부모가 다시 그려도 게임을 다시 마운트하지 않기 위한 것.
  const handlers = useRef({ onComplete, onCancel, onError })
  handlers.current = { onComplete, onCancel, onError }

  // 경기 입력은 시작하는 순간 얼린다. 경기 중에는 설정이 바뀌지 않는다.
  const frozen = useRef(buildMatchInput(state))
  const sessionId = frozen.current.sessionId

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    let controller: BrickPickController | null = null
    try {
      controller = mountBrickPick(host, {
        ...frozen.current,
        autoStart: true,
        showControls: true,
        showLeaderboard: true,
        // 결과는 단독 실행 사이트의 결과 화면이 그린다.
        showResult: false,
        scanlines: state.prefs.scanlines,
        progressIntervalMs: 500,
        hideParticipantEditor: true,
        onComplete: (result) => handlers.current.onComplete(result),
        onCancel: (event) => handlers.current.onCancel(event),
        onError: (event) => handlers.current.onError(event),
      })
      controllerRef.current = controller
    } catch (err) {
      handlers.current.onError({
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        status: 'error',
        code: 'INTERNAL',
        message: '게임을 띄우지 못했습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.',
        details: [err instanceof Error ? err.message : String(err)],
      })
    }

    return () => {
      controllerRef.current = null
      try {
        controller?.destroy()
      } catch {
        /* 이미 정리됐을 수 있다. */
      }
    }
    // 의도적으로 한 번만 실행한다 — 경기 중 재마운트는 진행을 잃는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const leaveMatch = () => {
    const controller = controllerRef.current
    if (controller) {
      controller.cancel('user')
      // cancel 이 onCancel 을 부르지 못하는 경우에도 화면이 멈추지 않도록 한 번 더 알린다.
      window.setTimeout(() => {
        if (controllerRef.current === controller) {
          handlers.current.onCancel({
            schemaVersion: SCHEMA_VERSION,
            sessionId,
            status: 'cancelled',
            cancelledAt: new Date().toISOString(),
            reason: 'user',
          })
        }
      }, 400)
    } else {
      handlers.current.onCancel({
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        reason: 'user',
      })
    }
  }

  return (
    <section className="bp-match" aria-labelledby="bp-match-title">
      <div className="bp-match__bar">
        <h1 id="bp-match-title" className="bp-match__title">
          경기 진행 중
          <span className="bp-match__meta">
            {state.mode === 'auto' ? '자동 경기' : '직접 조작'} · 참가자{' '}
            {state.participants.length}명 ·{' '}
            {state.roundMode === 'until-cleared'
              ? `다 깰 때까지 (최대 ${Math.round(state.roundDurationMs / 1000)}초)`
              : `${Math.round(state.roundDurationMs / 1000)}초`}
          </span>
        </h1>
        {confirmExit ? (
          <div className="bp-match__confirm" role="group" aria-label="경기 나가기 확인">
            <span className="bp-match__confirm-text">
              나가면 이번 경기 기록이 남지 않습니다.
            </span>
            <button type="button" className="bpx-btn bpx-btn--small" onClick={() => setConfirmExit(false)}>
              계속 진행
            </button>
            <button
              type="button"
              className="bpx-btn bpx-btn--small bpx-btn--danger"
              onClick={leaveMatch}
            >
              취소하고 나가기
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="bpx-btn bpx-btn--small bpx-btn--ghost"
            onClick={() => setConfirmExit(true)}
          >
            나가기
          </button>
        )}
      </div>
      <div className="bp-match__stage" ref={hostRef} />
    </section>
  )
}
