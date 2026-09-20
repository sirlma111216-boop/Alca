/**
 * Cloudflare Worker 진입점 — **실시간 참여 기능에만** 쓰인다.
 *
 * 하는 일은 셋뿐이다.
 *   1. 수업 코드를 발급한다        POST /api/new-code
 *   2. WebSocket 을 그 수업의 Durable Object 에게 넘긴다   /ws?code=ABC123
 *   3. 상태를 들여다본다           GET /api/room/ABC123
 *
 * 나머지(게임 화면·자산)는 **Worker 를 거치지 않는다.**
 * wrangler.jsonc 의 run_worker_first 가 위 경로만 지정하므로,
 * 정적 파일은 예전처럼 Cloudflare 가 바로 내려준다 — 느려지지도, 요금이 늘지도 않는다.
 */

import { makeCode, normalizeCode, CODE_LENGTH, LIVE_PROTOCOL_VERSION } from './protocol'

export { RoomSession } from './room-do'

export interface Env {
  ROOM: DurableObjectNamespace
  ASSETS: Fetcher
}

const json = (data: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers ?? {}),
    },
  })

/** 같은 코드면 언제나 같은 객체로 간다. 이것이 외부 DB 가 필요 없는 이유다. */
const roomFor = (env: Env, code: string): DurableObjectStub =>
  env.ROOM.get(env.ROOM.idFromName(code))

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    // ── 실시간: 그 수업의 Durable Object 에게 넘긴다 ──────────────────────
    if (pathname === '/ws') {
      const code = normalizeCode(url.searchParams.get('code'))
      if (code.length !== CODE_LENGTH) {
        return new Response('수업 코드가 필요합니다.', { status: 400 })
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('WebSocket 연결이 아닙니다.', { status: 426 })
      }
      return roomFor(env, code).fetch(request)
    }

    // ── 새 수업 코드 발급 (교사 화면에서만 부른다) ────────────────────────
    if (pathname === '/api/new-code') {
      return json({ code: makeCode(), protocolVersion: LIVE_PROTOCOL_VERSION })
    }

    // ── 지금 상태 (화면 없이 확인할 때) ──────────────────────────────────
    const m = pathname.match(/^\/api\/room\/([A-Za-z0-9]+)$/)
    if (m) {
      const code = normalizeCode(m[1])
      if (code.length !== CODE_LENGTH) return json({ error: '코드가 올바르지 않습니다.' }, { status: 400 })
      const snap = await (roomFor(env, code) as unknown as { snapshot(): Promise<unknown> }).snapshot()
      return json(snap)
    }

    // ── 살아 있는지 ──────────────────────────────────────────────────────
    if (pathname === '/api/health') {
      return json({
        ok: true,
        live: true,
        protocolVersion: LIVE_PROTOCOL_VERSION,
        runtime: 'cloudflare-workers',
      })
    }

    // 여기까지 왔다는 것은 run_worker_first 목록에 있는 경로인데 아무것도 안 맞은 것이다.
    // 정적 자산으로 넘겨 본다(없으면 404).
    return env.ASSETS.fetch(request)
  },
}
