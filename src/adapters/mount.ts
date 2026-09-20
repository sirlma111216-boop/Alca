/**
 * mountBrickPick — 프레임워크 없는 임베드 진입점.
 *
 * 여기 들어 있는 것은 **게임 화면과 구동 루프뿐**이다.
 * 참가자 입력·난이도 설정 같은 편집 UI 는 들어오지 않는다(그건 단독 실행 앱의 몫).
 * React 어댑터와 iframe 임베드가 이 함수를 그대로 쓴다.
 *
 * 설계에서 지킨 것
 *  - 경기 시간은 **스텝 수로만** 센다. 프레임이 밀리면 실시간만 길어지고 결과는 같다.
 *  - HUD 는 React 가 아니라 DOM 을 직접 5Hz 로 갱신한다. 닉네임은 언제나 textContent 로 넣는다.
 *  - 키보드·포인터 리스너는 window 가 아니라 이 인스턴스의 루트 요소에 붙는다.
 *    한 페이지에 게임이 여러 개 있어도 서로의 입력을 가로채지 않는다.
 *  - destroy() 는 몇 번을 불러도 안전하고, 타이머·리스너를 남기지 않는다.
 *  - 결과 문구는 추첨 결과로 읽히게 쓴다. 참가자의 실력을 평가하는 말로 쓰지 않는다.
 */

import {
  ENGINE_CAPABILITIES,
  ENGINE_VERSION,
  MAX_STEPS_PER_FRAME,
  Match,
  PLAY_STATUS_LABELS,
  SCHEMA_VERSION,
  STEP_MS,
  checkSelectionRule,
  createSeedString,
  describeSelectionRule,
  parseBrickPickInput,
} from '../core'
import type {
  BrickPickCancelEvent,
  BrickPickErrorCode,
  BrickPickErrorEvent,
  BrickPickInput,
  BrickPickProgress,
  BrickPickResult,
  ParticipantResult,
  ParticipantRun,
  ReplayLog,
} from '../core'
import type { GameAudio, InputController, MatchRenderer } from '../renderer/types'
import { createGameAudio, createInputController, createMatchRenderer } from '../renderer'
import type {
  BrickPickController,
  BrickPickOptions,
  BrickPickReadyInfo,
  BrickPickState,
} from './types'
import '../styles/brickpick.css'

// ────────────────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────────────────

/** 순위표에 기본으로 보여 줄 인원. 나머지는 "전체 펼치기" 로 연다. */
const BOARD_TOP_COUNT = 8
/** 직접 조작 모드에서 참가자 한 명당 준비 화면 + 카운트다운에 드는 대략의 시간(ms). */
const TURN_OVERHEAD_MS = 8_000
/** 3-2-1 카운트다운 길이(ms). 마지막 "시작!" 표시 시간까지 포함. */
const COUNTDOWN_MS = 3_200
/** HUD 를 다시 그리는 최소 간격(ms) — 약 5Hz. */
const HUD_INTERVAL_MS = 200

const MODE_BADGE_TEXT = {
  auto: '자동 경기 · 게임으로 진행하는 추첨',
  manual: '직접 조작 · 한 명씩 차례로 플레이',
} as const

/** 화면 상태 — match.phase 위에 얹는 "지금 무슨 화면인가". */
type UiState =
  | 'intro'
  | 'ready'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'result'
  | 'cancelled'
  | 'error'

// ────────────────────────────────────────────────────────────────────────────
// 작은 도우미
// ────────────────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** 바뀐 글자만 대입한다 — 매 프레임 레이아웃을 흔들지 않기 위해서다. */
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text
}

function setClass(node: HTMLElement, className: string, on: boolean): void {
  if (node.classList.contains(className) !== on) node.classList.toggle(className, on)
}

/** 남은 시간 — 1분 이상이면 M:SS, 아니면 "12초". */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  if (total >= 60) {
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }
  return `${total}초`
}

/** 예상 소요 시간처럼 사람에게 읽어 주는 길이. */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m === 0) return `${s}초`
  if (s === 0) return `${m}분`
  return `${m}분 ${s}초`
}

function formatScore(score: number | null): string {
  if (score === null) return '—'
  return score.toLocaleString('ko-KR')
}

