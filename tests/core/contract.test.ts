/**
 * 입력 검증 계약 시험.
 *
 * 여기서 보는 것은 "구현이 이렇게 생겼다"가 아니라 **계약 문서가 약속한 규칙**이다.
 * 그래서 기대값은 contract.ts 의 코드가 아니라 문서에 적힌 규칙에서 직접 가져와 적는다.
 *  - 외부 ID 는 게임을 한 바퀴 돌아도 글자 하나 바뀌지 않는다.
 *  - 거절은 코드(code)로 구분되고, 안내는 사람이 읽을 한국어여야 한다.
 *  - 조용히 고쳐 쓴 값은 반드시 warnings 로 알린다.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_PARTICIPANTS,
  MAX_ROUND_DURATION_MS,
  MIN_ROUND_DURATION_MS,
  Match,
  SCHEMA_VERSION,
  parseBrickPickInput,
  resolveDifficulty,
  validateParticipants,
  validateSelectionRule,
} from '../../src/core'
import type { BrickPickInput, DifficultySettings, Participant } from '../../src/core'

const people = (n: number): Participant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i + 1}`, nickname: `학생${i + 1}` }))

/** 검증을 통과했다고 믿고 값을 꺼낸다. 실패하면 오류 내용을 그대로 보여 주고 터뜨린다. */
function mustParse(raw: unknown): { value: BrickPickInput; warnings: string[] } {
  const parsed = parseBrickPickInput(raw)
  if (!parsed.ok) throw new Error(`검증 실패: ${JSON.stringify(parsed.error)}`)
  return { value: parsed.value, warnings: parsed.warnings }
}

// ────────────────────────────────────────────────────────────────────────────
// 스키마 버전
// ────────────────────────────────────────────────────────────────────────────

