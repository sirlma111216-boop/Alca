/**
 * 브릭픽 게임 엔진 (core).
 *
 * 이 폴더는 React·DOM·오디오·배포 업체·수업 앱의 전역 상태를 **전혀 모른다.**
 * 브라우저 기능은 전부 adapters 와 renderer 에서 연결한다.
 * 따라서 core 는 Node 에서도 그대로 돌고, 테스트가 브라우저 없이 끝난다.
 */

export * from './version'
export * from './contract'
export * from './config'
export * from './rng'
export * from './geometry'
export * from './level'
export * from './items'
export * from './engine'
export * from './autopilot'
export * from './scoring'
export * from './ranking'
export * from './selection'
export * from './events'
export * from './match'
