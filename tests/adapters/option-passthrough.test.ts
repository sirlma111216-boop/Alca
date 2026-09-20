/**
 * mountBrickPick 이 **옵션을 하나도 흘리지 않고** 엔진까지 넘기는지 본다.
 *
 * 왜 이 테스트가 있나: 계약(BrickPickInput)에 `roundMode` 칸을 더했을 때
 * mount.ts 가 옵션을 **필드별로 옮겨 적고 있어서** 그 칸이 조용히 사라졌다.
 * 화면에는 "다 깰 때까지" 라고 떠 있는데 엔진은 정해진 시간으로 돌았다.
 * 같은 사고가 다음 칸에서 또 나지 않도록 못 박아 둔다.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mountBrickPick } from '../../src/adapters/mount'
import type { BrickPickController, BrickPickReadyInfo } from '../../src/adapters/types'
import type { BrickPickInput } from '../../src/core'

let host: HTMLDivElement
const mounted: BrickPickController[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  for (const c of mounted.splice(0)) c.destroy()
  host.remove()
})

/** 마운트하고 onReady 가 준 appliedInput 을 돌려준다. */
function appliedInput(options: Parameters<typeof mountBrickPick>[1]): BrickPickInput {
  let info: BrickPickReadyInfo | null = null
  const controller = mountBrickPick(host, {
    ...options,
    autoStart: false,
    onReady: (i) => {
      info = i
    },
  })
  mounted.push(controller)
  if (!info) throw new Error('onReady 가 불리지 않았습니다 — 입력 검증에서 막혔을 수 있습니다.')
  return (info as BrickPickReadyInfo).appliedInput
}

const people = [
  { id: 'a', nickname: '가람' },
  { id: 'b', nickname: '나래' },
]

describe('mountBrickPick — 옵션이 엔진까지 그대로 간다', () => {
  it('roundMode: "until-cleared" 가 엔진 입력에 살아 있다', () => {
    const input = appliedInput({
      participants: people,
      roundMode: 'until-cleared',
      roundDurationMs: 90_000,
    })
    expect(input.roundMode).toBe('until-cleared')
    expect(input.roundDurationMs).toBe(90_000)
  })

  it('roundMode 를 생략하면 fixed 이고 기존 동작 그대로다', () => {
    const input = appliedInput({ participants: people })
    expect(input.roundMode).toBe('fixed')
    expect(input.roundDurationMs).toBe(30_000)
  })

  it('BrickPickInput 의 모든 칸이 엔진 입력에 존재한다 (새 칸이 조용히 사라지지 않게)', () => {
    const input = appliedInput({
      participants: people,
      mode: 'manual',
      difficulty: 'hard',
      roundDurationMs: 15_000,
      roundMode: 'fixed',
      // 제외하고 나면 후보가 1명이므로 하위 1명까지만 뽑을 수 있다.
      selectionRule: { kind: 'bottom', count: 1 },
      excludedParticipantIds: ['a'],
      seed: 'PASSTHROUGH',
      locale: 'ko',
      soundEnabled: false,
      reducedMotion: true,
    })

    // 계약이 요구하는 칸 목록. 여기에 빠진 것이 있으면 어딘가에서 흘린 것이다.
    const required: Array<keyof BrickPickInput> = [
      'schemaVersion',
      'sessionId',
      'participants',
      'mode',
      'difficulty',
      'roundDurationMs',
      'roundMode',
      'selectionRule',
      'excludedParticipantIds',
      'seed',
      'locale',
      'soundEnabled',
      'reducedMotion',
    ]
    for (const key of required) {
      expect(input[key], `${key} 가 엔진 입력에서 사라졌다`).not.toBeUndefined()
    }

    // 준 값이 그대로 도착했는지도 확인한다.
    expect(input.mode).toBe('manual')
    expect(input.difficulty).toBe('hard')
    expect(input.roundDurationMs).toBe(15_000)
    expect(input.selectionRule).toEqual({ kind: 'bottom', count: 1 })
    expect(input.excludedParticipantIds).toEqual(['a'])
    expect(input.seed).toBe('PASSTHROUGH')
    expect(input.soundEnabled).toBe(false)
    expect(input.reducedMotion).toBe(true)
    // 외부 ID 는 내부 번호로 바뀌지 않는다.
    expect(input.participants.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('콜백 같은 여분의 옵션이 섞여도 입력 검증이 깨지지 않는다', () => {
    const input = appliedInput({
      participants: people,
      showControls: false,
      showLeaderboard: false,
      progressIntervalMs: 999,
      scanlines: true,
      onProgress: () => undefined,
      onComplete: () => undefined,
    })
    expect(input.participants).toHaveLength(2)
    expect(input.roundMode).toBe('fixed')
  })
})