describe('parseBrickPickInput — 스키마 버전', () => {
  it('지원하지 않는 버전은 조용히 넘어가지 않고 UNSUPPORTED_SCHEMA_VERSION 으로 거절한다', () => {
    const parsed = parseBrickPickInput({ schemaVersion: '0.9', participants: people(3) })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.code).toBe('UNSUPPORTED_SCHEMA_VERSION')
    // 화면에 그대로 띄울 한국어 안내이고, 어떤 버전이 문제인지 사람이 알 수 있어야 한다.
    expect(parsed.error.message).toContain('0.9')
    expect(parsed.error.message).toMatch(/[가-힣]/)
  })

  it('현재 버전은 통과하고, 생략하면 현재 버전으로 채워진다', () => {
    expect(mustParse({ schemaVersion: SCHEMA_VERSION, participants: people(2) }).value.schemaVersion)
      .toBe(SCHEMA_VERSION)
    expect(mustParse({ participants: people(2) }).value.schemaVersion).toBe(SCHEMA_VERSION)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 참가자 목록
// ────────────────────────────────────────────────────────────────────────────

describe('validateParticipants — 참가자 목록', () => {
  it('중복 ID 는 DUPLICATE_PARTICIPANT_ID 로 거절한다', () => {
    const r = validateParticipants([
      { id: 'same', nickname: '가' },
      { id: 'other', nickname: '나' },
      { id: 'same', nickname: '다' },
    ])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('DUPLICATE_PARTICIPANT_ID')
    expect(r.error.details.join(' ')).toContain('same')
  })

  it('같은 닉네임은 허용된다 — ID 만 다르면 동명이인도 들어온다', () => {
    const r = validateParticipants([
      { id: 'a', nickname: '김하늘' },
      { id: 'b', nickname: '김하늘' },
      { id: 'c', nickname: '김하늘' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.map((p) => p.nickname)).toEqual(['김하늘', '김하늘', '김하늘'])
    expect(r.value.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('빈 이름과 공백만 있는 이름은 거절한다', () => {
    for (const bad of ['', '   ', '\t\n']) {
      const r = validateParticipants([{ id: 'a', nickname: bad }])
      expect(r.ok, `이름 ${JSON.stringify(bad)} 는 거절돼야 한다`).toBe(false)
      if (r.ok) continue
      expect(r.error.code).toBe('INVALID_INPUT')
    }
  })

  it('이름의 앞뒤 공백은 trim 된다', () => {
    const r = validateParticipants([{ id: 'a', nickname: '  홍길동  ' }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value[0].nickname).toBe('홍길동')
  })

  it('0명은 TOO_FEW_PARTICIPANTS, 41명은 TOO_MANY_PARTICIPANTS, 40명은 통과한다', () => {
    const none = validateParticipants([])
    expect(none.ok).toBe(false)
    if (!none.ok) expect(none.error.code).toBe('TOO_FEW_PARTICIPANTS')

    const over = validateParticipants(people(MAX_PARTICIPANTS + 1))
    expect(over.ok).toBe(false)
    if (!over.ok) {
      expect(over.error.code).toBe('TOO_MANY_PARTICIPANTS')
      expect(over.error.message).toContain(String(MAX_PARTICIPANTS))
    }

    const edge = validateParticipants(people(MAX_PARTICIPANTS))
    expect(edge.ok).toBe(true)
    if (edge.ok) expect(edge.value).toHaveLength(MAX_PARTICIPANTS)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 외부 ID 보존 — 계약의 핵심 약속
// ────────────────────────────────────────────────────────────────────────────

describe('외부 ID 보존', () => {
  const exotic: Participant[] = [
    { id: 'u-1', nickname: '대시' },
    { id: 'ID WITH SPACE', nickname: '공백' },
    { id: '학생_1', nickname: '한글아이디' },
    { id: '8f14e45f-ceea-467a-9f2c-9b0a6c5d7e31', nickname: '유<uuid>' },
    { id: '007', nickname: '앞자리0' },
  ]

  it('검증을 통과한 뒤에도 ID 는 글자 하나 바뀌지 않는다', () => {
    const { value } = mustParse({ participants: exotic, seed: 'ID-KEEP' })
    expect(value.participants.map((p) => p.id)).toEqual(exotic.map((p) => p.id))
    // 내부 인덱스(0,1,2…)로 바뀌지 않았는지도 못 박아 둔다.
    expect(value.participants.map((p) => p.id)).not.toEqual(['0', '1', '2', '3', '4'])
  })

  it('경기를 끝까지 돌린 결과에도 같은 ID 가 그대로 실려 돌아온다', () => {
    const { value } = mustParse({
      participants: exotic,
      mode: 'auto',
      roundDurationMs: 15_000,
      seed: 'ID-KEEP',
      sessionId: 'id-keep',
      selectionRule: { kind: 'top', count: 2 },
    })
    const match = new Match({ input: value, now: () => 1, random: () => 0.5 })
    match.start()
    while (!match.isFinished) match.step()
    const result = match.buildResult()

    // 순위 때문에 순서는 섞이므로 집합으로 비교한다.
    expect(new Set(result.participants.map((p) => p.id))).toEqual(new Set(exotic.map((p) => p.id)))
    // 선정된 사람의 ID 도 원래 명단에 있던 값 그대로여야 한다.
    for (const id of result.selectedParticipantIds) {
      expect(exotic.some((p) => p.id === id)).toBe(true)
    }
    for (const reason of result.selectionReasons) {
      expect(exotic.some((p) => p.id === reason.participantId)).toBe(true)
    }
    // 제외 목록도 준 값을 그대로 돌려준다.
    expect(result.appliedSettings.excludedParticipantIds).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 조용히 고친 값은 warnings 로
// ────────────────────────────────────────────────────────────────────────────

describe('parseBrickPickInput — 범위 보정과 안내', () => {
  it('roundDurationMs 가 범위 밖이면 잘리고 한국어 안내가 남는다', () => {
    const tooShort = mustParse({ participants: people(2), roundDurationMs: 1_000 })
    expect(tooShort.value.roundDurationMs).toBe(MIN_ROUND_DURATION_MS)
    expect(tooShort.warnings.some((w) => w.includes('경기 시간'))).toBe(true)

    const tooLong = mustParse({ participants: people(2), roundDurationMs: 9_999_999 })
    expect(tooLong.value.roundDurationMs).toBe(MAX_ROUND_DURATION_MS)
    expect(tooLong.warnings.some((w) => w.includes('경기 시간'))).toBe(true)

    // 범위 안이면 아무 말도 하지 않는다.
    const fine = mustParse({ participants: people(2), roundDurationMs: 30_000 })
    expect(fine.value.roundDurationMs).toBe(30_000)
    expect(fine.warnings).toEqual([])
  })

  it('모르는 mode 는 auto 로 되돌리고 warnings 로 알린다', () => {
    const parsed = mustParse({ participants: people(2), mode: 'coop' })
    expect(parsed.value.mode).toBe('auto')
    expect(parsed.warnings.some((w) => w.includes('coop'))).toBe(true)
  })

  it('모르는 difficulty 는 normal 로 되돌리고 warnings 로 알린다', () => {
    const parsed = mustParse({ participants: people(2), difficulty: 'insane' })
    expect(parsed.value.difficulty).toBe('normal')
    // 값을 말없이 바꿔 놓으면 호스트가 "왜 쉬워졌지" 를 영원히 알 수 없다.
    expect(parsed.warnings.some((w) => w.includes('insane'))).toBe(true)
  })

  it('명단에 없는 excludedParticipantIds 는 무시하고 안내한다', () => {
    const parsed = mustParse({
      participants: people(4),
      excludedParticipantIds: ['u2', 'ghost', 'u2'],
    })
    // 유령 ID 는 빠지고, 중복도 한 번만 남는다.
    expect(parsed.value.excludedParticipantIds).toEqual(['u2'])
    expect(parsed.warnings.some((w) => w.includes('ghost'))).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 선정 규칙
// ────────────────────────────────────────────────────────────────────────────

describe('validateSelectionRule — 선정 규칙', () => {
  it('후보 수를 모르면 모양만, 알면 범위까지 본다', () => {
    expect(validateSelectionRule({ kind: 'top', count: 5 }).ok).toBe(true)

    const over = validateSelectionRule({ kind: 'top', count: 5 }, 2)
    expect(over.ok).toBe(false)
    if (!over.ok) {
      expect(over.error.code).toBe('NOT_ENOUGH_CANDIDATES')
      expect(over.error.message).toContain('2')
      expect(over.error.message).toContain('5')
    }
  })

  it('1명 미만·정수가 아닌 인원은 INVALID_SELECTION_RULE', () => {
    for (const bad of [0, -1, 1.5, '2', null]) {
      const r = validateSelectionRule({ kind: 'top', count: bad })
      expect(r.ok, `count=${String(bad)} 는 거절돼야 한다`).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('INVALID_SELECTION_RULE')
    }
  })

  it('ranks 는 중복·비정수를 거절하고 통과하면 오름차순으로 정리된다', () => {
    const dup = validateSelectionRule({ kind: 'ranks', ranks: [2, 2] })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error.code).toBe('INVALID_SELECTION_RULE')

    const empty = validateSelectionRule({ kind: 'ranks', ranks: [] })
    expect(empty.ok).toBe(false)

    const good = validateSelectionRule({ kind: 'ranks', ranks: [8, 2, 5] }, 10)
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.value).toEqual({ kind: 'ranks', ranks: [2, 5, 8] })
  })

  it('알 수 없는 규칙 종류와 빈 값은 거절한다', () => {
    for (const bad of [undefined, null, 'top', { kind: 'random' }]) {
      const r = validateSelectionRule(bad)
      expect(r.ok, `${JSON.stringify(bad)} 는 거절돼야 한다`).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('INVALID_SELECTION_RULE')
    }
  })

  it('후보가 2명인데 5위를 지정하면 경기 시작 전에 NOT_ENOUGH_CANDIDATES 로 막는다', () => {
    const parsed = parseBrickPickInput({
      participants: people(5),
      excludedParticipantIds: ['u1', 'u2', 'u3'], // 후보는 u4, u5 두 명
      selectionRule: { kind: 'ranks', ranks: [5] },
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.code).toBe('NOT_ENOUGH_CANDIDATES')
    expect(parsed.error.message).toContain('2')

    // 후보 수 안쪽인 2위는 통과한다.
    const fine = parseBrickPickInput({
      participants: people(5),
      excludedParticipantIds: ['u1', 'u2', 'u3'],
      selectionRule: { kind: 'ranks', ranks: [2] },
    })
    expect(fine.ok).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 난이도 덮어쓰기
// ────────────────────────────────────────────────────────────────────────────

describe('resolveDifficulty — 덮어쓴 수치는 범위로 잘린다', () => {
  it('말도 안 되는 값은 허용 범위 안으로 잘린다', () => {
    const s = resolveDifficulty('normal', {
      ballBaseSpeed: 99_999,
      ballAccelPerMinute: -5,
      brickRows: 100,
      maxBrickDurability: 9,
      autoMissChance: 3,
      lives: 0,
    })
    expect(s.ballBaseSpeed).toBeLessThanOrEqual(400)
    expect(s.ballAccelPerMinute).toBe(0)
    expect(s.brickRows).toBe(12)
    expect(s.maxBrickDurability).toBe(3)
    expect(s.autoMissChance).toBe(0.5)
    expect(s.lives).toBe(1)
  })

  it('숫자가 아닌 값은 프리셋 값을 그대로 쓴다', () => {
    const base = resolveDifficulty('hard')
    const s = resolveDifficulty('hard', {
      ballBaseSpeed: Number.NaN,
      paddleWidth: undefined,
    } as Partial<DifficultySettings>)
    expect(s.ballBaseSpeed).toBe(base.ballBaseSpeed)
    expect(s.paddleWidth).toBe(base.paddleWidth)
  })

  it('ballMaxSpeed < ballBaseSpeed 는 기본 속도까지 끌어올린다', () => {
    const s = resolveDifficulty('normal', { ballBaseSpeed: 300, ballMaxSpeed: 100 })
    expect(s.ballBaseSpeed).toBe(300)
    expect(s.ballMaxSpeed).toBeGreaterThanOrEqual(s.ballBaseSpeed)
    expect(s.ballMaxSpeed).toBe(300)
  })

  it('paddleMaxWidth < paddleWidth 는 기본 너비까지 끌어올린다 (확장 아이템이 무의미해지지 않게)', () => {
    const s = resolveDifficulty('normal', { paddleWidth: 100, paddleMaxWidth: 30 })
    expect(s.paddleWidth).toBe(100)
    expect(s.paddleMaxWidth).toBeGreaterThanOrEqual(s.paddleWidth)
    expect(s.paddleMaxWidth).toBe(100)
  })

  it('lives > items.maxLives 는 목숨 상한을 올려 맞춘다', () => {
    const s = resolveDifficulty('normal', { lives: 7, items: { maxLives: 2 } } as Partial<DifficultySettings>)
    expect(s.lives).toBe(7)
    expect(s.items.maxLives).toBeGreaterThanOrEqual(s.lives)
    expect(s.items.maxLives).toBe(7)
  })

  it('아이템 설정도 범위로 잘린다', () => {
    const s = resolveDifficulty('normal', {
      items: { brickRatio: 5, capsuleSpeed: 1, maxBalls: 99, slowFactor: 0, expandFactor: 10 },
    } as Partial<DifficultySettings>)
    expect(s.items.brickRatio).toBe(0.6)
    expect(s.items.capsuleSpeed).toBe(20)
    expect(s.items.maxBalls).toBe(5)
    expect(s.items.slowFactor).toBe(0.4)
    expect(s.items.expandFactor).toBe(2.5)
  })

  it('Match 가 실제로 쓰는 설정도 같은 방식으로 잘린다', () => {
    const { value } = mustParse({
      participants: people(2),
      difficulty: 'normal',
      difficultySettings: { ballBaseSpeed: 300, ballMaxSpeed: 100, lives: 7, items: { maxLives: 2 } },
    })
    const match = new Match({ input: value, now: () => 1, random: () => 0.5 })
    expect(match.settings.ballMaxSpeed).toBe(300)
    expect(match.settings.items.maxLives).toBe(7)
    // 결과 JSON 에 실리는 스냅샷도 보정된 값이어야 한다.
    const snapshot = match.buildResult().appliedSettings.difficultySettings
    expect(snapshot.ballMaxSpeed).toBe(300)
    expect(snapshot.items.maxLives).toBe(7)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 기본값
// ────────────────────────────────────────────────────────────────────────────

describe('parseBrickPickInput — 기본값 채우기', () => {
  it('참가자만 줘도 나머지가 전부 채워진다', () => {
    const { value, warnings } = mustParse({ participants: people(3) })
    expect(value.seed).toBe('BRICKPICK')
    expect(value.locale).toBe('ko')
    expect(value.soundEnabled).toBe(true)
    expect(value.reducedMotion).toBe(false)
    expect(value.mode).toBe('auto')
    expect(value.difficulty).toBe('normal')
    expect(value.roundDurationMs).toBe(30_000)
    expect(value.selectionRule).toEqual({ kind: 'ranks', ranks: [1] })
    expect(value.excludedParticipantIds).toEqual([])
    expect(value.replayOf).toBeNull()
    expect(value.hideParticipantEditor).toBe(true)
    // sessionId 는 비어 있지 않은 문자열로 만들어진다.
    expect(typeof value.sessionId).toBe('string')
    expect(value.sessionId.length).toBeGreaterThan(0)
    expect(warnings).toEqual([])
  })

  it('sessionId 는 임의 난수가 아니라 seed 에서 결정적으로 만들어진다', () => {
    const a = mustParse({ participants: people(2), seed: 'ALPHA' }).value.sessionId
    const b = mustParse({ participants: people(2), seed: 'ALPHA' }).value.sessionId
    const c = mustParse({ participants: people(2), seed: 'BETA' }).value.sessionId
    expect(b).toBe(a)
    expect(c).not.toBe(a)
  })

  it('준 값이 있으면 기본값이 덮어쓰지 않는다', () => {
    const { value } = mustParse({
      participants: people(2),
      sessionId: 'host-session-77',
      seed: 'MY-SEED',
      locale: 'en',
      soundEnabled: false,
      reducedMotion: true,
      hideParticipantEditor: false,
      replayOf: 'bpr_previous',
    })
    expect(value.sessionId).toBe('host-session-77')
    expect(value.seed).toBe('MY-SEED')
    expect(value.locale).toBe('en')
    expect(value.soundEnabled).toBe(false)
    expect(value.reducedMotion).toBe(true)
    expect(value.hideParticipantEditor).toBe(false)
    expect(value.replayOf).toBe('bpr_previous')
  })

  it('객체가 아닌 입력은 INVALID_INPUT 으로 거절한다', () => {
    for (const bad of [null, undefined, 42, 'input', [1, 2]]) {
      const r = parseBrickPickInput(bad)
      expect(r.ok, `${JSON.stringify(bad)} 는 거절돼야 한다`).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT')
    }
  })
})
