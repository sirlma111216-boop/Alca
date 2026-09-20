/**
 * iframe **안쪽**(게임 쪽) 프로토콜 처리.
 *
 * 흐름
 *   READY → INIT(검증) → INIT_ACK → START → PROGRESS* → COMPLETE → COMPLETE_ACK
 *
 * 지킨 것
 *  - 허용된 부모 origin 이 아니면 **아무 메시지도 보내지 않는다.** 화면에 이유만 적는다.
 *  - 받을 때 origin · source · 구조 · protocolVersion · schemaVersion 을 전부 확인한다.
 *    (schemaVersion 은 parseBrickPickInput 이 입력 안에서 검사한다.)
 *  - INIT 이후에는 그 부모 window 와 sessionId 에 고정한다. 다른 세션의 메시지,
 *    두 번째 INIT, 이미 시작한 뒤의 START, 끝난 뒤의 START 는 무시하거나 ERROR 로 답한다.
 *  - 보낼 때 targetOrigin 은 항상 정확한 부모 origin 이다. '*' 를 쓰지 않는다.
 *  - COMPLETE 는 ACK 가 올 때까지 정해진 횟수만 다시 보내고, 그래도 없으면
 *    "결과를 수업 앱에 전달하지 못했습니다" 라고 **솔직하게** 적는다.
 *    통신 실패를 성공처럼 표시하지 않는다. 결과 JSON 을 내려받을 수 있는 버튼을 준다.
 *  - 호스트가 준 명단·규칙을 게임이 임의로 바꾸지 않는다. 임베드에는 편집 UI 자체가 없다.
 */

import { ENGINE_CAPABILITIES, ENGINE_VERSION, SCHEMA_VERSION } from '../../core'
import type {
  BrickPickCancelEvent,
  BrickPickErrorCode,
  BrickPickErrorEvent,
  BrickPickProgress,
  BrickPickResult,
} from '../../core'
import { mountBrickPick } from '../mount'
import type { BrickPickController, BrickPickOptions } from '../types'
import {
  COMPLETE_RETRY_DELAYS_MS,
  SUPPORTED_PROTOCOL_VERSIONS,
  createMessage,
  isBrickPickMessage,
  isOriginAllowed,
  isSupportedProtocol,
  normalizeOrigin,
  parseOriginList,
  readParentOriginFromUrl,
} from './protocol'
import type {
  BrickPickMessage,
  CompleteAckPayload,
  GameToHostType,
  InitPayload,
} from './protocol'
import '../../styles/brickpick.css'

export interface EmbedHostOptions {
  /** 게임을 그릴 요소. */
  container: HTMLElement
  /** 현재 주소. 기본 location.href. */
  href?: string
  /** 허용 부모 origin. 기본은 빌드 환경변수에서 읽는다. */
  allowedParentOrigins?: readonly string[]
  /** localhost 를 허용할지. 기본은 개발 빌드에서만 true. */
  allowLocalhost?: boolean
  /** 부모 창. 기본 window.parent. */
  parentWindow?: Window | null
}

export interface EmbedHost {
  /** 리스너·타이머·게임을 모두 정리한다. 여러 번 불러도 안전하다. */
  destroy(): void
  /** 허용된 부모 origin 으로 확인돼 통신을 시작했는지. */
  readonly connected: boolean
}

/** 배포 환경변수에서 허용 부모 origin 목록을 읽는다. */
export function readAllowedParentOrigins(): string[] {
  return parseOriginList(import.meta.env.VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS)
}

// ────────────────────────────────────────────────────────────────────────────
// 화면 안내 (게임이 뜨기 전 / 통신 문제)
// ────────────────────────────────────────────────────────────────────────────

interface NoticeAction {
  label: string
  onClick: () => void
}

