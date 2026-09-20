# 인수인계 — 다른 수업 앱에서 브릭픽을 연동할 때

**이 문서는 다른 저장소에서 작업하는 Claude Code(또는 사람)를 위한 것입니다.**
수업 앱 쪽에서 브릭픽을 붙일 때 알아야 할 것만 모았습니다.

---

## 0. 30초 요약

브릭픽은 **정적 웹 앱**입니다. 계정도 데이터베이스도 없습니다.
참가자 목록을 주면 벽돌깨기 경기를 치르고 **발표자 ID 목록**을 돌려줍니다.

```js
// 가장 짧은 연동 (iframe)
import { createBrickPickHost } from 'brickpick/host'

createBrickPickHost({
  container: document.getElementById('game-box'),
  gameOrigin: 'https://brickpick.example.com',
  input: {
    sessionId: `${classId}:${lessonId}:pick1`,
    participants: [{ id: 'stu_a1', nickname: '김민준' }], // 우리 앱의 ID 그대로
    mode: 'auto',
    selectionRule: { kind: 'ranks', ranks: [3] },          // 3위가 발표
    excludedParticipantIds: alreadyPresentedUids,          // 이미 발표한 사람
  },
  autoStart: true,
  onComplete: (result) => {
    // result.selectedParticipantIds === ['stu_a1'] 처럼 **우리가 준 ID 그대로**
    savePresenters(result.selectedParticipantIds)
  },
})
```

수업 앱이 해야 할 일은 **참가자 목록을 주고, 돌아온 ID 를 저장하는 것** 둘뿐입니다.
게임은 로그인·수업 관리·참가자 관리·발표 이력 저장을 **하지 않습니다.**

### 실시간 참여 모드는 이 연동과 별개입니다

브릭픽에는 **학생이 각자 폰으로 들어오는 실시간 모드**가 따로 있습니다
(수업 코드 6자리 + WebSocket + Cloudflare Durable Object).
**수업 앱 연동과 섞이지 않습니다.**

| | iframe / npm 연동 (이 문서) | 실시간 참여 |
|---|---|---|
| 참가자를 누가 아는가 | **수업 앱**이 안다. `id` 와 `nickname` 을 넘긴다 | 게임이 모른다. 학생이 그 자리에서 닉네임을 정한다 |
| 결과 | `BrickPickResult` 가 **수업 앱의 ID 체계로** 돌아온다 | 교사 화면에만 남는다. 닉네임 기준 |
| 서버 | 없음 | Worker + Durable Object |
| 학생 기기 | 필요 없음 | 필요함 |

> **수업 앱이 이미 학생 명단(uid, 이름)을 가지고 있다면 iframe 방식이 낫습니다.**
> 학생이 닉네임을 다시 정할 필요가 없고, 발표자가 **수업 앱의 uid 그대로** 돌아와
> 발표 이력에 바로 적을 수 있습니다. 실시간 모드의 결과는 닉네임뿐이라
> 수업 앱의 사용자와 이어 붙이려면 사람이 눈으로 맞춰야 합니다.
>
> 실시간 모드는 **명단이 없을 때**(일회성 특강, 다른 학교 수업, 외부 워크숍)를 위한 것입니다.
> 연동 작업에서는 이 문서의 1~9절만 보면 되고, 실시간 모드는
> [live-mode.md](./live-mode.md) 와 [protocol.md](./protocol.md) 8절에 따로 있습니다.

---

## 1. 브릭픽 저장소의 실제 구조

경로는 브릭픽 저장소 루트 기준입니다.

