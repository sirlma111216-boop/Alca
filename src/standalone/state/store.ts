/**
 * 단독 실행 웹사이트의 설정 상태.
 *
 * 규칙
 *  - 참가자 명단과 경기 결과는 **기본적으로 저장하지 않는다.** 화면을 닫으면 사라진다.
 *  - localStorage 에는 소리·난이도·모션 감소·스캔라인 같은 **환경설정만** 남긴다.
 *  - 명단/결과는 "이 기기에 저장" 을 눌렀을 때만 저장하고, 언제든 지울 수 있다.
 *  - 외부 서버로는 아무것도 보내지 않는다. 네트워크 호출이 이 파일에 하나도 없다.
 *  - 발표 이력(이미 발표한 사람)은 이 탭을 열어 둔 동안만 유지된다.
 */

import { useEffect, useMemo, useReducer } from 'react'
import type { Dispatch } from 'react'
import {
  DIFFICULTY_LABELS,
  ITEM_KINDS,
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
  SCHEMA_VERSION,
  SELECTION_PRESETS,
  checkSelectionRule,
  defaultDifficultySettings,
  resolveDifficulty,
} from '../../core'
import type {
  BrickPickResult,
  DifficultyPreset,
  DifficultySettings,
  GameMode,
  ItemSettings,
  Participant,
  SelectionRule,
} from '../../core'

// ────────────────────────────────────────────────────────────────────────────
// 화면
// ────────────────────────────────────────────────────────────────────────────

export type ScreenId =
  | 'participants'
  | 'mode'
  | 'selection'
  | 'summary'
  | 'match'
  | 'result'

/** 화면 흐름 순서. 상단 단계 표시가 이 배열을 그대로 그린다. */
export const SCREEN_ORDER: readonly ScreenId[] = [
  'participants',
  'mode',
  'selection',
  'summary',
  'match',
  'result',
]

export const SCREEN_LABELS: Record<ScreenId, string> = {
  participants: '참가자',
  mode: '경기 방식',
  selection: '선정 규칙',
  summary: '규칙 요약',
  match: '경기',
  result: '결과',
}

// ────────────────────────────────────────────────────────────────────────────
// 상태 모양
// ────────────────────────────────────────────────────────────────────────────

export interface EditableParticipant {
  id: string
  nickname: string
}

/** 선정 규칙 화면의 입력값. 프리셋마다 쓰는 값이 다르다. */
export interface SelectionDraft {
  presetId: string
  /** 상위/하위 N명에서 쓰는 N. */
  count: number
  /** 지정 순위 1명에서 쓰는 순위. */
  rank: number
  /** 지정한 복수 순위. */
  ranks: number[]
}

/** localStorage 에 남기는 유일한 것. 개인정보가 들어가지 않는다. */
export interface Preferences {
  soundEnabled: boolean
  reducedMotion: boolean
  scanlines: boolean
  /** 다음에 열었을 때의 기본 난이도. */
  difficulty: DifficultyPreset
}

export interface StandaloneState {
  screen: ScreenId
  participants: EditableParticipant[]
  mode: GameMode
  /** 지금 고른 난이도 이름. 수치를 하나라도 손대면 'custom' 이 된다. */
  difficulty: DifficultyPreset
  /** '기본값으로 되돌리기' 가 돌아갈 기준 프리셋. */
  basePreset: Exclude<DifficultyPreset, 'custom'>
  /** 실제로 경기에 넘어가는 최종 난이도 수치. */
  settings: DifficultySettings
  roundDurationMs: number
  selection: SelectionDraft
  /** 이번 경기에서 후보에서 뺄 참가자. */
  excludedIds: string[]
  /** 이번 세션에서 이미 발표한 사람. 탭을 닫으면 사라진다. */
  presentedIds: string[]
  sessionId: string
  seed: string
  result: BrickPickResult | null
  /** 안내 문구(파란 알림). */
  notice: string | null
  /** 오류 문구(빨간 알림). aria-live 로 읽힌다. */
  error: string | null
  /** 이 기기에 저장된 명단이 있으면 그 인원 수. */
  savedRosterCount: number | null
  /** 이 기기에 저장된 결과가 있으면 그 시각(ISO). */
  savedResultAt: string | null
  prefs: Preferences
}

