/**
 * 난이도 수치 편집기.
 *
 * 범위(min/max/step)는 core 의 DIFFICULTY_RANGES 를 그대로 쓴다. 화면에 따로 적은 숫자가 없다.
 * 값을 하나라도 바꾸면 난이도 이름이 '사용자 설정'으로 바뀐다.
 */

import { DIFFICULTY_RANGES } from '../../core'
import type { DifficultySettings, GameMode } from '../../core'
import { RangeField } from './Field'
import { Card } from './ScreenShell'

export interface DifficultyEditorProps {
  settings: DifficultySettings
  mode: GameMode
  onPatch: (patch: Partial<Omit<DifficultySettings, 'items'>>) => void
}

const speed = (v: number): string => `${Math.round(v)} 단위/초`
const percent = (v: number): string => `${Math.round(v * 100)}%`

export function DifficultyEditor({ settings, mode, onPatch }: DifficultyEditorProps) {
  return (
    <div className="bp-editor">
      <Card title="공" hint="빠를수록 받아 내기 어렵습니다.">
        <RangeField
          label="공의 기본 속도"
          value={settings.ballBaseSpeed}
          range={DIFFICULTY_RANGES.ballBaseSpeed}
          display={speed}
          onChange={(v) => onPatch({ ballBaseSpeed: v })}
          hint="경기가 시작될 때의 속도입니다."
        />
        <RangeField
          label="공의 최대 속도"
          value={settings.ballMaxSpeed}
          range={DIFFICULTY_RANGES.ballMaxSpeed}
          display={speed}
          onChange={(v) => onPatch({ ballMaxSpeed: v })}
          hint="기본 속도보다 작게 넣으면 기본 속도에 맞춰집니다."
        />
        <RangeField
          label="1분당 속도 증가"
          value={settings.ballAccelPerMinute}
          range={DIFFICULTY_RANGES.ballAccelPerMinute}
          display={percent}
          onChange={(v) => onPatch({ ballAccelPerMinute: v })}
          hint="0%이면 경기 내내 같은 속도를 유지합니다."
        />
      </Card>

      <Card title="패들">
        <RangeField
          label="패들 기본 너비"
          value={settings.paddleWidth}
          range={DIFFICULTY_RANGES.paddleWidth}
          unit=" 단위"
          onChange={(v) => onPatch({ paddleWidth: v })}
          hint="경기장 가로는 320 단위입니다."
        />
        <RangeField
          label="패들 최대 너비"
          value={settings.paddleMaxWidth}
          range={DIFFICULTY_RANGES.paddleMaxWidth}
          unit=" 단위"
          onChange={(v) => onPatch({ paddleMaxWidth: v })}
          hint="패들 확장 아이템이 늘릴 수 있는 한계입니다."
        />
        {mode === 'manual' ? (
          <RangeField
            label="가장자리 보정 폭"
            value={settings.manualEdgeForgiveness}
            range={DIFFICULTY_RANGES.manualEdgeForgiveness}
            unit=" 단위"
            onChange={(v) => onPatch({ manualEdgeForgiveness: v })}
            hint="아슬아슬하게 빗나간 공을 이만큼까지 받아 줍니다. 직접 조작 모드에만 적용됩니다."
          />
        ) : null}
      </Card>

      <Card title="판과 목숨">
        <RangeField
          label="시작 목숨 수"
          value={settings.lives}
          range={DIFFICULTY_RANGES.lives}
          unit="개"
          onChange={(v) => onPatch({ lives: v })}
        />
        <RangeField
          label="벽돌 행 수"
          value={settings.brickRows}
          range={DIFFICULTY_RANGES.brickRows}
          unit="줄"
          onChange={(v) => onPatch({ brickRows: v })}
          hint="한 줄은 11칸입니다."
        />
        <RangeField
          label="가장 단단한 벽돌의 내구도"
          value={settings.maxBrickDurability}
          range={DIFFICULTY_RANGES.maxBrickDurability}
          unit="번"
          onChange={(v) => onPatch({ maxBrickDurability: v })}
          hint="이 값보다 단단한 벽돌 종류는 판에 나오지 않습니다."
        />
      </Card>

      {mode === 'auto' ? (
        <Card
          title="자동 패들"
          hint="자동 경기에서 컴퓨터가 패들을 다루는 방식입니다. 참가자의 실력과는 관계가 없습니다."
        >
          <RangeField
            label="반응 지연"
            value={settings.autoReactionMs}
            range={DIFFICULTY_RANGES.autoReactionMs}
            display={(v) => `${Math.round(v)}ms`}
            onChange={(v) => onPatch({ autoReactionMs: v })}
            hint="클수록 늦게 반응해 놓치기 쉬워집니다."
          />
          <RangeField
            label="조준 오차"
            value={settings.autoAimErrorSigma}
            range={DIFFICULTY_RANGES.autoAimErrorSigma}
            onChange={(v) => onPatch({ autoAimErrorSigma: v })}
            hint="패들 반너비를 1로 봤을 때의 흔들림 폭입니다."
          />
          <RangeField
            label="크게 빗나갈 확률"
            value={settings.autoMissChance}
            range={DIFFICULTY_RANGES.autoMissChance}
            display={percent}
            onChange={(v) => onPatch({ autoMissChance: v })}
          />
          <RangeField
            label="패들 이동 속도"
            value={settings.autoPaddleSpeed}
            range={DIFFICULTY_RANGES.autoPaddleSpeed}
            display={speed}
            onChange={(v) => onPatch({ autoPaddleSpeed: v })}
          />
        </Card>
      ) : null}
    </div>
  )
}
