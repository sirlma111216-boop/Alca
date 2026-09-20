/**
 * 6단계 — 결과.
 *
 * 중립적인 표현만 쓴다. "꼴찌"·"실패자" 같은 말을 쓰지 않고, 자동 경기의 점수를
 * 실력 평가처럼 설명하지 않는다.
 */

import { useMemo, useState } from 'react'
import { ITEM_DEFS, PLAY_STATUS_LABELS, describeSelectionRule } from '../../core'
import type { BrickPickResult, ParticipantResult } from '../../core'
import { Callout } from '../components/Callout'
import { Card, ScreenShell } from '../components/ScreenShell'
import { saveResultToDevice } from '../state/store'
import type { StandaloneAction, StandaloneState } from '../state/store'
import type { Dispatch } from 'react'

export interface ResultScreenProps {
  state: StandaloneState
  dispatch: Dispatch<StandaloneAction>
  result: BrickPickResult
}

const CONFETTI_COUNT = 16

function scoreText(p: ParticipantResult): string {
  return p.score === null ? '기록 없음' : `${p.score.toLocaleString('ko-KR')}점`
}

/** "다 깰 때까지" 경기에서 순위의 근거가 되는 값. 못 깼으면 그 사실을 적는다. */
function clearText(p: ParticipantResult): string {
  if (p.clearedAtMs === null) return '못 깸'
  const sec = p.clearedAtMs / 1000
  return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)}초에 클리어`
}

function tieText(p: ParticipantResult, nameOf: (id: string) => string): string | null {
  if (!p.tie.tied) return null
  const others = p.tie.tiedWith.filter((id) => id !== p.id).map(nameOf)
  const who = others.length > 0 ? `${others.join(', ')} 와 동점` : '동점'
  if (p.tie.resolvedBy === 'lives') return `${who} — 남은 목숨이 많은 쪽이 앞`
  if (p.tie.resolvedBy === 'seed') {
    const draw = typeof p.tie.drawValue === 'number' ? ` (추첨값 ${p.tie.drawValue.toFixed(4)})` : ''
    return `${who} — 점수와 목숨까지 같아 seed 추첨으로 결정${draw}`
  }
  return who
}

function downloadJson(result: BrickPickResult): void {
  const text = JSON.stringify(result, null, 2)
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `brickpick-${result.sessionId}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ResultScreen({ state, dispatch, result }: ResultScreenProps) {
  const [showAll, setShowAll] = useState(false)
  const reduced = state.prefs.reducedMotion

  const byId = useMemo(() => {
    const map = new Map<string, ParticipantResult>()
    for (const p of result.participants) map.set(p.id, p)
    return map
  }, [result])

  const nameOf = (id: string): string => byId.get(id)?.nickname ?? id

  const byRank = useMemo(
    () => [...result.participants].sort((a, b) => a.rank - b.rank),
    [result],
  )
  const byEligible = useMemo(
    () =>
      result.participants
        .filter((p) => p.eligibleRank !== null)
        .sort((a, b) => (a.eligibleRank ?? 0) - (b.eligibleRank ?? 0)),
    [result],
  )

  /** "다 깰 때까지" 경기였나. 그러면 순위 근거가 점수가 아니라 깬 시각이다. */
  const byClearTime = result.appliedSettings.roundMode === 'until-cleared'
  const selected = result.selectedParticipantIds
    .map((id) => byId.get(id))
    .filter((p): p is ParticipantResult => Boolean(p))

  const saveResult = () => {
    const ok = saveResultToDevice(result)
    dispatch({ type: 'refreshSavedInfo' })
    dispatch({
      type: ok ? 'notice' : 'error',
      text: ok
        ? '이번 결과를 이 기기에 저장했습니다. 외부로는 보내지 않습니다.'
        : '이 브라우저에서는 저장이 막혀 있습니다(사생활 보호 모드일 수 있습니다).',
    })
  }

  return (
    <ScreenShell
      title="경기 결과"
      lead={
        <>
          {describeSelectionRule(result.appliedSettings.selectionRule, result.eligibleCount)} 규칙으로
          {' '}
          {selected.length}명을 뽑았습니다.
        </>
      }
      footer={
        <div className="bp-nav">
          <div className="bp-nav__left">
            <button
              type="button"
              className="bpx-btn bpx-btn--ghost"
              onClick={() => dispatch({ type: 'restartAll' })}
            >
              처음부터 다시 설정하기
            </button>
          </div>
          <div className="bp-nav__right">
            <button type="button" className="bpx-btn" onClick={() => downloadJson(result)}>
              결과 JSON 내려받기
            </button>
            <button
              type="button"
              className="bpx-btn bpx-btn--primary"
              onClick={() => dispatch({ type: 'newRoundSameSettings' })}
            >
              같은 설정으로 새 경기 →
            </button>
          </div>
        </div>
      }
    >
      {/* 경기 중 건너뛰기·중도 취소로 후보가 줄어 규칙을 다 못 채웠으면 분명히 알린다. */}
      {result.selectionIssue ? (
        <Callout tone="warn">
          선정 규칙을 그대로 적용하지 못했습니다 — {result.selectionIssue.message}
        </Callout>
      ) : null}
      <div className={`bp-winner${reduced ? ' is-still' : ''}`}>
        {!reduced ? (
          <div className="bp-confetti" aria-hidden="true">
            {Array.from({ length: CONFETTI_COUNT }, (_, i) => (
              <span
                key={i}
                className="bp-confetti__piece"
                style={{
                  left: `${(i * 97) % 100}%`,
                  animationDelay: `${(i % 8) * 0.12}s`,
                }}
              />
            ))}
          </div>
        ) : null}
        <p className="bp-winner__tag">이번 발표자</p>
        <ul className="bp-winner__list">
          {selected.length === 0 ? (
            <li className="bp-winner__name">선정된 참가자가 없습니다.</li>
          ) : (
            selected.map((p) => {
              const reason = result.selectionReasons.find((r) => r.participantId === p.id)
              return (
                <li key={p.id} className="bp-winner__item">
                  <span className="bp-winner__name">{p.nickname}</span>
                  <span className="bp-winner__facts">
                    후보 {p.eligibleRank}위 · 전체 {p.rank}위 · {scoreText(p)}
                    {byClearTime ? ` · ${clearText(p)}` : ''}
                  </span>
                  {reason ? <span className="bp-winner__reason">{reason.reason}</span> : null}
                </li>
              )
            })
          )}
        </ul>
      </div>

      {selected.length === 0 ? (
        <Callout tone="warn">
          경기를 끝까지 마친 후보가 없어 발표자를 정하지 못했습니다. 제외 목록을 확인하고 다시
          진행해 주세요.
        </Callout>
      ) : null}

      <Callout tone="info">
        이 결과는 <strong>무작위 요소가 섞인 놀이</strong>입니다.
        {result.appliedSettings.mode === 'auto'
          ? ' 자동 경기에서는 컴퓨터가 모든 패들을 움직였습니다. 점수는 참가자의 실력이나 노력과 관계가 없습니다.'
          : ' 점수를 실력 평가로 쓰지 마세요.'}
      </Callout>

      <Card
        title="전체 순위와 후보 순위"
        hint="왼쪽은 참가자 전원 기준, 오른쪽은 제외·미완료를 뺀 후보 기준입니다. 발표자는 오른쪽 순위로 뽑습니다."
      >
        <div className="bp-rank-columns">
          <div className="bp-rank-column">
            <h3 className="bp-rank-column__title">
              전체 순위 <span className="bp-rank-column__count">{byRank.length}명</span>
            </h3>
            <ol className="bp-rank-list">
              {byRank.map((p) => (
                <li
                  key={p.id}
                  className={`bp-rank-list__row${
                    result.selectedParticipantIds.includes(p.id) ? ' is-selected' : ''
                  }`}
                >
                  <span className="bp-rank-list__no">{p.rank}</span>
                  <span className="bp-rank-list__name">{p.nickname}</span>
                  <span className="bp-rank-list__score">
                    {byClearTime ? clearText(p) : scoreText(p)}
                  </span>
                  {p.playStatus !== 'played' ? (
                    <span className="bp-tag">{PLAY_STATUS_LABELS[p.playStatus]}</span>
                  ) : null}
                  {p.tie.tied ? <span className="bp-tag bp-tag--muted">동점</span> : null}
                </li>
              ))}
            </ol>
          </div>

          <div className="bp-rank-column">
            <h3 className="bp-rank-column__title">
              후보 순위 <span className="bp-rank-column__count">{byEligible.length}명</span>
            </h3>
            {byEligible.length === 0 ? (
              <p className="bp-empty">후보가 없습니다.</p>
            ) : (
              <ol className="bp-rank-list">
                {byEligible.map((p) => (
                  <li
                    key={p.id}
                    className={`bp-rank-list__row${
                      result.selectedParticipantIds.includes(p.id) ? ' is-selected' : ''
                    }`}
                  >
                    <span className="bp-rank-list__no">{p.eligibleRank}</span>
                    <span className="bp-rank-list__name">{p.nickname}</span>
                    <span className="bp-rank-list__score">
                    {byClearTime ? clearText(p) : scoreText(p)}
                  </span>
                    <span className="bp-rank-list__aside">전체 {p.rank}위</span>
                    {result.selectedParticipantIds.includes(p.id) ? (
                      <span className="bp-tag bp-tag--pick">발표자</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
        <p className="bp-field__hint">
          제외했거나 경기를 끝까지 마치지 못한 참가자는 오른쪽 목록에 나오지 않습니다. 그래서 두
          목록의 순위 번호가 서로 다릅니다.
        </p>
      </Card>

      <Card
        title="자세한 결과"
        actions={
          <button
            type="button"
            className="bpx-btn bpx-btn--small"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? '접기' : '펼쳐 보기'}
          </button>
        }
      >
        {showAll ? (
          <div className="bp-table-scroll">
            <table className="bp-table bp-table--wide">
              <caption className="bp-sr-only">참가자별 전체 결과</caption>
              <thead>
                <tr>
                  <th scope="col">전체</th>
                  <th scope="col">후보</th>
                  <th scope="col">닉네임</th>
                  <th scope="col">점수</th>
                  <th scope="col">남은 목숨</th>
                  <th scope="col">부순 벽돌</th>
                  <th scope="col">클리어한 판</th>
                  <th scope="col">상태</th>
                  <th scope="col">동점 처리</th>
                  <th scope="col">획득 아이템</th>
                </tr>
              </thead>
              <tbody>
                {byRank.map((p) => {
                  const picked = result.selectedParticipantIds.includes(p.id)
                  const collected = p.items.filter((it) => it.collected > 0)
                  const tie = tieText(p, nameOf)
                  return (
                    <tr key={p.id} className={picked ? 'is-selected' : ''}>
                      <td className="bp-num">{p.rank}</td>
                      <td className="bp-num">{p.eligibleRank ?? '—'}</td>
                      <th scope="row">
                        {p.nickname}
                        {picked ? <span className="bp-tag bp-tag--pick">발표자</span> : null}
                      </th>
                      <td className="bp-num">{scoreText(p)}</td>
                      <td className="bp-num">{p.livesRemaining ?? '—'}</td>
                      <td className="bp-num">{p.bricksDestroyed}</td>
                      <td className="bp-num">{p.wavesCleared}</td>
                      <td>{PLAY_STATUS_LABELS[p.playStatus]}</td>
                      <td className="bp-tie">{tie ?? '해당 없음'}</td>
                      <td>
                        {collected.length === 0 ? (
                          '없음'
                        ) : (
                          <span className="bp-item-chips">
                            {collected.map((it) => (
                              <span key={it.kind} className="bp-item-chip">
                                <span
                                  className="bp-item-chip__glyph"
                                  aria-hidden="true"
                                  style={{ color: ITEM_DEFS[it.kind].color }}
                                >
                                  {ITEM_DEFS[it.kind].glyph}
                                </span>
                                {ITEM_DEFS[it.kind].label} {it.collected}개
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="bp-note">
            참가자 {result.participants.length}명의 점수·상태·동점 처리 근거·획득 아이템을 표로 볼
            수 있습니다.
          </p>
        )}
      </Card>

      <Card title="이 경기의 기록" collapsible defaultOpen={false}>
        <dl className="bp-kv-list">
          <div className="bp-kv">
            <dt className="bp-kv__key">seed</dt>
            <dd className="bp-kv__value">
              <code className="bp-code">{result.seed}</code>
            </dd>
          </div>
          <div className="bp-kv">
            <dt className="bp-kv__key">세션 ID</dt>
            <dd className="bp-kv__value">
              <code className="bp-code">{result.sessionId}</code>
            </dd>
          </div>
          <div className="bp-kv">
            <dt className="bp-kv__key">결과 ID</dt>
            <dd className="bp-kv__value">
              <code className="bp-code">{result.resultId}</code>
            </dd>
          </div>
          <div className="bp-kv">
            <dt className="bp-kv__key">엔진 버전</dt>
            <dd className="bp-kv__value">{result.engineVersion}</dd>
          </div>
          <div className="bp-kv">
            <dt className="bp-kv__key">진행 시각</dt>
            <dd className="bp-kv__value">
              {new Date(result.startedAt).toLocaleString('ko-KR')} →{' '}
              {new Date(result.completedAt).toLocaleString('ko-KR')}
            </dd>
          </div>
        </dl>
        <div className="bp-row-buttons">
          <button type="button" className="bpx-btn" onClick={() => downloadJson(result)}>
            결과 JSON 내려받기
          </button>
          <button type="button" className="bpx-btn" onClick={saveResult}>
            이 기기에 결과 저장
          </button>
        </div>
        <p className="bp-field__hint">
          결과는 자동으로 저장되지 않습니다. 필요할 때만 내려받거나 이 기기에 저장하세요.
          {state.savedResultAt
            ? ` 지금 이 기기에는 ${new Date(state.savedResultAt).toLocaleString('ko-KR')} 에 저장한 결과가 있습니다.`
            : ''}
        </p>
      </Card>
    </ScreenShell>
  )
}
