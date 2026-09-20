/**
 * 순위 계산 — 순수 함수. 엔진도 화면도 모른다.
 *
 * 규칙
 *  1. 점수 내림차순
 *  2. 같으면 남은 목숨이 많은 쪽이 앞
 *  3. 그마저 같으면 **seed 기반 추첨**으로 확정 (이름순·입력순으로 가르지 않는다)
 *  4. 플레이하지 않은 사람은 점수 0점이 아니라 "점수 없음"으로 보고 항상 뒤에 놓는다
 *
 * 순위는 두 가지를 함께 낸다.
 *  - rank         : 전체 참가자 기준 (1 … N, 유일)
 *  - eligibleRank : 제외·미플레이를 뺀 **후보** 기준 (1 … M, 유일). 후보가 아니면 null
 *
 * 발표자 선정은 항상 eligibleRank 를 기준으로 한다.
 */

import type { ItemStat, ParticipantResult, PlayStatus, TieInfo } from './contract'
import { hashString } from './rng'

export interface RankingEntry {
  id: string
  nickname: string
  /** 점수. 플레이하지 않았으면 null. */
  score: number | null
  livesRemaining: number | null
  playStatus: PlayStatus
  excluded: boolean
  bricksDestroyed: number
  playedMs: number
  wavesCleared: number
  items: ItemStat[]
  /** 벽돌을 처음 전부 깬 시각(ms). 못 깼으면 null. "다 깰 때까지" 방식에서만 쓰인다. */
  clearedAtMs?: number | null
}

export interface RankingOptions {
  /** 동점 추첨에 쓰는 seed. 같은 seed 면 항상 같은 순서가 나온다. */
  seed: string
  /**
   * 무엇을 기준으로 순위를 매길지.
   *
   *  - 'score'      : 점수 내림차순 (기본. 정해진 시간 경기)
   *  - 'clear-time' : **다 깬 사람이 먼저, 그중 빨리 깬 순.** 못 깬 사람끼리는 점수 순.
   *                   "다 깰 때까지" 경기에서는 다 깬 사람이 전부 같은 점수가 되어
   *                   점수로는 순위가 갈리지 않기 때문이다.
   *
   * 어느 쪽이든 마지막 두 단계(남은 목숨 → seed 추첨)는 같다.
   */
  rankBy?: 'score' | 'clear-time'
}

/** 동점 추첨값 — 참가자 ID 해시만 쓰므로 입력 순서와 무관하다. [0, 1) */
export function tieBreakDraw(seed: string, participantId: string): number {
  return hashString(`${seed}tiebreak${participantId}`) / 4294967296
}

/** 후보 자격: 제외되지 않았고 실제로 경기를 마친 사람. */
export function isCandidate(entry: {
  excluded: boolean
  playStatus: PlayStatus
}): boolean {
  return !entry.excluded && entry.playStatus === 'played'
}