```
brickpick/
├─ src/
│  ├─ core/                     게임 엔진. 브라우저를 전혀 모른다
│  │  ├─ contract.ts            ★ 입출력 타입 + parseBrickPickInput (연동 시 여기만 봐도 된다)
│  │  ├─ config.ts              모든 수치 (난이도·아이템·점수표·경기장)
│  │  ├─ engine.ts              Arena — 한 참가자의 경기장
│  │  ├─ match.ts               Match — 여러 경기장과 시계
│  │  ├─ autopilot.ts           자동 경기 패들
│  │  ├─ scoring.ts / ranking.ts / selection.ts   순수 함수 3종
│  │  ├─ items.ts / level.ts / geometry.ts / rng.ts / events.ts
│  │  └─ version.ts             ★ SCHEMA_VERSION, PROTOCOL_VERSION, ENGINE_CAPABILITIES
│  ├─ renderer/                 Canvas·오디오·입력 (엔진을 읽기만 한다)
│  ├─ adapters/
│  │  ├─ types.ts               ★ BrickPickOptions / BrickPickController
│  │  ├─ mount.ts               ★ mountBrickPick — 게임 화면 + 구동 루프
│  │  ├─ react.tsx              ★ <BrickPick /> / useBrickPick
│  │  ├─ index.ts               기본 진입점 (React 를 import 하지 않는다)
│  │  └─ iframe/
│  │     ├─ protocol.ts         ★ 메시지 타입·검증·origin 허용 목록 (양쪽이 공유)
│  │     ├─ embed-host.ts       iframe 안쪽 (게임 쪽)
│  │     └─ host-client.ts      ★ createBrickPickHost — 부모(수업 앱) 쪽
│  ├─ live/                     실시간 참여 — 브라우저 쪽 (연동에는 안 쓴다)
│  │  ├─ client.ts              LiveClient — WebSocket 연결·재접속·기기 토큰·수업 코드 기억
│  │  └─ types.ts               AppMode, LiveMatchSetup, LiveResult, readCodeFromUrl
│  ├─ standalone/               독립 실행 화면 + 실시간 화면 (라이브러리에 들어가지 않는다)
│  └─ embed/main.tsx            /embed/ 진입 스크립트
├─ worker/                      실시간 참여 — 서버 쪽 (연동에는 안 쓴다)
│  ├─ protocol.ts               메시지 봉투·수업 코드·닉네임 거르기·공유 타입
│  ├─ room-do.ts                RoomSession — 수업 1개 = Durable Object 1개
│  └─ index.ts                  진입점. /ws 와 /api/* 만 처리
├─ index.html                   독립 실행 진입점  → /
├─ embed/index.html             임베드 진입점      → /embed/
├─ public/_headers              ★ iframe 허용 목록 (frame-ancestors)
├─ public/404.html
├─ wrangler.jsonc               ★ Cloudflare Workers 배포 설정 (정적 + 실시간 서버)
├─ netlify.toml                 대체 배포 (정적만)
├─ examples/html-host/          ★ 순수 HTML + postMessage 직접 사용 예제
├─ examples/react-host/         ★ npm 패키지 설치 예제
├─ scripts/static-server.mjs    빌드 결과 확인용 정적 서버
├─ scripts/verify-package-install.mjs   패키지 설치 통합 검증
└─ docs/                        이 문서들
```

### 빌드 산출물

| 명령 | 출력 | 용도 |
|---|---|---|
| `npm run build:app` | `dist/` | 정적 사이트. `/` 와 `/embed/` |
| `npm run build:lib` | `dist-lib/` | npm 패키지 (ESM + `.d.ts`) |
| `npx wrangler deploy` | (없음) | `dist/` + `worker/` 를 Cloudflare 에 올린다 |

**셋은 분리돼 있습니다.** 정적 배포에는 `dist/` 만 올라가고,
`worker/` 는 vite 를 거치지 않고 wrangler 가 직접 번들합니다.

> **`src/live/` 와 `worker/` 는 npm 패키지에 들어가지 않습니다.**
> 수업 앱이 `brickpick` 을 설치해도 WebSocket 코드는 딸려 오지 않습니다.

---

## 2. 공개 API 전부

### npm 패키지 진입점

```
brickpick           → mountBrickPick, createBrickPickHost, 타입, core 유틸  (React 없음)
brickpick/react     → BrickPick, useBrickPick                              (React 필요)
brickpick/host      → createBrickPickHost                                  (iframe 호스트)
brickpick/style.css → 게임 화면 스타일 (반드시 import)
```

`react` / `react-dom` 은 **선택적 peerDependency** 입니다.

### 함수 시그니처

