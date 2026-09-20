/**
 * React 어댑터.
 *
 * mountBrickPick 을 감싸기만 한다. 게임 루프·HUD 는 전부 DOM 쪽에서 돌기 때문에
 * **프레임마다 React 가 다시 그려지지 않는다.**
 *
 * 지킨 것
 *  - React 18 StrictMode 의 이중 마운트에서도 인스턴스가 두 개 생기지 않는다
 *    (정리에서 반드시 destroy, ref 로 중복 마운트 방지).
 *  - 콜백(onProgress 등)은 ref 로 최신 값을 잡아 넘긴다. 콜백이 매 렌더 새로 만들어져도
 *    게임이 다시 마운트되지 않는다.
 *  - 다시 마운트하는 기준은 "경기 정의"(참가자·모드·난이도·시간·규칙·seed 등)뿐이다.
 *  - 소리 켜기/끄기 같은 값은 다시 마운트하지 않고 controller 로 반영한다.
 */

import { useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { CSSProperties, Ref, RefObject } from 'react'

import { mountBrickPick } from './mount'
import type {
  BrickPickController,
  BrickPickOptions,
  BrickPickReadyInfo,
  BrickPickState,
} from './types'
import type {
  BrickPickCancelEvent,
  BrickPickErrorEvent,
  BrickPickProgress,
  BrickPickResult,
  ReplayLog,
} from '../core'

// ────────────────────────────────────────────────────────────────────────────
// 밖으로 내보내는 조작 손잡이
// ────────────────────────────────────────────────────────────────────────────

/**
 * 호스트(수업 앱)가 밖에서 게임을 조작할 때 쓰는 손잡이.
 * 아직 마운트 전이면 각 메서드는 아무 일도 하지 않는다.
 */
export interface BrickPickHandle {
  readonly state: BrickPickState
  readonly sessionId: string | null
  start(): void
  pause(): void
  resume(): void
  cancel(reason?: 'user' | 'host'): void
  skipCurrentParticipant(): void
  continueToNextParticipant(): void
  setSoundEnabled(enabled: boolean): void
  focusParticipant(participantId: string | null): void
  getResult(): BrickPickResult | null
  exportReplayLog(): ReplayLog | null
}

export interface BrickPickProps extends BrickPickOptions {
  className?: string
  style?: CSSProperties
  /** 밖에서 start/pause/resume/cancel 을 부르고 싶을 때 넘기는 ref. */
  controllerRef?: Ref<BrickPickHandle>
}

// ────────────────────────────────────────────────────────────────────────────
// 다시 마운트할 기준 키
// ────────────────────────────────────────────────────────────────────────────

/**
 * "경기 정의"가 실제로 바뀌었을 때만 값이 바뀌는 문자열.
 * 콜백 함수나 매 렌더 새로 만들어지는 객체는 여기 들어오지 않는다.
 */
function matchDefinitionKey(options: BrickPickOptions): string {
  return JSON.stringify({
    p: options.participants.map((participant) => [participant.id, participant.nickname]),
    mode: options.mode ?? null,
    difficulty: options.difficulty ?? null,
    settings: options.difficultySettings ?? null,
    round: options.roundDurationMs ?? null,
    rule: options.selectionRule ?? null,
    excluded: options.excludedParticipantIds ?? null,
    seed: options.seed ?? null,
    session: options.sessionId ?? null,
    schema: options.schemaVersion ?? null,
    locale: options.locale ?? null,
    reduced: options.reducedMotion ?? null,
    scanlines: options.scanlines ?? null,
    autoStart: options.autoStart ?? null,
    controls: options.showControls ?? null,
    board: options.showLeaderboard ?? null,
    result: options.showResult ?? null,
    interval: options.progressIntervalMs ?? null,
    replayOf: options.replayOf ?? null,
    // 재현 로그는 통째로 비교하기엔 크다. 어느 로그인지만 구분한다.
    replay: options.replayLog
      ? `${options.replayLog.sessionId}:${options.replayLog.seed}:${options.replayLog.inputs.length}`
      : null,
  })
}

// ────────────────────────────────────────────────────────────────────────────
// useBrickPick
// ────────────────────────────────────────────────────────────────────────────

/**
 * 원하는 컨테이너 요소에 게임을 붙인다.
 *
 * @param containerRef 게임을 그릴 요소의 ref. 크기를 가진 요소여야 한다.
 * @param options      mountBrickPick 과 같은 옵션.
 * @returns 밖에서 조작할 손잡이. 참조가 바뀌지 않으므로 의존성에 넣어도 안전하다.
 */
export function useBrickPick(
  containerRef: RefObject<HTMLElement | null>,
  options: BrickPickOptions,
): BrickPickHandle {
  const controllerRef = useRef<BrickPickController | null>(null)
  const latest = useRef<BrickPickOptions>(options)

  // 최신 옵션(특히 콜백)을 항상 ref 에 담아 둔다 — 콜백이 바뀌어도 다시 마운트하지 않는다.
  useEffect(() => {
    latest.current = options
  })

  const key = matchDefinitionKey(options)

  useEffect(() => {
    const host = containerRef.current
    if (!host) return undefined

    // StrictMode 의 이중 마운트 등으로 이전 인스턴스가 남아 있으면 먼저 정리한다.
    controllerRef.current?.destroy()
    controllerRef.current = null

    const controller = mountBrickPick(host, {
      ...latest.current,
      onReady: (info: BrickPickReadyInfo) => latest.current.onReady?.(info),
      onProgress: (progress: BrickPickProgress) => latest.current.onProgress?.(progress),
      onComplete: (result: BrickPickResult) => latest.current.onComplete?.(result),
      onCancel: (event: BrickPickCancelEvent) => latest.current.onCancel?.(event),
      onError: (event: BrickPickErrorEvent) => latest.current.onError?.(event),
    })
    controllerRef.current = controller

    return () => {
      if (controllerRef.current === controller) controllerRef.current = null
      controller.destroy()
    }
    // containerRef 는 안정적인 ref 객체다. key 가 바뀔 때만 다시 마운트한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, containerRef])

  // 소리는 다시 마운트하지 않고 그대로 반영한다.
  useEffect(() => {
    if (options.soundEnabled === undefined) return
    controllerRef.current?.setSoundEnabled(options.soundEnabled)
  }, [options.soundEnabled, key])

  return useMemo<BrickPickHandle>(
    () => ({
      get state(): BrickPickState {
        return controllerRef.current?.state ?? 'idle'
      },
      get sessionId(): string | null {
        return controllerRef.current?.sessionId ?? null
      },
      start: () => controllerRef.current?.start(),
      pause: () => controllerRef.current?.pause(),
      resume: () => controllerRef.current?.resume(),
      cancel: (reason) => controllerRef.current?.cancel(reason),
      skipCurrentParticipant: () => controllerRef.current?.skipCurrentParticipant(),
      continueToNextParticipant: () => controllerRef.current?.continueToNextParticipant(),
      setSoundEnabled: (enabled) => controllerRef.current?.setSoundEnabled(enabled),
      focusParticipant: (participantId) => controllerRef.current?.focusParticipant(participantId),
      getResult: () => controllerRef.current?.getResult() ?? null,
      exportReplayLog: () => controllerRef.current?.exportReplayLog() ?? null,
    }),
    [],
  )
}

// ────────────────────────────────────────────────────────────────────────────
// <BrickPick />
// ────────────────────────────────────────────────────────────────────────────

/**
 * 게임 화면 컴포넌트.
 *
 * ```tsx
 * const game = useRef<BrickPickHandle>(null)
 * <BrickPick participants={people} mode="auto" controllerRef={game} onComplete={save} />
 * <button onClick={() => game.current?.start()}>시작</button>
 * ```
 */
export function BrickPick(props: BrickPickProps): JSX.Element {
  const { className, style, controllerRef, ...options } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const handle = useBrickPick(hostRef, options)
  useImperativeHandle(controllerRef, () => handle, [handle])

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: '100%', height: '100%', ...style }}
    />
  )
}

export default BrickPick

// ── 타입 다시 내보내기 ──────────────────────────────────────────────────────

export { mountBrickPick }
export type {
  BrickPickController,
  BrickPickOptions,
  BrickPickReadyInfo,
  BrickPickState,
} from './types'
export type {
  BrickPickCancelEvent,
  BrickPickErrorEvent,
  BrickPickInput,
  BrickPickProgress,
  BrickPickResult,
  DifficultyPreset,
  DifficultySettings,
  GameMode,
  Participant,
  ParticipantResult,
  ReplayLog,
  SelectionRule,
} from '../core'
