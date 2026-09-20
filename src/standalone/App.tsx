/**
 * 화면 흐름 라우팅.
 *
 * 라우터 라이브러리를 쓰지 않는다 — 화면은 상태 하나(state.screen)로 정해진다.
 * 참가자 입력 → 경기 방식·난이도 → 선정 규칙 → 규칙 요약 → 경기 → 결과 → 다시 하기.
 */

import { LiveRegion } from './components/Callout'
import { Stepper } from './components/Stepper'
import { Toggle } from './components/Toggle'
import { MatchScreen } from './screens/MatchScreen'
import { ModeScreen } from './screens/ModeScreen'
import { ParticipantsScreen } from './screens/ParticipantsScreen'
import { ResultScreen } from './screens/ResultScreen'
import { SelectionScreen } from './screens/SelectionScreen'
import { SummaryScreen } from './screens/SummaryScreen'
import { clearAllStoredData, useStandaloneStore } from './state/store'

export function App() {
  const { state, dispatch, names } = useStandaloneStore()
  const inMatch = state.screen === 'match'

  if (inMatch) {
    return (
      <div className="bp-app bp-app--match">
        <MatchScreen
          state={state}
          onComplete={(result) => dispatch({ type: 'completed', result })}
          onCancel={(event) =>
            dispatch({
              type: 'cancelledMatch',
              message:
                event.reason === 'user'
                  ? '경기를 취소했습니다. 설정을 고쳐 다시 시작할 수 있습니다.'
                  : '경기가 중단됐습니다. 설정을 확인하고 다시 시작해 주세요.',
            })
          }
          onError={(event) => {
            dispatch({ type: 'goto', screen: 'summary' })
            dispatch({
              type: 'error',
              text:
                event.details && event.details.length > 0
                  ? `${event.message} (${event.details.join(' / ')})`
                  : event.message,
            })
          }}
        />
      </div>
    )
  }

  return (
    <div className="bp-app">
      <header className="bp-top">
        <div className="bp-top__brand">
          <span className="bp-top__logo" aria-hidden="true">
            <span className="bp-top__brick" />
            <span className="bp-top__brick" />
            <span className="bp-top__brick" />
          </span>
          <span className="bp-top__name">
            브릭픽 <span className="bp-top__name-en">BrickPick</span>
          </span>
        </div>
        <p className="bp-top__tagline">수업용 벽돌깨기 발표자 선정</p>
      </header>

      <Stepper current={state.screen} onJump={(screen) => dispatch({ type: 'goto', screen })} />

      <LiveRegion
        notice={state.notice}
        error={state.error}
        onDismissNotice={() => dispatch({ type: 'notice', text: null })}
        onDismissError={() => dispatch({ type: 'error', text: null })}
      />

      <main className="bp-main">
        {state.screen === 'participants' ? (
          <ParticipantsScreen state={state} dispatch={dispatch} />
        ) : null}
        {state.screen === 'mode' ? <ModeScreen state={state} dispatch={dispatch} /> : null}
        {state.screen === 'selection' ? (
          <SelectionScreen state={state} dispatch={dispatch} names={names} />
        ) : null}
        {state.screen === 'summary' ? (
          <SummaryScreen state={state} dispatch={dispatch} names={names} />
        ) : null}
        {state.screen === 'result' && state.result ? (
          <ResultScreen state={state} dispatch={dispatch} result={state.result} />
        ) : null}
        {state.screen === 'result' && !state.result ? (
          <p className="bp-empty">
            아직 결과가 없습니다.{' '}
            <button
              type="button"
              className="bp-linkbtn"
              onClick={() => dispatch({ type: 'goto', screen: 'summary' })}
            >
              규칙 요약으로 돌아가기
            </button>
          </p>
        ) : null}
      </main>

      <footer className="bp-bottom">
        <details className="bp-prefs">
          <summary className="bp-prefs__summary">화면·소리 설정</summary>
          <div className="bp-prefs__body">
            <Toggle
              label="소리"
              checked={state.prefs.soundEnabled}
              onChange={(v) => dispatch({ type: 'patchPrefs', patch: { soundEnabled: v } })}
              hint="벽돌·패들 소리를 코드로 합성해 냅니다. 교실에서는 꺼 두어도 됩니다."
            />
            <Toggle
              label="모션 줄이기"
              checked={state.prefs.reducedMotion}
              onChange={(v) => dispatch({ type: 'patchPrefs', patch: { reducedMotion: v } })}
              hint="잔상·파티클·화면 움직임을 줄입니다. 기기 설정을 처음 값으로 읽어 왔습니다."
            />
            <Toggle
              label="스캔라인 효과"
              checked={state.prefs.scanlines}
              onChange={(v) => dispatch({ type: 'patchPrefs', patch: { scanlines: v } })}
              hint="옛 브라운관 느낌의 가로줄을 덧씌웁니다. 프로젝터에서는 끄는 편이 잘 보입니다."
            />
            <div className="bp-row-buttons">
              <button
                type="button"
                className="bpx-btn bpx-btn--small bpx-btn--danger"
                onClick={() => {
                  clearAllStoredData()
                  dispatch({ type: 'refreshSavedInfo' })
                  dispatch({
                    type: 'notice',
                    text: '이 기기에 저장한 환경설정·명단·결과를 모두 지웠습니다.',
                  })
                }}
              >
                이 기기에 저장한 내용 모두 지우기
              </button>
            </div>
          </div>
        </details>
        <p className="bp-bottom__note">
          브릭픽은 어떤 정보도 외부 서버로 보내지 않습니다. 참가자 명단과 경기 결과는 기본적으로
          저장하지 않으며, 화면을 새로 고치면 사라집니다. 이 기기에 남는 것은 위의 화면·소리
          설정뿐입니다.
        </p>
      </footer>
    </div>
  )
}