```ts
// brickpick
function mountBrickPick(container: HTMLElement, options: BrickPickOptions): BrickPickController

// brickpick/host
function createBrickPickHost(options: {
  container: HTMLElement
  gameOrigin: string            // 'https://brickpick.example.com' (끝에 / 없이)
  embedPath?: string            // 기본 '/embed/'
  input: BrickPickInput | BrickPickOptions
  autoStart?: boolean
  onReady?(info): void
  onProgress?(p: BrickPickProgress): void
  onComplete?(r: BrickPickResult): void
  onCancel?(e: BrickPickCancelEvent): void
  onError?(e: BrickPickErrorEvent): void
}): { start(); pause(); resume(); cancel(); destroy(); iframe: HTMLIFrameElement }

// brickpick/react
function BrickPick(props: BrickPickOptions & {
  className?: string
  style?: CSSProperties
  controllerRef?: MutableRefObject<BrickPickController | null>
}): JSX.Element
```

### BrickPickController

```ts
interface BrickPickController {
  readonly state: 'idle'|'ready'|'running'|'paused'|'between-players'|'finished'|'cancelled'|'error'
  readonly sessionId: string
  start(): void
  pause(): void
  resume(): void
  cancel(reason?: 'user' | 'host'): void
  skipCurrentParticipant(): void       // 직접 조작 모드
  continueToNextParticipant(): void    // 직접 조작 모드
  setSoundEnabled(enabled: boolean): void
  focusParticipant(id: string | null): void
  getResult(): BrickPickResult | null
  exportReplayLog(): ReplayLog | null
  destroy(): void                       // 여러 번 불러도 안전
}
```

### 입력 (필수는 participants 뿐)

```ts
{
  schemaVersion?: '1.0'
  sessionId?: string
  participants: Array<{ id: string; nickname: string }>   // ★ 필수
  mode?: 'auto' | 'manual'                                 // 기본 'auto'
  difficulty?: 'easy' | 'normal' | 'hard' | 'custom'       // 기본 'normal'
  difficultySettings?: Partial<DifficultySettings>         // 아이템 설정 포함
  roundDurationMs?: number                                 // 기본 30000
  selectionRule?: { kind:'top'|'bottom'; count:number } | { kind:'ranks'; ranks:number[] }
  excludedParticipantIds?: string[]
  seed?: string
  locale?: 'ko' | 'en'
  soundEnabled?: boolean
  reducedMotion?: boolean
  replayOf?: string | null
}
```

### 결과에서 실제로 쓸 것

```ts
result.selectedParticipantIds        // string[] — 우리가 준 ID 그대로
result.resultId                      // 중복 반영 방지용 고유 ID
result.selectionReasons              // [{ participantId, nickname, eligibleRank, reason }]
result.participants                  // 전체 명단 + rank / eligibleRank / score / tie / items
result.eligibleCount                 // 선정 후보였던 인원
result.appliedSettings               // 실제 적용된 설정 스냅샷 (재현·기록용)
result.seed                          // 재현용
```

전체 모양은 [protocol.md](./protocol.md), 실제 예시는
[`docs/examples/result.json`](./examples/result.json) (엔진이 직접 만든 파일).

---

## 3. 설정이 있는 곳

| 무엇 | 어디 | 언제 반영되나 |
|---|---|---|
| iframe 허용 목록 (브라우저) | `public/_headers` 의 `/embed/*` `frame-ancestors` | **다시 배포**해야 |
| iframe 허용 목록 (postMessage) | 빌드 변수 `VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS` | **다시 빌드·배포**해야 |
| 하위 경로 배포 | 빌드 변수 `VITE_BASE` (예: `/brickpick/`) | 다시 빌드 |
| 게임 수치 (난이도·아이템·점수) | `src/core/config.ts` | 다시 빌드 |
| 배포 설정 | `wrangler.jsonc` (Workers), `netlify.toml` (Netlify) | — |
| 실시간 서버가 도는 경로 | `wrangler.jsonc` 의 `assets.run_worker_first` | 다시 배포 |
| 실시간 방 보관 기간 · 인원 · 묶음 간격 | `worker/room-do.ts`, `worker/protocol.ts` | 다시 배포 |
| Node 버전 | `.nvmrc` (22) | — |

