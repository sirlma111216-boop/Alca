/** 엔진 구현 버전. 결과 JSON 의 engineVersion 으로 나간다. */
export const ENGINE_VERSION = '1.0.0'

/** 입출력 데이터 계약(schemaVersion)의 현재 버전. */
export const SCHEMA_VERSION = '1.0'

/** 읽어들일 수 있는 계약 버전 목록. 여기 없는 버전은 명확한 오류로 거절한다. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = ['1.0']

/** iframe postMessage 프로토콜 버전. schemaVersion 과 별개로 올라간다. */
export const PROTOCOL_VERSION = '1.0'

/** 모든 postMessage 에 붙는 네임스페이스. 다른 앱의 메시지와 섞이지 않게 한다. */
export const PROTOCOL_CHANNEL = 'brickpick'

/**
 * 이 배포가 지원하는 기능 목록. 호스트(수업 앱)는 READY 메시지의 capabilities 를 보고
 * "옛 배포라 아직 이 기능이 없다"를 코드 문제와 구분할 수 있다.
 */
export const ENGINE_CAPABILITIES: readonly string[] = [
  'mode.auto',
  'mode.manual',
  'items.v1',
  'selection.top',
  'selection.bottom',
  'selection.ranks',
  'exclusion',
  'pause',
  'cancel',
  'progress',
  'replay.eventLog',
  'result.itemStats',
]
