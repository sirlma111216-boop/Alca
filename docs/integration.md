# 연동 방법 — 코드 모듈과 iframe

수업 앱에 브릭픽을 붙이는 두 가지 방법입니다. **둘 다 완전히 같은 입력과 결과**를 씁니다.
데이터 모양은 [protocol.md](./protocol.md) 를 보세요.

| | 코드 모듈 | iframe |
|---|---|---|
| 설치 | npm 패키지 | 없음 (배포된 주소를 연다) |
| 배포 | 수업 앱과 함께 | 게임을 따로 배포 |
| 게임 업데이트 | 수업 앱을 다시 배포해야 반영 | 게임만 다시 배포하면 바로 반영 |
| 격리 | 같은 페이지 (스타일·전역 상태 주의) | 완전히 분리 |
| 추천 | 수업 앱이 React 이고 같이 배포해도 될 때 | **대부분의 경우** |

---

## 공통 — 수업 앱이 해야 하는 일

게임은 **로그인·수업 관리·참가자 관리를 다시 구현하지 않습니다.**
수업 앱이 이미 가진 것을 그대로 넘겨 주세요.

1. 참가자 목록을 `[{ id, nickname }]` 로 만든다.
   `id` 는 **수업 앱의 식별자 그대로**입니다. 게임이 그대로 돌려줍니다.
2. 이미 발표한 사람의 ID 를 `excludedParticipantIds` 에 넣는다.
3. 결과의 `selectedParticipantIds` 를 받아 **수업 앱의 발표 이력 체계에** 저장한다.

게임이 저장하는 것은 소리·난이도 같은 환경설정뿐입니다. 참가자와 결과는 저장하지 않습니다.

---

## 1. 코드 모듈 방식

### 설치

npm 에 공개하지 않아도 됩니다. 로컬 패키지 파일로 설치할 수 있습니다.

```bash
# 게임 저장소에서
npm run build:lib
npm pack --pack-destination ./dist-pack     # brickpick-1.0.0.tgz 가 생긴다

# 수업 앱 저장소에서
npm install ../brickpick/dist-pack/brickpick-1.0.0.tgz
```

또는 `package.json` 에 경로로:

```json
{ "dependencies": { "brickpick": "file:../brickpick" } }
```

`npm run test:integration` 이 이 과정을 실제로 돌려서 확인합니다.

### 진입점

```
brickpick          → mountBrickPick, createBrickPickHost, 타입, core 유틸  (React 없음)
brickpick/react    → <BrickPick />, useBrickPick                          (React 필요)
brickpick/host     → createBrickPickHost                                  (iframe 호스트용)
brickpick/style.css → 게임 화면 스타일 (반드시 import)
```

`react` / `react-dom` 은 **선택적 peerDependency** 입니다.
React 를 쓰지 않는 앱은 `brickpick` 만 가져다 쓰면 React 가 번들에 들어가지 않습니다.

### React 컴포넌트

```tsx
import { useRef, useState } from 'react'
import { BrickPick } from 'brickpick/react'
import type { BrickPickController, BrickPickResult } from 'brickpick'
import 'brickpick/style.css'

export function PresenterPicker({ roster, alreadyPresented, lessonId }) {
  const controllerRef = useRef<BrickPickController | null>(null)
  const [result, setResult] = useState<BrickPickResult | null>(null)

  return (
    <>
      <BrickPick
        controllerRef={controllerRef}
        sessionId={`${lessonId}:pick-1`}
        participants={roster}                        // [{ id, nickname }]
        mode="auto"                                  // "auto" | "manual"
        difficulty="normal"
        roundDurationMs={30_000}
        selectionRule={{ kind: 'ranks', ranks: [3] }}
        excludedParticipantIds={alreadyPresented}
        autoStart
        onReady={(info) => console.log('준비됨', info.capabilities, info.warnings)}
        onProgress={(p) => setRemaining(p.remainingMs)}
        onComplete={(r) => { setResult(r); savePresenters(r.selectedParticipantIds) }}
        onCancel={(e) => console.log('취소됨', e.reason)}   // 결과는 오지 않는다
        onError={(e) => alert(e.message)}                   // 한국어 안내 문구
        style={{ height: '70vh' }}
      />
      <button onClick={() => controllerRef.current?.pause()}>일시정지</button>
    </>
  )
}
```

**게임이 다시 마운트되는 조건**은 "경기 정의"에 해당하는 값(참가자·모드·난이도·seed·
선정 규칙·제외 목록)뿐입니다. 콜백을 인라인으로 써도 게임이 다시 시작되지 않습니다.
React 18 StrictMode 의 이중 마운트에서도 인스턴스가 두 개 생기지 않습니다.

### 프레임워크 없이

