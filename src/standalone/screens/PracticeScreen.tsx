/**
 * 혼자 연습하기.
 *
 * 이 사이트에 들어온 사람이 **설정 없이 바로 한 판** 할 수 있게 하는 화면이다.
 * 참가자 입력도, 선정 규칙도, 발표자도 없다 — 내 점수만 있다.
 *
 * 게임 자체는 mountBrickPick 을 그대로 쓴다(참가자 1명, 직접 조작).
 * 엔진·조작·아이템이 실제 경기와 완전히 같으므로 "연습" 이 실제 경기의 연습이 된다.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DIFFICULTY_LABELS,
  ROUND_DURATION_OPTIONS_MS,
  UNTIL_CLEARED_CAP_OPTIONS_MS,
  UNTIL_CLEARED_DEFAULT_CAP_MS,
} from '../../core'
import type { BrickPickResult, DifficultyPreset, RoundMode } from '../../core'
import { mountBrickPick } from '../../adapters/mount'
import type { BrickPickController } from '../../adapters/types'
import { ChoiceCards } from '../components/ChoiceCards'
import { Callout } from '../components/Callout'
import { Card, ScreenShell } from '../components/ScreenShell'
import {
  clearPracticeBests,
  loadPracticeBests,
  practiceKey,
  savePracticeBest,
} from '../state/store'
import type { PracticeBest, Preferences } from '../state/store'
import '../../styles/practice.css'

export interface PracticeScreenProps {
  prefs: Preferences
  onExit: () => void
}

type Stage = 'setup' | 'playing' | 'done'

/** 이번 판의 결과에서 화면에 쓸 값만 뽑아 둔다. */
interface PracticeRun {
  score: number
  clearedAtMs: number | null
  bricksDestroyed: number
  livesRemaining: number
  playedMs: number
  itemsCollected: number
  isBest: boolean
}

function formatMs(ms: number): string {
  const sec = ms / 1000
  return sec < 10 ? `${sec.toFixed(1)}초` : `${Math.round(sec)}초`
}

function bestText(best: PracticeBest | undefined, byClearTime: boolean): string {
  if (!best) return '아직 기록이 없습니다'
  if (byClearTime) {
    return best.clearedAtMs === null
      ? `${best.score.toLocaleString('ko-KR')}점 (아직 다 깨지 못함)`
      : `${formatMs(best.clearedAtMs)} 만에 클리어`
  }
  return `${best.score.toLocaleString('ko-KR')}점`
}

