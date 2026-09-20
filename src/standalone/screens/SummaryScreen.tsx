/**
 * 4단계 — 규칙 요약.
 *
 * 경기 전에 점수·보너스·동점 처리·난이도·아이템·선정 규칙·seed 를 한 화면에서 모두 확인한다.
 * 숨겨진 보정은 없다. 여기 적힌 값이 그대로 경기에 들어간다.
 */

import {
  DIFFICULTY_LABELS,
  ITEM_DEFS,
  WAVE_CLEAR_BONUS_SCORE,
  describeSelectionRule,
  scoreTable,
} from '../../core'
import { Callout } from '../components/Callout'
import { Card, NavButtons, ScreenShell } from '../components/ScreenShell'
import {
  enabledItemKinds,
  estimatedDurationMs,
  formatDuration,
  maxCandidateCount,
  readinessProblem,
  ruleFromDraft,
} from '../state/store'
import type { StandaloneAction, StandaloneState } from '../state/store'
import type { Dispatch, ReactNode } from 'react'

export interface SummaryScreenProps {
  state: StandaloneState
  dispatch: Dispatch<StandaloneAction>
  names: Record<string, string>
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bp-kv">
      <dt className="bp-kv__key">{label}</dt>
      <dd className="bp-kv__value">{value}</dd>
    </div>
  )
}