function showNotice(
  container: HTMLElement,
  title: string,
  lines: string[],
  actions: NoticeAction[] = [],
  tone: 'info' | 'error' = 'info',
): void {
  const wrap = document.createElement('div')
  wrap.className = tone === 'error' ? 'bp-embed bp-embed--error' : 'bp-embed'
  wrap.setAttribute('role', tone === 'error' ? 'alert' : 'status')

  const box = document.createElement('div')
  box.className = 'bp-embed__box'

  const heading = document.createElement('h1')
  heading.className = 'bp-embed__title'
  heading.textContent = title
  box.appendChild(heading)

  for (const line of lines) {
    const p = document.createElement('p')
    p.className = 'bp-embed__text'
    p.textContent = line
    box.appendChild(p)
  }

  if (actions.length > 0) {
    const row = document.createElement('div')
    row.className = 'bp-embed__actions'
    for (const action of actions) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'bp-btn bp-btn--primary'
      button.textContent = action.label
      button.addEventListener('click', action.onClick)
      row.appendChild(button)
    }
    box.appendChild(row)
  }

  wrap.appendChild(box)
  container.replaceChildren(wrap)
}

/** 결과 JSON 을 파일로 내려받게 한다 — 전달에 실패해도 손으로 옮길 수 있도록. */
function downloadResult(result: BrickPickResult): void {
  try {
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `brickpick-${result.sessionId}-${result.resultId}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch {
    /* 내려받기를 막아 둔 환경에서는 조용히 넘어간다. */
  }
}

const blocked = (container: HTMLElement): EmbedHost => ({
  destroy: () => container.replaceChildren(),
  connected: false,
})

// ────────────────────────────────────────────────────────────────────────────
// startEmbedHost
// ────────────────────────────────────────────────────────────────────────────

export function startEmbedHost(options: EmbedHostOptions): EmbedHost {
  const container = options.container
  const href = options.href ?? window.location.href
  const allowList = options.allowedParentOrigins ?? readAllowedParentOrigins()
  const allowLocalhost = options.allowLocalhost ?? import.meta.env.DEV === true
  const parentWindow = options.parentWindow ?? window.parent

  // ── 부모 origin 확인 — 여기서 걸리면 아무 메시지도 보내지 않는다. ───────
  if (parentWindow === null || parentWindow === window) {
    showNotice(
      container,
      '이 화면은 수업 앱 안에서 열어야 합니다',
      [
        '브릭픽 임베드 화면은 수업 앱이 iframe 으로 열 때만 동작합니다.',
        '직접 플레이하려면 단독 실행 화면을 열어 주세요.',
      ],
      [],
      'error',
    )
    return blocked(container)
  }

  const parentOrigin = readParentOriginFromUrl(href)
  if (!parentOrigin) {
    showNotice(
      container,
      '연결 정보가 없습니다',
      [
        '주소에 parentOrigin 값이 없어 수업 앱과 연결할 수 없습니다.',
        '수업 앱에서 다시 열어 주세요.',
      ],
      [],
      'error',
    )
    return blocked(container)
  }

  if (!isOriginAllowed(parentOrigin, allowList, { allowLocalhost })) {
    showNotice(
      container,
      '허용되지 않은 주소에서 열렸습니다',
      [
        `이 게임을 열 수 있는 주소 목록에 ${parentOrigin} 이(가) 없습니다.`,
        '수업 앱의 주소를 게임 배포 설정(VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS)에 추가해 주세요.',
        '안전을 위해 이 상태에서는 어떤 정보도 주고받지 않습니다.',
      ],
      [],
      'error',
    )
    return blocked(container)
  }

  // ── 여기서부터 통신 가능 ─────────────────────────────────────────────────
  const target = normalizeOrigin(parentOrigin)

  let destroyed = false
  let lockedParent: Window | null = null
  let sessionId: string | null = null
  let controller: BrickPickController | null = null
  let initialized = false
  let started = false
  let finished = false
  let pendingResult: BrickPickResult | null = null
  let retryIndex = 0
  let retryTimer = 0

  const post = (type: GameToHostType, payload: unknown): void => {
    if (destroyed) return
    const win = lockedParent ?? parentWindow
    if (!win) return
    try {
      win.postMessage(createMessage(type, sessionId, payload), target)
    } catch {
      /* 부모 창이 이미 닫혔으면 넘어간다. */
    }
  }

  const postError = (code: BrickPickErrorCode, message: string, details: string[] = []): void => {
    const event: BrickPickErrorEvent = {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      status: 'error',
      code,
      message,
    }
    if (details.length > 0) event.details = details
    post('ERROR', event)
  }

  showNotice(container, '수업 앱과 연결하는 중입니다', [
    '잠시만 기다려 주세요. 참가자 명단과 규칙은 수업 앱이 보내 줍니다.',
  ])

  // ── COMPLETE 재전송 ──────────────────────────────────────────────────────

  const clearRetry = (): void => {
    if (retryTimer !== 0) {
      window.clearTimeout(retryTimer)
      retryTimer = 0
    }
  }

  const showDeliveryFailure = (): void => {
    const result = pendingResult
    if (!result) return
    controller?.destroy()
    controller = null
    const names = result.selectionReasons.map((reason) => reason.nickname).join(', ')
    showNotice(
      container,
      '결과를 수업 앱에 전달하지 못했습니다',
      [
        '경기는 끝났지만 수업 앱이 결과를 받았다는 응답을 보내지 않았습니다.',
        '수업 앱 화면을 새로 고친 뒤 다시 보내거나, 결과 파일을 내려받아 직접 옮겨 주세요.',
        `선정된 참가자: ${names.length > 0 ? names : '없음'}`,
      ],
      [
        { label: '결과 JSON 내려받기', onClick: () => downloadResult(result) },
        {
          label: '다시 보내기',
          onClick: () => {
            retryIndex = 0
            post('COMPLETE', { result })
            scheduleRetry()
          },
        },
      ],
      'error',
    )
  }

  function scheduleRetry(): void {
    clearRetry()
    if (destroyed || !pendingResult) return
    if (retryIndex >= COMPLETE_RETRY_DELAYS_MS.length) {
      showDeliveryFailure()
      return
    }
    const delay = COMPLETE_RETRY_DELAYS_MS[retryIndex]
    retryIndex += 1
    retryTimer = window.setTimeout(() => {
      retryTimer = 0
      if (destroyed || !pendingResult) return
      post('COMPLETE', { result: pendingResult })
      scheduleRetry()
    }, delay)
  }

  // ── INIT — 게임 만들기 ───────────────────────────────────────────────────

  const handleInit = (payload: InitPayload, source: Window): void => {
    if (initialized) {
      postError(
        'ALREADY_STARTED',
        '이미 초기화된 세션입니다. 새로 시작하려면 화면을 다시 열어 주세요.',
      )
      return
    }
    const raw = payload.input
    if (typeof raw !== 'object' || raw === null) {
      const error: BrickPickErrorEvent = {
        schemaVersion: SCHEMA_VERSION,
        sessionId: null,
        status: 'error',
        code: 'INVALID_INPUT',
        message: 'INIT 메시지에 입력 데이터가 없습니다.',
      }
      post('INIT_ACK', { accepted: false, sessionId: null, warnings: [], error })
      return
    }

    initialized = true
    lockedParent = source

    const outcome: { accepted: boolean; failure: BrickPickErrorEvent | null } = {
      accepted: false,
      failure: null,
    }

    // 호스트가 준 명단·규칙을 그대로 쓴다. 임베드에서만 정하는 것은 "편집 UI 없음"뿐이다.
    const hostOptions = raw as unknown as BrickPickOptions

    container.replaceChildren()
    controller = mountBrickPick(container, {
      ...hostOptions,
      hideParticipantEditor: true,
      // 시작은 언제나 START 메시지로만 한다.
      autoStart: false,
      onReady: (info) => {
        outcome.accepted = true
        sessionId = info.sessionId
        post('INIT_ACK', {
          accepted: true,
          sessionId: info.sessionId,
          warnings: info.warnings,
          appliedInput: info.appliedInput,
        })
      },
      onProgress: (progress: BrickPickProgress) => post('PROGRESS', progress),
      onComplete: (result: BrickPickResult) => {
        finished = true
        pendingResult = result
        retryIndex = 0
        post('COMPLETE', { result })
        scheduleRetry()
      },
      onCancel: (event: BrickPickCancelEvent) => {
        finished = true
        post('CANCEL', event)
      },
      onError: (event: BrickPickErrorEvent) => {
        outcome.failure = event
        sessionId = event.sessionId
      },
    })

    if (!outcome.accepted) {
      const error: BrickPickErrorEvent = outcome.failure ?? {
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        status: 'error',
        code: 'INTERNAL',
        message: '게임을 시작하지 못했습니다.',
      }
      post('INIT_ACK', { accepted: false, sessionId, warnings: [], error })
    }
  }

  // ── 메시지 수신 ──────────────────────────────────────────────────────────

  const onMessage = (event: MessageEvent): void => {
    if (destroyed) return
    if (normalizeOrigin(event.origin) !== target) return
    // INIT 이전에는 window.parent 만, 이후에는 고정한 부모 창만 받는다.
    const expected: Window | null = lockedParent ?? parentWindow
    if (event.source !== expected) return
    if (!isBrickPickMessage(event.data)) return

    const message = event.data as BrickPickMessage
    if (!isSupportedProtocol(message.protocolVersion)) {
      postError(
        'UNSUPPORTED_PROTOCOL_VERSION',
        `지원하지 않는 연동 방식 버전입니다: ${message.protocolVersion}`,
        [`protocolVersion=${message.protocolVersion}`],
      )
      return
    }
    // 세션이 정해진 뒤에는 그 세션의 메시지만 받는다.
    if (sessionId !== null && message.sessionId !== null && message.sessionId !== sessionId) {
      return
    }

    switch (message.type) {
      case 'INIT': {
        const source = event.source as Window | null
        if (!source) return
        handleInit(message.payload as InitPayload, source)
        return
      }
      case 'START': {
        if (!controller) {
          postError('NOT_STARTED', '아직 초기화되지 않았습니다. INIT 을 먼저 보내 주세요.')
          return
        }
        if (finished) {
          postError(
            'ALREADY_STARTED',
            '이미 끝난 경기입니다. 새 경기를 하려면 화면을 다시 열어 주세요.',
          )
          return
        }
        if (started) {
          postError('ALREADY_STARTED', '이미 시작한 경기입니다.')
          return
        }
        started = true
        controller.start()
        return
      }
      case 'PAUSE': {
        controller?.pause()
        return
      }
      case 'RESUME': {
        controller?.resume()
        return
      }
      case 'CANCEL': {
        const reason = (message.payload as { reason?: 'host' | 'user' }).reason
        controller?.cancel(reason === 'user' ? 'user' : 'host')
        return
      }
      case 'COMPLETE_ACK': {
        const ack = message.payload as CompleteAckPayload
        if (pendingResult && ack.resultId === pendingResult.resultId) {
          clearRetry()
          pendingResult = null
        }
        return
      }
      default:
        return
    }
  }

  window.addEventListener('message', onMessage)

  // READY — 정확한 부모 origin 으로만 보낸다.
  post('READY', {
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    capabilities: ENGINE_CAPABILITIES,
    supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
  })

  return {
    get connected(): boolean {
      return !destroyed
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      clearRetry()
      window.removeEventListener('message', onMessage)
      controller?.destroy()
      controller = null
      container.replaceChildren()
    },
  }
}

export default startEmbedHost
