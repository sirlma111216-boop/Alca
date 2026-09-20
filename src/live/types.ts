/**
 * 실시간 참여 화면들이 주고받는 계약.
 *
 * 화면(교사·학생)은 이 타입만 보고 만들고, 라우팅은 App.tsx 가 맡는다.
 */

import type { BrickPickResult, DifficultyPreset, DifficultySettings, SelectionRule } from '../core'
import type { MatchStartView, MemberView, ResultBroadcast } from '../../worker/protocol'

export type { MatchStartView, MemberView, ResultBroadcast }

/** 단독 실행 앱의 최상위 모드. */
export type AppMode =
  /** 교사가 혼자 진행 (기존 흐름 — 자동 경기 / 직접 조작) */
  | 'solo'
  /** 교사가 학생 기기를 받아 진행 */
  | 'host'
  /** 학생이 수업 코드로 참여 */
  | 'student'

/** 교사가 실시간 경기를 시작할 때 정하는 것. */
export interface LiveMatchSetup {
  difficulty: DifficultyPreset
  difficultySettings?: Partial<DifficultySettings>
  roundDurationMs: number
  selectionRule: SelectionRule
  /** 이미 발표한 사람(닉네임 기준). 실시간 모드에는 외부 ID 가 없다. */
  excludedNicks: string[]
  soundEnabled: boolean
  reducedMotion: boolean
}

/** 교사 화면이 집계를 마치고 만든 결과. */
export interface LiveResult {
  /** core 의 순수 함수로 낸 정식 결과. 결과 JSON 내려받기에 그대로 쓴다. */
  full: BrickPickResult
  /** 학생 폰으로 내려보낼 가벼운 형태. */
  broadcast: ResultBroadcast
}

/** 학생 화면이 경기 중 올리는 보고 (연결이 없으면 조용히 버려진다). */
export interface StudentProgressReport {
  score: number
  lives: number
  bricksDestroyed: number
  /** 0 ~ 1 */
  progress: number
}

/** 학생 화면이 경기를 마치고 올리는 최종 기록. */
export interface StudentFinalReport {
  score: number
  livesRemaining: number
  bricksDestroyed: number
  playedMs: number
  wavesCleared: number
  items: BrickPickResult['participants'][number]['items']
}

/**
 * URL 에서 수업 코드를 읽는다. QR 하나로 학생이 바로 들어오게 하기 위한 것이다.
 *   https://.../?code=ABC123
 * 닉네임은 절대 URL 에 넣지 않는다 — 기록·리퍼러·서버 로그에 남는다.
 */
export function readCodeFromUrl(href: string): string | null {
  try {
    const url = new URL(href)
    const raw = url.searchParams.get('code')
    if (!raw) return null
    const code = raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6)
    return code.length === 6 ? code : null
  } catch {
    return null
  }
}

/** 학생에게 보여 줄 참여 주소. QR 로 만든다. */
export function buildJoinUrl(origin: string, code: string): string {
  const base = origin.replace(/\/+$/, '')
  return `${base}/?code=${encodeURIComponent(code)}`
}
