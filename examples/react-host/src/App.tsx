/**
 * ════════════════════════════════════════════════════════════════════════════
 *  브릭픽을 npm 패키지로 설치해 쓰는 최소 예제.
 *
 *  같은 게임을 붙이는 두 가지 길을 나란히 보여 준다.
 *    ① React 컴포넌트   : <BrickPick {...옵션} />        ← 'brickpick/react'
 *    ② 직접 붙이기      : mountBrickPick(요소, 옵션)      ← 'brickpick'
 *  둘은 **완전히 같은 옵션**을 받고 **완전히 같은 결과**를 돌려준다.
 *  React 를 쓰지 않는 수업 앱은 ②만 있으면 된다.
 *
 *  확인할 것 하나
 *    여기서 넘긴 참가자 id 가 결과의 selectedParticipantIds 에 그대로 돌아온다.
 *    학번처럼 수업 앱이 이미 쓰는 값을 그대로 넣어도 안전하다는 뜻이다.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { mountBrickPick } from 'brickpick'
import { BrickPick } from 'brickpick/react'
import type { BrickPickOptions, BrickPickResult, Participant } from 'brickpick'

// ── 수업 앱이 이미 들고 있는 명단이라고 치자 ────────────────────────────────
// id 는 학번, nickname 은 화면에 보일 이름이다.
const PARTICIPANTS: Participant[] = [
  { id: 'stu-2026-001', nickname: '김하늘' },
  { id: 'stu-2026-002', nickname: '이도윤' },
  { id: 'stu-2026-003', nickname: '박서연' },
  { id: 'stu-2026-004', nickname: '최준우' },
  { id: 'stu-2026-005', nickname: '정예은' },
  { id: 'stu-2026-006', nickname: '한지호' },
]

type View = 'none' | 'react' | 'imperative'

export default function App() {
  const [view, setView] = useState<View>('none')
  const [result, setResult] = useState<BrickPickResult | null>(null)

  const handleComplete = useCallback((r: BrickPickResult) => {
    setResult(r)
  }, [])

  // 두 방식이 **같은 옵션 객체**를 쓴다는 점이 이 예제의 핵심이다.
  const options: BrickPickOptions = useMemo(
    () => ({
      participants: PARTICIPANTS,
      mode: 'auto',
      difficulty: 'normal',
      roundDurationMs: 30_000,
      // 최고 성적 1명을 발표자로. 규칙을 바꾸려면 여기만 고치면 된다.
      //   { kind: 'bottom', count: 1 }      → 최저 성적 1명
      //   { kind: 'ranks', ranks: [2, 5] }  → 2위와 5위
      selectionRule: { kind: 'top', count: 1 },
      // 이미 발표한 사람이 있으면 여기에 넣는다. 순위에는 남고 선정에서만 빠진다.
      excludedParticipantIds: [],
      // 같은 seed + 같은 설정이면 결과가 같다. 수업 회차를 그대로 쓰면 재현이 쉽다.
      seed: '2026-1반-3차시',
      locale: 'ko',
      soundEnabled: true,
      // 화면 효과에 예민한 학생이 있으면 true 로. OS 설정과 별개로 강제할 수 있다.
      reducedMotion: false,
      // 호스트(이 앱)가 명단과 설정을 관리하므로 게임 안의 편집기는 숨긴다.
      hideParticipantEditor: true,
      autoStart: true,
      onComplete: handleComplete,
      onError: (e) => console.error('[브릭픽] 오류', e.code, e.message, e.details),
      onCancel: (e) => console.warn('[브릭픽] 취소됨', e.reason),
    }),
    [handleComplete],
  )

  const open = (next: View) => {
    setResult(null)
    setView(next)
  }

  return (
    <div className="wrap">
      <header className="head">
        <h1>
          <span className="mark">▚</span> 브릭픽 연동 예제 <span className="muted">/</span> React 호스트
        </h1>
        <span className="sub">npm 으로 설치한 패키지를 그대로 불러 씁니다</span>
      </header>

      <div className="note">
        <b>핵심 검증 포인트</b> — 아래에서 넘긴 참가자 <code>id</code> 가 결과의{' '}
        <code>selectedParticipantIds</code> 에 그대로 돌아옵니다. 게임은 id 를 내부 번호로
        바꾸지 않습니다. 결과가 나오면 아래 「돌아온 id」 칸에서 글자까지 대조해 보세요.
      </div>

      {/* 조작 줄 — 얇게 유지한다. 화면의 중심은 게임판이다. */}
      <div className="bar" role="group" aria-label="게임 여는 방법 고르기">
        <span className="label">여는 방법</span>
        <button
          type="button"
          aria-pressed={view === 'react'}
          onClick={() => open('react')}
        >
          ① React 컴포넌트 &lt;BrickPick /&gt;
        </button>
        <button
          type="button"
          aria-pressed={view === 'imperative'}
          onClick={() => open('imperative')}
        >
          ② mountBrickPick 으로 직접
        </button>
        <span className="grow" />
        <button type="button" onClick={() => setView('none')} disabled={view === 'none'}>
          닫기
        </button>
      </div>

      {/* ══════════ 게임판 ══════════ */}
      <div className="stage">
        {view === 'none' && (
          <div className="empty">
            <div className="big">게임이 아직 열리지 않았습니다</div>
            <div>위에서 ① 또는 ② 를 누르면 같은 게임이 같은 설정으로 열립니다.</div>
          </div>
        )}

        {/* ① React 컴포넌트 — 옵션을 props 로 그대로 넘긴다. */}
        {view === 'react' && <BrickPick {...options} />}

        {/* ② 직접 붙이기 — React 없이도 되는 길. */}
        {view === 'imperative' && <ImperativeMount options={options} />}
      </div>

      {/* ══════════ 결과 ══════════ */}
      <section className="result">
        <h2>결과</h2>
        <div className="body">
          {result === null ? (
            <p className="muted" style={{ margin: 0 }}>
              아직 결과가 없습니다. 경기가 정상적으로 끝나면 <code>onComplete</code> 로 옵니다.
              (취소·오류는 결과가 아니라 <code>onCancel</code> / <code>onError</code> 로 옵니다.)
            </p>
          ) : (
            <ResultView result={result} />
          )}
        </div>
      </section>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// ② mountBrickPick — React 를 쓰지 않는 앱이 게임을 붙이는 방법.
