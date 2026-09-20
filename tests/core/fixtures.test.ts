import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Match, parseBrickPickInput } from '../../src/core'

/**
 * 문서에 싣는 입력/결과 JSON 예시를 **실제 엔진으로** 만들어 낸다.
 * 손으로 쓴 예시가 코드와 어긋나는 일을 막는다.
 * `npm test` 를 돌릴 때마다 docs/examples/*.json 이 갱신된다.
 */
const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../../docs/examples')

describe('문서용 예시 JSON', () => {
  it('입력과 결과 예시를 만든다', () => {
    const raw = {
      schemaVersion: '1.0',
      sessionId: 'lesson-2026-09-20-3교시:activity-7',
      participants: [
        { id: 'stu_a1b2', nickname: '김민준' },
        { id: 'stu_c3d4', nickname: '이서연' },
        { id: 'stu_e5f6', nickname: '박도윤' },
        { id: 'stu_g7h8', nickname: '최지우' },
        { id: 'stu_i9j0', nickname: '정하은' },
        { id: 'stu_k1l2', nickname: '김민준' },
      ],
      mode: 'auto',
      difficulty: 'normal',
      roundDurationMs: 30_000,
      selectionRule: { kind: 'ranks', ranks: [3] },
      excludedParticipantIds: ['stu_c3d4'],
      seed: 'KX7M2PQR4T',
      locale: 'ko',
      soundEnabled: true,
      reducedMotion: false,
    }

    const parsed = parseBrickPickInput(raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const match = new Match({
      input: parsed.value,
      now: () => Date.parse('2026-09-20T02:15:30.000Z'),
      random: () => 0.42,
    })
    match.start()
    while (!match.isFinished) match.step()
    const result = match.buildResult()

    // 계약이 실제로 지켜지는지 여기서도 확인한다.
    expect(result.participants).toHaveLength(6)
    expect(result.participants.map((p) => p.id).sort()).toEqual(
      raw.participants.map((p) => p.id).sort(),
    )
    const excluded = result.participants.find((p) => p.id === 'stu_c3d4')
    expect(excluded?.excluded).toBe(true)
    expect(excluded?.eligibleRank).toBeNull()
    expect(result.eligibleCount).toBe(5)
    expect(result.selectedParticipantIds).toHaveLength(1)
    expect(result.selectedParticipantIds[0]).not.toBe('stu_c3d4')

    mkdirSync(outDir, { recursive: true })
    writeFileSync(resolve(outDir, 'input.json'), JSON.stringify(raw, null, 2) + '\n', 'utf8')
    writeFileSync(resolve(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8')

    const cancelled = {
      schemaVersion: '1.0',
      sessionId: raw.sessionId,
      status: 'cancelled',
      cancelledAt: '2026-09-20T02:15:52.000Z',
      reason: 'user',
    }
    const errored = {
      schemaVersion: '1.0',
      sessionId: raw.sessionId,
      status: 'error',
      code: 'NOT_ENOUGH_CANDIDATES',
      message: '선정 가능한 참가자가 5명이라 8위를 뽑을 수 없습니다.',
      details: ['rank=8'],
    }
    writeFileSync(
      resolve(outDir, 'cancel.json'),
      JSON.stringify(cancelled, null, 2) + '\n',
      'utf8',
    )
    writeFileSync(resolve(outDir, 'error.json'), JSON.stringify(errored, null, 2) + '\n', 'utf8')
  })
})