> **허용 목록은 두 군데 다 고쳐야 합니다.**
> `_headers` 만 고치면 게임이 메시지를 거부하고,
> 빌드 변수만 고치면 브라우저가 iframe 자체를 막습니다.

---

## 4. 수업 앱 쪽에서 할 일 — 체크리스트

### 4-1. 참가자 넘기기

```ts
const participants = enrollments
  .filter((e) => e.status === 'active')
  .map((e) => ({ id: e.uid, nickname: e.displayName }))   // uid 를 그대로!
```

- `id` 는 **고유**해야 합니다. 중복이면 `DUPLICATE_PARTICIPANT_ID` 로 거절됩니다.
- 같은 닉네임은 괜찮습니다. 게임이 화면에서 보조 번호로 구별합니다.
- 빈 이름·공백만 있는 이름은 거절됩니다. 넘기기 전에 걸러 주세요.
- 1~40명. 41명 이상이면 `TOO_MANY_PARTICIPANTS` 입니다. 나눠서 진행하거나
  **콘솔에서 미리 경고**하세요.

### 4-2. 이미 발표한 사람 제외

```ts
excludedParticipantIds: presentHistory[lessonId] ?? []
```

- 제외된 사람도 **경기는 하고 전체 순위에는 들어갑니다.** 선정 후보에서만 빠집니다.
- 결과에 `rank`(전체)와 `eligibleRank`(후보) 가 **둘 다** 들어 있습니다.
- **발표자는 `eligibleRank` 기준으로 뽑힙니다.** 전체 `rank` 로 고르지 마세요.

### 4-3. 결과 저장

```ts
onComplete: (result) => {
  if (seenResultIds.has(result.resultId)) return     // ★ 중복 반영 방지
  seenResultIds.add(result.resultId)

  // 수업 앱의 기존 구조에도 적는다 — 새 구조만 만들면 기존 화면·통계가 못 본다
  session.presenterUids = result.selectedParticipantIds
  session.pickRecord = {
    resultId: result.resultId,
    seed: result.seed,
    rule: result.appliedSettings.selectionRule,
    reasons: result.selectionReasons,
    at: result.completedAt,
  }
  for (const uid of result.selectedParticipantIds) incrementPresentCount(uid)
}
```

- **`resultId` 로 멱등하게** 처리하세요. iframe 방식에서 `COMPLETE` 가 재전송될 수 있습니다.
- **빈 결과는 빈 대로** 적으세요. 선정자가 없다고 임의로 채우지 마세요.
- **`result.selectionIssue` 를 반드시 확인하세요.** 경기 시작 전에 규칙을 검증하지만,
  직접 조작 모드에서 참가자를 건너뛰거나 중도 취소하면 **경기 중에 후보가 줄어듭니다.**
  그러면 요청보다 적게 뽑히거나 아무도 안 뽑힐 수 있고, 그 이유가 여기에 담깁니다.

  ```js
  if (result.selectionIssue) {
    // 예: "선정 가능한 참가자가 4명이라 5위를 뽑지 못했습니다."
    showMessage(result.selectionIssue.message)
  }
  ```

  정상이면 `null` 입니다. 경기 자체는 끝났으므로 `status` 는 `"completed"` 이고
  점수·순위는 모두 유효합니다 — 취소·오류와는 다릅니다.

### 4-4. 취소·오류를 성공으로 취급하지 않기

```ts
onCancel: (e) => setStatus('취소됨'),          // 결과 없음. 아무것도 저장하지 않는다
onError:  (e) => setStatus(e.message),         // e.message 는 한국어. 그대로 띄워도 된다
```

**취소된 경기는 결과를 만들지 않습니다.** "결과 대기 중" 에서 영원히 멈추지 않도록
`onCancel` 과 `onError` 를 반드시 화면에 연결하세요.

### 4-5. 옛 배포 구분

```ts
onReady: (info) => {
  const need = ['items.v1', 'selection.ranks', 'exclusion']
  const missing = need.filter((c) => !info.capabilities.includes(c))
  if (missing.length) setStatus(`게임을 다시 배포해야 합니다 (없는 기능: ${missing.join(', ')})`)
}
```

이게 없으면 "왜 안 되지" 가 배포 어긋남인지 코드 문제인지 알 수 없습니다.

---

