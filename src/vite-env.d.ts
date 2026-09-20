/// <reference types="vite/client" />

/** 빌드 모드 표식. vite.config.ts / vite.lib.config.ts 의 define 으로 주입된다. */
declare const __BRICKPICK_BUILD_MODE__: string

interface ImportMetaEnv {
  /** iframe 으로 이 게임을 열 수 있는 부모 origin 목록 (쉼표 구분). */
  readonly VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS?: string
  /** GitHub Pages 등 하위 경로 배포용 base. */
  readonly VITE_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