// ────────────────────────────────────────────────────────────────────────────
// 저장소 (localStorage) — 접두사 brickpick:
// ────────────────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'brickpick:'
const KEY_PREFS = `${STORAGE_PREFIX}prefs`
const KEY_ROSTER = `${STORAGE_PREFIX}roster`
const KEY_RESULT = `${STORAGE_PREFIX}result`

interface SavedRoster {
  savedAt: string
  participants: EditableParticipant[]
}

interface SavedResult {
  savedAt: string
  result: BrickPickResult
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* 사생활 보호 모드 등에서 막힐 수 있다. 무시해도 기능에 지장이 없다. */
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function defaultPreferences(): Preferences {
  return {
    soundEnabled: true,
    reducedMotion: prefersReducedMotion(),
    scanlines: false,
    difficulty: 'normal',
  }
}

function loadPreferences(): Preferences {
  const base = defaultPreferences()
  const saved = readJson<Partial<Preferences>>(KEY_PREFS)
  if (!saved) return base
  return {
    soundEnabled: typeof saved.soundEnabled === 'boolean' ? saved.soundEnabled : base.soundEnabled,
    reducedMotion:
      typeof saved.reducedMotion === 'boolean' ? saved.reducedMotion : base.reducedMotion,
    scanlines: typeof saved.scanlines === 'boolean' ? saved.scanlines : base.scanlines,
    difficulty:
      saved.difficulty === 'easy' ||
      saved.difficulty === 'normal' ||
      saved.difficulty === 'hard' ||
      saved.difficulty === 'custom'
        ? saved.difficulty
        : base.difficulty,
  }
}

/** 환경설정만 저장한다. 명단·결과는 여기에 들어가지 않는다. */
export function savePreferences(prefs: Preferences): void {
  writeJson(KEY_PREFS, prefs)
}

export function saveRosterToDevice(participants: readonly EditableParticipant[]): boolean {
  return writeJson(KEY_ROSTER, {
    savedAt: new Date().toISOString(),
    participants: participants.map((p) => ({ id: p.id, nickname: p.nickname })),
  } satisfies SavedRoster)
}

export function loadRosterFromDevice(): EditableParticipant[] | null {
  const saved = readJson<SavedRoster>(KEY_ROSTER)
  if (!saved || !Array.isArray(saved.participants)) return null
  const list = saved.participants
    .filter((p) => p && typeof p.id === 'string' && typeof p.nickname === 'string')
    .map((p) => ({ id: p.id, nickname: p.nickname.trim() }))
    .filter((p) => p.nickname.length > 0)
  return list.length > 0 ? list : null
}

export function savedRosterCount(): number | null {
  const list = loadRosterFromDevice()
  return list ? list.length : null
}

export function saveResultToDevice(result: BrickPickResult): boolean {
  return writeJson(KEY_RESULT, {
    savedAt: new Date().toISOString(),
    result,
  } satisfies SavedResult)
}

export function savedResultAt(): string | null {
  const saved = readJson<SavedResult>(KEY_RESULT)
  return saved && typeof saved.savedAt === 'string' ? saved.savedAt : null
}

/** 이 기기에 저장한 명단과 결과를 모두 지운다. 환경설정은 남는다. */
export function clearSavedData(): void {
  removeKey(KEY_ROSTER)
  removeKey(KEY_RESULT)
}

/** 환경설정까지 포함해 브릭픽이 남긴 모든 항목을 지운다. */
export function clearAllStoredData(): void {
  removeKey(KEY_ROSTER)
  removeKey(KEY_RESULT)
  removeKey(KEY_PREFS)
}

// ────────────────────────────────────────────────────────────────────────────
// 참가자 도우미
// ────────────────────────────────────────────────────────────────────────────

/** 화면에 보여 줄 수 있는 닉네임 최대 길이. 프로젝터에서 잘리지 않게 제한한다. */
export const MAX_NICKNAME_LENGTH = 20

let idCounter = 0

export function makeParticipantId(): string {
  idCounter += 1
  const rand = Math.random().toString(36).slice(2, 8)
  return `p${idCounter.toString(36)}-${rand}`
}

export interface ParsedNameInput {
  names: string[]
  /** 이름이 없어 버린 줄 수. */
  blanks: number
  /** 너무 길어 줄인 이름 수. */
  truncated: number
}

/** 줄바꿈 또는 쉼표로 구분된 입력을 이름 목록으로 바꾼다. */
export function parseNameInput(text: string): ParsedNameInput {
  const parts = text.split(/[\n\r,、，]/)
  const names: string[] = []
  let blanks = 0
  let truncated = 0
  parts.forEach((part, index) => {
    const trimmed = part.trim()
    if (trimmed.length > 0) {
      if (trimmed.length > MAX_NICKNAME_LENGTH) {
        truncated += 1
        names.push(trimmed.slice(0, MAX_NICKNAME_LENGTH))
      } else {
        names.push(trimmed)
      }
      return
    }
    // 맨 앞/맨 뒤의 빈 칸은 그냥 여백이므로 "거부된 이름"으로 세지 않는다.
    const isEdgePadding = (index === 0 || index === parts.length - 1) && part.length === 0
    if (!isEdgePadding) blanks += 1
  })
  return { names, blanks, truncated }
}

/**
 * 같은 닉네임을 구별할 보조 표시를 붙인다.
 * 같은 이름이 둘 이상이면 "홍길동 (1)", "홍길동 (2)" 로 보여 준다. 내부 ID 는 그대로다.
 */
export function displayNameMap(
  list: readonly { id: string; nickname: string }[],
): Record<string, string> {
  const total = new Map<string, number>()
  for (const p of list) {
    total.set(p.nickname, (total.get(p.nickname) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const out: Record<string, string> = {}
  for (const p of list) {
    if ((total.get(p.nickname) ?? 0) > 1) {
      const n = (seen.get(p.nickname) ?? 0) + 1
      seen.set(p.nickname, n)
      out[p.id] = `${p.nickname} (${n})`
    } else {
      out[p.id] = p.nickname
    }
  }
  return out
}

/** 게임과 결과에 넘길 참가자 목록 — 화면과 같은 이름을 쓰도록 보조 표시를 적용한다. */
export function toParticipants(list: readonly EditableParticipant[]): Participant[] {
  const names = displayNameMap(list)
  return list.map((p) => ({ id: p.id, nickname: names[p.id] ?? p.nickname }))
}

/** 예시 참가자 — 교사가 혼자 미리 돌려 볼 때 쓴다. */
export const SAMPLE_NAMES: readonly string[] = [
  '김하늘',
  '이준호',
  '박서연',
  '최민재',
  '정다은',
  '강태현',
  '윤소은',
  '임도윤',
  '한지우',
  '오시우',
  '서예린',
  '배현우',
]

// ────────────────────────────────────────────────────────────────────────────
// 선정 규칙 도우미
// ────────────────────────────────────────────────────────────────────────────

export function selectionPreset(presetId: string) {
  return SELECTION_PRESETS.find((p) => p.id === presetId) ?? SELECTION_PRESETS[0]
}

/** 화면 입력값 → 코어가 이해하는 선정 규칙. */
export function ruleFromDraft(draft: SelectionDraft): SelectionRule {
  const preset = selectionPreset(draft.presetId)
  switch (preset.input) {
    case 'rank':
      return preset.build(Math.max(1, Math.trunc(draft.rank)))
    case 'count':
      return preset.build(Math.max(1, Math.trunc(draft.count)))
    case 'ranks': {
      const ranks = draft.ranks.length > 0 ? [...draft.ranks].sort((a, b) => a - b) : [1]
      return preset.build(ranks)
    }
    case 'none':
    default:
      return preset.build(1)
  }
}

/**
 * 경기 전에 알 수 있는 **최대** 후보 수.
 * 실제 후보는 경기를 끝까지 마친 사람만 들어가므로 이보다 적어질 수 있다.
 */
export function maxCandidateCount(state: StandaloneState): number {
  return Math.max(0, state.participants.length - state.excludedIds.length)
}

/** 지금 설정으로 경기를 시작할 수 있는지. 못 하면 한국어 이유를 돌려준다. */
export function readinessProblem(state: StandaloneState): string | null {
  if (state.participants.length < MIN_PARTICIPANTS) {
    return '참가자를 한 명 이상 입력해 주세요.'
  }
  if (state.participants.length > MAX_PARTICIPANTS) {
    return `참가자는 최대 ${MAX_PARTICIPANTS}명까지 지원합니다. 지금 ${state.participants.length}명입니다.`
  }
  const problem = checkSelectionRule(ruleFromDraft(state.selection), maxCandidateCount(state))
  return problem ? problem.message : null
}

// ────────────────────────────────────────────────────────────────────────────
// 예상 진행 시간
// ────────────────────────────────────────────────────────────────────────────

/** 준비·결과 화면까지 포함한 대략적인 진행 시간(ms). */
export function estimatedDurationMs(state: StandaloneState): number {
  const overhead = 8_000
  if (state.mode === 'manual') {
    const per = state.roundDurationMs + 7_000
    return overhead + Math.max(1, state.participants.length) * per
  }
  return overhead + state.roundDurationMs
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}초`
  if (seconds === 0) return `${minutes}분`
  return `${minutes}분 ${seconds}초`
}

export function formatSeconds(ms: number): string {
  return `${Math.round(ms / 1000)}초`
}

export const difficultyLabel = (preset: DifficultyPreset): string => DIFFICULTY_LABELS[preset]

// ────────────────────────────────────────────────────────────────────────────
// seed / sessionId
// ────────────────────────────────────────────────────────────────────────────

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function makeSeed(): string {
  let out = ''
  for (let i = 0; i < 8; i += 1) {
    out += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)]
  }
  return out
}

export function makeSessionId(): string {
  return `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ────────────────────────────────────────────────────────────────────────────
// 동작(액션)
// ────────────────────────────────────────────────────────────────────────────

export type StandaloneAction =
  | { type: 'goto'; screen: ScreenId }
  | { type: 'addNames'; names: string[]; blanks?: number; truncated?: number }
  | { type: 'replaceParticipants'; list: EditableParticipant[]; notice?: string }
  | { type: 'renameParticipant'; id: string; nickname: string }
  | { type: 'removeParticipant'; id: string }
  | { type: 'clearParticipants' }
  | { type: 'setMode'; mode: GameMode }
  | { type: 'setDifficultyPreset'; preset: DifficultyPreset }
  | { type: 'patchSettings'; patch: Partial<Omit<DifficultySettings, 'items'>> }
  | { type: 'patchItems'; patch: Partial<ItemSettings> }
  | { type: 'resetSettings' }
  | { type: 'setRoundDuration'; ms: number }
  | { type: 'patchSelection'; patch: Partial<SelectionDraft> }
  | { type: 'toggleExcluded'; id: string }
  | { type: 'setExcluded'; ids: string[] }
  | { type: 'clearPresented' }
  | { type: 'excludeAllPresented' }
  | { type: 'rerollSeed' }
  | { type: 'startMatch' }
  | { type: 'completed'; result: BrickPickResult }
  | { type: 'cancelledMatch'; message: string }
  | { type: 'newRoundSameSettings' }
  | { type: 'restartAll' }
  | { type: 'patchPrefs'; patch: Partial<Preferences> }
  | { type: 'notice'; text: string | null }
  | { type: 'error'; text: string | null }
  | { type: 'refreshSavedInfo' }

// ────────────────────────────────────────────────────────────────────────────
// 초기 상태
// ────────────────────────────────────────────────────────────────────────────

export function createInitialState(): StandaloneState {
  const prefs = loadPreferences()
  const basePreset: Exclude<DifficultyPreset, 'custom'> =
    prefs.difficulty === 'custom' ? 'normal' : prefs.difficulty
  return {
    screen: 'participants',
    participants: [],
    mode: 'auto',
    difficulty: prefs.difficulty === 'custom' ? 'normal' : prefs.difficulty,
    basePreset,
    settings: defaultDifficultySettings(basePreset),
    roundDurationMs: 30_000,
    selection: { presetId: 'best', count: 1, rank: 3, ranks: [1] },
    excludedIds: [],
    presentedIds: [],
    sessionId: makeSessionId(),
    seed: makeSeed(),
    result: null,
    notice: null,
    error: null,
    savedRosterCount: savedRosterCount(),
    savedResultAt: savedResultAt(),
    prefs,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 리듀서
// ────────────────────────────────────────────────────────────────────────────

/** 수치를 하나라도 손대면 난이도 이름이 '사용자 설정'으로 바뀐다. */
function withCustomSettings(
  state: StandaloneState,
  next: DifficultySettings,
): StandaloneState {
  return {
    ...state,
    difficulty: 'custom',
    settings: next,
    error: null,
  }
}

export function reducer(state: StandaloneState, action: StandaloneAction): StandaloneState {
  switch (action.type) {
    case 'goto':
      return { ...state, screen: action.screen, error: null }

    case 'addNames': {
      const room = MAX_PARTICIPANTS - state.participants.length
      const accepted = action.names.slice(0, Math.max(0, room))
      const rejectedForSpace = action.names.length - accepted.length
      const added = accepted.map((nickname) => ({ id: makeParticipantId(), nickname }))
      const notes: string[] = []
      if (added.length > 0) notes.push(`${added.length}명을 명단에 추가했습니다.`)
      if (action.blanks && action.blanks > 0) {
        notes.push(`이름이 비어 있는 ${action.blanks}줄은 추가하지 않았습니다.`)
      }
      if (action.truncated && action.truncated > 0) {
        notes.push(
          `${action.truncated}명의 이름이 ${MAX_NICKNAME_LENGTH}자를 넘어 줄였습니다. 필요하면 직접 고쳐 주세요.`,
        )
      }
      const error =
        rejectedForSpace > 0
          ? `참가자는 최대 ${MAX_PARTICIPANTS}명까지 지원합니다. ${rejectedForSpace}명은 추가하지 못했습니다.`
          : added.length === 0 && action.names.length === 0
            ? '추가할 이름이 없습니다. 줄바꿈이나 쉼표로 이름을 적어 주세요.'
            : null
      return {
        ...state,
        participants: [...state.participants, ...added],
        notice: notes.length > 0 ? notes.join(' ') : state.notice,
        error,
      }
    }

    case 'replaceParticipants': {
      const list = action.list.slice(0, MAX_PARTICIPANTS)
      const keep = new Set(list.map((p) => p.id))
      return {
        ...state,
        participants: list,
        excludedIds: state.excludedIds.filter((id) => keep.has(id)),
        presentedIds: state.presentedIds.filter((id) => keep.has(id)),
        notice: action.notice ?? state.notice,
        error: null,
      }
    }

    case 'renameParticipant': {
      const nickname = action.nickname.slice(0, MAX_NICKNAME_LENGTH)
      return {
        ...state,
        participants: state.participants.map((p) =>
          p.id === action.id ? { ...p, nickname } : p,
        ),
      }
    }

    case 'removeParticipant':
      return {
        ...state,
        participants: state.participants.filter((p) => p.id !== action.id),
        excludedIds: state.excludedIds.filter((id) => id !== action.id),
        presentedIds: state.presentedIds.filter((id) => id !== action.id),
        error: null,
      }

    case 'clearParticipants':
      return {
        ...state,
        participants: [],
        excludedIds: [],
        presentedIds: [],
        notice: '명단을 비웠습니다.',
        error: null,
      }

    case 'setMode':
      return { ...state, mode: action.mode }

    case 'setDifficultyPreset': {
      if (action.preset === 'custom') {
        return { ...state, difficulty: 'custom' }
      }
      return {
        ...state,
        difficulty: action.preset,
        basePreset: action.preset,
        settings: defaultDifficultySettings(action.preset),
        prefs: { ...state.prefs, difficulty: action.preset },
      }
    }

    case 'patchSettings':
      return withCustomSettings(
        state,
        resolveDifficulty('custom', { ...state.settings, ...action.patch }),
      )

    case 'patchItems':
      return withCustomSettings(
        state,
        resolveDifficulty('custom', {
          ...state.settings,
          items: { ...state.settings.items, ...action.patch },
        }),
      )

    case 'resetSettings':
      return {
        ...state,
        difficulty: state.basePreset,
        settings: defaultDifficultySettings(state.basePreset),
        notice: `난이도 수치를 '${DIFFICULTY_LABELS[state.basePreset]}' 기본값으로 되돌렸습니다.`,
        error: null,
      }

    case 'setRoundDuration':
      return { ...state, roundDurationMs: action.ms }

    case 'patchSelection':
      return { ...state, selection: { ...state.selection, ...action.patch }, error: null }

    case 'toggleExcluded': {
      const has = state.excludedIds.includes(action.id)
      return {
        ...state,
        excludedIds: has
          ? state.excludedIds.filter((id) => id !== action.id)
          : [...state.excludedIds, action.id],
        error: null,
      }
    }

    case 'setExcluded':
      return { ...state, excludedIds: [...new Set(action.ids)], error: null }

    case 'excludeAllPresented':
      return {
        ...state,
        excludedIds: [...new Set([...state.excludedIds, ...state.presentedIds])],
        notice: '이미 발표한 사람을 모두 제외 목록에 넣었습니다.',
        error: null,
      }

    case 'clearPresented':
      return {
        ...state,
        presentedIds: [],
        notice: '이번 세션의 발표 이력을 초기화했습니다. 제외 목록은 그대로 두었습니다.',
      }

    case 'rerollSeed':
      return { ...state, seed: makeSeed(), notice: '새 seed 를 뽑았습니다.' }

    case 'startMatch': {
      const problem = readinessProblem(state)
      if (problem) return { ...state, error: problem }
      return { ...state, screen: 'match', result: null, error: null, notice: null }
    }

    case 'completed': {
      const presented = [
        ...new Set([...state.presentedIds, ...action.result.selectedParticipantIds]),
      ]
      return {
        ...state,
        screen: 'result',
        result: action.result,
        presentedIds: presented,
        error: null,
        notice: null,
      }
    }

    case 'cancelledMatch':
      return { ...state, screen: 'summary', result: null, notice: action.message, error: null }

    case 'newRoundSameSettings':
      return {
        ...state,
        screen: 'summary',
        sessionId: makeSessionId(),
        seed: makeSeed(),
        result: null,
        excludedIds: [...new Set([...state.excludedIds, ...state.presentedIds])],
        notice:
          '같은 설정으로 새 경기를 준비했습니다. seed 를 새로 뽑았고, 이미 발표한 사람을 제외 목록에 넣었습니다.',
        error: null,
      }

    case 'restartAll':
      return {
        ...state,
        screen: 'participants',
        sessionId: makeSessionId(),
        seed: makeSeed(),
        result: null,
        excludedIds: [],
        notice: null,
        error: null,
      }

    case 'patchPrefs':
      return { ...state, prefs: { ...state.prefs, ...action.patch } }

    case 'notice':
      return { ...state, notice: action.text }

    case 'error':
      return { ...state, error: action.text }

    case 'refreshSavedInfo':
      return { ...state, savedRosterCount: savedRosterCount(), savedResultAt: savedResultAt() }

    default:
      return state
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 훅
// ────────────────────────────────────────────────────────────────────────────

export interface StandaloneStore {
  state: StandaloneState
  dispatch: Dispatch<StandaloneAction>
  /** 화면에 쓰는 보조 표시가 붙은 이름. */
  names: Record<string, string>
}

export function useStandaloneStore(): StandaloneStore {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState)

  // 환경설정만 저장한다.
  useEffect(() => {
    savePreferences(state.prefs)
  }, [state.prefs])

  // 모션 감소·스캔라인은 CSS 가 읽을 수 있게 body 속성으로 내린다.
  useEffect(() => {
    document.body.dataset.reducedMotion = state.prefs.reducedMotion ? 'true' : 'false'
    document.body.dataset.scanlines = state.prefs.scanlines ? 'true' : 'false'
  }, [state.prefs.reducedMotion, state.prefs.scanlines])

  const names = useMemo(() => displayNameMap(state.participants), [state.participants])

  return { state, dispatch, names }
}

// ────────────────────────────────────────────────────────────────────────────
// 경기에 넘길 입력 만들기
// ────────────────────────────────────────────────────────────────────────────

export interface MatchInput {
  schemaVersion: string
  sessionId: string
  participants: Participant[]
  mode: GameMode
  difficulty: DifficultyPreset
  difficultySettings: DifficultySettings
  roundDurationMs: number
  selectionRule: SelectionRule
  excludedParticipantIds: string[]
  seed: string
  locale: 'ko'
  soundEnabled: boolean
  reducedMotion: boolean
}

/** 현재 설정을 그대로 얼려서 경기 입력으로 만든다. 경기 중에는 이 값이 바뀌지 않는다. */
export function buildMatchInput(state: StandaloneState): MatchInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId: state.sessionId,
    participants: toParticipants(state.participants),
    mode: state.mode,
    difficulty: state.difficulty,
    difficultySettings: state.settings,
    roundDurationMs: state.roundDurationMs,
    selectionRule: ruleFromDraft(state.selection),
    excludedParticipantIds: state.excludedIds.filter((id) =>
      state.participants.some((p) => p.id === id),
    ),
    seed: state.seed,
    locale: 'ko',
    soundEnabled: state.prefs.soundEnabled,
    reducedMotion: state.prefs.reducedMotion,
  }
}

/** 켜져 있는 아이템 종류만 추린다. 규칙 요약 화면이 쓴다. */
export function enabledItemKinds(settings: DifficultySettings) {
  if (!settings.items.enabled) return []
  return ITEM_KINDS.filter(
    (kind) => settings.items.enabledKinds[kind] && settings.items.weights[kind] > 0,
  )
}