## 5. UX 원칙 (실제 수업에서 얻은 것)

- **교사가 하는 일은 둘입니다: 다 모였는지 보고, 시작을 누른다.**
  방식·난이도·시간·선정 규칙은 수업 앱의 설정으로 고정해 넘기세요.
  임베드 모드에는 참가자 편집 UI 가 애초에 없습니다.
- **iframe/npm 연동에서 학생은 아무것도 입력하지 않습니다.** 자동 경기는 관전만 하고,
  직접 조작 모드는 교사 기기에서 한 명씩 돌아가며 합니다.
  학생 기기를 쓰고 싶다면 그것은 **실시간 모드**이고, 이 연동 경로와는 별개입니다(0절).
- 결과 전까지 **몇 위가 발표하는지 감추고 싶다면**: `selectionRule` 을 학생 화면 쪽
  설정에 넣지 마세요. 임베드 화면은 규칙 요약을 보여 주므로, 감춰야 한다면
  교사 화면에서만 게임을 띄우세요.
- 자동 경기 화면에는 항상 **"자동 경기 · 게임으로 진행하는 추첨"** 이 표시됩니다.
  수업 앱 문구도 이와 어긋나지 않게 쓰세요 — 실력 평가로 설명하지 마세요.

---

## 6. 알려진 제한

| 제한 | 내용 | 대응 |
|---|---|---|
| **같은 경기장을 함께 하는 멀티플레이 없음** | 학생 기기 동시 접속은 **된다**(실시간 모드). 다만 각자 자기 경기장에서 **똑같은 판을 따로** 한다. 남의 공이 내 화면에 들어오지 않는다 | 공을 주고받는 대전이 필요하면 이 게임이 아니다 |
| **실시간 모드는 연동과 별개** | 결과가 닉네임 기준이라 수업 앱의 uid 로 돌아오지 않는다 | 수업 앱에 명단이 있으면 **iframe 방식을 쓸 것** (0절) |
| **실시간 모드는 Workers 배포에서만** | Pages·Netlify·GitHub Pages 에는 `/ws` 가 없다 | 참여 칸이 조용히 접힌다. 오류는 안 난다 |
| **서버 검증 없음** | 점수는 학생/교사 브라우저에서 계산된다. 실시간 모드도 같다. 조작 가능 | 수업 중 발표자 선정에는 충분. 성적에 반영되는 용도로는 쓰지 말 것 |
| **참가자 40명** | 기본 지원 범위. 실시간 모드도 한 방 40명 | 41명 이상은 거절. 나눠서 진행 |
| **실시간 방은 8일** | Durable Object 의 TTL. 그 전에는 같은 코드로 이어진다 | 8일이 지나면 새 코드를 연다 |
| **GitHub Pages 임베드 비권장** | 응답 헤더를 설정할 수 없어 `frame-ancestors` 를 못 준다 | Cloudflare Workers / Pages / Netlify 사용 |
| **환경변수는 빌드 시점** | 허용 목록을 바꾸면 다시 빌드·배포해야 한다 | 배포 파이프라인에 반영 |
| **결과 전달 실패 가능** | iframe 에서 `COMPLETE_ACK` 가 안 오면 제한적으로 재전송 후 포기 | 게임 화면에 실패를 표시하고 결과 JSON 내려받기를 제공한다. **성공처럼 보이지 않는다** |
| **자동 경기는 추첨** | 실력 평가가 아니다 | 문구를 그렇게 쓰지 말 것 |
| **소리는 사용자 조작 뒤** | 브라우저 정책 | 교사가 "시작" 을 누르게 한다 |
| **`playStatus: 'excluded'`** | 계약에는 있지만 엔진은 내보내지 않는다 | 제외는 `excluded: true` 불리언으로만 판단 |

---

## 7. 절대 깨지 말아야 할 성질

브릭픽 저장소를 고칠 일이 생기면 이것들을 지켜 주세요.

1. **결정성** — 같은 seed + 설정 + 입력 → 같은 결과.
   `src/core` 안에서 `Math.random()` / `Date.now()` 금지.
2. **고정 스텝** — 물리는 1/120초 단위. 경기 시간은 스텝 수로 센다.
   프레임 저하가 결과에 영향을 주면 안 된다.
