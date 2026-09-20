/**
 * 코드 모듈 연동 공개 API 타입.
 *
 * 다른 수업 앱이 보는 표면은 이 파일이 전부다.
 *  - mountBrickPick(container, options)  → 프레임워크 없는 임베드
 *  - <BrickPick {...options} />          → React 어댑터 (같은 옵션을 그대로 받는다)
 *  - iframe                              → 같은 입력·같은 결과를 postMessage 로 주고받는다
 */

import type {
  BrickPickCancelEvent,
  BrickPickErrorEvent,
  BrickPickInput,
  BrickPickProgress,
  BrickPickResult,
  Participant,
  ReplayLog,
} from '../core'

/**
 * 게임을 띄울 때 넘기는 옵션.
 * BrickPickInput 의 항목을 거의 그대로 쓰되, 생략하면 안전한 기본값이 채워진다.
 * participants 만 필수다.
 */
export interface BrickPickOptions
  extends Partial<Omit<BrickPickInput, 'participants'>> {
  /** 필수. id 는 외부 앱의 값을 그대로 보존해 결과에 되돌려 준다. */
  participants: Participant[]

  /** 마운트 직후 바로 시작할지. 기본 false — start() 를 불러야 시작한다. */
  autoStart?: boolean
  /** 화면 위 조작 버튼(시작/일시정지/취소/소리/전체화면)을 보일지. 기본 true. */
  showControls?: boolean
  /** 실시간 순위표를 보일지. 기본 true. */
  showLeaderboard?: boolean
  /** 결과 화면을 게임 안에서 보여 줄지. false 면 onComplete 만 부르고 화면은 호스트가 그린다. 기본 true. */
  showResult?: boolean
  /** 진행 상황 콜백 간격(ms). 기본 250. */
  progressIntervalMs?: number
  /** 재현 실행 — 기록된 입력으로 직접 조작 모드를 재생한다. */
  replayLog?: ReplayLog | null
  /** CRT/스캔라인 효과. 기본 false. */
  scanlines?: boolean

  /** 게임이 준비됐을 때. 이 시점부터 start() 를 부를 수 있다. */
  onReady?: (info: BrickPickReadyInfo) => void
  /** 경기 진행 상황. progressIntervalMs 간격으로 온다. */
  onProgress?: (progress: BrickPickProgress) => void
  /** 경기가 정상적으로 끝났을 때. 이때만 결과가 확정된다. */
  onComplete?: (result: BrickPickResult) => void
  /** 취소됐을 때. 결과는 오지 않는다. */
  onCancel?: (event: BrickPickCancelEvent) => void
  /** 입력 검증 실패·내부 오류. */
  onError?: (event: BrickPickErrorEvent) => void
}

export interface BrickPickReadyInfo {
  sessionId: string
  engineVersion: string
  schemaVersion: string
  capabilities: readonly string[]
  /** 검증 중 조정된 항목이 있으면 한국어 안내가 담긴다. */
  warnings: string[]
  /** 실제로 적용된 입력(기본값이 채워진 상태). */
  appliedInput: BrickPickInput
}

export type BrickPickState =
  | 'idle'
  | 'ready'
  | 'running'
  | 'paused'
  | 'between-players'
  | 'finished'
  | 'cancelled'
  | 'error'

export interface BrickPickController {
  readonly state: BrickPickState
  readonly sessionId: string
  /** 경기를 시작한다. 이미 시작했으면 아무 일도 하지 않는다. */
  start(): void
  /** 공·아이템 낙하·효과 지속 시간·제한 시간이 함께 멈춘다. */
  pause(): void
  resume(): void
  /** 경기를 취소한다. 완료 결과를 만들지 않고 onCancel 만 부른다. */
  cancel(reason?: 'user' | 'host'): void
  /** 직접 조작 모드 — 현재 참가자를 건너뛴다(0점이 아니라 "미플레이"). */
  skipCurrentParticipant(): void
  /** 직접 조작 모드 — 다음 참가자의 차례를 시작한다. */
  continueToNextParticipant(): void
  /** 소리 켜기/끄기. */
  setSoundEnabled(enabled: boolean): void
  /** 한 명을 크게 본다. null 이면 전체 격자. */
  focusParticipant(participantId: string | null): void
  /** 끝난 경기의 결과. 아직이면 null. */
  getResult(): BrickPickResult | null
  /** 재현용 로그. */
  exportReplayLog(): ReplayLog | null
  /**
   * 타이머·이벤트 리스너·오디오·animation frame 을 전부 정리하고 DOM 을 비운다.
   * 여러 번 불러도 안전하다.
   */
  destroy(): void
}

/** mountBrickPick 의 시그니처. React 어댑터도 내부적으로 이것을 쓴다. */
export type MountBrickPick = (
  container: HTMLElement,
  options: BrickPickOptions,
) => BrickPickController