export function computeRanking(
  entries: readonly RankingEntry[],
  options: RankingOptions,
): ParticipantResult[] {
  const withDraw = entries.map((entry) => ({
    entry,
    draw: tieBreakDraw(options.seed, entry.id),
    scored: entry.score !== null,
  }))

  const byClearTime = options.rankBy === 'clear-time'

  withDraw.sort((a, b) => {
    // 점수가 있는 사람이 항상 앞. (미플레이는 0점이 아니라 "기록 없음")
    if (a.scored !== b.scored) return a.scored ? -1 : 1
    if (a.scored && b.scored) {
      if (byClearTime) {
        // 다 깬 사람이 먼저, 그중 빨리 깬 순.
        const ca = a.entry.clearedAtMs ?? null
        const cb = b.entry.clearedAtMs ?? null
        if ((ca !== null) !== (cb !== null)) return ca !== null ? -1 : 1
        if (ca !== null && cb !== null && ca !== cb) return ca - cb
        // 둘 다 못 깼으면(또는 같은 시각에 깼으면) 평소대로 점수로 가른다.
      }
      const sa = a.entry.score as number
      const sb = b.entry.score as number
      if (sa !== sb) return sb - sa
      const la = a.entry.livesRemaining ?? 0
      const lb = b.entry.livesRemaining ?? 0
      if (la !== lb) return lb - la
    }
    if (a.draw !== b.draw) return a.draw - b.draw
    // 해시가 완전히 같은 극단적인 경우에만 ID 문자열로 확정한다 (유일성 보장용).
    return a.entry.id < b.entry.id ? -1 : 1
  })

  // 동점 묶음 파악 — 같은 점수끼리, 그리고 같은 점수+같은 목숨끼리.
  const byScore = new Map<string, string[]>()
  const byScoreAndLives = new Map<string, string[]>()
  // "동점" 의 뜻은 순위 기준에 따라 달라진다.
  // 다 깬 사람끼리는 점수가 같아도 깬 시각이 다르면 동점이 아니다.
  const gradeKey = (e: RankingEntry): string => {
    if (e.score === null) return 'none'
    if (byClearTime && e.clearedAtMs != null) return `c${e.clearedAtMs}`
    return `s${e.score}`
  }
  const scoreKey = gradeKey
  const livesKey = (e: RankingEntry): string =>
    e.score === null ? 'none' : `${gradeKey(e)}|l${e.livesRemaining ?? 0}`

  for (const { entry } of withDraw) {
    const sk = scoreKey(entry)
    const lk = livesKey(entry)
    if (!byScore.has(sk)) byScore.set(sk, [])
    if (!byScoreAndLives.has(lk)) byScoreAndLives.set(lk, [])
    byScore.get(sk)?.push(entry.id)
    byScoreAndLives.get(lk)?.push(entry.id)
  }

  let eligibleCounter = 0
  return withDraw.map(({ entry, draw }, index) => {
    const sameScore = byScore.get(scoreKey(entry)) ?? [entry.id]
    const sameScoreAndLives = byScoreAndLives.get(livesKey(entry)) ?? [entry.id]

    // 점수가 없는 사람(미플레이)은 "동점"이 아니다 — 기록 자체가 없다.
    // 다만 자기들끼리의 순서는 seed 추첨으로 정해지므로 그 사실만 남긴다.
    const scored = entry.score !== null
    let resolvedBy: TieInfo['resolvedBy'] = 'none'
    if (sameScoreAndLives.length > 1) resolvedBy = 'seed'
    else if (scored && sameScore.length > 1) resolvedBy = 'lives'

    const tie: TieInfo = {
      tied: scored && sameScore.length > 1,
      tiedWith: scored && sameScore.length > 1 ? [...sameScore] : [],
      resolvedBy,
      ...(resolvedBy === 'seed' ? { drawValue: draw } : {}),
    }

    const candidate = isCandidate(entry)
    if (candidate) eligibleCounter += 1

    return {
      id: entry.id,
      nickname: entry.nickname,
      score: entry.score,
      rank: index + 1,
      eligibleRank: candidate ? eligibleCounter : null,
      excluded: entry.excluded,
      playStatus: entry.playStatus,
      livesRemaining: entry.livesRemaining,
      bricksDestroyed: entry.bricksDestroyed,
      playedMs: entry.playedMs,
      wavesCleared: entry.wavesCleared,
      clearedAtMs: entry.clearedAtMs ?? null,
      items: entry.items,
      tie,
    }
  })
}

/** 선정 후보 수. */
export function candidateCount(results: readonly ParticipantResult[]): number {
  return results.filter((r) => r.eligibleRank !== null).length
}

/** 플레이 상태를 사람이 읽을 한국어로. */
export const PLAY_STATUS_LABELS: Record<PlayStatus, string> = {
  played: '완료',
  not_played: '미플레이',
  aborted: '중도 취소',
  excluded: '참가 제외',
}
