/**
 * 조작 입력 — 마우스·터치·키보드를 하나의 ArenaInput 으로 모은다.
 *
 * 설계에서 조심한 것
 *  1. **키보드 리스너는 window 가 아니라 options.element 에 붙인다.**
 *     한 페이지에 게임이 두 개 떠 있어도(수업 앱 안의 iframe 여러 개) 서로의 입력을
 *     훔치지 않는다. element 안에 초점이 있을 때만 Space 의 기본 동작(페이지 스크롤)을 막는다.
 *  2. **패들 이동과 발사 버튼은 pointerId 를 나눠 관리한다.**
 *     발사 버튼 위에서 시작된 터치는 패들을 옮기지 않는다. 손가락 두 개로
 *     왼손은 패들, 오른손은 발사를 동시에 할 수 있다.
 *  3. **firePressed 는 엣지 입력이다.** take() 한 번에 한 번만 true 가 된다.
 *     한 프레임에 여러 스텝을 돌려도 발사가 중복되지 않는다.
 */

import { NEUTRAL_INPUT } from '../core'
import type { ArenaInput } from '../core'
import type { InputController, InputControllerOptions } from './types'

type Device = 'mouse' | 'touch' | 'keyboard' | 'none'

export function createInputController(options: InputControllerOptions): InputController {
  const { element, canvas, toArenaX } = options
  const fireButton = options.fireButton ?? null

  let enabled = true
  let destroyed = false
  let device: Device = 'none'

  let pointerX: number | null = null
  let leftDown = false
  let rightDown = false
  let spaceDown = false
  let firePressed = false
  let pointerFireHeld = false

  /** 패들을 끄는 손가락. 발사 버튼의 손가락과 절대 섞이지 않는다. */
  let paddlePointerId: number | null = null
  let firePointerId: number | null = null

  // 드래그 중 브라우저가 화면을 스크롤하지 않도록.
  const prevCanvasTouchAction = canvas.style.touchAction
  canvas.style.touchAction = 'none'
  const prevFireTouchAction = fireButton ? fireButton.style.touchAction : ''
  if (fireButton) fireButton.style.touchAction = 'none'

  // 키보드 초점을 받을 수 있어야 한다.
  const hadTabIndex = element.hasAttribute('tabindex')
  if (!hadTabIndex) element.setAttribute('tabindex', '0')

  function markDevice(next: Device): void {
    device = next
  }

  function updatePointerFromEvent(event: PointerEvent): void {
    const x = toArenaX(event.clientX, event.clientY)
    if (x !== null) pointerX = x
  }

  // ── 캔버스 포인터 (마우스 + 터치) ─────────────────────────────────────────

  function onCanvasPointerDown(event: PointerEvent): void {
    if (destroyed || !enabled) return
    if (fireButton && event.target === fireButton) return
    if (event.pointerId === firePointerId) return

    if (event.pointerType === 'mouse') {
      markDevice('mouse')
      updatePointerFromEvent(event)
      firePressed = true
      pointerFireHeld = true
      return
    }

    markDevice('touch')
    if (paddlePointerId === null) {
      paddlePointerId = event.pointerId
      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {
        /* 캡처를 못 해도 pointermove 는 계속 들어온다 */
      }
    }
    if (event.pointerId === paddlePointerId) {
      updatePointerFromEvent(event)
      // 발사 버튼이 따로 없을 때만 화면 터치가 발사를 겸한다.
      if (!fireButton) {
        firePressed = true
        pointerFireHeld = true
      }
    }
  }

  function onCanvasPointerMove(event: PointerEvent): void {
    if (destroyed || !enabled) return
    if (event.pointerId === firePointerId) return
    if (event.pointerType === 'mouse') {
      markDevice('mouse')
      updatePointerFromEvent(event)
      return
    }
    if (event.pointerId !== paddlePointerId) return
    markDevice('touch')
    updatePointerFromEvent(event)
  }

  function onCanvasPointerUp(event: PointerEvent): void {
    if (destroyed) return
    if (event.pointerId === paddlePointerId) {
      paddlePointerId = null
      try {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      } catch {
        /* 무시 */
      }
    }
    if (event.pointerType === 'mouse' || event.pointerId !== firePointerId) {
      pointerFireHeld = false
    }
  }

  function onCanvasPointerLeave(event: PointerEvent): void {
    if (destroyed) return
    if (event.pointerType === 'mouse') pointerFireHeld = false
  }

  // ── 발사 버튼 ─────────────────────────────────────────────────────────────

  function onFireDown(event: PointerEvent): void {
    if (destroyed || !enabled) return
    // 이 손가락은 오직 발사용이다. 패들은 움직이지 않는다.
    event.preventDefault()
    event.stopPropagation()
    if (firePointerId !== null) return
    firePointerId = event.pointerId
    firePressed = true
    pointerFireHeld = true
    markDevice(event.pointerType === 'mouse' ? 'mouse' : 'touch')
    if (fireButton) {
      try {
        fireButton.setPointerCapture(event.pointerId)
      } catch {
        /* 무시 */
      }
    }
  }

  function onFireUp(event: PointerEvent): void {
    if (destroyed) return
    if (event.pointerId !== firePointerId) return
    firePointerId = null
    pointerFireHeld = false
    if (fireButton) {
      try {
        if (fireButton.hasPointerCapture(event.pointerId)) {
          fireButton.releasePointerCapture(event.pointerId)
        }
      } catch {
        /* 무시 */
      }
    }
  }

  // ── 키보드 ────────────────────────────────────────────────────────────────

  function ownsFocus(): boolean {
    const active = element.ownerDocument?.activeElement
    return active !== null && active !== undefined && (active === element || element.contains(active))
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (destroyed || !enabled) return
    switch (event.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        leftDown = true
        pointerX = null // 키보드를 쓰기 시작하면 마우스 위치는 놓는다.
        markDevice('keyboard')
        event.preventDefault()
        break
      case 'ArrowRight':
      case 'd':
      case 'D':
        rightDown = true
        pointerX = null
        markDevice('keyboard')
        event.preventDefault()
        break
      case ' ':
      case 'Spacebar':
        if (!spaceDown) firePressed = true
        spaceDown = true
        markDevice('keyboard')
        // 초점이 이 게임 안에 있을 때만 페이지 스크롤을 막는다.
        if (ownsFocus()) event.preventDefault()
        break
      default:
        break
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (destroyed) return
    switch (event.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        leftDown = false
        break
      case 'ArrowRight':
      case 'd':
      case 'D':
        rightDown = false
        break
      case ' ':
      case 'Spacebar':
        spaceDown = false
        break
      default:
        break
    }
  }

  /** 초점을 잃으면 눌린 키가 그대로 남아 패들이 계속 움직이는 사고를 막는다. */
  function onBlur(): void {
    leftDown = false
    rightDown = false
    spaceDown = false
    pointerFireHeld = false
    paddlePointerId = null
    firePointerId = null
  }

  canvas.addEventListener('pointerdown', onCanvasPointerDown)
  canvas.addEventListener('pointermove', onCanvasPointerMove)
  canvas.addEventListener('pointerup', onCanvasPointerUp)
  canvas.addEventListener('pointercancel', onCanvasPointerUp)
  canvas.addEventListener('pointerleave', onCanvasPointerLeave)
  element.addEventListener('keydown', onKeyDown)
  element.addEventListener('keyup', onKeyUp)
  element.addEventListener('blur', onBlur)
  if (fireButton) {
    fireButton.addEventListener('pointerdown', onFireDown)
    fireButton.addEventListener('pointerup', onFireUp)
    fireButton.addEventListener('pointercancel', onFireUp)
    fireButton.addEventListener('lostpointercapture', onFireUp)
  }

  return {
    take(): ArenaInput {
      if (destroyed || !enabled) return NEUTRAL_INPUT
      const direction: -1 | 0 | 1 = leftDown && !rightDown ? -1 : rightDown && !leftDown ? 1 : 0
      const input: ArenaInput = {
        // 방향키를 쓰는 동안에는 포인터 위치를 보내지 않는다(둘이 서로 밀지 않도록).
        pointerX: direction === 0 ? pointerX : null,
        direction,
        firePressed,
        fireHeld: pointerFireHeld || spaceDown,
      }
      firePressed = false // 엣지 — 가져간 뒤에는 꺼진다.
      return input
    },

    setEnabled(next: boolean): void {
      if (enabled === next) return
      enabled = next
      if (!next) {
        pointerX = null
        onBlur()
        firePressed = false
      }
    },

    get lastDevice(): Device {
      return device
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true
      enabled = false
      canvas.removeEventListener('pointerdown', onCanvasPointerDown)
      canvas.removeEventListener('pointermove', onCanvasPointerMove)
      canvas.removeEventListener('pointerup', onCanvasPointerUp)
      canvas.removeEventListener('pointercancel', onCanvasPointerUp)
      canvas.removeEventListener('pointerleave', onCanvasPointerLeave)
      element.removeEventListener('keydown', onKeyDown)
      element.removeEventListener('keyup', onKeyUp)
      element.removeEventListener('blur', onBlur)
      if (fireButton) {
        fireButton.removeEventListener('pointerdown', onFireDown)
        fireButton.removeEventListener('pointerup', onFireUp)
        fireButton.removeEventListener('pointercancel', onFireUp)
        fireButton.removeEventListener('lostpointercapture', onFireUp)
        fireButton.style.touchAction = prevFireTouchAction
      }
      canvas.style.touchAction = prevCanvasTouchAction
      if (!hadTabIndex) element.removeAttribute('tabindex')
      pointerX = null
      firePressed = false
      pointerFireHeld = false
      paddlePointerId = null
      firePointerId = null
    },
  }
}
