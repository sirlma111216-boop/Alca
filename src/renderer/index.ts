/**
 * 렌더러 배럴.
 *
 * 브라우저에 닿는 모든 것(캔버스·오디오·입력)이 여기 모여 있다.
 * core 는 이 폴더를 모르고, 이 폴더는 React 를 모른다 — 화면 틀(ui/)과 붙이는 일은 adapters 가 한다.
 */

export * from './types'
export * from './palette'
export * from './particles'
export * from './canvas'
export * from './audio'
export * from './input'