export function SummaryScreen({ state, dispatch, names }: SummaryScreenProps) {
  const settings = state.settings
  const items = settings.items
  const rule = ruleFromDraft(state.selection)
  const candidates = maxCandidateCount(state)
  const problem = readinessProblem(state)
  const table = scoreTable(settings.maxBrickDurability)
  const activeKinds = enabledItemKinds(settings)
  const excluded = state.participants.filter((p) => state.excludedIds.includes(p.id))

  return (
    <ScreenShell
      title="규칙 요약"
      lead="경기에 들어가기 전에 이 화면에서 모든 규칙을 확인하세요. 점수 계산에 숨겨진 보정은 없습니다."
      footer={
        <NavButtons
          onBack={() => dispatch({ type: 'goto', screen: 'selection' })}
          onNext={() => dispatch({ type: 'startMatch' })}
          nextLabel="경기 시작"
          nextDisabled={problem !== null}
          nextBlockedReason={problem}
        />
      }
    >
      <Callout tone="warn">
        <strong>경기를 시작하면 설정을 바꿀 수 없습니다.</strong> 참가자·난이도·아이템·경기
        시간·선정 규칙·seed 는 시작하는 순간 그대로 고정됩니다. 바꾸려면 경기를 취소하고 이
        화면으로 돌아와야 합니다.
      </Callout>

      <div className="bp-summary-grid">
        <Card title="이번 경기">
          <dl className="bp-kv-list">
            <Row label="참가자" value={`${state.participants.length}명`} />
            <Row
              label="이번 선정에서 제외"
              value={
                excluded.length === 0
                  ? '없음'
                  : `${excluded.length}명 — ${excluded.map((p) => names[p.id] ?? p.nickname).join(', ')}`
              }
            />
            <Row label="선정 후보 (최대)" value={`${candidates}명`} />
            <Row label="경기 방식" value={state.mode === 'auto' ? '자동 경기' : '직접 조작'} />
            <Row
              label="경기 시간"
              value={
                state.roundMode === 'until-cleared'
                  ? `벽돌을 다 깰 때까지 (최대 ${Math.round(state.roundDurationMs / 1000)}초)`
                  : `${Math.round(state.roundDurationMs / 1000)}초`
              }
            />
            <Row
              label="예상 진행 시간"
              value={`약 ${formatDuration(estimatedDurationMs(state))}`}
            />
            <Row label="난이도" value={DIFFICULTY_LABELS[state.difficulty]} />
            <Row
              label="seed"
              value={
                <span className="bp-seed">
                  <code className="bp-code">{state.seed}</code>
                  <button
                    type="button"
                    className="bpx-btn bpx-btn--small"
                    onClick={() => dispatch({ type: 'rerollSeed' })}
                  >
                    다시 뽑기
                  </button>
                </span>
              }
            />
            <Row label="세션 ID" value={<code className="bp-code">{state.sessionId}</code>} />
          </dl>
          <p className="bp-field__hint">
            seed 는 동점을 가르는 추첨과 판 배치에 쓰입니다. 같은 seed·같은 설정이면 같은 판이
            나옵니다.
          </p>
        </Card>

        <Card title="선정 규칙">
          <p className="bp-big">{describeSelectionRule(rule, candidates)}</p>
          <p className="bp-note">
            선정은 <strong>후보 순위</strong> 기준입니다. 제외된 사람과 경기를 끝까지 마치지 못한
            사람은 후보에서 빠지고, 남은 사람끼리 1위부터 다시 번호를 매깁니다.
          </p>
        </Card>

        <Card title="점수표" hint="지금 난이도에서 실제로 나오는 벽돌만 보여 줍니다.">
          <table className="bp-table">
            <caption className="bp-sr-only">벽돌 종류별 점수</caption>
            <thead>
              <tr>
                <th scope="col">벽돌</th>
                <th scope="col">내구도</th>
                <th scope="col">부서지지 않은 타격</th>
                <th scope="col">부쉈을 때</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row) => (
                <tr key={row.label}>
                  <th scope="row">
                    <span
                      className="bp-swatch"
                      aria-hidden="true"
                      style={{ backgroundColor: row.color }}
                    />
                    {row.label}
                  </th>
                  <td className="bp-num">{row.durability}번</td>
                  <td className="bp-num">{row.hitScore}점</td>
                  <td className="bp-num">{row.breakScore}점</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="bp-note">
            한 판의 벽돌을 모두 부수면 <strong>{WAVE_CLEAR_BONUS_SCORE}점</strong> 보너스를 받고 새
            판이 채워집니다. 아이템을 받는 것 자체로는 점수가 오르지 않습니다.
          </p>
        </Card>

        <Card title="동점 처리">
          <ol className="bp-ordered">
            <li>점수가 높은 사람이 앞입니다.</li>
            <li>점수가 같으면 남은 목숨이 많은 사람이 앞입니다.</li>
            <li>
              그마저 같으면 <strong>seed 추첨</strong>으로 순서를 정합니다. 이름순이나 입력순으로
              가르지 않습니다.
            </li>
            <li>
              경기를 하지 않은 사람은 0점이 아니라 &ldquo;기록 없음&rdquo;으로 보고 항상 뒤에
              놓습니다.
            </li>
          </ol>
          <p className="bp-field__hint">
            결과 화면에서 누가 동점이었고 무엇으로 갈렸는지 그대로 보여 줍니다.
          </p>
        </Card>

        <Card title="난이도 수치">
          <dl className="bp-kv-list">
            <Row label="공 기본 속도" value={`${Math.round(settings.ballBaseSpeed)} 단위/초`} />
            <Row label="공 최대 속도" value={`${Math.round(settings.ballMaxSpeed)} 단위/초`} />
            <Row
              label="1분당 속도 증가"
              value={`${Math.round(settings.ballAccelPerMinute * 100)}%`}
            />
            <Row label="패들 너비" value={`${Math.round(settings.paddleWidth)} 단위`} />
            <Row label="패들 최대 너비" value={`${Math.round(settings.paddleMaxWidth)} 단위`} />
            <Row label="시작 목숨" value={`${settings.lives}개`} />
            <Row label="벽돌" value={`${settings.brickRows}줄 × 11칸`} />
            <Row label="가장 단단한 벽돌" value={`${settings.maxBrickDurability}번 맞아야 부서짐`} />
            {state.mode === 'auto' ? (
              <>
                <Row label="자동 패들 반응 지연" value={`${Math.round(settings.autoReactionMs)}ms`} />
                <Row label="자동 패들 조준 오차" value={settings.autoAimErrorSigma.toFixed(2)} />
                <Row
                  label="자동 패들이 크게 빗나갈 확률"
                  value={`${Math.round(settings.autoMissChance * 100)}%`}
                />
              </>
            ) : (
              <Row
                label="가장자리 보정 폭"
                value={`${Math.round(settings.manualEdgeForgiveness)} 단위`}
              />
            )}
          </dl>
        </Card>

        <Card title="아이템">
          {!items.enabled ? (
            <p className="bp-note">
              아이템을 껐습니다. 캡슐이 떨어지지 않고, 벽돌 점수만으로 순위가 정해집니다.
            </p>
          ) : activeKinds.length === 0 ? (
            <Callout tone="warn">
              켜진 아이템이 없거나 가중치가 모두 0이라 캡슐이 나오지 않습니다. 아이템을 쓰려면
              2단계로 돌아가 확인해 주세요.
            </Callout>
          ) : (
            <>
              <p className="bp-note">
                벽돌의 <strong>{Math.round(items.brickRatio * 100)}%</strong> 안에 캡슐이 들어
                있습니다. 캡슐은 초당 {Math.round(items.capsuleSpeed)} 단위로 떨어집니다. 동시에
                존재할 수 있는 공은 최대 {items.maxBalls}개입니다.
              </p>
              <ul className="bp-item-summary">
                {activeKinds.map((kind) => {
                  const def = ITEM_DEFS[kind]
                  const total = activeKinds.reduce((sum, k) => sum + items.weights[k], 0)
                  const share = total > 0 ? Math.round((items.weights[kind] / total) * 100) : 0
                  return (
                    <li key={kind} className="bp-item-summary__row">
                      <span
                        className="bp-item__glyph"
                        aria-hidden="true"
                        style={{ color: def.color }}
                      >
                        {def.glyph}
                      </span>
                      <span className="bp-item-summary__name">{def.label}</span>
                      <span className="bp-item-summary__desc">{def.description}</span>
                      <span className="bp-item-summary__share">{share}%</span>
                    </li>
                  )
                })}
              </ul>
              <p className="bp-field__hint">
                지속 시간 — 확장 {(items.expandDurationMs / 1000).toFixed(1)}초 · 캐치{' '}
                {(items.catchDurationMs / 1000).toFixed(1)}초 · 슬로우{' '}
                {(items.slowDurationMs / 1000).toFixed(1)}초 · 레이저{' '}
                {(items.laserDurationMs / 1000).toFixed(1)}초
              </p>
            </>
          )}
        </Card>
      </div>

      <Card title="참가 명단" collapsible defaultOpen={false} hint={`${state.participants.length}명`}>
        <ol className="bp-name-grid">
          {state.participants.map((p) => (
            <li key={p.id} className={state.excludedIds.includes(p.id) ? 'is-excluded' : ''}>
              <span className="bp-name-grid__name">{names[p.id] ?? p.nickname}</span>
              {state.excludedIds.includes(p.id) ? <span className="bp-tag">제외</span> : null}
            </li>
          ))}
        </ol>
      </Card>
    </ScreenShell>
  )
}