3. **공정성** — 참가자 스트림은 `해시(seed) XOR 해시(ID)`. 입력 순서·이름·화면 위치가
   결과에 영향을 주면 안 된다. 아이템 배치는 매치 seed **만** 쓴다.
4. **외부 ID 보존** — 호스트가 준 `id` 를 내부 인덱스로 바꾸지 않는다.
5. **취소 ≠ 완료** — 취소된 경기는 결과를 만들지 않는다.
6. **두 가지 순위** — `rank` 와 `eligibleRank` 를 항상 함께 낸다. 선정은 `eligibleRank` 기준.
7. **`core` 는 브라우저를 모른다** — DOM·React·오디오·배포 업체 API 금지.
8. **`core` 는 네트워크도 모른다** — 실시간 기능이 생긴 뒤에도 마찬가지입니다.
   `WebSocket`·`fetch`·수업 코드는 `src/live` 와 `worker/` 에만 있습니다.
   순위 계산은 **서버가 아니라** 교사 화면이 `computeRanking`/`selectPresenters` 로 합니다.
9. **실시간은 부가 기능이다** — 연결이 끊겨도 게임은 그대로 돌아가야 합니다.
   점수 올리기 실패가 게임을 멈추게 만들면 안 됩니다.

자세한 것은 브릭픽 저장소의 [`CLAUDE.md`](../CLAUDE.md) 에 있습니다.

---

## 8. 실행 가능한 연동 예제

| 예제 | 위치 | 실행 |
|---|---|---|
| **순수 HTML + iframe** | `examples/html-host/index.html` | 브라우저에서 파일을 바로 연다. 빌드 도구 불필요 |
| **React + npm 패키지** | `examples/react-host/` | `npm install && npm run dev` |

HTML 예제는 `createBrickPickHost` 를 쓰지 않고 **postMessage 를 직접** 다룹니다.
프로토콜을 눈으로 확인하면서 연동할 때 이걸 베끼세요.

### 연동이 끝났는지 확인하는 법

1. 게임을 배포하고 기본 주소에서 `/` 와 `/embed/` 가 열리는지 확인
2. `examples/html-host/index.html` 을 열어 게임 주소를 넣고 참가자 ID 를 넣는다
3. 경기를 돌리고 **결과의 `selectedParticipantIds` 에 넣은 ID 가 그대로 돌아오는지** 확인
4. 수업 앱에서 같은 것을 하고, 저장된 발표자가 수업 앱의 uid 체계와 맞는지 확인
5. 같은 경기를 두 번 완료 처리해도 발표 횟수가 두 번 세어지지 않는지 (`resultId` 멱등성)
6. 경기를 취소했을 때 아무것도 저장되지 않는지

---

## 9. 명령 모음 (브릭픽 저장소에서)

```bash
npm install
npm run dev               # 개발 서버 5173. / 와 /embed/  (실시간은 안 뜬다)
npm run verify            # 타입 검사 + 테스트 + 앱 빌드 + 라이브러리 빌드
npm run typecheck         # 앱(tsconfig.json) + 실시간 서버(tsconfig.worker.json) 두 벌
npm run build:app         # dist/
npm run build:lib         # dist-lib/
npm run serve:dist        # dist/ 를 4178 에서 서빙 (배포 결과 확인. 실시간 없음)
npx wrangler dev          # dist/ + 실시간 서버를 8787 에서 함께 (실시간 확인용)
npm run test:integration  # 라이브러리를 예제 앱에 실제 설치해 빌드
npm run deploy:workers    # Cloudflare Workers — 정적 + 실시간 서버
npm run deploy:pages      # Cloudflare Pages — 정적만
```

연동 작업만 한다면 `npm run dev` 와 `npm run serve:dist` 로 충분합니다.
`wrangler` 는 실시간 모드를 건드릴 때만 필요합니다.

패키지를 다른 저장소에 설치하려면 (npm 공개 게시 없이):

```bash
# 브릭픽 저장소에서
npm run build:lib && npm pack --pack-destination ./dist-pack

# 수업 앱 저장소에서
npm install ../brickpick/dist-pack/brickpick-1.0.0.tgz
```