//    여기서는 React 안에서 부르지만, 평범한 DOM 요소와 옵션만 있으면 어디서든 같다.
// ────────────────────────────────────────────────────────────────────────────

function ImperativeMount({ options }: { options: BrickPickOptions }) {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return

    const controller = mountBrickPick(el, options)

    // 정리를 빼먹으면 타이머·오디오·animation frame 이 남는다.
    // 화면을 떠날 때 반드시 destroy() 를 부른다. 여러 번 불러도 안전하다.
    return () => controller.destroy()
  }, [options])

  return <div ref={boxRef} style={{ width: '100%', minHeight: 460 }} />
}

// ────────────────────────────────────────────────────────────────────────────
// 결과 보여 주기 — 선정된 id 를 우리 명단과 대조한다.
// ────────────────────────────────────────────────────────────────────────────

function ResultView({ result }: { result: BrickPickResult }) {
  const nickById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of PARTICIPANTS) map.set(p.id, p.nickname)
    return map
  }, [])

  const selected = result.selectedParticipantIds
  const allKnown = selected.length > 0 && selected.every((id) => nickById.has(id))

  return (
    <div>
      <div>
        <b>선정된 발표자</b>{' '}
        <span className="muted">
          — 선정 가능 {result.eligibleCount}명 중
        </span>
      </div>

      <div className="picked">
        {selected.length === 0 ? (
          <span className="muted">선정된 사람이 없습니다. 규칙과 제외 목록을 확인해 주세요.</span>
        ) : (
          selected.map((id, i) => (
            <span className="who" key={id}>
              {i + 1}. {nickById.get(id) ?? '(명단에 없는 id)'}{' '}
              <span className="id">{id}</span>
            </span>
          ))
        )}
      </div>

      <div>
        <span className={allKnown ? 'ok' : 'muted'}>
          {allKnown
            ? '✔ 돌아온 id 가 모두 우리가 넘긴 명단과 글자까지 같습니다.'
            : '· 돌아온 id 를 명단과 대조하지 못했습니다.'}
        </span>
      </div>

      <ul className="plain">
        {result.selectionReasons.map((r) => (
          <li key={r.participantId}>
            {r.nickname} — {r.reason}
          </li>
        ))}
      </ul>

      <details>
        <summary className="muted" style={{ cursor: 'pointer', fontSize: 13, marginTop: 10 }}>
          결과 JSON 전체 보기 (수업 앱이 저장하는 값)
        </summary>
        <pre>{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div>
  )
}