export function PracticeScreen({ prefs, onExit }: PracticeScreenProps) {
  const [stage, setStage] = useState<Stage>('setup')
  const [difficulty, setDifficulty] = useState<DifficultyPreset>(
    prefs.difficulty === 'custom' ? 'normal' : prefs.difficulty,
  )
  const [roundMode, setRoundMode] = useState<RoundMode>('fixed')
  const [roundDurationMs, setRoundDurationMs] = useState(60_000)
  const [run, setRun] = useState<PracticeRun | null>(null)
  const [bests, setBests] = useState<Record<string, PracticeBest>>(() => loadPracticeBests())
  /** 다시 할 때마다 새 판이 나오도록 매번 바꾼다. */
  const [attempt, setAttempt] = useState(0)

  const byClearTime = roundMode === 'until-cleared'
  const key = practiceKey(difficulty, roundMode, roundDurationMs)
  const best = bests[key]

  const hostRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<BrickPickController | null>(null)
  /** 콜백이 바뀌어도 게임이 다시 마운트되지 않게 최신 값을 ref 로 잡아 둔다. */
  const finishRef = useRef<(result: BrickPickResult) => void>(() => undefined)

  finishRef.current = (result: BrickPickResult) => {
    const me = result.participants[0]
    if (!me) return
    const record = { score: me.score ?? 0, clearedAtMs: me.clearedAtMs }
    const isBest = savePracticeBest(key, record, byClearTime)
    if (isBest) setBests(loadPracticeBests())
    setRun({
      score: record.score,
      clearedAtMs: record.clearedAtMs,
      bricksDestroyed: me.bricksDestroyed,
      livesRemaining: me.livesRemaining ?? 0,
      playedMs: me.playedMs,
      itemsCollected: me.items.reduce((n, i) => n + i.collected, 0),
      isBest,
    })
    setStage('done')
  }

  // 경기를 띄운다. attempt 가 바뀌면 새 판으로 다시 마운트한다.
  useEffect(() => {
    if (stage !== 'playing') return
    const host = hostRef.current
    if (!host) return

    const controller = mountBrickPick(host, {
      // 연습은 참가자가 나 하나뿐이다. 선정 규칙은 형식상 채운다(발표자를 뽑지 않는다).
      participants: [{ id: 'me', nickname: '나' }],
      mode: 'manual',
      difficulty,
      roundDurationMs,
      roundMode,
      selectionRule: { kind: 'top', count: 1 },
      excludedParticipantIds: [],
      soundEnabled: prefs.soundEnabled,
      reducedMotion: prefs.reducedMotion,
      scanlines: prefs.scanlines,
      autoStart: true,
      showControls: true,
      showLeaderboard: false,
      // 결과는 이 화면이 직접 그린다.
      showResult: false,
      hideParticipantEditor: true,
      onComplete: (result) => finishRef.current(result),
      onCancel: () => setStage('setup'),
      onError: () => setStage('setup'),
    })
    controllerRef.current = controller

    return () => {
      controller.destroy()
      controllerRef.current = null
    }
    // difficulty·시간은 setup 에서만 바꾸므로 경기 중에 바뀌지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, attempt])

  const startPlay = () => {
    setRun(null)
    setAttempt((n) => n + 1)
    setStage('playing')
  }

  const timeLabel = useMemo(
    () =>
      byClearTime
        ? `다 깰 때까지 (최대 ${Math.round(roundDurationMs / 1000)}초)`
        : `${Math.round(roundDurationMs / 1000)}초`,
    [byClearTime, roundDurationMs],
  )

  // ── 경기 중 ───────────────────────────────────────────────────────────────
  if (stage === 'playing') {
    return (
      <div className="bp-app bp-app--match">
        <div className="bp-prac-top">
          <span className="bp-prac-top__title">혼자 연습하기</span>
          <span className="bp-prac-top__meta">
            {DIFFICULTY_LABELS[difficulty]} · {timeLabel}
          </span>
          <button
            type="button"
            className="bpx-btn bpx-btn--small bpx-btn--ghost"
            onClick={() => {
              controllerRef.current?.cancel('user')
              setStage('setup')
            }}
          >
            그만두기
          </button>
        </div>
        <div className="bp-prac-stage" ref={hostRef} />
      </div>
    )
  }

  // ── 준비 / 결과 ───────────────────────────────────────────────────────────
  return (
    <ScreenShell
      title="혼자 연습하기"
      lead={
        stage === 'done'
          ? '수고했어요. 같은 설정으로 다시 해 보거나 난이도를 바꿔 보세요.'
          : '설정을 고르고 바로 시작하세요. 참가자 입력도, 발표자 선정도 없습니다.'
      }
      footer={
        <div className="bp-nav">
          <div className="bp-nav__left">
            <button type="button" className="bpx-btn bpx-btn--ghost" onClick={onExit}>
              ← 처음 화면으로
            </button>
          </div>
          <div className="bp-nav__right">
            <button type="button" className="bpx-btn bpx-btn--primary" onClick={startPlay}>
              {stage === 'done' ? '한 판 더 →' : '시작하기 →'}
            </button>
          </div>
        </div>
      }
    >
      {stage === 'done' && run ? (
        <div className={`bp-prac-result${run.isBest ? ' is-best' : ''}`}>
          {run.isBest ? <p className="bp-prac-result__badge">최고 기록!</p> : null}
          <p className="bp-prac-result__score">
            {byClearTime && run.clearedAtMs !== null
              ? formatMs(run.clearedAtMs)
              : `${run.score.toLocaleString('ko-KR')}점`}
          </p>
          <p className="bp-prac-result__sub">
            {byClearTime
              ? run.clearedAtMs !== null
                ? `벽돌을 전부 깼습니다 · ${run.score.toLocaleString('ko-KR')}점`
                : '아직 다 깨지 못했어요'
              : `깬 벽돌 ${run.bricksDestroyed}개 · 남은 목숨 ${run.livesRemaining}`}
          </p>
          <ul className="bp-prac-facts">
            <li>
              <span>깬 벽돌</span>
              <strong>{run.bricksDestroyed}개</strong>
            </li>
            <li>
              <span>받은 아이템</span>
              <strong>{run.itemsCollected}개</strong>
            </li>
            <li>
              <span>남은 목숨</span>
              <strong>{run.livesRemaining}</strong>
            </li>
            <li>
              <span>플레이 시간</span>
              <strong>{formatMs(run.playedMs)}</strong>
            </li>
          </ul>
        </div>
      ) : null}

      <Card
        title="내 최고 기록"
        hint="이 기기에만 남습니다. 설정(난이도·시간)이 다르면 기록도 따로 셉니다."
      >
        <p className="bp-prac-best">
          <span className="bp-prac-best__label">
            {DIFFICULTY_LABELS[difficulty]} · {timeLabel}
          </span>
          <strong className="bp-prac-best__value">{bestText(best, byClearTime)}</strong>
        </p>
        {Object.keys(bests).length > 0 ? (
          <button
            type="button"
            className="bpx-btn bpx-btn--small bpx-btn--danger"
            onClick={() => {
              clearPracticeBests()
              setBests({})
            }}
          >
            연습 기록 지우기
          </button>
        ) : null}
      </Card>

      <Card title="난이도">
        <ChoiceCards<DifficultyPreset>
          legend="난이도"
          variant="chips"
          value={difficulty}
          onChange={setDifficulty}
          options={(['easy', 'normal', 'hard'] as const).map((d) => ({
            value: d,
            label: DIFFICULTY_LABELS[d],
          }))}
        />
      </Card>

      <Card title="경기 시간">
        <ChoiceCards<string>
          legend="경기 시간"
          variant="chips"
          value={byClearTime ? 'cleared' : String(roundDurationMs)}
          onChange={(v) => {
            if (v === 'cleared') {
              setRoundMode('until-cleared')
              setRoundDurationMs(UNTIL_CLEARED_DEFAULT_CAP_MS)
            } else {
              setRoundMode('fixed')
              setRoundDurationMs(Number(v))
            }
          }}
          options={[
            ...ROUND_DURATION_OPTIONS_MS.map((ms) => ({
              value: String(ms),
              label: `${Math.round(ms / 1000)}초`,
            })),
            { value: 'cleared', label: '다 깰 때까지' },
          ]}
        />
        {byClearTime ? (
          <div className="bp-clearmode">
            <p className="bp-clearmode__lead">
              <strong>벽돌을 전부 깨면 끝납니다.</strong> 얼마나 빨리 깼는지가 기록이 됩니다.
            </p>
            <ChoiceCards<string>
              legend="못 깨면 끊을 시간"
              variant="chips"
              value={String(roundDurationMs)}
              onChange={(v) => setRoundDurationMs(Number(v))}
              options={UNTIL_CLEARED_CAP_OPTIONS_MS.map((ms) => ({
                value: String(ms),
                label: ms >= 60000 ? `${Math.round(ms / 60000)}분` : `${Math.round(ms / 1000)}초`,
              }))}
            />
          </div>
        ) : null}
      </Card>

      <Callout tone="info">
        조작은 <strong>마우스</strong>, <strong>키보드 ← →</strong> 또는 <strong>A · D</strong>,
        휴대폰은 <strong>손가락 드래그</strong>입니다. 공을 붙잡는 캐치 아이템을 먹으면{' '}
        <strong>스페이스바</strong>나 화면의 <strong>발사</strong> 버튼으로 쏘세요. 규칙은 실제
        경기와 완전히 같습니다.
      </Callout>
    </ScreenShell>
  )
}
