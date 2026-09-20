/**
 * 화면 흐름 라우팅.
 *
 * 라우터 라이브러리를 쓰지 않는다 — 화면은 상태 하나(state.screen)로 정해진다.
 * 참가자 입력 → 경기 방식·난이도 → 선정 규칙 → 규칙 요약 → 경기 → 결과 → 다시 하기.
 */

import { useState } from 'react'
import { LiveRegion } from './components/Callout'
import { GradientRibbon, WordmarkBanner } from './components/Ribbon'
import { Stepper } from './components/Stepper'
import { Toggle } from './components/Toggle'
import { MatchScreen } from './screens/MatchScreen'
import { ModeScreen } from './screens/ModeScreen'
import { ParticipantsScreen } from './screens/ParticipantsScreen'
import { ResultScreen } from './screens/ResultScreen'
import { SelectionScreen } from './screens/SelectionScreen'
import { SummaryScreen } from './screens/SummaryScreen'
import { HostLiveScreen } from './screens/HostLiveScreen'
import { StudentJoinScreen } from './screens/StudentJoinScreen'
import { PracticeScreen } from './screens/PracticeScreen'
import { clearAllStoredData, useStandaloneStore } from './state/store'
import { readCodeFromUrl, isPracticeUrl } from '../live/types'
import type { AppMode } from '../live/types'

/**
 * 첫 진입 모드를 정한다.
 * 주소에 ?code=ABC123 이 있으면 QR 로 들어온 학생이므로 곧장 참여 화면으로 보낸다.
 */
function initialAppMode(): AppMode {
  if (typeof window === 'undefined') return 'solo'
  if (readCodeFromUrl(window.location.href)) return 'student'
  if (isPracticeUrl(window.location.href)) return 'practice'
  return 'solo'
}

export function App() {
  const { state, dispatch, names } = useStandaloneStore()
  const [appMode, setAppMode] = useState<AppMode>(initialAppMode)
  const inMatch = state.screen === 'match'
  /** 첫 화면에서만 큰 머리말(제목 + 리본)을 편다. 그 다음부터는 얇은 띠로 줄인다. */
  const isFront = state.screen === 'participants'

  /** 모드를 벗어날 때 주소의 ?code= 를 지운다 — 새로고침하면 또 학생 화면으로 가 버린다. */
  const backToSolo = (): void => {
    setAppMode('solo')
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.has('code') || url.searchParams.has('practice')) {
        url.searchParams.delete('code')
        url.searchParams.delete('practice')
        window.history.replaceState(null, '', url.toString())
      }
    } catch {
      /* 주소를 못 고쳐도 화면은 바뀐다 */
    }
  }

  if (appMode === 'student') {
    return <StudentJoinScreen initialCode={readCodeFromUrl(window.location.href)} onExit={backToSolo} />
  }

  if (appMode === 'practice') {
    return (
      <div className="bp-app">
        <PracticeScreen prefs={state.prefs} onExit={backToSolo} />
      </div>
    )
  }

  if (appMode === 'host') {
    return (
      <HostLiveScreen
        onExit={backToSolo}
        reducedMotion={state.prefs.reducedMotion}
        soundEnabled={state.prefs.soundEnabled}
      />
    )
  }

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
      <header className={`bp-band bp-band--dark bp-top${isFront ? '' : ' bp-top--bar'}`}>
        <div className="bp-top__row">
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
        </div>

        {isFront ? (
          <div className="bp-hero">
            <div className="bp-hero__copy">
              <span className="t-eyebrow">수업용 발표자 선정</span>
              <h1 className="bp-hero__title">벽돌을 깨서 이번 발표자를 정합니다</h1>
              <p className="bp-hero__lead">
                이름만 붙여 넣으면 됩니다. 명단과 결과는 이 기기 밖으로 나가지 않습니다.
              </p>

              <section className="bp-modepick" aria-label="진행 방식 고르기">
                <p className="bp-modepick__lead">
                  <strong>학생들이 자기 폰으로 참여</strong>하게 할 수도 있습니다.
                </p>
                <div className="bp-modepick__row">
                  <button
                    type="button"
                    className="bpx-btn bpx-btn--mint"
                    onClick={() => setAppMode('host')}
                  >
                    학생 폰으로 참여 →
                  </button>
                  <button type="button" className="bpx-btn" onClick={() => setAppMode('student')}>
                    나는 학생입니다
                  </button>
                  <button type="button" className="bpx-btn" onClick={() => setAppMode('practice')}>
                    혼자 연습하기
                  </button>
                </div>
                <p className="bp-modepick__note">
                  <strong>혼자 연습하기</strong>는 설정 없이 바로 한 판 하는 것입니다 — 발표자를
                  뽑지 않습니다.
                  <br />
                  아래 방식은 <strong>교사 기기 한 대</strong>로 끝냅니다 — 닉네임을 직접 입력하고
                  자동 경기로 뽑거나, 한 명씩 차례로 플레이합니다. 인터넷 연결이 없어도 됩니다.
                </p>
              </section>
            </div>
            <div className="bp-hero__art">
              <GradientRibbon />
            </div>
          </div>
        ) : null}
      </header>

      <div className="bp-band bp-band--steps">
        <Stepper current={state.screen} onJump={(screen) => dispatch({ type: 'goto', screen })} />
      </div>

      <div className="bp-band bp-band--live">
        <LiveRegion
          notice={state.notice}
          error={state.error}
          onDismissNotice={() => dispatch({ type: 'notice', text: null })}
          onDismissError={() => dispatch({ type: 'error', text: null })}
        />
      </div>

      <main className="bp-band bp-main">
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

      <footer className="bp-band bp-bottom">
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
          이 화면(교사 기기 한 대로 진행하는 방식)은 <strong>어떤 정보도 외부로 보내지 않습니다.</strong>{' '}
          참가자 명단과 경기 결과는 기본적으로 저장하지 않으며, 화면을 새로 고치면 사라집니다. 이
          기기에 남는 것은 위의 화면·소리 설정뿐입니다.
          <br />
          <strong>학생 폰으로 참여</strong>를 쓸 때만 서버에 연결합니다. 그때 올라가는 것은 학생이
          정한 별명과 점수뿐이고(실명·학번은 올라가지 않습니다), 8일 뒤 자동으로 사라집니다.
        </p>
        <WordmarkBanner />
      </footer>
    </div>
  )
}
