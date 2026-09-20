/**
 * 재현용 기록.
 *
 * 자동 경기는 seed 와 설정만 있으면 그대로 재현된다(입력이 없으므로).
 * 직접 조작 모드는 사람의 조작이 들어가므로 **입력 기록**이 있어야 재현된다.
 * 여기서는 바뀐 순간만 기록해 용량을 줄인다.
 */

import { STEP_MS } from './config'
import type { ArenaEvent, ArenaInput } from './engine'
import { NEUTRAL_INPUT } from './engine'

export interface InputFrame {
  /** 이 입력이 적용되기 시작하는 스텝 번호 (1부터). */
  s: number
  /**
   * pointerX. 방향키만 쓰는 상태면 null.
   *
   * **반올림하지 않는다.** 물리가 혼돈계라 0.01 단위의 차이도 30초 뒤에는
   * 다른 점수로 벌어진다. 용량보다 재현 정확도가 우선이다.
   */
  p: number | null
  /** direction */
  d: -1 | 0 | 1
  /** firePressed (엣지). 1/0 */
  f: 0 | 1
  /** fireHeld. 1/0 */
  h: 0 | 1
}

export interface ParticipantInputLog {
  participantId: string
  frames: InputFrame[]
  /** 기록된 총 스텝 수. */
  steps: number
}

/** 직접 조작 모드에서 한 참가자의 입력을 기록한다. */
export class InputRecorder {
  private frames: InputFrame[] = []
  private last: ArenaInput = NEUTRAL_INPUT
  private steps = 0

  record(step: number, input: ArenaInput): void {
    this.steps = step
    const changed =
      input.pointerX !== this.last.pointerX ||
      input.direction !== this.last.direction ||
      input.fireHeld !== this.last.fireHeld
    // firePressed 는 그 스텝에만 존재하는 엣지 입력이라 항상 남겨야 한다.
    if (changed || input.firePressed) {
      this.frames.push({
        s: step,
        p: input.pointerX,
        d: input.direction,
        f: input.firePressed ? 1 : 0,
        h: input.fireHeld ? 1 : 0,
      })
      this.last = { ...input, firePressed: false }
    }
  }

  toLog(participantId: string): ParticipantInputLog {
    return { participantId, frames: this.frames.slice(), steps: this.steps }
  }

  reset(): void {
    this.frames = []
    this.last = NEUTRAL_INPUT
    this.steps = 0
  }
}

/** 기록된 입력을 다시 재생한다. */
export class InputPlayer {
  private index = 0
  private current: ArenaInput = NEUTRAL_INPUT

  constructor(private readonly log: ParticipantInputLog) {}

  /** 해당 스텝에 적용할 입력. 스텝은 1부터 오름차순으로 호출해야 한다. */
  at(step: number): ArenaInput {
    let pressed = false
    while (this.index < this.log.frames.length && this.log.frames[this.index].s <= step) {
      const frame = this.log.frames[this.index]
      this.current = {
        pointerX: frame.p,
        direction: frame.d,
        firePressed: false,
        fireHeld: frame.h === 1,
      }
      if (frame.f === 1 && frame.s === step) pressed = true
      this.index += 1
    }
    return pressed ? { ...this.current, firePressed: true } : this.current
  }

  reset(): void {
    this.index = 0
    this.current = NEUTRAL_INPUT
  }
}

/** 경기 중 일어난 일을 그대로 담은 로그. 점수 교차 검증과 재현 확인에 쓴다. */
export interface ReplayLog {
  schemaVersion: string
  sessionId: string
  seed: string
  mode: 'auto' | 'manual'
  roundDurationMs: number
  stepMs: number
  /** 직접 조작 모드에서만 채워진다. */
  inputs: ParticipantInputLog[]
  /** 참가자별 경기 이벤트 (선택적으로 수집). */
  arenaEvents?: Array<{ participantId: string; events: ArenaEvent[] }>
}

export const REPLAY_STEP_MS = STEP_MS
