/**
 * 3단계 — 발표자 선정 규칙과 제외 목록.
 *
 * 모든 순위는 "제외하고 남은 후보" 기준이다. 전체 순위와 다르다는 점을 화면에 문장으로 적는다.
 */

import { SELECTION_PRESETS, checkSelectionRule, describeSelectionRule } from '../../core'
import { Callout } from '../components/Callout'
import { ChoiceCards } from '../components/ChoiceCards'
import { NumberField } from '../components/Field'
import { Card, NavButtons, ScreenShell } from '../components/ScreenShell'
import {
  maxCandidateCount,
  ruleFromDraft,
  selectionPreset,
} from '../state/store'
import type { StandaloneAction, StandaloneState } from '../state/store'
import type { Dispatch } from 'react'

export interface SelectionScreenProps {
  state: StandaloneState
  dispatch: Dispatch<StandaloneAction>
  names: Record<string, string>
}

export function SelectionScreen({ state, dispatch, names }: SelectionScreenProps) {
  const candidates = maxCandidateCount(state)
  const preset = selectionPreset(state.selection.presetId)
  const rule = ruleFromDraft(state.selection)
  const problem = checkSelectionRule(rule, candidates)
  const preview = describeSelectionRule(rule, candidates)
  const rankChoices = Array.from({ length: Math.max(1, Math.min(candidates, 40)) }, (_, i) => i + 1)

  const toggleRank = (rank: number) => {
    const has = state.selection.ranks.includes(rank)
    const next = has
      ? state.selection.ranks.filter((r) => r !== rank)
      : [...state.selection.ranks, rank].sort((a, b) => a - b)
    dispatch({ type: 'patchSelection', patch: { ranks: next } })
  }

  return (
    <ScreenShell
      title="선정 규칙"
      lead="어떤 성적의 참가자를 이번 발표자로 정할지 고릅니다. 경기 결과가 나온 뒤에 이 규칙대로 자동으로 뽑힙니다."
      footer={
        <NavButtons
          onBack={() => dispatch({ type: 'goto', screen: 'mode' })}
          onNext={() => dispatch({ type: 'goto', screen: 'summary' })}
          nextLabel="규칙 요약 보기"
          nextDisabled={problem !== null}
          nextBlockedReason={problem ? problem.message : null}
        />
      }
    >
      <Card title="규칙 고르기">
        <ChoiceCards<string>
          legend="발표자 선정 규칙"
          value={state.selection.presetId}
          onChange={(presetId) => dispatch({ type: 'patchSelection', patch: { presetId } })}
          options={SELECTION_PRESETS.map((p) => ({
            value: p.id,
            label: p.label,
            hint: p.hint,
          }))}
        />

        {preset.input === 'count' ? (
          <NumberField
            label="몇 명을 뽑을까요?"
            value={state.selection.count}
            range={{ min: 1, max: Math.max(1, candidates), step: 1 }}
            unit="명"
            onChange={(count) => dispatch({ type: 'patchSelection', patch: { count } })}
            hint={`지금 후보는 최대 ${candidates}명입니다.`}
          />
        ) : null}

        {preset.input === 'rank' ? (
          <NumberField
            label="몇 위를 뽑을까요?"
            value={state.selection.rank}
            range={{ min: 1, max: Math.max(1, candidates), step: 1 }}
            unit="위"
            onChange={(rank) => dispatch({ type: 'patchSelection', patch: { rank } })}
            hint="후보 순위 기준입니다. 제외된 사람은 이 순위에 들어가지 않습니다."
          />
        ) : null}

        {preset.input === 'ranks' ? (
          <fieldset className="bp-choice">
            <legend className="bp-choice__legend">뽑을 순위 고르기</legend>
            <p className="bp-choice__desc">
              여러 개를 고를 수 있습니다. 예를 들어 2위, 5위, 8위. 지금 고른 순위:{' '}
              <strong>
                {state.selection.ranks.length > 0
                  ? `${state.selection.ranks.join('위, ')}위`
                  : '아직 없음'}
              </strong>
            </p>
            <div className="bp-rank-chips">
              {rankChoices.map((rank) => {
                const on = state.selection.ranks.includes(rank)
                return (
                  <button
                    key={rank}
                    type="button"
                    className={`bp-chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggleRank(rank)}
                  >
                    {rank}위{on ? <span className="bp-sr-only"> 선택됨</span> : null}
                  </button>
                )
              })}
            </div>
          </fieldset>
        ) : null}

        <div className="bp-preview">
          <span className="bp-preview__tag">이렇게 뽑습니다</span>
          <p className="bp-preview__text">{preview}</p>
        </div>

        {problem ? <Callout tone="error">{problem.message}</Callout> : null}
      </Card>

      <Card
        title="이미 발표한 사람 제외"
        hint="체크한 사람은 이번 선정에서 빠집니다. 경기에는 그대로 참가하고 점수도 남습니다."
      >
        <p className="bp-note">
          브릭픽은 순위를 <strong>두 가지</strong>로 냅니다. <strong>전체 순위</strong>는 참가자
          전원을 점수순으로 줄 세운 것이고, <strong>후보 순위</strong>는 여기서 체크한 사람을 뺀
          뒤 다시 매긴 것입니다. 발표자는 언제나 <strong>후보 순위</strong>로 뽑습니다. 그래서
          전체 3위가 후보 1위가 될 수 있습니다. 결과 화면에서 두 순위를 나란히 볼 수 있습니다.
        </p>
        <p className="bp-note">
          또한 경기를 끝까지 마친 사람만 후보가 됩니다. 중간에 취소했거나 차례를 건너뛴 사람은
          점수가 0점이 아니라 &ldquo;기록 없음&rdquo;으로 남고 후보에서 빠집니다.
        </p>

        <div className="bp-counts">
          <span className="bp-counts__item">
            참가자 <strong>{state.participants.length}명</strong>
          </span>
          <span className="bp-counts__item">
            제외 <strong>{state.excludedIds.length}명</strong>
          </span>
          <span className="bp-counts__item">
            후보 최대 <strong>{candidates}명</strong>
          </span>
          <span className="bp-counts__item">
            이번 세션 발표 이력 <strong>{state.presentedIds.length}명</strong>
          </span>
        </div>

        <div className="bp-row-buttons">
          <button
            type="button"
            className="bpx-btn"
            disabled={state.presentedIds.length === 0}
            onClick={() => dispatch({ type: 'excludeAllPresented' })}
          >
            이미 발표한 사람 모두 제외하기
          </button>
          <button
            type="button"
            className="bpx-btn"
            disabled={state.excludedIds.length === 0}
            onClick={() => dispatch({ type: 'setExcluded', ids: [] })}
          >
            제외 목록 비우기
          </button>
          <button
            type="button"
            className="bpx-btn bpx-btn--danger"
            disabled={state.presentedIds.length === 0}
            onClick={() => dispatch({ type: 'clearPresented' })}
          >
            발표 이력 초기화
          </button>
        </div>
        <p className="bp-field__hint">
          발표 이력은 이 탭을 열어 둔 동안에만 남습니다. 새로 고치면 사라집니다.
        </p>

        {state.participants.length === 0 ? (
          <p className="bp-empty">참가자가 없습니다. 1단계에서 명단을 먼저 입력해 주세요.</p>
        ) : (
          <ul className="bp-exclude">
            {state.participants.map((p, index) => {
              const checked = state.excludedIds.includes(p.id)
              const presented = state.presentedIds.includes(p.id)
              const id = `bp-ex-${p.id}`
              return (
                <li key={p.id} className={`bp-exclude__row${checked ? ' is-on' : ''}`}>
                  <input
                    id={id}
                    type="checkbox"
                    className="bp-checkbox"
                    checked={checked}
                    onChange={() => dispatch({ type: 'toggleExcluded', id: p.id })}
                  />
                  <label htmlFor={id} className="bp-exclude__label">
                    <span className="bp-exclude__index" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="bp-exclude__name">{names[p.id] ?? p.nickname}</span>
                    {presented ? <span className="bp-tag">발표함</span> : null}
                    {checked ? <span className="bp-tag bp-tag--muted">이번 선정 제외</span> : null}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </ScreenShell>
  )
}