```js
import { mountBrickPick } from 'brickpick'
import 'brickpick/style.css'

const controller = mountBrickPick(document.getElementById('game'), {
  sessionId: 'lesson-7:pick-1',
  participants: [
    { id: 'stu_a1', nickname: '김민준' },
    { id: 'stu_b2', nickname: '이서연' },
  ],
  mode: 'auto',
  selectionRule: { kind: 'top', count: 1 },
  excludedParticipantIds: [],
  onComplete: (result) => savePresenters(result.selectedParticipantIds),
  onError: (e) => showMessage(e.message),
})

controller.start()
// controller.pause() / resume() / cancel() / focusParticipant(id) / setSoundEnabled(false)
// controller.getResult() / exportReplayLog()
controller.destroy()   // 반드시 부를 것. 여러 번 불러도 안전하다
```

### 제어 API

| 메서드 | 하는 일 |
|---|---|
| `start()` | 경기 시작. 이미 시작했으면 아무 일도 안 한다 |
| `pause()` / `resume()` | 공·아이템 낙하·효과 지속 시간·제한 시간이 **함께** 멈춘다 |
| `cancel(reason?)` | 취소. **완료 결과를 만들지 않고** `onCancel` 만 부른다 |
| `skipCurrentParticipant()` | 직접 조작 모드 — 현재 참가자를 "미플레이" 로 건너뛴다 |
| `continueToNextParticipant()` | 직접 조작 모드 — 다음 차례 시작 |
| `focusParticipant(id \| null)` | 한 명을 크게 본다 / 전체 격자로 돌아온다 |
| `setSoundEnabled(bool)` | 소리 |
| `getResult()` | 끝난 경기의 결과. 아직이면 `null` |
| `exportReplayLog()` | 재현용 입력·이벤트 로그 |
| `destroy()` | 타이머·리스너·오디오·animation frame 전부 정리 |

### 콜백

| 콜백 | 언제 |
|---|---|
| `onReady(info)` | 검증을 통과하고 시작할 준비가 됐을 때. `info.warnings` 에 조정 안내 |
| `onProgress(p)` | 기본 250ms 간격 (`progressIntervalMs` 로 조절) |
| `onComplete(result)` | 경기가 **정상적으로** 끝났을 때. **정확히 한 번** |
| `onCancel(event)` | 취소. 결과는 오지 않는다 |
| `onError(event)` | 입력 검증 실패·내부 오류. `event.message` 는 화면에 그대로 띄울 수 있는 한국어 |

---

## 2. iframe 방식

### 가장 짧은 방법 — 도우미 사용

```js
import { createBrickPickHost } from 'brickpick/host'

const host = createBrickPickHost({
  container: document.getElementById('game-box'),
  gameOrigin: 'https://brickpick.example.com',   // 정확한 origin. 끝에 / 없이
  input: {
    sessionId: 'lesson-7:pick-1',
    participants: roster,
    mode: 'auto',
    difficulty: 'normal',
    roundDurationMs: 30_000,
    selectionRule: { kind: 'ranks', ranks: [3] },
    excludedParticipantIds: alreadyPresented,
  },
  autoStart: true,
  onReady: (info) => {
    // 이 배포가 필요한 기능을 지원하는지 확인 — "옛 배포"를 코드 문제와 구분할 수 있다
    if (!info.capabilities.includes('items.v1')) {
      showMessage('게임을 다시 배포해야 합니다 (옛 배포).')
    }
  },
  onProgress: (p) => setRemaining(p.remainingMs),
  onComplete: (result) => savePresenters(result.selectedParticipantIds),
  onCancel: (e) => showMessage('경기가 취소됐습니다.'),
  onError: (e) => showMessage(e.message),
})

// host.start() / pause() / resume() / cancel()
host.destroy()   // 리스너 제거 → iframe.src='about:blank' → iframe 제거
```

도우미가 대신 해 주는 것:

- **리스너를 먼저 등록한 뒤** `iframe.src` 를 넣습니다(먼저 넣으면 `READY` 를 놓칩니다).
- `event.origin === gameOrigin && event.source === iframe.contentWindow` 를 확인합니다.
- `READY` 를 받은 뒤 `INIT` 을 **한 번만** 보냅니다.
- `COMPLETE` 에 `COMPLETE_ACK` 를 보내고, `resultId` 로 **중복 반영을 막습니다**
  (이미 본 `resultId` 면 반영하지 않되 ACK 는 다시 보내 게임이 재전송을 멈추게 합니다).
- `targetOrigin: '*'` 를 절대 쓰지 않습니다.

### 직접 다루는 방법

프로토콜을 눈으로 보고 싶거나 빌드 도구가 없다면
[`examples/html-host/index.html`](../examples/html-host/index.html) 을 그대로 참고하세요.
브라우저에서 바로 열리는 한 장짜리 예제입니다.

