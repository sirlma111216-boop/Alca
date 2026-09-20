/**
 * 단독 실행 웹사이트의 진입점.
 *
 * 캔버스(renderer)와 CSS 가 같은 색·같은 글꼴을 쓰도록, palette.ts 의 값을
 * CSS 사용자 지정 속성으로 내려 준다. 외부 서버로 나가는 요청은 하나도 없다.
 */

/*
 * 글꼴은 자체 호스팅이다 (@fontsource) — 외부 CDN 으로 나가는 요청이 없다.
 * 교실 네트워크가 외부를 막아도 화면은 그대로 뜬다.
 * Inter 와 JetBrains Mono 에는 한글이 없어서, 라틴 글자와 숫자만 이 둘이 맡고
 * 한글은 뒤따르는 한국어 글꼴이 맡는다 — 의도한 조합이다.
 */
import '@fontsource-variable/inter/wght.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'

import { createRoot } from 'react-dom/client'
import { App } from './App'
import { FONTS, PALETTE } from '../renderer/palette'
import '../styles/standalone.css'

function applyTheme(): void {
  const root = document.documentElement
  for (const [key, value] of Object.entries(PALETTE)) {
    // camelCase → kebab-case (arenaBackground → --bp-arena-background)
    const name = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    root.style.setProperty(`--bp-${name}`, value)
  }
  root.style.setProperty('--bp-font-ui', FONTS.ui)
  root.style.setProperty('--bp-font-numeric', FONTS.numeric)
}

function mount(): void {
  const container = document.getElementById('root')
  if (!container) {
    throw new Error('#root 요소를 찾지 못했습니다. index.html 을 확인해 주세요.')
  }
  applyTheme()
  // StrictMode 를 쓰지 않는다 — 개발 모드에서 effect 를 두 번 실행하면 경기 화면의
  // mountBrickPick 이 마운트/해제/마운트를 반복해 진행 중인 경기가 끊긴다.
  createRoot(container).render(<App />)
}

mount()
