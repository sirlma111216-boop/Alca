import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 브릭픽 예제 앱 빌드 설정.
 *
 * 브릭픽은 `"brickpick": "file:../.."` 로 설치한다. npm 이 상위 폴더를
 * node_modules/brickpick 에 심볼릭 링크로 걸어 주므로, 공개 게시 없이도
 * 남이 설치한 것과 **같은 경로**(패키지 exports)로 불러오게 된다.
 *
 * 그 링크 때문에 생기는 문제가 하나 있어서 dedupe 를 적어 둔다 — 아래 주석 참고.
 */
export default defineConfig({
  plugins: [react()],

  resolve: {
    // 링크된 패키지가 자기 쪽 React 를 따로 물고 오면 React 가 두 벌 로드되어
    // "Invalid hook call" 이 난다. 항상 이 앱의 React 하나만 쓰도록 고정한다.
    dedupe: ['react', 'react-dom'],
  },

  server: {
    // 브릭픽 개발 서버(5173)와 겹치지 않게 다른 포트를 쓴다.
    port: 5174,
    // 심볼릭 링크 바깥(상위 폴더)의 파일을 읽어야 하므로 허용해 준다.
    fs: { allow: ['..', '../..'] },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
})