메시지 순서와 보안 규칙은 [protocol.md 6절](./protocol.md#6-iframe-postmessage-프로토콜) 에 있습니다.

### 게임 주소

```
https://brickpick.example.com/embed/?parentOrigin=https%3A%2F%2Flesson.example.com
```

- `parentOrigin` **만** 쿼리에 넣습니다.
- **닉네임 목록을 URL 에 절대 넣지 마세요.** 참가자는 항상 `INIT` 메시지로만 보냅니다.
  URL 은 브라우저 기록·리퍼러·서버 로그에 남습니다.

### 배포 쪽 설정이 반드시 필요하다

postMessage 검증만으로는 iframe 이 열리지 않습니다. **게임 배포의 응답 헤더**에도
수업 앱 주소를 허용해야 합니다.

`public/_headers`:

```
/embed/*
  Content-Security-Policy: frame-ancestors 'self' https://lesson.example.com
```

그리고 `VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS` 환경변수에 같은 주소를 넣고 빌드합니다.

```
VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS=https://lesson.example.com
```

**두 곳 다** 해야 합니다. 하나만 하면:

| 빠뜨린 곳 | 증상 |
|---|---|
| `_headers` 의 `frame-ancestors` | iframe 이 빈 칸으로 보이고 콘솔에 CSP 오류 |
| `VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS` | iframe 은 보이는데 "허용되지 않은 주소" 문구만 뜨고 메시지가 오지 않음 |

`X-Frame-Options: SAMEORIGIN` 을 **절대 넣지 마세요** — 다른 주소의 수업 앱이 열 수 없게 됩니다.
자세한 절차는 [deployment.md](./deployment.md) 를 보세요.

### 전체 화면과 소리

```html
<iframe allow="fullscreen; autoplay" ...></iframe>
```

`allow="fullscreen"` 이 없으면 게임 안의 전체 화면 버튼이 동작하지 않습니다.
소리는 브라우저 정책상 **사용자가 무언가를 누른 뒤에만** 납니다. 게임이 알아서 처리하지만,
수업 앱이 자동으로 시작(`autoStart`)시키는 경우 첫 소리가 안 날 수 있습니다.
교사가 "시작" 을 누르게 하면 확실합니다.

---

## 3. 자주 부딪히는 것

| 증상 | 원인 | 처방 |
|---|---|---|
| iframe 이 빈 칸 | `frame-ancestors` 에 수업 앱 주소가 없다 | `public/_headers` 수정 후 **다시 배포** |
| "허용되지 않은 주소" 문구 | `VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS` 누락 | 환경변수 넣고 **다시 빌드·배포** |
| `READY` 를 못 받는다 | 리스너보다 `iframe.src` 를 먼저 넣었다 | 리스너 먼저 |
| `INIT` 을 보냈는데 반응이 없다 | `targetOrigin` 이 게임 origin 과 다르다 (끝 `/`, `http`/`https`) | 정확히 맞춘다 |
| `onComplete` 가 두 번 온다 | `COMPLETE` 재전송을 그대로 반영했다 | `resultId` 로 거른다 |
| 결과가 저장되지 않는다 | `COMPLETE_ACK` 를 안 보냈다 | 받으면 반드시 ACK. 게임 화면에 "전달하지 못했습니다" 가 뜬다 |
| 발표자가 이상하다 | 전체 `rank` 로 골랐다 | 선정은 **`eligibleRank`** 기준 |
| 미플레이자가 최하위로 뽑힌다 | 그럴 수 없다 — 미플레이는 후보에서 빠진다 | `playStatus` 와 `eligibleRank` 를 확인 |
| 발표자가 0명으로 돌아왔다 | 경기 중 건너뛰기·중도 취소로 후보가 줄어 규칙을 못 채웠다 | **`result.selectionIssue`** 를 읽어 화면에 알린다 |
| 요청보다 적게 뽑혔다 | 위와 같음 (`top`/`bottom` 이 후보 수로 잘렸다) | `selectionIssue.requestedCount` vs `selectedCount` |
| 소리가 안 난다 | 사용자 조작 전 | 교사가 "시작" 을 누르게 한다 |
| 41명을 넣었다 | 기본 지원은 40명 | `TOO_MANY_PARTICIPANTS` 로 거절된다. 나눠서 진행 |
| 후보보다 높은 순위 지정 | 예: 후보 5명인데 8위 | `NOT_ENOUGH_CANDIDATES`. **경기를 시작하지 않는다** |

---

## 4. 같은 게임을 두 번 여는 경우

- **재경기**는 새 `sessionId` 와 새 `seed` 를 씁니다. `resultId` 도 달라집니다.
- **재현 실행**은 `replayOf` 에 원래 `resultId` 를 넣습니다.
  결과의 `run.kind` 가 `"replay"` 가 되어 실제 경기와 구분됩니다.
- 같은 페이지에 게임을 여러 개 띄워도 키보드 입력과 오디오가 서로를 침범하지 않습니다.
- 열고 닫기를 반복해도 타이머·리스너가 누적되지 않습니다(`destroy()` 를 부르면).
