/**
 * 2단계 — 경기 방식과 난이도.
 *
 * 난이도 수치와 아이템 수치를 하나라도 손대면 난이도 이름이 '사용자 설정'으로 바뀐다.
 * 어떤 값이 적용됐는지는 다음 단계의 "규칙 요약" 에서 전부 다시 확인할 수 있다.
 */

import { DIFFICULTY_LABELS, ROUND_DURATION_OPTIONS_MS } from '../../core'
import type { DifficultyPreset, GameMode } from '../../core'
import { Callout } from '../components/Callout'
import { ChoiceCards } from '../components/ChoiceCards'
import { DifficultyEditor } from '../components/DifficultyEditor'
import { ItemSettingsEditor } from '../components/ItemSettingsEditor'
import { Card, NavButtons, ScreenShell } from '../components/ScreenShell'
import { estimatedDurationMs, formatDuration } from '../state/store'
import type { StandaloneAction, StandaloneState } from '../state/store'
import type { Dispatch } from 'react'

export interface ModeScreenProps {
  state: StandaloneState
  dispatch: Dispatch<StandaloneAction>
}

const DIFFICULTY_HINTS: Record<DifficultyPreset, string> = {
  easy: '공이 느리고 목숨이 넉넉합니다. 아이템도 자주 나옵니다.',
  normal: '기준값입니다. 처음이라면 이쪽을 권합니다.',
  hard: '공이 빠르고 목숨이 적습니다. 점수 차가 크게 벌어집니다.',
  custom: '아래에서 수치를 직접 고른 상태입니다.',
}

export function ModeScreen({ state, dispatch }: ModeScreenProps) {
  const estimate = formatDuration(estimatedDurationMs(state))
  const touched = state.difficulty === 'custom'

  return (
    <ScreenShell
      title="경기 방식과 난이도"
      lead={
        <>
          예상 진행 시간은 약 <strong>{estimate}</strong> 입니다. 아래 값을 바꾸면 바로 다시
          계산됩니다.
        </>
      }
      footer={
        <NavButtons
          onBack={() => dispatch({ type: 'goto', screen: 'participants' })}
          onNext={() => dispatch({ type: 'goto', screen: 'selection' })}
          nextLabel="선정 규칙 고르기"
        />
      }
    >
      <Card title="경기 방식">
        <ChoiceCards<GameMode>
          legend="경기 방식"
          description="자동 경기는 참가자 전원이 한 화면에서 동시에 진행됩니다. 직접 조작은 한 사람씩 차례로 합니다."
          value={state.mode}
          onChange={(mode) => dispatch({ type: 'setMode', mode })}
          options={[
            {
              value: 'auto',
              label: '자동 경기',
              badge: '한 번에 끝',
              hint: '컴퓨터가 모든 참가자의 패들을 대신 움직입니다. 점수는 우연히 정해지며 참가자의 실력과는 관계가 없습니다.',
            },
            {
              value: 'manual',
              label: '직접 조작',
              badge: `참가자 ${state.participants.length}명 차례로`,
              hint: '참가자가 한 명씩 나와 마우스·터치·키보드로 직접 합니다. 사람 수만큼 시간이 늘어납니다.',
            },
          ]}
        />
      </Card>

      <Card title="경기 시간">
        <ChoiceCards<string>
          legend="한 차례의 경기 시간"
          description={
            state.mode === 'manual'
              ? '참가자 한 명당 이만큼씩 진행합니다.'
              : '이 시간이 지나면 경기가 끝나고 순위가 확정됩니다.'
          }
          variant="chips"
          value={String(state.roundDurationMs)}
          onChange={(v) => dispatch({ type: 'setRoundDuration', ms: Number(v) })}
          options={ROUND_DURATION_OPTIONS_MS.map((ms) => ({
            value: String(ms),
            label: `${Math.round(ms / 1000)}초`,
          }))}
        />
        <p className="bp-note">
          전체 예상 진행 시간: 약 <strong>{estimate}</strong> (준비와 결과 확인 시간을 포함한
          어림값입니다.)
        </p>
      </Card>

      <Card title="난이도">
        <ChoiceCards<DifficultyPreset>
          legend="난이도"
          value={state.difficulty}
          onChange={(preset) => dispatch({ type: 'setDifficultyPreset', preset })}
          options={(['easy', 'normal', 'hard', 'custom'] as DifficultyPreset[]).map((preset) => ({
            value: preset,
            label: DIFFICULTY_LABELS[preset],
            hint: DIFFICULTY_HINTS[preset],
          }))}
        />
        {touched ? (
          <Callout tone="info">
            수치를 직접 고른 상태입니다. 기준이 된 난이도는 &ldquo;
            {DIFFICULTY_LABELS[state.basePreset]}&rdquo; 입니다.
          </Callout>
        ) : (
          <p className="bp-note">
            아래에서 수치를 하나라도 바꾸면 난이도 이름이 &ldquo;사용자 설정&rdquo;으로 바뀝니다.
            원래 값으로 언제든 되돌릴 수 있습니다.
          </p>
        )}
        <div className="bp-row-buttons">
          <button
            type="button"
            className="bpx-btn"
            disabled={!touched}
            onClick={() => dispatch({ type: 'resetSettings' })}
          >
            기본값으로 되돌리기
          </button>
        </div>
      </Card>

      <Card
        title="세부 수치 (선택)"
        hint="그대로 두어도 괜찮습니다. 반 분위기에 맞춰 조절할 때만 펼치세요."
        collapsible
        defaultOpen={false}
      >
        <DifficultyEditor
          settings={state.settings}
          mode={state.mode}
          onPatch={(patch) => dispatch({ type: 'patchSettings', patch })}
        />
      </Card>

      <Card
        title="아이템 설정 (선택)"
        hint="벽돌 안에서 떨어지는 캡슐을 켜고 끄거나, 얼마나 자주 나올지 정합니다."
        collapsible
        defaultOpen={false}
      >
        <ItemSettingsEditor
          items={state.settings.items}
          onPatch={(patch) => dispatch({ type: 'patchItems', patch })}
        />
      </Card>
    </ScreenShell>
  )
}
