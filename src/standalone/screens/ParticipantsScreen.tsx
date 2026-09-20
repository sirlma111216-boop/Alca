/**
 * 1단계 — 참가자 입력.
 *
 * 명단은 기본적으로 저장하지 않는다. "이 기기에 저장" 을 눌렀을 때만 남는다.
 */

import { useMemo, useState } from 'react'
import { MAX_PARTICIPANTS } from '../../core'
import { Callout } from '../components/Callout'
import { Card, NavButtons, ScreenShell } from '../components/ScreenShell'
import {
  MAX_NICKNAME_LENGTH,
  SAMPLE_NAMES,
  clearSavedData,
  displayNameMap,
  loadRosterFromDevice,
  makeParticipantId,
  parseNameInput,
  saveRosterToDevice,
} from '../state/store'
import type { StandaloneAction, StandaloneState } from '../state/store'
import type { Dispatch } from 'react'

export interface ParticipantsScreenProps {
  state: StandaloneState
  dispatch: Dispatch<StandaloneAction>
}

export function ParticipantsScreen({ state, dispatch }: ParticipantsScreenProps) {
  const [bulk, setBulk] = useState('')
  const participants = state.participants
  const names = useMemo(() => displayNameMap(participants), [participants])

  const emptyNameCount = participants.filter((p) => p.nickname.trim().length === 0).length
  const duplicateCount = useMemo(() => {
    const seen = new Map<string, number>()
    for (const p of participants) seen.set(p.nickname, (seen.get(p.nickname) ?? 0) + 1)
    return [...seen.values()].filter((n) => n > 1).reduce((sum, n) => sum + n, 0)
  }, [participants])

  const overLimit = participants.length > MAX_PARTICIPANTS
  const blockedReason =
    participants.length === 0
      ? '참가자를 한 명 이상 입력해 주세요.'
      : overLimit
        ? `참가자는 최대 ${MAX_PARTICIPANTS}명까지 지원합니다. ${participants.length - MAX_PARTICIPANTS}명을 지워 주세요.`
        : emptyNameCount > 0
          ? `이름이 비어 있는 참가자가 ${emptyNameCount}명 있습니다. 이름을 적거나 지워 주세요.`
          : null

  const addBulk = () => {
    const parsed = parseNameInput(bulk)
    if (parsed.names.length === 0 && parsed.blanks === 0) {
      dispatch({ type: 'error', text: '추가할 이름이 없습니다. 줄바꿈이나 쉼표로 이름을 적어 주세요.' })
      return
    }
    dispatch({
      type: 'addNames',
      names: parsed.names,
      blanks: parsed.blanks,
      truncated: parsed.truncated,
    })
    setBulk('')
  }

  const fillSample = () => {
    const room = MAX_PARTICIPANTS - participants.length
    if (room <= 0) {
      dispatch({ type: 'error', text: `이미 ${participants.length}명이라 예시를 더 넣을 수 없습니다.` })
      return
    }
    dispatch({ type: 'addNames', names: SAMPLE_NAMES.slice(0, room) as string[] })
  }

  const saveToDevice = () => {
    const ok = saveRosterToDevice(participants)
    dispatch({ type: 'refreshSavedInfo' })
    dispatch({
      type: ok ? 'notice' : 'error',
      text: ok
        ? `참가자 ${participants.length}명을 이 기기에 저장했습니다. 다른 기기로는 가지 않습니다.`
        : '이 브라우저에서는 저장이 막혀 있습니다(사생활 보호 모드일 수 있습니다).',
    })
  }

  const loadFromDevice = () => {
    const list = loadRosterFromDevice()
    if (!list) {
      dispatch({ type: 'error', text: '이 기기에 저장된 명단이 없습니다.' })
      return
    }
    dispatch({
      type: 'replaceParticipants',
      list: list.map((p) => ({ id: p.id || makeParticipantId(), nickname: p.nickname })),
      notice: `저장해 둔 명단 ${list.length}명을 불러왔습니다.`,
    })
  }

  const clearDevice = () => {
    clearSavedData()
    dispatch({ type: 'refreshSavedInfo' })
    dispatch({
      type: 'notice',
      text: '이 기기에 저장해 둔 명단과 결과를 지웠습니다. 화면에 있는 명단은 그대로입니다.',
    })
  }

  return (
    <ScreenShell
      title="참가자 입력"
      lead={
        <>
          닉네임을 줄바꿈이나 쉼표로 구분해 한 번에 붙여 넣으세요. 최대 {MAX_PARTICIPANTS}명까지
          진행할 수 있습니다. 입력한 명단은 <strong>저장하지 않습니다</strong> — 저장이 필요하면
          아래 버튼을 눌러 주세요.
        </>
      }
      footer={
        <NavButtons
          onNext={() => dispatch({ type: 'goto', screen: 'mode' })}
          nextDisabled={blockedReason !== null}
          nextBlockedReason={blockedReason}
          nextLabel="경기 방식 고르기"
        />
      }
    >
      {state.savedRosterCount !== null ? (
        <Callout tone="warn">
          이 기기에 참가자 {state.savedRosterCount}명이 저장돼 있습니다. 아래 &ldquo;저장한 명단
          불러오기&rdquo; 로 쓰거나 &ldquo;저장한 내용 지우기&rdquo; 로 없앨 수 있습니다.
        </Callout>
      ) : null}

      <Card title="한 번에 붙여 넣기" hint="엑셀·메모장에서 복사한 이름 목록을 그대로 붙여 넣어도 됩니다.">
        <div className="bp-field">
          <label className="bp-field__label" htmlFor="bp-bulk">
            닉네임 목록
          </label>
          <textarea
            id="bp-bulk"
            className="bp-textarea"
            rows={6}
            value={bulk}
            spellCheck={false}
            placeholder={'김하늘\n이준호\n박서연\n또는: 김하늘, 이준호, 박서연'}
            aria-describedby="bp-bulk-hint"
            onChange={(e) => setBulk(e.target.value)}
          />
          <p id="bp-bulk-hint" className="bp-field__hint">
            빈 줄과 공백만 있는 줄은 이름이 없어 추가되지 않습니다. 이름은 {MAX_NICKNAME_LENGTH}
            자까지 쓸 수 있습니다. 같은 닉네임이 여럿이어도 괜찮습니다 — 화면에 (1), (2) 를 붙여
            구별합니다.
          </p>
        </div>
        <div className="bp-row-buttons">
          <button type="button" className="bpx-btn bpx-btn--primary" onClick={addBulk}>
            명단에 추가
          </button>
          <button type="button" className="bpx-btn" onClick={fillSample}>
            예시 참가자 채우기 ({SAMPLE_NAMES.length}명)
          </button>
          {participants.length > 0 ? (
            <button
              type="button"
              className="bpx-btn bpx-btn--danger"
              onClick={() => dispatch({ type: 'clearParticipants' })}
            >
              명단 전체 비우기
            </button>
          ) : null}
        </div>
      </Card>

      <Card
        title="참가자 명단"
        hint={
          <>
            참가자 <strong>{participants.length}명</strong> · 이번 경기 제외{' '}
            <strong>{state.excludedIds.length}명</strong> · 선정 후보 최대{' '}
            <strong>{Math.max(0, participants.length - state.excludedIds.length)}명</strong>
            {duplicateCount > 0 ? ` · 같은 닉네임 ${duplicateCount}명은 (1), (2) 로 구별합니다` : ''}
          </>
        }
      >
        {overLimit ? (
          <Callout tone="error">
            참가자가 {participants.length}명입니다. 브릭픽은 한 번에 {MAX_PARTICIPANTS}명까지
            진행합니다. {participants.length - MAX_PARTICIPANTS}명을 지우거나, 반을 나눠 두 번
            진행해 주세요.
          </Callout>
        ) : null}

        {participants.length === 0 ? (
          <p className="bp-empty">
            아직 참가자가 없습니다. 위에 이름을 붙여 넣거나 예시 참가자를 채워 보세요.
          </p>
        ) : (
          <ol className="bp-roster">
            {participants.map((p, index) => {
              const empty = p.nickname.trim().length === 0
              return (
                <li key={p.id} className={`bp-roster__row${empty ? ' is-invalid' : ''}`}>
                  <span className="bp-roster__index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="bp-sr-only">{index + 1}번 참가자</span>
                  <input
                    className="bp-input bp-roster__input"
                    type="text"
                    value={p.nickname}
                    maxLength={MAX_NICKNAME_LENGTH}
                    aria-label={`${index + 1}번 참가자 닉네임`}
                    aria-invalid={empty}
                    onChange={(e) =>
                      dispatch({ type: 'renameParticipant', id: p.id, nickname: e.target.value })
                    }
                  />
                  {names[p.id] !== p.nickname && !empty ? (
                    <span className="bp-roster__alias">화면 표시: {names[p.id]}</span>
                  ) : null}
                  {empty ? <span className="bp-roster__alias is-warn">이름이 비어 있습니다</span> : null}
                  <button
                    type="button"
                    className="bpx-btn bpx-btn--icon"
                    onClick={() => dispatch({ type: 'removeParticipant', id: p.id })}
                  >
                    <span aria-hidden="true">×</span>
                    <span className="bp-sr-only">
                      {p.nickname || `${index + 1}번`} 참가자 삭제
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </Card>

      <Card
        title="이 기기에 저장"
        hint="브릭픽은 어떤 것도 외부 서버로 보내지 않습니다. 저장을 누르면 이 브라우저에만 남습니다."
      >
        <div className="bp-row-buttons">
          <button
            type="button"
            className="bpx-btn"
            disabled={participants.length === 0}
            onClick={saveToDevice}
          >
            이 기기에 명단 저장
          </button>
          <button
            type="button"
            className="bpx-btn"
            disabled={state.savedRosterCount === null}
            onClick={loadFromDevice}
          >
            저장한 명단 불러오기
          </button>
          <button
            type="button"
            className="bpx-btn bpx-btn--danger"
            disabled={state.savedRosterCount === null && state.savedResultAt === null}
            onClick={clearDevice}
          >
            저장한 내용 지우기
          </button>
        </div>
      </Card>
    </ScreenShell>
  )
}
