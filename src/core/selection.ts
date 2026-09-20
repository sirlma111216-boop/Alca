/**
 * 발표자 선정 — 순수 함수.
 *
 * 항상 **제외 처리 후의 후보 순위(eligibleRank)** 를 기준으로 고른다.
 * 전체 순위(rank)와 후보 순위(eligibleRank)는 결과 데이터에 함께 담기고,
 * 화면에도 "어느 기준으로 뽑았는지"를 적는다.
 *
 * 문구는 중립적으로 쓴다 — "꼴찌"·"실패자" 대신 "하위 순위"·"이번 발표자".
 */

import type {
  ParticipantResult,
  SelectionIssue,
  SelectionRule,
  SelectionReason,
} from './contract'
import { candidateCount } from './ranking'

export interface SelectionOutcome {
  selectedParticipantIds: string[]
  selectionReasons: SelectionReason[]
  /** 선정 후보였던 참가자 수. */
  eligibleCount: number
  /** 규칙을 그대로 적용하지 못했으면 그 이유. 정상이면 null. */
  issue: SelectionIssue | null
}

export interface SelectionProblem {
  code: 'NOT_ENOUGH_CANDIDATES' | 'INVALID_SELECTION_RULE'
  message: string
  details: string[]
}

/**
 * 경기 전 검증 — 후보 수에 비해 규칙이 말이 되는지 본다.
 * 여기서 걸리면 경기를 시작하지 않는다.
 */
export function checkSelectionRule(
  rule: SelectionRule,
  candidates: number,
): SelectionProblem | null {
  if (candidates <= 0) {
    return {
      code: 'NOT_ENOUGH_CANDIDATES',
      message: '선정할 수 있는 참가자가 없습니다. 제외 목록을 확인해 주세요.',
      details: ['candidates=0'],
    }
  }
  if (rule.kind === 'top' || rule.kind === 'bottom') {
    if (!Number.isInteger(rule.count) || rule.count < 1) {
      return {
        code: 'INVALID_SELECTION_RULE',
        message: '선정 인원은 1명 이상이어야 합니다.',
        details: [`count=${rule.count}`],
      }
    }
    if (rule.count > candidates) {
      return {
        code: 'NOT_ENOUGH_CANDIDATES',
        message: `선정 가능한 참가자가 ${candidates}명인데 ${rule.count}명을 뽑으려고 합니다.`,
        details: [`count=${rule.count}`, `candidates=${candidates}`],
      }
    }
    return null
  }
  const seen = new Set<number>()
  const details: string[] = []
  for (const r of rule.ranks) {
    if (!Number.isInteger(r) || r < 1) details.push(`올바르지 않은 순위: ${r}`)
    else if (seen.has(r)) details.push(`${r}위가 중복 지정됐습니다.`)
    else seen.add(r)
  }
  if (details.length > 0) {
    return { code: 'INVALID_SELECTION_RULE', message: '지정한 순위를 확인해 주세요.', details }
  }
  if (seen.size === 0) {
    return {
      code: 'INVALID_SELECTION_RULE',
      message: '지정할 순위를 하나 이상 골라 주세요.',
      details: [],
    }
  }
  const over = [...seen].filter((r) => r > candidates)
  if (over.length > 0) {
    return {
      code: 'NOT_ENOUGH_CANDIDATES',
      message: `선정 가능한 참가자가 ${candidates}명이라 ${over.join('위, ')}위를 뽑을 수 없습니다.`,
      details: over.map((r) => `rank=${r}`),
    }
  }
  return null
}

/** 규칙이 고르려는 후보 순위 목록을 만든다. */
export function targetEligibleRanks(rule: SelectionRule, candidates: number): number[] {
  if (candidates <= 0) return []
  if (rule.kind === 'top') {
    const n = Math.min(candidates, Math.max(1, Math.trunc(rule.count)))
    return Array.from({ length: n }, (_, i) => i + 1)
  }
  if (rule.kind === 'bottom') {
    const n = Math.min(candidates, Math.max(1, Math.trunc(rule.count)))
    return Array.from({ length: n }, (_, i) => candidates - n + i + 1)
  }
  const unique = [...new Set(rule.ranks.map((r) => Math.trunc(r)))]
  return unique.filter((r) => r >= 1 && r <= candidates).sort((a, b) => a - b)
}

/** 규칙을 화면에 보여 줄 한 줄 설명으로. 경기 전 미리보기에 쓴다. */
export function describeSelectionRule(rule: SelectionRule, candidates?: number): string {
  const scope = candidates === undefined ? '' : ` (선정 가능 ${candidates}명 기준)`
  if (rule.kind === 'top') {
    return rule.count === 1 ? `최고 성적 1명${scope}` : `상위 ${rule.count}명${scope}`
  }
  if (rule.kind === 'bottom') {
    return rule.count === 1 ? `최저 성적 1명${scope}` : `하위 ${rule.count}명${scope}`
  }
  const ranks = [...new Set(rule.ranks)].sort((a, b) => a - b)
  if (ranks.length === 1) return `${ranks[0]}위 1명${scope}`
  return `${ranks.join('위, ')}위${scope}`
}

/** 선정 근거 한 줄. */
function reasonText(rule: SelectionRule, eligibleRank: number, candidates: number): string {
  if (rule.kind === 'top') {
    return rule.count === 1
      ? `선정 가능 참가자 ${candidates}명 중 1위 — 최고 성적`
      : `선정 가능 참가자 ${candidates}명 중 ${eligibleRank}위 — 상위 ${rule.count}명 규칙`
  }
  if (rule.kind === 'bottom') {
    return rule.count === 1
      ? `선정 가능 참가자 ${candidates}명 중 ${eligibleRank}위 — 하위 순위 1명 규칙`
      : `선정 가능 참가자 ${candidates}명 중 ${eligibleRank}위 — 하위 ${rule.count}명 규칙`
  }
  return `선정 가능 참가자 ${candidates}명 중 ${eligibleRank}위 — 지정 순위 규칙`
}

