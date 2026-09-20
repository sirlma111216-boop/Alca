/**
 * 부모(수업 앱) 쪽 도우미 — iframe 으로 브릭픽을 열고 결과를 받는다.
 *
 * 이 파일은 게임 코드를 하나도 싣지 않는다. 수업 앱 번들에 postMessage 다리만 들어간다.
 *
 * 지킨 것
 *  - 리스너를 **먼저** 등록한 뒤에 iframe.src 를 넣는다. READY 를 놓치지 않기 위해서다.
 *  - 받을 때 event.origin 과 event.source 를 둘 다 확인한다.
 *  - 보낼 때 targetOrigin 은 항상 정확한 게임 origin 이다. '*' 를 쓰지 않는다.
 *  - INIT 은 READY 를 받은 뒤 **한 번만** 보낸다.
 *  - COMPLETE 는 resultId 로 중복을 걸러 낸다. 이미 본 결과면 콜백을 다시 부르지 않지만
 *    ACK 는 다시 보낸다(게임 쪽 재전송이 멈추도록).
 *  - 닉네임은 URL 에 넣지 않는다. 참가자는 INIT 메시지로만 간다.
 */

import type {
  BrickPickCancelEvent,
  BrickPickErrorEvent,
  BrickPickInput,
  BrickPickInputLike,
  BrickPickProgress,
  BrickPickResult,
} from '../../core'
import {
  buildEmbedUrl,
  createMessage,
  isBrickPickMessage,
  isSupportedProtocol,
  normalizeOrigin,
} from './protocol'
import type { BrickPickMessage, HostToGameType, InitAckPayload, ReadyPayload } from './protocol'

export interface BrickPickHostReadyInfo {
  /** 게임이 확정한 세션 id. INIT_ACK 이후에 채워진다. */
  sessionId: string | null
  engineVersion: string
  schemaVersion: string
  capabilities: readonly string[]
  /** 검증 중 조정된 항목 안내 (한국어). */
  warnings: string[]
  /** 게임이 실제로 적용한 입력. */
  appliedInput?: BrickPickInput
}

export interface BrickPickHostOptions {
  /** iframe 을 넣을 요소. */
  container: HTMLElement
  /** 게임이 배포된 origin. 예: 'https://brickpick.example.com' */
  gameOrigin: string
  /** 임베드 경로. 기본 '/embed/'. */
  embedPath?: string
  /** 코드 모듈 방식과 완전히 같은 입력 데이터. */
  input: BrickPickInputLike
  /** INIT 이 받아들여진 직후. 이때부터 start() 를 부를 수 있다. */
  onReady?: (info: BrickPickHostReadyInfo) => void
  onProgress?: (progress: BrickPickProgress) => void
  /** 경기가 정상적으로 끝났을 때. 같은 resultId 로는 한 번만 부른다. */
  onComplete?: (result: BrickPickResult) => void
  onCancel?: (event: BrickPickCancelEvent) => void
  onError?: (event: BrickPickErrorEvent) => void
  /** INIT 이 받아들여지면 바로 START 를 보낼지. 기본 false. */
  autoStart?: boolean
  /** iframe 의 접근성 제목. 기본 '브릭픽 발표자 선정 게임'. */
  title?: string
}

export interface BrickPickHost {
  /** 경기를 시작한다. INIT_ACK 전에 부르면 받아들여진 직후에 자동으로 보낸다. */
  start(): void
  pause(): void
  resume(): void
  cancel(reason?: 'host' | 'user'): void
  /** 리스너를 떼고 iframe 을 정리한다. 여러 번 불러도 안전하다. */
  destroy(): void
  readonly iframe: HTMLIFrameElement
  /** 게임이 확정한 세션 id. INIT_ACK 전에는 null. */
  readonly sessionId: string | null
}

