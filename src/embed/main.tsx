/**
 * /embed/ 페이지 진입 스크립트.
 *
 * 하는 일은 하나뿐이다 — embed-host 를 띄우는 것.
 * 임베드 화면에는 단독 실행용 메뉴나 참가자 편집 UI 가 없다.
 * 참가자 명단·규칙·난이도는 전부 수업 앱이 INIT 메시지로 보내 준다.
 *
 * React 를 쓰지 않는다. 이 페이지는 DOM 한 덩어리면 충분하고,
 * 그만큼 첫 화면이 빨리 뜬다.
 */

import { startEmbedHost } from '../adapters/iframe/embed-host'
import type { EmbedHost } from '../adapters/iframe/embed-host'
import '../styles/brickpick.css'

function mountPoint(): HTMLElement {
  const existing = document.getElementById('root')
  if (existing) return existing
  const created = document.createElement('div')
  created.id = 'root'
  document.body.appendChild(created)
  return created
}

function boot(): void {
  const container = mountPoint()
  let host: EmbedHost | null = null

  try {
    host = startEmbedHost({ container })
  } catch (error) {
    const wrap = document.createElement('div')
    wrap.className = 'bp-embed bp-embed--error'
    wrap.setAttribute('role', 'alert')
    const box = document.createElement('div')
    box.className = 'bp-embed__box'
    const title = document.createElement('h1')
    title.className = 'bp-embed__title'
    title.textContent = '게임을 불러오지 못했습니다'
    const text = document.createElement('p')
    text.className = 'bp-embed__text'
    text.textContent = '화면을 새로 고친 뒤에도 같은 문제가 계속되면 수업 앱 관리자에게 알려 주세요.'
    const detail = document.createElement('p')
    detail.className = 'bp-embed__text'
    detail.textContent = error instanceof Error ? error.message : String(error)
    box.append(title, text, detail)
    wrap.appendChild(box)
    container.replaceChildren(wrap)
    return
  }

  // 페이지를 벗어날 때 타이머·리스너를 정리한다.
  window.addEventListener(
    'pagehide',
    () => {
      host?.destroy()
      host = null
    },
    { once: true },
  )
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}
