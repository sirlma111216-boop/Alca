/**
 * LiveClient 를 React 에서 쓰기 위한 훅.
 *
 * 여기서 지키는 것 세 가지 — 셋 다 실제로 데어 본 자리다.
 *
 *  1. **소켓은 한 개만.** React 18 StrictMode 는 개발 중 마운트를 두 번 흉내 낸다.
 *     정리(cleanup)에서 곧바로 disconnect 하면, 바로 이어지는 두 번째 마운트가
 *     새 소켓을 열어 서버에 두 번 붙는다(교사 자리가 스스로에게 뺏긴다).
 *     그래서 끊기를 setTimeout 0 으로 한 박자 미루고, 다시 마운트되면 취소한다.
 *
 *  2. **snapshot 은 client.snapshot 을 그대로 쓴다.** 필드를 하나씩 골라 새 객체를
 *     만들면, 서버에 칸이 하나 늘었을 때 그 칸이 조용히 사라진다. 찾기 가장 어려운 사고다.
 *     그래서 이 훅은 상태를 복사하지 않고 "바뀌었다"는 신호만 세어 다시 그린다.
 *
 *  3. **연결이 끊겨도 화면은 살아 있어야 한다.** 이 훅은 아무것도 던지지 않는다.
 *     실패는 error 문자열로만 나온다.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { LiveClient } from '../../live/client'
import type { LiveEvent, LiveRole, LiveSnapshot } from '../../live/client'
import type { MatchStartView, MemberView, ResultBroadcast } from '../../live/types'

/** 방에서 일어난 일을 화면으로 내보내는 콜백들. 전부 선택이다. */
export interface UseLiveRoomHandlers {
  /** 교사가 경기를 시작했다 (학생 화면이 이걸 받아 판을 만든다). */
  onMatch?: (match: MatchStartView) => void
  /** 집계가 끝나 결과가 내려왔다. */
  onResult?: (result: ResultBroadcast) => void
  /** 교사가 경기를 취소했다. */
  onCancel?: () => void
  /** 연결·요청 오류. 화면에 그대로 띄울 수 있는 한국어다. */
  onError?: (message: string) => void
}

export interface UseLiveRoom {
  client: LiveClient
  /** 서버가 준 마지막 상태 **그대로**. 필드별로 다시 만들지 않는다. */
  snapshot: LiveSnapshot | null
  /** 연결이 살아 있는가. false 여도 게임 자체는 돌아간다. */
  ready: boolean
  isHost: boolean
  error: string | null
  members: MemberView[]
  joined: number
  online: number
  done: number
  phase: string
  /** 같은 코드로 두 번 붙지 않게 막아 주는 connect. */
  join: (code: string, nick?: string) => void
  /** 방을 떠난다. 그 뒤 join 으로 다시 들어올 수 있다. */
  leave: () => Promise<void>
}

export function useLiveRoom(role: LiveRole, handlers: UseLiveRoomHandlers = {}): UseLiveRoom {
  // 클라이언트는 이 컴포넌트가 사는 동안 하나뿐이다.
  const clientRef = useRef<LiveClient | null>(null)
  if (clientRef.current === null) clientRef.current = new LiveClient()
  const client = clientRef.current

  // 콜백은 매 렌더 바뀔 수 있다. 구독을 다시 걸지 않으려고 ref 로만 들고 있는다.
  const handlersRef = useRef<UseLiveRoomHandlers>(handlers)
  handlersRef.current = handlers

  // 상태를 복사하지 않고 "다시 그려라" 신호만 센다 (위 2번).
  const [, bump] = useReducer((n: number) => n + 1, 0)

  const disposeRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef<string | null>(null)

  useEffect(() => {
    // StrictMode 의 가짜 언마운트가 예약해 둔 끊기를 취소한다 (위 1번).
    if (disposeRef.current !== null) {
      clearTimeout(disposeRef.current)
      disposeRef.current = null
    }

    const off = client.on((event: LiveEvent) => {
      const h = handlersRef.current
      if (event.type === 'match') h.onMatch?.(event.match)
      else if (event.type === 'result') h.onResult?.(event.result)
      else if (event.type === 'cancel') h.onCancel?.()
      else if (event.type === 'error') h.onError?.(event.message)
      bump()
    })

    // 이미 붙어 있는 클라이언트를 물려받았을 수도 있으니 지금 상태를 한 번 반영한다.
    bump()

    return () => {
      off()
      disposeRef.current = setTimeout(() => {
        disposeRef.current = null
        attemptRef.current = null
        client.disconnect()
      }, 0)
    }
  }, [client])

  const join = useCallback(
    (code: string, nick?: string) => {
      const key = `${code}|${role}|${nick ?? ''}`
      // 같은 조건으로 이미 붙어 있으면 다시 열지 않는다 (소켓 두 개 방지).
      if (attemptRef.current === key && client.code === code) return
      attemptRef.current = key
      client.connect(code, role, nick)
      bump()
    },
    [client, role],
  )

  const leave = useCallback(async () => {
    attemptRef.current = null
    await client.leave()
    bump()
  }, [client])

  const snapshot = client.snapshot
  const members = (snapshot?.members as MemberView[] | undefined) ?? []
  const phase = typeof snapshot?.phase === 'string' ? snapshot.phase : 'lobby'

  return {
    client,
    snapshot,
    ready: client.ready,
    isHost: client.isHost,
    error: client.lastError,
    members,
    joined: typeof snapshot?.joined === 'number' ? snapshot.joined : members.length,
    online: typeof snapshot?.online === 'number' ? snapshot.online : 0,
    done: typeof snapshot?.done === 'number' ? snapshot.done : 0,
    phase,
    join,
    leave,
  }
}