/**
 * 순위 결과와 규칙으로 발표자를 고른다.
 * 결과의 selectedParticipantIds 와 selectionReasons 가 여기서 나온다.
 */
export function selectPresenters(
  results: readonly ParticipantResult[],
  rule: SelectionRule,
): SelectionOutcome {
  const candidates = candidateCount(results)
  const wanted = targetEligibleRanks(rule, candidates)
  const byEligibleRank = new Map<number, ParticipantResult>()
  for (const r of results) {
    if (r.eligibleRank !== null) byEligibleRank.set(r.eligibleRank, r)
  }

  const selectedParticipantIds: string[] = []
  const selectionReasons: SelectionReason[] = []
  for (const rank of wanted) {
    const person = byEligibleRank.get(rank)
    if (!person) continue
    selectedParticipantIds.push(person.id)
    selectionReasons.push({
      participantId: person.id,
      nickname: person.nickname,
      eligibleRank: rank,
      reason: reasonText(rule, rank, candidates),
    })
  }

  return {
    selectedParticipantIds,
    selectionReasons,
    eligibleCount: candidates,
    issue: describeShortfall(rule, candidates, selectedParticipantIds.length),
  }
}

/**
 * 규칙이 원한 인원을 다 뽑지 못했는지 본다.
 *
 * 경기 시작 전에도 같은 검사를 하지만(checkSelectionRule), 직접 조작 모드에서는
 * 경기 도중 참가자를 건너뛰거나 중도 취소해 후보가 줄어들 수 있다.
 * 그때 **조용히 아무도 뽑지 않고 "완료" 로 끝나지 않도록** 결과에 이유를 남긴다.
 */
export function describeShortfall(
  rule: SelectionRule,
  candidates: number,
  selectedCount: number,
): SelectionIssue | null {
  const requestedCount =
    rule.kind === 'ranks'
      ? new Set(rule.ranks.map((r) => Math.trunc(r)).filter((r) => r >= 1)).size
      : Math.max(1, Math.trunc(rule.count))
  if (selectedCount >= requestedCount) return null

  const missingRanks =
    rule.kind === 'ranks'
      ? [...new Set(rule.ranks.map((r) => Math.trunc(r)))]
          .filter((r) => r >= 1 && r > candidates)
          .sort((a, b) => a - b)
      : []

  const message =
    candidates === 0
      ? '경기가 끝난 뒤 선정할 수 있는 참가자가 없어 발표자를 뽑지 못했습니다. (미플레이·중도 취소·참가 제외를 확인해 주세요.)'
      : missingRanks.length > 0
        ? `선정 가능한 참가자가 ${candidates}명이라 ${missingRanks.join('위, ')}위를 뽑지 못했습니다.`
        : `선정 가능한 참가자가 ${candidates}명이라 ${requestedCount}명 중 ${selectedCount}명만 뽑았습니다.`

  return {
    code: 'NOT_ENOUGH_CANDIDATES',
    message,
    requestedCount,
    selectedCount,
    missingRanks,
    candidateCount: candidates,
  }
}

/** 화면 프리셋 — 교사가 고르는 6가지 규칙. */
export interface SelectionPreset {
  id: string
  label: string
  hint: string
  build: (value: number | number[]) => SelectionRule
  /** 숫자 입력이 필요한지. 'count' | 'rank' | 'ranks' | 'none' */
  input: 'count' | 'rank' | 'ranks' | 'none'
}

export const SELECTION_PRESETS: SelectionPreset[] = [
  {
    id: 'best',
    label: '최고 성적 1명',
    hint: '가장 높은 점수를 받은 한 사람',
    input: 'none',
    build: () => ({ kind: 'top', count: 1 }),
  },
  {
    id: 'worst',
    label: '최저 성적 1명',
    hint: '가장 낮은 점수를 받은 한 사람 (하위 순위)',
    input: 'none',
    build: () => ({ kind: 'bottom', count: 1 }),
  },
  {
    id: 'rank',
    label: '지정 순위 1명',
    hint: '예를 들어 3위',
    input: 'rank',
    build: (v) => ({ kind: 'ranks', ranks: [Math.max(1, Math.trunc(Number(v)))] }),
  },
  {
    id: 'topN',
    label: '상위 N명',
    hint: '점수가 높은 쪽에서 N명',
    input: 'count',
    build: (v) => ({ kind: 'top', count: Math.max(1, Math.trunc(Number(v))) }),
  },
  {
    id: 'bottomN',
    label: '하위 N명',
    hint: '점수가 낮은 쪽에서 N명',
    input: 'count',
    build: (v) => ({ kind: 'bottom', count: Math.max(1, Math.trunc(Number(v))) }),
  },
  {
    id: 'ranks',
    label: '지정한 복수 순위',
    hint: '예를 들어 2위, 5위, 8위',
    input: 'ranks',
    build: (v) => ({
      kind: 'ranks',
      ranks: (Array.isArray(v) ? v : [Number(v)]).map((n) => Math.max(1, Math.trunc(n))),
    }),
  },
]

/** 규칙 → 프리셋 id (화면에서 현재 선택 상태를 되살릴 때 쓴다). */
export function presetIdForRule(rule: SelectionRule): string {
  if (rule.kind === 'top') return rule.count === 1 ? 'best' : 'topN'
  if (rule.kind === 'bottom') return rule.count === 1 ? 'worst' : 'bottomN'
  return rule.ranks.length === 1 ? 'rank' : 'ranks'
}
