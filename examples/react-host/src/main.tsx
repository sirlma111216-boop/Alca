/**
 * 예제 앱의 시작점.
 *
 * 여기서 확인할 것은 두 줄뿐이다.
 *   1) 'brickpick/style.css' 를 **한 번** 가져온다 — 게임 화면의 스타일이다.
 *      빼먹으면 게임이 글자만 쌓인 모습으로 나온다.
 *   2) 나머지는 평범한 React 앱이다. 브릭픽 때문에 달라지는 설정이 없다.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'

// 게임 화면 스타일. 패키지의 exports 에 "./style.css" 로 열려 있다.
import 'brickpick/style.css'

import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('#root 를 찾지 못했습니다. index.html 을 확인해 주세요.')

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
