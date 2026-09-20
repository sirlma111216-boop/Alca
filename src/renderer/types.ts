/**
 * 렌더러 공개 인터페이스.
 *
 * 렌더러는 core 의 상태를 **읽기만** 한다. 절대로 엔진 상태를 바꾸지 않는다.
 * 시뮬레이션과 렌더링이 분리돼 있으므로, 프레임이 밀려도 경기 결과는 달라지지 않는다.
 */

import type { ArenaEventType, Locale, Match } from '../core'

export type DetailLevel = 'full' | 'mini'

export interface RendererOptions {
  canvas: HTMLCanvasElement
  match: Match
  /** 모션 감소 — 잔상·파티클·화면 흔들림을 줄인다. */
  reducedMotion: boolean
  /** 선택적 CRT/스캔라인 효과. */
  scanlines: boolean
  /** 한 명을 크게 볼 때의 참가자 ID. null 이면 전체 격자 보기. */
  focusParticipantId: string | null
  locale: Locale
  /** 발표자로 뽑힌 참가자 ID — 결과 화면에서 강조한다. */
  highlightParticipantIds?: string[]
}

export interface MatchRenderer {
  /**
   * 한 프레임을 그린다. 물리는 이미 이만큼 진행돼 있다.
   * @param alpha 마지막 스텝 이후 남은 보간 비율 (0~1). 부드러운 움직임에 쓴다.
   */
  render(alpha: number): void
  /** 캔버스 크기와 기기 픽셀 비율을 반영한다. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void
  setOptions(patch: Partial<Omit<RendererOptions, 'canvas' | 'match'>>): void
  /** 화면 좌표 → 논리 x 좌표. 확대 보기(또는 1인 경기) 중일 때만 값을 낸다. */
  pointerToArenaX(clientX: number, clientY: number): number | null
  /** 그 지점에 그려진 참가자 ID. 관전 중 클릭해 확대할 때 쓴다. */
  participantAt(clientX: number, clientY: number): string | null
  /** 격자에서 각 참가자가 차지한 화면 영역 (HUD 배치용). */
  layout(): ArenaLayoutBox[]
  /** 타이머·이벤트 리스너·오프스크린 캔버스를 모두 정리한다. */
  destroy(): void
}

export interface ArenaLayoutBox {
  participantId: string
  /** CSS 픽셀 기준. */
  x: number
  y: number
  width: number
  height: number
  detail: DetailLevel
}

export function isMatchRenderer(v: unknown): v is MatchRenderer {
  return typeof v === 'object' && v !== null && typeof (v as MatchRenderer).render === 'function'
}

// ────────────────────────────────────────────────────────────────────────────
// 오디오
// ────────────────────────────────────────────────────────────────────────────

/** 효과음 이름. 전부 WebAudio 로 그때그때 합성한다 — 음원 파일을 쓰지 않는다. */
export type SoundName =
  | ArenaEventType
  | 'countdown'
  | 'countdown-go'
  | 'result-fanfare'
  | 'ui-click'

export interface GameAudio {
  readonly enabled: boolean
  setEnabled(enabled: boolean): void
  /**
   * 브라우저 정책상 사용자의 첫 조작 이후에만 소리를 켤 수 있다.
   * 버튼 클릭 등에서 한 번 불러 준다.
   */
  unlock(): void
  play(name: SoundName, options?: { volume?: number; pitch?: number }): void
  destroy(): void
}

export interface GameAudioOptions {
  enabled: boolean
  /** 0 ~ 1. */
  masterVolume?: number
}

// ────────────────────────────────────────────────────────────────────────────
// 입력
// ────────────────────────────────────────────────────────────────────────────

export interface InputControllerOptions {
  /**
   * 키보드 리스너를 붙일 요소. window 가 아니라 **이 요소**에 붙여야
   * 한 페이지에 게임이 여러 개 있어도 서로의 입력을 가로채지 않는다.
   * tabindex 를 줘서 초점을 받을 수 있게 해야 한다.
   */
  element: HTMLElement
  /** 포인터·터치를 받을 캔버스. */
  canvas: HTMLCanvasElement
  /** 화면 좌표 → 논리 x. 렌더러의 pointerToArenaX 를 그대로 넘긴다. */
  toArenaX: (clientX: number, clientY: number) => number | null
  /** 모바일용 별도 "발사" 버튼. 패들 이동과 서로 방해하지 않아야 한다. */
  fireButton?: HTMLElement | null
}

export interface InputController {
  /**
   * 이번 스텝에 쓸 입력을 가져간다.
   * firePressed 는 엣지 입력이라 **한 번만** true 로 나온다(여러 스텝을 한 프레임에
   * 처리해도 발사가 중복되지 않는다).
   */
  take(): import('../core').ArenaInput
  /** 조작을 받을지 여부. 일시정지·관전 중에는 끈다. */
  setEnabled(enabled: boolean): void
  /** 지금 입력 장치를 쓰고 있는지 (화면 안내용). */
  readonly lastDevice: 'mouse' | 'touch' | 'keyboard' | 'none'
  destroy(): void
}