export function createBrickPickHost(options: BrickPickHostOptions): BrickPickHost {
  const gameOrigin = normalizeOrigin(options.gameOrigin)
  const parentOrigin = normalizeOrigin(window.location.origin)
  const embedUrl = buildEmbedUrl(gameOrigin, parentOrigin, options.embedPath ?? '/embed/')

  const iframe = document.createElement('iframe')
  iframe.title = options.title ?? '브릭픽 발표자 선정 게임'
  iframe.allow = 'fullscreen; autoplay'
  iframe.setAttribute('allowfullscreen', 'true')
  iframe.style.display = 'block'
  iframe.style.width = '100%'
  iframe.style.height = '100%'
  iframe.style.border = '0'
  iframe.style.colorScheme = 'dark'

  let destroyed = false
  let initSent = false
  let ready = false
  let sessionId: string | null =
    typeof options.input.sessionId === 'string' ? options.input.sessionId : null
  let wantStart = options.autoStart === true
  const seenResultIds = new Set<string>()

  const send = (type: HostToGameType, payload: unknown): void => {
    if (destroyed) return
    const target = iframe.contentWindow
    if (!target) return
    target.postMessage(createMessage(type, sessionId, payload), gameOrigin)
  }

  const handleReady = (payload: ReadyPayload): void => {
    if (initSent) return
    if (
      Array.isArray(payload.supportedProtocolVersions) &&
      payload.supportedProtocolVersions.length > 0 &&
      !payload.supportedProtocolVersions.some((v) => isSupportedProtocol(v))
    ) {
      options.onError?.({
        schemaVersion: String(payload.schemaVersion ?? ''),
        sessionId,
        status: 'error',
        code: 'UNSUPPORTED_PROTOCOL_VERSION',
        message:
          '게임과 수업 앱의 연동 방식(프로토콜) 버전이 맞지 않습니다. 게임 배포를 갱신해 주세요.',
        details: [`game=${payload.supportedProtocolVersions.join(', ')}`],
      })
      return
    }
    initSent = true
    send('INIT', { input: options.input })
  }

  const handleInitAck = (payload: InitAckPayload, readyPayload: ReadyPayload | null): void => {
    if (!payload.accepted) {
      if (payload.error) options.onError?.(payload.error)
      return
    }
    if (typeof payload.sessionId === 'string') sessionId = payload.sessionId
    ready = true
    const info: BrickPickHostReadyInfo = {
      sessionId,
      engineVersion: readyPayload?.engineVersion ?? '',
      schemaVersion: readyPayload?.schemaVersion ?? '',
      capabilities: readyPayload?.capabilities ?? [],
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    }
    if (payload.appliedInput) info.appliedInput = payload.appliedInput
    options.onReady?.(info)
    if (wantStart) {
      wantStart = false
      send('START', {})
    }
  }

  let lastReady: ReadyPayload | null = null

  const onMessage = (event: MessageEvent): void => {
    if (destroyed) return
    // origin 과 source 를 둘 다 본다 — 둘 중 하나만 보면 다른 창이 흉내 낼 수 있다.
    if (normalizeOrigin(event.origin) !== gameOrigin) return
    if (event.source !== iframe.contentWindow) return
    if (!isBrickPickMessage(event.data)) return

    const message = event.data as BrickPickMessage
    if (!isSupportedProtocol(message.protocolVersion)) return
    // INIT 이후에는 이 세션의 메시지만 받는다.
    if (sessionId !== null && message.sessionId !== null && message.sessionId !== sessionId) return

    switch (message.type) {
      case 'READY': {
        lastReady = message.payload as ReadyPayload
        handleReady(lastReady)
        return
      }
      case 'INIT_ACK': {
        handleInitAck(message.payload as InitAckPayload, lastReady)
        return
      }
      case 'PROGRESS': {
        options.onProgress?.(message.payload as BrickPickProgress)
        return
      }
      case 'COMPLETE': {
        const result = (message.payload as { result: BrickPickResult }).result
        if (!result || typeof result.resultId !== 'string') return
        // 이미 본 결과여도 ACK 는 다시 보낸다 — 게임 쪽 재전송이 멈추도록.
        send('COMPLETE_ACK', { resultId: result.resultId })
        if (seenResultIds.has(result.resultId)) return
        seenResultIds.add(result.resultId)
        options.onComplete?.(result)
        return
      }
      case 'CANCEL': {
        options.onCancel?.(message.payload as BrickPickCancelEvent)
        return
      }
      case 'ERROR': {
        options.onError?.(message.payload as BrickPickErrorEvent)
        return
      }
      default:
        return
    }
  }

  // 리스너를 먼저 등록한 뒤에 주소를 넣는다.
  window.addEventListener('message', onMessage)
  options.container.appendChild(iframe)
  iframe.src = embedUrl

  return {
    iframe,
    get sessionId(): string | null {
      return sessionId
    },
    start(): void {
      if (destroyed) return
      if (!ready) {
        wantStart = true
        return
      }
      send('START', {})
    },
    pause(): void {
      send('PAUSE', {})
    },
    resume(): void {
      send('RESUME', {})
    },
    cancel(reason: 'host' | 'user' = 'host'): void {
      send('CANCEL', { reason })
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      window.removeEventListener('message', onMessage)
      try {
        iframe.src = 'about:blank'
      } catch {
        /* 이미 떼어 낸 iframe 이면 넘어간다. */
      }
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    },
  }
}

export default createBrickPickHost
