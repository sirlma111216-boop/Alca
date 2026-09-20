import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/**
 * 라이브러리 빌드 설정 — 다른 수업 앱에 npm 패키지로 설치해 쓰는 산출물.
 *
 * 출력: dist-lib/   (앱 빌드 dist/ 와 완전히 분리)
 *   brickpick.js        → 기본 진입점. React 를 import 하지 않는다.
 *   brickpick-react.js  → React 어댑터 진입점.
 *   brickpick-host.js   → iframe 을 여는 "호스트(부모)" 쪽 도우미.
 *   brickpick.css       → 게임 화면 스타일.
 *   types/**            → tsc 가 따로 생성 (npm run build:types)
 */
export default defineConfig({
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: {
        brickpick: resolve(__dirname, 'src/adapters/index.ts'),
        'brickpick-react': resolve(__dirname, 'src/adapters/react.tsx'),
        'brickpick-host': resolve(__dirname, 'src/adapters/iframe/host-client.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
      output: {
        assetFileNames: (info) => (info.name === 'style.css' ? 'brickpick.css' : '[name][extname]'),
      },
    },
  },
  define: {
    __BRICKPICK_BUILD_MODE__: JSON.stringify('library'),
  },
})