/** requestAnimationFrame 이 주는 시각과 같은 시계. */
function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function newSessionId(): string {
  const rand = Math.floor(Math.random() * 0xffffff).toString(36)
  return `bp-${Date.now().toString(36)}-${rand}`
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function errorEvent(
  code: BrickPickErrorCode,
  message: string,
  details: string[],
  sessionId: string | null,
): BrickPickErrorEvent {
  const event: BrickPickErrorEvent = {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    status: 'error',
    code,
    message,
  }
  if (details.length > 0) event.details = details
  return event
}

// ────────────────────────────────────────────────────────────────────────────
// 오류 화면 + 아무것도 하지 않는 컨트롤러
// ────────────────────────────────────────────────────────────────────────────

function renderErrorScreen(container: HTMLElement, event: BrickPickErrorEvent): () => void {
  const root = el('div', 'bp-root bp-root--error')
  root.setAttribute('role', 'alert')
  const box = el('div', 'bp-error')
  box.appendChild(el('h2', 'bp-error__title', '게임을 시작할 수 없습니다'))
  box.appendChild(el('p', 'bp-error__message', event.message))
  if (event.details && event.details.length > 0) {
    const list = el('ul', 'bp-error__details')
    for (const detail of event.details) list.appendChild(el('li', undefined, detail))
    box.appendChild(list)
  }
  root.appendChild(box)
  container.replaceChildren(root)
  return () => {
    if (root.parentNode === container) container.removeChild(root)
  }
}

function inertController(sessionId: string, cleanup: () => void): BrickPickController {
  let done = false
  const noop = (): void => undefined
  return {
    get state(): BrickPickState {
      return 'error'
    },
    sessionId,
    start: noop,
    pause: noop,
    resume: noop,
    cancel: noop,
    skipCurrentParticipant: noop,
    continueToNextParticipant: noop,
    setSoundEnabled: noop,
    focusParticipant: noop,
    getResult: () => null,
    exportReplayLog: () => null,
    destroy: () => {
      if (done) return
      done = true
      cleanup()
    },
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 화면 구성
// ────────────────────────────────────────────────────────────────────────────

interface Dom {
  root: HTMLDivElement
  stage: HTMLDivElement
  canvas: HTMLCanvasElement
  fireBtn: HTMLButtonElement
  hud: HTMLDivElement
  modeBadge: HTMLSpanElement
  timerValue: HTMLSpanElement
  progressBar: HTMLDivElement
  turn: HTMLDivElement
  turnName: HTMLSpanElement
  turnMeta: HTMLSpanElement
  board: HTMLDivElement
  boardTitle: HTMLHeadingElement
  boardList: HTMLUListElement
  boardMore: HTMLButtonElement
  controls: HTMLDivElement
  startBtn: HTMLButtonElement
  pauseBtn: HTMLButtonElement
  cancelBtn: HTMLButtonElement
  soundBtn: HTMLButtonElement
  fullscreenBtn: HTMLButtonElement
  overlay: HTMLDivElement
  live: HTMLDivElement
}

function buildDom(): Dom {
  const root = el('div', 'bp-root')
  root.tabIndex = 0
  root.setAttribute('role', 'application')
  root.setAttribute('aria-label', '브릭픽 발표자 선정 게임')

  const stage = el('div', 'bp-stage')
  const canvas = el('canvas', 'bp-canvas')
  canvas.setAttribute('aria-hidden', 'true')
  const fireBtn = el('button', 'bp-fire', '발사')
  fireBtn.type = 'button'
  stage.append(canvas, fireBtn)

  const hud = el('div', 'bp-hud')
  const top = el('div', 'bp-hud__top')
  const modeBadge = el('span', 'bp-mode')
  modeBadge.appendChild(el('span', 'bp-mode__glyph', '▣'))
  const modeText = el('span', undefined, '')
  modeBadge.appendChild(modeText)
  const timer = el('div', 'bp-timer')
  timer.appendChild(el('span', 'bp-timer__label', '남은 시간'))
  const timerValue = el('span', 'bp-timer__value', '—')
  timer.appendChild(timerValue)
  top.append(modeBadge, timer)

  const progress = el('div', 'bp-progress')
  progress.setAttribute('role', 'progressbar')
  progress.setAttribute('aria-label', '경기 진행')
  const progressBar = el('div', 'bp-progress__bar')
  progress.appendChild(progressBar)

  const turn = el('div', 'bp-turn')
  turn.hidden = true
  const turnName = el('span', 'bp-turn__name', '')
  const turnMeta = el('span', undefined, '')
  turn.append(turnName, turnMeta)

  const board = el('div', 'bp-board')
  const boardHead = el('div', 'bp-board__head')
  const boardTitle = el('h3', 'bp-board__title', '실시간 순위')
  const boardMore = el('button', 'bp-btn bp-board__more', '전체 펼치기')
  boardMore.type = 'button'
  boardMore.hidden = true
  boardHead.append(boardTitle, boardMore)
  const boardList = el('ul', 'bp-board__list')
  board.append(boardHead, boardList)

  hud.append(top, progress, turn, board)

  const controls = el('div', 'bp-controls')
  const startBtn = el('button', 'bp-btn bp-btn--primary', '시작')
  startBtn.type = 'button'
  const pauseBtn = el('button', 'bp-btn', '일시정지')
  pauseBtn.type = 'button'
  const cancelBtn = el('button', 'bp-btn bp-btn--danger', '경기 취소')
  cancelBtn.type = 'button'
  const soundBtn = el('button', 'bp-btn', '소리 켜짐')
  soundBtn.type = 'button'
  const fullscreenBtn = el('button', 'bp-btn', '전체화면')
  fullscreenBtn.type = 'button'
  controls.append(startBtn, pauseBtn, cancelBtn, soundBtn, fullscreenBtn)

  const overlay = el('div', 'bp-overlay')

  const live = el('div', 'bp-sr')
  live.setAttribute('role', 'status')
  live.setAttribute('aria-live', 'polite')

  root.append(stage, hud, controls, overlay, live)

  return {
    root,
    stage,
    canvas,
    fireBtn,
    hud,
    modeBadge: modeText,
    timerValue,
    progressBar,
    turn,
    turnName,
    turnMeta,
    board,
    boardTitle,
    boardList,
    boardMore,
    controls,
    startBtn,
    pauseBtn,
    cancelBtn,
    soundBtn,
    fullscreenBtn,
    overlay,
    live,
  }
}

interface BoardRow {
  li: HTMLLIElement
  rank: HTMLSpanElement
  name: HTMLSpanElement
  score: HTMLSpanElement
  lives: HTMLSpanElement
}

function buildBoardRow(): BoardRow {
  const li = el('li', 'bp-row')
  const rank = el('span', 'bp-row__rank', '')
  const name = el('span', 'bp-row__name', '')
  const score = el('span', 'bp-row__score', '')
  const lives = el('span', 'bp-row__lives', '')
  li.append(rank, name, score, lives)
  return { li, rank, name, score, lives }
}

// ────────────────────────────────────────────────────────────────────────────
// mountBrickPick
// ────────────────────────────────────────────────────────────────────────────

export function mountBrickPick(
  container: HTMLElement,
  options: BrickPickOptions,
): BrickPickController {
  // ── 1. 입력 검증 ─────────────────────────────────────────────────────────
  const seed = options.seed && options.seed.trim().length > 0
    ? options.seed
    : createSeedString(Math.random)
  const sessionId =
    options.sessionId && options.sessionId.trim().length > 0 ? options.sessionId : newSessionId()

  // ★ options 를 통째로 펼친 뒤 계산한 값만 덮어쓴다.
  //   필드를 하나씩 옮겨 적으면, 계약에 칸이 늘었을 때 그 칸이 **조용히 사라진다**.
  //   (roundMode 를 더했을 때 실제로 그렇게 됐다 — 화면에는 "다 깰 때까지" 라고 떠 있는데
  //    엔진은 정해진 시간으로 돌았다.)
  //   parseBrickPickInput 은 아는 칸만 읽으므로 콜백 같은 여분의 키가 섞여도 안전하다.
  const rawInput = {
    ...options,
    schemaVersion: options.schemaVersion ?? SCHEMA_VERSION,
    sessionId,
    participants: options.participants,
    mode: options.mode,
    difficulty: options.difficulty,
    difficultySettings: options.difficultySettings,
    roundDurationMs: options.roundDurationMs,
    roundMode: options.roundMode,
    selectionRule: options.selectionRule,
    excludedParticipantIds: options.excludedParticipantIds,
    seed,
    locale: options.locale,
    soundEnabled: options.soundEnabled,
    reducedMotion: options.reducedMotion ?? prefersReducedMotion(),
    hideParticipantEditor: options.hideParticipantEditor,
    replayOf: options.replayOf,
  }

  const parsed = parseBrickPickInput(rawInput)
  if (!parsed.ok) {
    const event = errorEvent(
      parsed.error.code,
      parsed.error.message,
      parsed.error.details,
      sessionId,
    )
    const cleanup = renderErrorScreen(container, event)
    options.onError?.(event)
    return inertController(sessionId, cleanup)
  }

  const input: BrickPickInput = parsed.value
  const candidateCount = input.participants.length - input.excludedParticipantIds.length
  const ruleProblem = checkSelectionRule(input.selectionRule, candidateCount)
  if (ruleProblem) {
    const event = errorEvent(
      ruleProblem.code,
      ruleProblem.message,
      ruleProblem.details,
      input.sessionId,
    )
    const cleanup = renderErrorScreen(container, event)
    options.onError?.(event)
    return inertController(input.sessionId, cleanup)
  }

  // ── 2. 화면 ──────────────────────────────────────────────────────────────
  const dom = buildDom()
  if (input.reducedMotion) dom.root.classList.add('bp-root--reduced-motion')
  setText(dom.modeBadge, MODE_BADGE_TEXT[input.mode])
  dom.controls.hidden = options.showControls === false
  dom.board.hidden = options.showLeaderboard === false
  dom.turn.hidden = input.mode !== 'manual'
  setClass(dom.fireBtn, 'bp-fire--on', input.mode === 'manual')
  container.replaceChildren(dom.root)

  const progressIntervalMs = Math.max(50, options.progressIntervalMs ?? 250)
  const showResult = options.showResult !== false
  const isManual = input.mode === 'manual'

  // ── 3. 엔진 · 렌더러 · 오디오 · 입력 ─────────────────────────────────────
  const match = new Match({
    input,
    collectArenaEvents: false,
    replayInputs: options.replayLog?.inputs,
  })

  const renderer: MatchRenderer = createMatchRenderer({
    canvas: dom.canvas,
    match,
    reducedMotion: input.reducedMotion,
    scanlines: options.scanlines === true,
    focusParticipantId: null,
    locale: input.locale,
  })

  const audio: GameAudio = createGameAudio({ enabled: input.soundEnabled })

  const inputController: InputController = createInputController({
    element: dom.root,
    canvas: dom.canvas,
    toArenaX: (x, y) => renderer.pointerToArenaX(x, y),
    fireButton: dom.fireBtn,
  })
  inputController.setEnabled(false)

  // ── 4. 상태 ──────────────────────────────────────────────────────────────
  let ui: UiState = 'intro'
  let destroyed = false
  let completed = false
  let result: BrickPickResult | null = null
  let soundEnabled = input.soundEnabled
  let showAllRows = false
  let visibilityPaused = false
  let countdownEndsAt = 0
  let lastCountdownTick = -1
  /** 탭이 숨는 동안 카운트다운도 멈춘다. 안 보는 사이에 경기가 시작되면 안 되기 때문이다. */
  let countdownFrozenMs: number | null = null
  /** 직접 조작 모드에서는 지금 차례인 사람을 크게 보여 준다. 호스트가 직접 고르면 손을 뗀다. */
  let followCurrentParticipant = isManual
  let focusedParticipantId: string | null = null

  let rafId = 0
  let lastFrameAt = 0
  let accumulator = 0
  let lastHudAt = 0
  let lastProgressAt = 0
  let boardRows: BoardRow[] = []
  const hookedArenas = new WeakSet<object>()
  /** 순위표에 "기록 없음 / 미플레이 / 중도 취소"를 적기 위한 참가자별 상태. */
  const runStatusById = new Map<string, ParticipantRun['status']>()

  const setUi = (next: UiState): void => {
    if (ui === next) return
    ui = next
    syncChrome()
    renderOverlay()
  }

  const announce = (text: string): void => {
    setText(dom.live, text)
  }

  // ── 5. 오버레이 화면들 ───────────────────────────────────────────────────

  const panel = (kicker: string, title: string): HTMLDivElement => {
    const p = el('div', 'bp-panel')
    if (kicker) p.appendChild(el('p', 'bp-panel__kicker', kicker))
    p.appendChild(el('h2', 'bp-panel__title', title))
    return p
  }

  const estimateText = (): string => {
    if (!isManual) return `경기 시간 ${formatDuration(input.roundDurationMs)}`
    const total = input.participants.length * (input.roundDurationMs + TURN_OVERHEAD_MS)
    return `참가자 ${input.participants.length}명 × (경기 ${formatDuration(input.roundDurationMs)} + 준비) — 예상 소요 시간 약 ${formatDuration(total)}`
  }

  const renderIntro = (): HTMLDivElement => {
    const p = panel(MODE_BADGE_TEXT[input.mode], '발표자를 게임으로 뽑습니다')
    p.appendChild(
      el(
        'p',
        'bp-panel__text',
        isManual
          ? '참가자가 한 명씩 차례로 플레이합니다. 차례마다 준비 화면이 먼저 나옵니다.'
          : '모든 참가자의 경기가 컴퓨터로 동시에 진행됩니다. 참가자가 직접 조작하지 않습니다.',
      ),
    )
    p.appendChild(
      el('p', 'bp-panel__text', `선정 규칙 — ${describeSelectionRule(input.selectionRule, candidateCount)}`),
    )
    p.appendChild(el('p', 'bp-panel__note', estimateText()))
    p.appendChild(el('p', 'bp-panel__note', `추첨 번호(seed): ${input.seed}`))
    const actions = el('div', 'bp-panel__actions')
    const go = el('button', 'bp-btn bp-btn--primary bp-btn--big', isManual ? '첫 참가자 준비' : '경기 시작')
    go.type = 'button'
    go.addEventListener('click', handleStartClick)
    actions.appendChild(go)
    p.appendChild(actions)
    return p
  }

  const renderReady = (): HTMLDivElement => {
    const run = match.currentRun
    const index = match.currentIndex
    const p = panel(
      `${index + 1}번째 차례 · 전체 ${match.runs.length}명`,
      run ? run.participant.nickname : '다음 참가자',
    )
    // 닉네임은 textContent 로만 넣는다 (panel 안에서 이미 그렇게 처리한다).
    p.appendChild(el('p', 'bp-panel__text', '준비되면 아래 버튼을 눌러 주세요. 3초 뒤에 시작합니다.'))
    p.appendChild(
      el(
        'p',
        'bp-panel__note',
        `경기 시간 ${formatDuration(input.roundDurationMs)} · 좌우 방향키 또는 마우스·손가락으로 패들을 움직입니다.`,
      ),
    )
    const actions = el('div', 'bp-panel__actions')
    const ready = el('button', 'bp-btn bp-btn--primary bp-btn--big', '준비됐어요')
    ready.type = 'button'
    ready.addEventListener('click', handleReadyClick)
    const skip = el('button', 'bp-btn', '이 참가자 건너뛰기')
    skip.type = 'button'
    skip.addEventListener('click', () => {
      audio.play('ui-click')
      skipCurrentParticipant()
    })
    const quit = el('button', 'bp-btn bp-btn--danger', '그만두기')
    quit.type = 'button'
    quit.addEventListener('click', () => {
      audio.play('ui-click')
      cancel('user')
    })
    actions.append(ready, skip, quit)
    p.appendChild(actions)
    return p
  }

  const renderCountdown = (): HTMLDivElement => {
    const run = match.currentRun
    const p = panel(
      '곧 시작합니다',
      run ? run.participant.nickname : '모든 참가자 동시 경기',
    )
    const count = el('div', 'bp-count', '3')
    count.id = 'bp-countdown-value'
    p.appendChild(count)
    return p
  }

  const renderPaused = (): HTMLDivElement => {
    const p = panel('일시정지', visibilityPaused ? '다른 탭으로 이동해 멈췄습니다' : '경기를 멈췄습니다')
    p.appendChild(
      el(
        'p',
        'bp-panel__text',
        visibilityPaused
          ? '공·아이템·남은 시간이 모두 멈춰 있습니다. 저절로 이어지지 않으니 아래에서 재개를 눌러 주세요.'
          : '공·아이템·남은 시간이 모두 멈춰 있습니다.',
      ),
    )
    const actions = el('div', 'bp-panel__actions')
    const go = el('button', 'bp-btn bp-btn--primary bp-btn--big', '재개')
    go.type = 'button'
    go.addEventListener('click', () => {
      audio.play('ui-click')
      resume()
    })
    const quit = el('button', 'bp-btn bp-btn--danger', '경기 취소')
    quit.type = 'button'
    quit.addEventListener('click', () => {
      audio.play('ui-click')
      cancel('user')
    })
    if (isManual) {
      const skip = el('button', 'bp-btn', '이 참가자 건너뛰기')
      skip.type = 'button'
      skip.addEventListener('click', () => {
        audio.play('ui-click')
        skipCurrentParticipant()
      })
      actions.append(go, skip, quit)
    } else {
      actions.append(go, quit)
    }
    p.appendChild(actions)
    return p
  }

  const renderCancelled = (): HTMLDivElement => {
    const p = panel('', '경기를 취소했습니다')
    p.appendChild(el('p', 'bp-panel__text', '결과를 만들지 않았습니다. 발표자는 선정되지 않았습니다.'))
    return p
  }

  const renderResult = (): HTMLDivElement => {
    const res = result
    const p = panel(MODE_BADGE_TEXT[input.mode], '추첨 결과')
    if (!res) {
      p.appendChild(el('p', 'bp-panel__text', '결과를 준비하는 중입니다.'))
      return p
    }
    p.appendChild(
      el(
        'p',
        'bp-panel__text',
        `선정 규칙 — ${describeSelectionRule(res.appliedSettings.selectionRule, res.eligibleCount)}`,
      ),
    )
    // 경기 중 건너뛰기·중도 취소로 후보가 줄어 규칙을 다 못 채웠으면 분명히 알린다.
    // 조용히 아무도 뽑지 않고 "완료" 로 끝나서는 안 된다.
    if (res.selectionIssue) {
      const warn = el('p', 'bp-panel__warning', res.selectionIssue.message)
      warn.setAttribute('role', 'alert')
      p.appendChild(warn)
    }
    if (res.selectionReasons.length === 0) {
      p.appendChild(el('p', 'bp-panel__text', '조건에 맞는 참가자가 없어 아무도 선정되지 않았습니다.'))
    }
    for (const reason of res.selectionReasons) {
      const box = el('div', 'bp-picked')
      box.appendChild(el('span', 'bp-picked__name', reason.nickname))
      box.appendChild(el('span', 'bp-picked__reason', reason.reason))
      p.appendChild(box)
    }

    const picked = new Set(res.selectedParticipantIds)
    const list = el('ul', 'bp-list')
    for (const person of res.participants) {
      list.appendChild(buildResultRow(person, picked.has(person.id)))
    }
    p.appendChild(list)
    p.appendChild(
      el(
        'p',
        'bp-panel__note',
        `추첨 번호(seed) ${res.seed} · 같은 번호와 같은 설정이면 언제 돌려도 같은 결과가 나옵니다.`,
      ),
    )
    return p
  }

  const buildResultRow = (person: ParticipantResult, isPicked: boolean): HTMLLIElement => {
    const li = el('li', isPicked ? 'bp-list__item bp-list__item--picked' : 'bp-list__item')
    li.appendChild(el('span', 'bp-list__rank', `${person.rank}위`))
    const name = el('span', 'bp-list__name')
    setText(name, person.nickname)
    li.appendChild(name)
    const status = person.excluded
      ? PLAY_STATUS_LABELS.excluded
      : PLAY_STATUS_LABELS[person.playStatus]
    const meta =
      person.playStatus === 'played' && !person.excluded
        ? `${formatScore(person.score)}점`
        : `${formatScore(person.score)}점 · ${status}`
    li.appendChild(el('span', 'bp-list__meta', isPicked ? `${meta} · 선정` : meta))
    return li
  }

  function renderOverlay(): void {
    if (destroyed) return
    let content: HTMLDivElement | null = null
    switch (ui) {
      case 'intro':
        content = renderIntro()
        break
      case 'ready':
        content = renderReady()
        break
      case 'countdown':
        content = renderCountdown()
        break
      case 'paused':
        content = renderPaused()
        break
      case 'cancelled':
        content = renderCancelled()
        break
      case 'result':
        content = showResult ? renderResult() : null
        break
      default:
        content = null
    }
    if (content) {
      dom.overlay.replaceChildren(content)
      dom.overlay.classList.add('bp-overlay--on')
      dom.overlay.removeAttribute('aria-hidden')
    } else {
      dom.overlay.replaceChildren()
      dom.overlay.classList.remove('bp-overlay--on')
      dom.overlay.setAttribute('aria-hidden', 'true')
    }
  }

  // ── 6. HUD ───────────────────────────────────────────────────────────────

  function syncChrome(): void {
    const canStart = ui === 'intro'
    dom.startBtn.disabled = !canStart
    dom.startBtn.hidden = !canStart
    const canPause = ui === 'playing' || ui === 'paused'
    dom.pauseBtn.disabled = !canPause
    setText(dom.pauseBtn, ui === 'paused' ? '재개' : '일시정지')
    dom.cancelBtn.disabled = ui === 'result' || ui === 'cancelled' || ui === 'error'
    setText(dom.soundBtn, soundEnabled ? '소리 켜짐' : '소리 꺼짐')
    dom.soundBtn.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false')
    inputController.setEnabled(isManual && ui === 'playing')
    setClass(dom.fireBtn, 'bp-fire--on', isManual && ui === 'playing')
    followFocus()
  }

  /** 직접 조작 모드에서 차례가 넘어가면 화면도 그 사람에게 맞춘다. */
  function followFocus(): void {
    if (!followCurrentParticipant) return
    const next = ui === 'result' ? null : (match.currentRun?.participant.id ?? null)
    if (next === focusedParticipantId) return
    focusedParticipantId = next
    renderer.setOptions({ focusParticipantId: next })
  }

  function updateHud(): void {
    const progress = match.progress()
    const low = progress.remainingMs <= 5_000 && ui === 'playing'
    setText(dom.timerValue, ui === 'intro' ? '—' : formatRemaining(progress.remainingMs))
    setClass(dom.timerValue, 'bp-timer__value--low', low)
    dom.progressBar.style.width = `${Math.round(progress.progress * 100)}%`
    dom.progressBar.parentElement?.setAttribute(
      'aria-valuetext',
      `${progress.completedCount} / ${progress.totalCount}명 진행`,
    )

    followFocus()

    if (isManual) {
      const run = match.currentRun
      dom.turn.hidden = false
      setText(dom.turnName, run ? run.participant.nickname : '—')
      setText(
        dom.turnMeta,
        `지금 차례 · ${match.currentIndex + 1} / ${match.runs.length}명`,
      )
    }

    updateBoard(progress)
  }

  function updateBoard(progress: BrickPickProgress): void {
    if (dom.board.hidden) return
    const rows = progress.leaderboard
    const total = rows.length
    const visible = showAllRows ? total : Math.min(BOARD_TOP_COUNT, total)
    dom.boardMore.hidden = total <= BOARD_TOP_COUNT
    setText(dom.boardMore, showAllRows ? '접기' : `전체 펼치기 (${total}명)`)
    setText(dom.boardTitle, showAllRows ? `실시간 순위 · ${total}명` : `실시간 순위 · 상위 ${visible}명`)

    while (boardRows.length < visible) {
      const row = buildBoardRow()
      boardRows.push(row)
      dom.boardList.appendChild(row.li)
    }
    while (boardRows.length > visible) {
      const row = boardRows.pop()
      if (row && row.li.parentNode === dom.boardList) dom.boardList.removeChild(row.li)
    }

    const currentId = progress.currentParticipantId
    runStatusById.clear()
    for (const run of match.runs) runStatusById.set(run.participant.id, run.status)
    for (let i = 0; i < visible; i += 1) {
      const row = boardRows[i]
      const data = rows[i]
      if (!row || !data) continue
      const status = runStatusById.get(data.id)
      // 아직 플레이하지 않은 사람을 0점처럼 보이게 두지 않는다.
      const waiting = status === 'pending'
      setText(row.rank, waiting ? '—' : `${i + 1}위`)
      setText(row.name, data.nickname)
      setText(row.score, waiting ? '기록 없음' : `${data.score.toLocaleString('ko-KR')}점`)
      setText(
        row.lives,
        status === 'not_played'
          ? '미플레이'
          : status === 'aborted'
            ? '중도 취소'
            : waiting
              ? (isManual ? '차례 대기' : '대기 중')
              : `목숨 ${data.livesRemaining}`,
      )
      setClass(row.li, 'bp-row--current', currentId !== null && data.id === currentId)
    }
  }

  // ── 7. 구동 루프 ─────────────────────────────────────────────────────────

  function hookAudioSinks(): void {
    if (!soundEnabled) return
    for (const run of match.runs) {
      const arena = run.arena
      if (!arena || hookedArenas.has(arena)) continue
      hookedArenas.add(arena)
      // 렌더러는 drainEvents() 로 읽는다. eventSink 는 그와 독립적인 출구라
      // 둘이 서로의 이벤트를 빼앗지 않는다. 이미 누가 쓰고 있으면 건드리지 않는다.
      if (arena.eventSink === null) {
        arena.eventSink = (event) => {
          audio.play(event.type)
        }
      }
    }
  }

  function frame(now: number): void {
    if (destroyed) return
    rafId = requestAnimationFrame(frame)

    const dt = lastFrameAt === 0 ? 0 : Math.min(now - lastFrameAt, 250)
    lastFrameAt = now

    if (ui === 'countdown') {
      tickCountdown(now)
    } else if (ui === 'playing' && match.phase === 'running') {
      accumulator += dt
      let steps = 0
      while (accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
        match.step(inputController.take())
        accumulator -= STEP_MS
        steps += 1
        if (match.phase !== 'running') break
      }
      // 따라잡기를 포기하되 스텝을 건너뛰지는 않는다 — 실시간만 길어진다.
      if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0
      hookAudioSinks()
      syncMatchPhase()
    } else {
      accumulator = 0
    }

    renderer.render(Math.min(1, accumulator / STEP_MS))

    if (now - lastHudAt >= HUD_INTERVAL_MS) {
      lastHudAt = now
      updateHud()
    }
    if (ui !== 'intro' && now - lastProgressAt >= progressIntervalMs) {
      lastProgressAt = now
      emitProgress()
    }
  }

  function tickCountdown(now: number): void {
    if (countdownFrozenMs !== null) return
    const remaining = countdownEndsAt - now
    const value = Math.ceil((remaining - 200) / 1000)
    const node = dom.overlay.querySelector('.bp-count')
    if (node instanceof HTMLElement) {
      setText(node, value > 0 ? String(value) : '시작!')
    }
    if (value !== lastCountdownTick) {
      lastCountdownTick = value
      if (value > 0) audio.play('countdown')
      else audio.play('countdown-go')
    }
    if (remaining <= 0) beginTurn()
  }

  function beginTurn(): void {
    lastCountdownTick = -1
    countdownFrozenMs = null
    accumulator = 0
    if (match.phase === 'idle' || match.phase === 'ready') match.start()
    else match.continueToNext()
    hookAudioSinks()
    setUi('playing')
    dom.root.focus({ preventScroll: true })
    const run = match.currentRun
    announce(run ? `${run.participant.nickname} 차례를 시작합니다.` : '경기를 시작합니다.')
  }

  /** 엔진 쪽에서 스스로 바뀐 단계를 화면 상태에 반영한다. */
  function syncMatchPhase(): void {
    if (match.isFinished) {
      finish()
      return
    }
    if (match.phase === 'between-players' && ui === 'playing') {
      setUi('ready')
      announce('다음 참가자 준비 화면입니다.')
    }
  }

  function emitProgress(): void {
    if (destroyed) return
    try {
      options.onProgress?.(match.progress())
    } catch {
      /* 호스트 콜백의 오류가 게임을 멈추지 않게 한다. */
    }
  }

  function finish(): void {
    if (completed) return
    completed = true
    result = match.buildResult()
    renderer.setOptions({ highlightParticipantIds: result.selectedParticipantIds })
    setUi('result')
    audio.play('result-fanfare')
    emitProgress()
    const names = result.selectionReasons.map((r) => r.nickname).join(', ')
    announce(names ? `추첨 결과: ${names}` : '추첨이 끝났습니다.')
    try {
      options.onComplete?.(result)
    } catch {
      /* 호스트 콜백의 오류가 게임을 멈추지 않게 한다. */
    }
  }

  // ── 8. 조작 ──────────────────────────────────────────────────────────────

  function handleStartClick(): void {
    audio.unlock()
    audio.play('ui-click')
    start()
  }

  function handleReadyClick(): void {
    audio.unlock()
    audio.play('ui-click')
    if (ui !== 'ready') return
    startCountdown()
  }

  function startCountdown(): void {
    countdownEndsAt = nowMs() + COUNTDOWN_MS
    countdownFrozenMs = null
    lastCountdownTick = -1
    setUi('countdown')
  }

  function start(): void {
    if (destroyed || ui !== 'intro') return
    if (isManual) {
      setUi('ready')
      announce('첫 참가자 준비 화면입니다.')
    } else {
      startCountdown()
    }
    emitProgress()
  }

  function pause(): void {
    if (destroyed || ui !== 'playing') return
    match.pause()
    setUi('paused')
    announce('일시정지했습니다.')
  }

  function resume(): void {
    if (destroyed || ui !== 'paused') return
    visibilityPaused = false
    match.resume()
    accumulator = 0
    lastFrameAt = 0
    setUi('playing')
    dom.root.focus({ preventScroll: true })
    announce('경기를 이어서 진행합니다.')
  }

  function cancel(reason: 'user' | 'host' | 'destroy' = 'user'): void {
    if (destroyed) return
    if (ui === 'result' || ui === 'cancelled') return
    match.cancel()
    if (reason !== 'destroy') setUi('cancelled')
    const event: BrickPickCancelEvent = {
      schemaVersion: SCHEMA_VERSION,
      sessionId: input.sessionId,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      reason,
    }
    try {
      options.onCancel?.(event)
    } catch {
      /* 호스트 콜백의 오류가 정리를 막지 않게 한다. */
    }
  }

  function skipCurrentParticipant(): void {
    if (destroyed || !isManual) return
    if (ui !== 'ready' && ui !== 'countdown' && ui !== 'playing' && ui !== 'paused') return
    match.skipCurrent()
    lastCountdownTick = -1
    countdownFrozenMs = null
    accumulator = 0
    if (match.isFinished) {
      finish()
      return
    }
    setUi('ready')
    renderOverlay()
    announce('이 참가자를 미플레이로 남기고 다음 차례로 넘어갑니다.')
  }

  function continueToNextParticipant(): void {
    if (destroyed || !isManual) return
    if (ui === 'ready') handleReadyClick()
  }

  function setSoundEnabled(enabled: boolean): void {
    soundEnabled = enabled
    audio.setEnabled(enabled)
    if (enabled) {
      audio.unlock()
      hookAudioSinks()
    }
    syncChrome()
  }

  function toggleFullscreen(): void {
    try {
      if (document.fullscreenElement === dom.root) void document.exitFullscreen()
      else void dom.root.requestFullscreen?.()
    } catch {
      /* 전체화면을 막아 둔 환경에서는 조용히 넘어간다. */
    }
  }

  // ── 9. 리스너 ────────────────────────────────────────────────────────────

  const onStartClick = (): void => handleStartClick()
  const onPauseClick = (): void => {
    audio.unlock()
    audio.play('ui-click')
    if (ui === 'paused') resume()
    else pause()
  }
  const onCancelClick = (): void => {
    audio.play('ui-click')
    cancel('user')
  }
  const onSoundClick = (): void => {
    setSoundEnabled(!soundEnabled)
    audio.play('ui-click')
  }
  const onFullscreenClick = (): void => {
    audio.play('ui-click')
    toggleFullscreen()
  }
  const onBoardMoreClick = (): void => {
    showAllRows = !showAllRows
    updateHud()
  }
  const onFirstPointer = (): void => audio.unlock()
  const onFullscreenChange = (): void => {
    setText(dom.fullscreenBtn, document.fullscreenElement === dom.root ? '전체화면 끄기' : '전체화면')
  }
  const onVisibilityChange = (): void => {
    if (document.hidden) {
      if (ui === 'countdown' && countdownFrozenMs === null) {
        // 안 보는 사이에 경기가 시작되면 안 된다 — 남은 시간을 붙잡아 둔다.
        countdownFrozenMs = Math.max(0, countdownEndsAt - nowMs())
        return
      }
      if (ui === 'playing') {
        visibilityPaused = true
        pause()
      }
      return
    }
    // 돌아왔을 때 — 카운트다운은 멈춘 지점에서 다시 흐른다.
    // 경기 자체는 자동으로 이어지지 않는다(사용자가 재개를 눌러야 한다).
    if (countdownFrozenMs !== null) {
      countdownEndsAt = nowMs() + countdownFrozenMs
      countdownFrozenMs = null
    }
  }

  dom.startBtn.addEventListener('click', onStartClick)
  dom.pauseBtn.addEventListener('click', onPauseClick)
  dom.cancelBtn.addEventListener('click', onCancelClick)
  dom.soundBtn.addEventListener('click', onSoundClick)
  dom.fullscreenBtn.addEventListener('click', onFullscreenClick)
  dom.boardMore.addEventListener('click', onBoardMoreClick)
  dom.root.addEventListener('pointerdown', onFirstPointer)
  document.addEventListener('visibilitychange', onVisibilityChange)
  document.addEventListener('fullscreenchange', onFullscreenChange)

  // ── 10. 크기 ─────────────────────────────────────────────────────────────

  const applyResize = (): void => {
    if (destroyed) return
    const rect = dom.stage.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    renderer.resize(width, height, window.devicePixelRatio || 1)
  }

  let resizeObserver: ResizeObserver | null = null
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => applyResize())
    resizeObserver.observe(dom.stage)
  } else {
    window.addEventListener('resize', applyResize)
  }

  let dprQuery: MediaQueryList | null = null
  const onDprChange = (): void => {
    applyResize()
    watchDpr()
  }
  function watchDpr(): void {
    try {
      dprQuery?.removeEventListener('change', onDprChange)
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      dprQuery.addEventListener('change', onDprChange)
    } catch {
      dprQuery = null
    }
  }
  watchDpr()
  applyResize()

  // ── 11. 시작 ─────────────────────────────────────────────────────────────

  syncChrome()
  renderOverlay()
  updateHud()
  onFullscreenChange()
  rafId = requestAnimationFrame(frame)

  const readyInfo: BrickPickReadyInfo = {
    sessionId: input.sessionId,
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    capabilities: ENGINE_CAPABILITIES,
    warnings: parsed.warnings,
    appliedInput: input,
  }
  try {
    options.onReady?.(readyInfo)
  } catch {
    /* 호스트 콜백의 오류가 게임을 막지 않게 한다. */
  }

  if (options.autoStart) start()

  // ── 12. 컨트롤러 ─────────────────────────────────────────────────────────

  const stateOf = (): BrickPickState => {
    switch (ui) {
      case 'intro':
        return 'ready'
      case 'ready':
        return 'between-players'
      case 'countdown':
        return 'between-players'
      case 'playing':
        return 'running'
      case 'paused':
        return 'paused'
      case 'result':
        return 'finished'
      case 'cancelled':
        return 'cancelled'
      default:
        return 'error'
    }
  }

  function destroy(): void {
    if (destroyed) return
    if (!completed && ui !== 'cancelled') cancel('destroy')
    destroyed = true

    if (rafId !== 0) cancelAnimationFrame(rafId)
    rafId = 0

    dom.startBtn.removeEventListener('click', onStartClick)
    dom.pauseBtn.removeEventListener('click', onPauseClick)
    dom.cancelBtn.removeEventListener('click', onCancelClick)
    dom.soundBtn.removeEventListener('click', onSoundClick)
    dom.fullscreenBtn.removeEventListener('click', onFullscreenClick)
    dom.boardMore.removeEventListener('click', onBoardMoreClick)
    dom.root.removeEventListener('pointerdown', onFirstPointer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    document.removeEventListener('fullscreenchange', onFullscreenChange)

    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    } else {
      window.removeEventListener('resize', applyResize)
    }
    try {
      dprQuery?.removeEventListener('change', onDprChange)
    } catch {
      /* 브라우저가 지원하지 않으면 이미 등록되지 않았다. */
    }
    dprQuery = null

    for (const run of match.runs) {
      if (run.arena) run.arena.eventSink = null
    }

    inputController.destroy()
    renderer.destroy()
    audio.destroy()
    match.destroy()

    boardRows = []
    runStatusById.clear()
    dom.overlay.replaceChildren()
    if (dom.root.parentNode === container) container.removeChild(dom.root)
  }

  return {
    get state(): BrickPickState {
      return destroyed ? 'cancelled' : stateOf()
    },
    sessionId: input.sessionId,
    start,
    pause,
    resume,
    cancel: (reason) => cancel(reason ?? 'user'),
    skipCurrentParticipant,
    continueToNextParticipant,
    setSoundEnabled,
    focusParticipant: (participantId) => {
      // 호스트가 직접 골랐으면 그 선택을 존중한다 — 차례가 바뀌어도 되돌리지 않는다.
      followCurrentParticipant = false
      focusedParticipantId = participantId
      renderer.setOptions({ focusParticipantId: participantId })
    },
    getResult: () => result,
    exportReplayLog: (): ReplayLog | null => {
      try {
        return match.exportReplayLog()
      } catch {
        return null
      }
    },
    destroy,
  }
}

export default mountBrickPick
