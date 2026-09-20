import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * 앱 빌드 설정 — 독립 실행(/)과 임베드(/embed/) 두 진입점을 가진 정적 사이트를 만든다.
 *
 * 출력: dist/
 *   dist/index.html        → 독립 실행 화면
 *   dist/embed/index.html  → iframe 임베드 진입점
 *   dist/_headers          → Cloudflare Workers Static Assets / Pages / Netlify 공통 헤더
 *
 * base 경로는 VITE_BASE 로 바꿀 수 있다(GitHub Pages 하위 경로 배포용).
 *   예) VITE_BASE=/brickpick/ npm run build:app
 */
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  define: {
    __BRICKPICK_BUILD_MODE__: JSON.stringify(mode),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: mode !== 'production',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        embed: resolve(__dirname, 'embed/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    // 개발 중에는 다른 포트의 수업 앱이 iframe 으로 열 수 있어야 한다.
    headers: {
      'Content-Security-Policy': "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*",
    },
  },
  preview: {
    port: 4173,
  },
}))
