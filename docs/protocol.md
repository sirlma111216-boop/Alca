# 데이터 계약과 메시지 프로토콜

수업 앱이 브릭픽과 주고받는 **모든 데이터의 모양**과 **iframe 메시지 순서**를 정의합니다.
1~7절이 그것이고, **8절은 별개의 프로토콜**입니다 — 학생 폰이 실시간으로 참여할 때 쓰는
WebSocket 메시지입니다.

- 타입 원본: [`src/core/contract.ts`](../src/core/contract.ts)
- 메시지 원본: [`src/adapters/iframe/protocol.ts`](../src/adapters/iframe/protocol.ts)
- 실시간 참여 원본: [`worker/protocol.ts`](../worker/protocol.ts) (8절)
- 실제 엔진이 만든 예시: [`docs/examples/`](./examples/) — `npm test` 를 돌릴 때마다 갱신됩니다.

> **코드 모듈 방식과 iframe 방식은 완전히 같은 타입과 같은 검증 규칙을 씁니다.**
> 한쪽에서 되는 입력은 다른 쪽에서도 그대로 됩니다.

---

## 1. 버전

| 이름 | 현재 값 | 뜻 |
|---|---|---|
| `schemaVersion` | `"1.0"` | 입력·결과 데이터의 모양 |
| `PROTOCOL_VERSION` | `"1.0"` | postMessage 봉투의 모양 |
| `ENGINE_VERSION` | `"1.0.0"` | 엔진 구현 버전 (결과에만 실림) |

지원하지 않는 `schemaVersion` 은 **조용히 넘어가지 않고** 오류로 거절합니다.

```json
{ "status": "error", "code": "UNSUPPORTED_SCHEMA_VERSION",
  "message": "지원하지 않는 데이터 버전입니다: 2.0 (지원: 1.0)" }
```

프로토콜 버전도 마찬가지로 `UNSUPPORTED_PROTOCOL_VERSION` 으로 거절합니다.

### capabilities

게임은 `READY` 에 이 배포가 지원하는 기능 목록을 싣습니다.
호스트는 필요한 기능이 없으면 **"옛 배포라 다시 배포해야 한다"** 를 코드 문제와 구분해 안내할 수 있습니다.

```
mode.auto, mode.manual, items.v1, selection.top, selection.bottom, selection.ranks,
exclusion, pause, cancel, progress, replay.eventLog, result.itemStats
```

---

## 2. 입력 `BrickPickInput`

```jsonc
{
  "schemaVersion": "1.0",
  "sessionId": "lesson-2026-09-20-3교시:activity-7",  // 외부 앱이 만든 실행 식별자
  "participants": [
    { "id": "stu_a1b2", "nickname": "김민준" },
    { "id": "stu_c3d4", "nickname": "이서연" },
    { "id": "stu_k1l2", "nickname": "김민준" }        // 같은 닉네임 허용, ID 로 구분
  ],
  "mode": "auto",                                      // "auto" | "manual"
  "difficulty": "normal",                              // "easy"|"normal"|"hard"|"custom"
  "difficultySettings": { /* 선택 — 프리셋 위에 덮어쓸 값 */ },
  "roundDurationMs": 30000,
  "roundMode": "fixed",                                // "fixed" | "until-cleared"
  "selectionRule": { "kind": "ranks", "ranks": [3] },
  "excludedParticipantIds": ["stu_c3d4"],              // 이미 발표한 사람 등
  "seed": "KX7M2PQR4T",
  "locale": "ko",
  "soundEnabled": true,
  "reducedMotion": false,
  "hideParticipantEditor": true,                       // 선택, 기본 true
  "replayOf": null                                     // 선택 — 재현 실행이면 원래 resultId
}
```

전체 예시: [`docs/examples/input.json`](./examples/input.json)

### 참가자 ID 규칙 (중요)

- `id` 는 **필수 고유 식별자**입니다.
- 게임은 외부 앱이 준 ID 를 **그대로 보존해 그대로 돌려줍니다.** 내부 인덱스로 바꾸지 않습니다.
- **중복 ID 는 거절**합니다 → `DUPLICATE_PARTICIPANT_ID`.
- **같은 닉네임은 허용**합니다. 화면에서는 보조 표시로 구별합니다.
- 빈 이름과 공백만 있는 이름은 거절합니다.
- ID 생성은 **독립 실행에서만** 합니다. 임베드/모듈에서는 호스트가 준 ID 만 씁니다.

### 검증과 기본값

`parseBrickPickInput(raw)` 가 검증과 정규화를 함께 합니다.

```ts
const parsed = parseBrickPickInput(raw)
if (!parsed.ok) {
  // parsed.error = { code, message(한국어), details[] }
} else {
  // parsed.value    = 기본값이 채워진 BrickPickInput
  // parsed.warnings = ["경기 시간 900000ms 를 300000ms 로 조정했습니다.", ...]
}
```

| 항목 | 없을 때 | 범위를 벗어나면 |
|---|---|---|
| `mode` | `"auto"` | 경고 후 `"auto"` |
| `difficulty` | `"normal"` | 경고 후 `"normal"` |
| `roundDurationMs` | `30000` (until-cleared 면 `120000`) | 5,000 ~ 300,000 으로 자르고 경고 |
| `roundMode` | `"fixed"` | 모르는 값 → `"fixed"` + 경고 |
| `selectionRule` | `{kind:"ranks",ranks:[1]}` | `INVALID_SELECTION_RULE` 로 거절 |
| `excludedParticipantIds` | `[]` | 명단에 없는 ID 는 경고 후 무시 |
| `seed` | `"BRICKPICK"` | — |
| `locale` | `"ko"` | — |
| `soundEnabled` | `true` | — |
| `reducedMotion` | `false` | — |
| 참가자 수 | — | 0명 → `TOO_FEW_PARTICIPANTS`, 41명↑ → `TOO_MANY_PARTICIPANTS` |
| 난이도 세부값 | 프리셋 | `DIFFICULTY_RANGES` 로 자름 |

선정 규칙은 **후보 수까지 고려해** 검증합니다. 후보가 5명인데 8위를 지정하면
`NOT_ENOUGH_CANDIDATES` 로 **경기를 시작하지 않습니다.**

---

## 3. 결과 `BrickPickResult`

```jsonc
{
  "schemaVersion": "1.0",
  "sessionId": "lesson-2026-09-20-3교시:activity-7",
  "resultId": "bpr_1d0sk85_47126",     // 이 결과 한 건의 고유 ID — 중복 반영 방지용
  "engineVersion": "1.0.0",
  "seed": "KX7M2PQR4T",
  "appliedSettings": {                  // 실제로 적용된 설정의 스냅샷
    "mode": "auto",
    "difficulty": "normal",
    "difficultySettings": { /* 아이템 설정 포함한 최종 수치 전부 */ },
    "roundDurationMs": 30000,
    "selectionRule": { "kind": "ranks", "ranks": [3] },
    "excludedParticipantIds": ["stu_c3d4"]
  },
  "startedAt": "2026-09-20T02:15:30.000Z",
  "completedAt": "2026-09-20T02:16:00.000Z",
  "participants": [ /* 아래 참조 */ ],
  "selectedParticipantIds": ["stu_e5f6"],
  "selectionReasons": [
    { "participantId": "stu_e5f6", "nickname": "박도윤", "eligibleRank": 3,
      "reason": "선정 가능 참가자 5명 중 3위 — 지정 순위 규칙" }
  ],
  "selectionIssue": null,       // 규칙을 다 못 채웠으면 여기에 이유가 담긴다 (아래 참조)
  "status": "completed",
  "run": { "kind": "live", "replayOf": null },
  "eligibleCount": 5
}
```

### 참가자별 결과

```jsonc
{
  "id": "stu_c3d4",
  "nickname": "이서연",
  "score": 230,                 // 플레이하지 않았으면 null (0점과 다름!)
  "rank": 2,                    // 전체 참가자 기준, 1..N 유일
  "eligibleRank": null,         // 후보 기준, 1..M 유일. 후보가 아니면 null
  "excluded": true,
  "playStatus": "played",       // "played"|"not_played"|"aborted"|"excluded"
  "livesRemaining": 4,          // 미플레이면 null
  "bricksDestroyed": 15,
  "playedMs": 30000,
  "wavesCleared": 0,
  "clearedAtMs": null,          // 벽돌을 처음 전부 깬 시각(ms). 못 깼으면 null
  "items": [                    // 한 번도 안 나온 종류는 생략된다
    { "kind": "life", "dropped": 2, "collected": 1 }
  ],
  "tie": {
    "tied": false,
    "tiedWith": [],
    "resolvedBy": "none"        // "none"|"lives"|"seed"
  }
}
```

동점이었던 예:

```json
"tie": {
  "tied": true,
  "tiedWith": ["stu_k1l2", "stu_g7h8"],
  "resolvedBy": "seed",
  "drawValue": 0.8172015470918268
}
```

전체 예시: [`docs/examples/result.json`](./examples/result.json)

> **점수와 선정 결과는 화면 문구를 분석하지 않아도 프로그램에서 바로 쓸 수 있습니다.**
> `selectedParticipantIds` 와 `participants[].eligibleRank` 만 보면 됩니다.

### `roundMode` — 경기가 끝나는 방식

| 값 | 언제 끝나나 | 순위 기준 |
|---|---|---|
| `"fixed"` (기본) | `roundDurationMs` 가 지나면 | 점수 내림차순 |
| `"until-cleared"` | **벽돌을 전부 깨면** 그 참가자의 경기가 끝난다 | **다 깬 사람 먼저, 그중 빨리 깬 순** |

`"until-cleared"` 에서 `roundDurationMs` 는 **최대 시간**(안전장치)입니다.
아무도 못 깨면 그 시간에 끊습니다. 생략하면 120,000ms(2분)이 들어갑니다.

- **자동 경기**: 누군가 먼저 다 깨는 순간 **전원의 경기가 함께** 끝납니다.
- **직접 조작 · 실시간 참여**: 각자 자기가 다 깨면 그 차례가 끝납니다.

순위가 점수가 아니라 시간인 이유: 다 깨면 모든 벽돌 점수 + 클리어 보너스를 받아
**전원이 정확히 같은 점수**가 되기 때문입니다. 못 깬 사람끼리는 평소대로 점수 순이고,
마지막 두 단계(남은 목숨 → seed 추첨)는 그대로입니다.

결과의 `participants[].clearedAtMs` 로 누가 언제 깼는지 알 수 있습니다(못 깼으면 `null`).

---
### `selectionIssue` — 규칙을 다 못 채웠을 때

경기 **시작 전**에도 후보 수로 선정 규칙을 검증합니다. 그런데 직접 조작 모드에서는
경기 도중 참가자를 건너뛰거나(미플레이) 중도 취소해 **후보가 줄어들 수 있습니다.**

예: 5명으로 시작하며 "5위 발표" 로 정했는데, 한 명이 플레이하지 않아 후보가 4명이 된 경우.

이때 게임이 조용히 아무도 뽑지 않고 `"completed"` 로 끝나면 안 되므로,
무엇이 모자랐는지 **기계가 읽을 수 있게** 남깁니다.

```json
"selectionIssue": {
  "code": "NOT_ENOUGH_CANDIDATES",
  "message": "선정 가능한 참가자가 4명이라 5위를 뽑지 못했습니다.",
  "requestedCount": 1,
  "selectedCount": 0,
  "missingRanks": [5],
  "candidateCount": 4
}
```

- 정상이면 **`null`** 입니다.
- `top` / `bottom` 규칙에서 요청보다 적게 뽑힌 경우에도 채워집니다
  (`requestedCount: 3, selectedCount: 2, missingRanks: []`).
- **호스트는 이 값이 `null` 이 아니면 발표자 수가 요청과 다르다는 것을 화면에 알려야 합니다.**
  게임 화면에도 경고가 표시됩니다.
- 경기 자체는 정상적으로 끝났으므로 `status` 는 그대로 `"completed"` 이고
  점수·순위는 모두 유효합니다. 취소·오류와는 다릅니다.

### `playStatus` 와 `excluded` 는 다르다

| | 뜻 | 후보 자격 |
|---|---|---|
| `playStatus: "played"` | 경기를 마쳤다 | 있음 (제외되지 않았다면) |
| `playStatus: "not_played"` | 플레이하지 않았다. `score` 는 `null` | **없음** |
| `playStatus: "aborted"` | 도중에 그만뒀다. `score` 는 그때까지의 점수 | **없음** |
| `excluded: true` | 이미 발표한 사람 등 — 선정에서만 제외 | **없음** (전체 순위에는 들어감) |

`playStatus: "excluded"` 값은 계약에 포함돼 있지만 **엔진은 내보내지 않습니다.**
호스트가 자체적으로 "아예 참여하지 않은 제외자"를 표시할 때 쓰라고 열어 둔 값입니다.
엔진은 제외를 항상 `excluded: true` 불리언으로만 표현합니다.

---

## 4. 취소와 오류는 결과가 아니다

**취소와 오류는 완료 결과와 구별되는 별도 이벤트로 전달됩니다.**
취소된 경기는 `BrickPickResult` 를 만들지 않습니다.

```json
// 취소
{ "schemaVersion": "1.0", "sessionId": "...", "status": "cancelled",
  "cancelledAt": "2026-09-20T02:15:52.000Z", "reason": "user" }
```

```json
// 오류
{ "schemaVersion": "1.0", "sessionId": "...", "status": "error",
  "code": "NOT_ENOUGH_CANDIDATES",
  "message": "선정 가능한 참가자가 5명이라 8위를 뽑을 수 없습니다.",
  "details": ["rank=8"] }
```

### 오류 코드

| 코드 | 언제 |
|---|---|
| `UNSUPPORTED_SCHEMA_VERSION` | 모르는 데이터 버전 |
| `UNSUPPORTED_PROTOCOL_VERSION` | 모르는 메시지 프로토콜 버전 |
| `INVALID_INPUT` | 구조가 틀렸다 |
| `DUPLICATE_PARTICIPANT_ID` | 참가자 ID 중복 |
| `TOO_MANY_PARTICIPANTS` | 41명 이상 |
| `TOO_FEW_PARTICIPANTS` | 0명 |
| `INVALID_SELECTION_RULE` | 순위 값이 잘못됐거나 중복 |
| `NOT_ENOUGH_CANDIDATES` | 후보보다 많이 뽑으려 했다 |
| `ORIGIN_NOT_ALLOWED` | 허용되지 않은 부모 origin |
| `SESSION_MISMATCH` | 다른 세션의 메시지 |
| `ALREADY_STARTED` / `NOT_STARTED` | 순서가 맞지 않는 제어 메시지 |
| `INTERNAL` | 그 밖의 내부 오류 |

---

## 5. 진행 상황 `BrickPickProgress`

```jsonc
{
  "schemaVersion": "1.0",
  "sessionId": "...",
  "phase": "running",          // preparing|running|paused|between-players|finished
  "remainingMs": 18250,
  "elapsedMs": 11750,
  "progress": 0.39,
  "currentParticipantId": null, // 직접 조작 모드에서만 채워짐
  "completedCount": 0,
  "totalCount": 6,
  "leaderboard": [
    { "id": "stu_a1b2", "nickname": "김민준", "score": 140, "livesRemaining": 3 }
  ]
}
```

기본 250ms 간격으로 옵니다(`progressIntervalMs` 로 조절).
**실시간 순위표는 화면 표시용이며 최종 순위와 다릅니다** — 최종 순위는 `COMPLETE` 에서만 확정됩니다.

---

## 6. iframe postMessage 프로토콜

### 봉투

모든 메시지는 같은 모양입니다.

```jsonc
{
  "channel": "brickpick",     // 항상 고정 — 다른 앱의 메시지와 섞이지 않게
  "protocolVersion": "1.0",
  "type": "INIT",
  "messageId": "m3_1k9xz",    // 재전송 중복 판별용
  "sessionId": "lesson-...",  // READY 에만 null
  "payload": { }
}
```

### 메시지 순서

```
게임(iframe)                              호스트(수업 앱)
    │                                            │
    │  ── READY ──────────────────────────────▶  │  리스너를 먼저 등록하고 iframe.src 를 넣는다
    │     {engineVersion, capabilities, ...}     │
    │                                            │
    │  ◀────────────────────────── INIT ──────   │  참가자·규칙을 보낸다 (한 번만!)
    │     {input: BrickPickInput}                │
    │                                            │
    │  ── INIT_ACK ───────────────────────────▶  │  accepted=false 면 error 에 이유
    │     {accepted, sessionId, warnings,        │
    │      appliedInput}                         │
    │                                            │
    │  ◀───────────────────────── START ──────   │
    │                                            │
    │  ── PROGRESS ──────────────────────────▶   │  250ms 간격
    │  ── PROGRESS ──────────────────────────▶   │
    │                                            │
    │  ◀──────────────── PAUSE / RESUME ─────    │  선택
    │                                            │
    │  ── COMPLETE ──────────────────────────▶   │  {result: BrickPickResult}
    │  ◀──────────────── COMPLETE_ACK ───────    │  {resultId}
    │                                            │
```

취소·오류:

```
    │  ◀──────────────────────── CANCEL ─────    │  호스트가 중단
    │  ── CANCEL ────────────────────────────▶   │  사용자가 게임 안에서 취소
    │  ── ERROR ─────────────────────────────▶   │  검증 실패·내부 오류
```

### 게임 주소 만들기

```
https://brickpick.example.com/embed/?parentOrigin=https%3A%2F%2Flesson.example.com
```

- 쿼리에는 **`parentOrigin` 만** 넣습니다.
- **닉네임 목록을 URL 쿼리에 절대 넣지 않습니다.** 참가자는 항상 `INIT` 메시지로만 전달합니다.
  (URL 은 브라우저 기록·리퍼러·서버 로그에 남습니다.)

`buildEmbedUrl(gameOrigin, parentOrigin)` 도우미가 있습니다.

### 보안 규칙 — 양쪽 다 지켜야 한다

| | 게임(iframe 안) | 호스트(부모) |
|---|---|---|
| 보낼 때 | 정확한 **부모 origin** 으로 | 정확한 **게임 origin** 으로 |
| `targetOrigin: "*"` | **금지** | **금지** |
| 받을 때 확인 | `event.origin` 이 허용 목록에 있는지, `event.source === window.parent` | `event.origin === gameOrigin`, `event.source === iframe.contentWindow` |
| 구조 확인 | `isBrickPickMessage()` 로 channel·버전·필드 전부 | 같음 |
| 고정 | `INIT` 이후 **그 부모 window 와 sessionId 에 고정** | `READY` 이후 그 iframe 에 고정 |

허용 부모 origin 은 **배포 설정**으로 정합니다.

```
VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS=https://lesson.example.com,https://수업앱2.example.com
```

정확히 일치하는 origin 만 허용합니다. 와일드카드는 지원하지 않습니다.
개발 모드(`import.meta.env.DEV`)에서만 `http://localhost:*` 와 `http://127.0.0.1:*` 를 추가로 허용합니다.

### 중복·재시도·재로드 처리

| 상황 | 처리 |
|---|---|
| `INIT` 이 두 번 온다 | 두 번째는 무시하고 `ERROR: ALREADY_STARTED` 로 답한다 |
| `START` 가 두 번 온다 | 두 번째는 무시한다 |
| 다른 `sessionId` 의 메시지 | 무시한다 (`SESSION_MISMATCH`) |
| iframe 이 새로고침된다 | 게임이 `READY` 를 다시 보낸다. 호스트는 `mountKey` 가 바뀐 게 아니면 같은 세션으로 `INIT` 을 다시 보낸다 |
| `COMPLETE` 에 `ACK` 가 안 온다 | 800ms → 2,000ms → 5,000ms 로 **제한적으로** 재전송한다. 그래도 없으면 화면에 "결과를 수업 앱에 전달하지 못했습니다" 를 적고 결과 JSON 내려받기 버튼을 준다 |
| `COMPLETE` 가 두 번 온다 | 호스트가 `resultId` 로 거른다. 이미 본 `resultId` 면 반영하지 않되 **`ACK` 는 다시 보낸다**(게임이 재전송을 멈추도록) |

> **통신 실패를 성공처럼 표시하지 않습니다.** `COMPLETE_ACK` 를 받기 전까지 게임 화면은
> "수업 앱에 전달 중" 으로 남습니다.

### 브라우저의 삽입 허용 설정

postMessage 검증만으로는 부족합니다. **배포 응답 헤더로도** 삽입을 허용해야 합니다.

```
/embed/*
  Content-Security-Policy: frame-ancestors 'self' https://lesson.example.com
```

`X-Frame-Options: SAMEORIGIN` 을 **절대 넣지 마세요** — 다른 origin 의 수업 앱이 열 수 없게 됩니다.
자세한 내용은 [deployment.md](./deployment.md) 를 보세요.

---

## 7. 코드 모듈 방식의 대응 관계

iframe 메시지와 모듈 콜백은 1:1 로 대응합니다.

| iframe | 코드 모듈 |
|---|---|
| `READY` | `onReady(info)` |
| `INIT` + `START` | `mountBrickPick(...)` + `controller.start()` |
| `INIT_ACK` (accepted=false) | `onError(event)` |
| `PAUSE` / `RESUME` | `controller.pause()` / `controller.resume()` |
| `PROGRESS` | `onProgress(progress)` |
| `COMPLETE` | `onComplete(result)` |
| `COMPLETE_ACK` | 필요 없음 (같은 페이지 안이라 전달 실패가 없다) |
| `CANCEL` | `controller.cancel()` / `onCancel(event)` |
| `ERROR` | `onError(event)` |

---

## 8. 실시간 참여 프로토콜 (학생 폰 동시 접속)

앞의 1~7절은 **수업 앱 ↔ 게임** 사이의 계약입니다.
이 절은 **학생 폰·교사 화면 ↔ 실시간 서버** 사이의 계약으로, 위와 **별개**입니다.
둘을 섞어 쓰지 않습니다.

- 타입 원본: [`worker/protocol.ts`](../worker/protocol.ts)
- 서버 구현: [`worker/room-do.ts`](../worker/room-do.ts), [`worker/index.ts`](../worker/index.ts)
- 브라우저 쪽: [`src/live/client.ts`](../src/live/client.ts), [`src/live/types.ts`](../src/live/types.ts)
- 교사용 설명서: [live-mode.md](./live-mode.md)

> **서버는 순위를 계산하지 않습니다.** 명단을 세고, 시작 신호를 전하고, 점수를 모을 뿐입니다.
> 최종 순위와 발표자는 **교사 화면**이 `core` 의 순수 함수(`computeRanking` / `selectPresenters`)로
> 냅니다. 그래서 실시간 모드의 순위 규칙이 단독 실행과 완전히 같습니다.

### 8-1. 연결

```
wss://<게임주소>/ws?code=ABC123
```

- `code` 는 **6자리**. 코드 하나 = Durable Object 하나입니다(`idFromName(code)`).
  같은 코드면 언제나 같은 객체로 가므로 **외부 데이터베이스가 없습니다.**
- 코드 길이가 6이 아니면 `400`, `Upgrade: websocket` 헤더가 없으면 `426` 입니다.
- 코드는 사람이 친 값을 **서버와 브라우저가 같은 방식으로** 다듬습니다
  (`normalizeCode` / `normalizeCodeInput`: 공백 제거 → 대문자 → 영숫자만 → 6자).
  한쪽만 다듬으면 "분명히 맞게 쳤는데 안 들어가는" 사고가 납니다.
- 코드 문자표는 `23456789ABCDEFGHJKMNPQRSTUVWXYZ` 31자입니다.
  **`0` `O` `1` `I` `L` 을 뺐습니다** — 교실에서 불러 줄 때 헷갈리기 때문입니다.

HTTP 쪽 경로는 셋뿐입니다.

| 경로 | 하는 일 | 응답 |
|---|---|---|
| `GET /api/new-code` | 새 수업 코드 발급 (교사 화면만 부름) | `{ code, protocolVersion }` |
| `GET /api/room/<코드>` | 방 상태 들여다보기 (문제 확인용) | 스냅샷 + `createdAt` / `updatedAt` |
| `GET /api/health` | 살아 있는지 | `{ ok: true, live: true, protocolVersion, runtime }` |

### 8-2. 봉투

iframe 프로토콜과 **다른 모양**입니다. 라이브러리 없이 표준 WebSocket 한 줄로 주고받습니다.
모양은 셋뿐입니다.

```jsonc
// ① 요청 (브라우저 → 서버). i 는 요청 번호
{ "t": "join", "i": 7, "d": { "token": "d8x1...", "nick": "도윤", "role": "student" } }

// ② 응답 (서버 → 그 브라우저). 같은 i 를 그대로 실어 돌려준다
{ "t": "ack", "i": 7, "d": { "members": [...], "phase": "lobby", "isHost": false } }
{ "t": "ack", "i": 7, "err": "이미 다른 기기가 이 수업을 진행하고 있습니다." }

// ③ 밀어주기 (서버 → 방 안 전원). i 가 없다
{ "t": "board", "d": { "members": [...], "joined": 27, "online": 26, "done": 12 } }
```

| 칸 | 뜻 |
|---|---|
| `t` | 메시지 종류 |
| `i` | 요청 번호. 응답에 그대로 실려 온다. 서버가 먼저 보낼 때는 **없다** |
| `d` | 내용 |
| `err` | 있으면 실패. **한국어 문장이라 화면에 그대로 띄울 수 있다** |

응답이 8초 안에 안 오면 브라우저 쪽에서 `응답이 없습니다.` 로 스스로 끊습니다
(영영 기다리는 화면을 만들지 않기 위해서입니다).

**응답을 기다리지 않는 알림**(`notify`)도 있습니다. `i` 를 붙이지 않고 보내며,
연결이 없으면 **조용히 버립니다.** 경기 중 점수 보고가 이것입니다 —
집계는 부가 기능이고, 연결이 없어도 게임은 그대로 돌아가야 하기 때문입니다.

### 8-3. 클라이언트 → 서버

| `t` | 누가 | `d` | 하는 일 |
|---|---|---|---|
| `join` | 모두 | `{ token, nick, role }` | 방에 들어간다 |
| `score` | 학생 | `ScoreReport` | 경기 중 중간 보고 |
| `done` | 학생 | `FinalReport` | 경기를 마쳤다 |
| `start` | **교사** | `{ token, match }` | 경기를 시작한다 |
| `collect` | **교사** | `{ token }` | 최종 기록을 가져간다 |
| `result` | **교사** | `{ token, result }` | 집계 결과를 모두에게 알린다 |
| `cancel` | **교사** | `{ token }` | 경기를 취소한다 |
| `leave` | 모두 | `{ token }` | 이 기기가 남긴 것을 지운다 |
| `reset` | **교사** | `{ token, what }` | 비우기. `what`: `"scores"` / `"all"` / `"demo"` |

`token` 은 **기기가 만든 무작위 문자열**입니다(48자까지 자름). 이름이 아닙니다 —
서버도 누가 누군지 모릅니다. 브라우저 로컬 저장소에 남아 있어서, 같은 폰으로 다시 들어오면
서버가 **지난 기록을 되살려 줍니다.**

#### `join`

```jsonc
{ "token": "d8x1k3...", "nick": "도윤", "role": "student" }   // role: "host" | "student"
```

- 학생은 `nick` 이 **필수**입니다. 없으면 `이름을 입력해 주세요.` 로 거절합니다.
- 닉네임은 서버에서도 한 번 더 자릅니다 — **12자까지**, 제어문자와
  화면에서 태그로 읽힐 수 있는 기호(`<` `>` `&` `"` `'` `\` 백틱)를 한 글자씩 걸러 냅니다.
  클라이언트만 믿지 않습니다.
- 한 방 **40명**(`ROOM_MAX_MEMBERS`, core 의 최대 참가자 수와 맞춤). 넘으면 거절합니다.
- 응답은 스냅샷 전체 + `you: { token, role, nick }` + `isHost`.

#### `score` / `done`

```jsonc
// score — 경기 중, 기본 800ms 간격 (SCORE_SHARE_MS)
{ "token": "...", "matchId": "m_9f3k", "score": 480, "lives": 2,
  "bricksDestroyed": 24, "progress": 0.62 }

// done — 경기 종료 시 한 번. 교사 화면이 이걸 모아 순위를 낸다
{ "token": "...", "matchId": "m_9f3k", "score": 720, "livesRemaining": 1,
  "bricksDestroyed": 39, "playedMs": 30000, "wavesCleared": 0,
  "items": [ { "kind": "life", "dropped": 2, "collected": 1 } ] }
```

- 점수는 **끝나고 한 번** 이 아니라 **하는 동안 계속** 올립니다.
  안 그러면 교사 화면의 진행 상황이 30초 내내 0 입니다.
- 올라온 숫자는 서버가 `-1,000,000 ~ 10,000,000` 으로 자릅니다.
  숫자가 아니면 기본값으로 대체합니다. 화면이 깨지지 않게 하려는 것이지
  **성적 검증이 아닙니다**(9절).
- `items` 는 16개까지만 받습니다.
- `progress` 는 0~1 로 자릅니다.

#### `start` (교사만)

`d.match` 가 `MatchStartView` 입니다. **이 값 하나로 모든 폰이 똑같은 판을 만듭니다.**

```jsonc
{
  "matchId": "m_9f3k",         // 이번 경기 식별자
  "seed": "KX7M2PQR4T",        // ★ 전원 동일 — 같은 벽돌, 같은 아이템 배치
  "difficulty": "normal",
  "difficultySettings": { },   // 선택 — core 의 Partial<DifficultySettings>
  "roundDurationMs": 30000,
  "selectionRule": { "kind": "ranks", "ranks": [3] },   // 규칙 요약 표시용
  "soundEnabled": true,
  "reducedMotion": false
}
```

- `seed` 나 `matchId` 가 문자열이 아니면 `경기 설정이 올바르지 않습니다.` 로 거절합니다.
- 새 경기이므로 **지난 점수를 비웁니다. 명단은 남깁니다.**
- 이 값은 방에 저장됩니다. 늦게 들어온 학생도 `join` 응답으로 같은 `match` 를 받습니다.

#### `collect` / `result` (교사만)

`collect` 응답은 **순위가 아니라 재료**입니다.

```jsonc
{ "matchId": "m_9f3k",
  "finals": [ { "token": "...", "nick": "도윤", "status": "done", "final": { /* FinalReport */ } } ] }
```

교사 화면이 이걸로 `computeRanking` → `selectPresenters` 를 돌려 결과를 만든 뒤,
가벼운 형태(`ResultBroadcast`)만 `result` 로 되돌려 보냅니다.

```jsonc
{ "matchId": "m_9f3k",
  "selectedNicks": ["도윤"],
  "reasons": ["선정 가능 참가자 27명 중 3위 — 지정 순위 규칙"],
  "board": [ { "nick": "도윤", "score": 720, "rank": 3, "picked": true } ] }
```

정식 결과(`BrickPickResult`)는 **교사 화면에만** 남습니다. 결과 JSON 내려받기는 그걸 씁니다.
서버로는 학생 화면에 띄울 만큼만 올라갑니다.

### 8-4. 서버 → 클라이언트 (밀어주기)

| `t` | 언제 | `d` |
|---|---|---|
| `roster` | 명단·접속 상태가 바뀜 | 스냅샷 (`RosterView` + `phase` + `match`) |
| `match` | 교사가 시작을 누름 | `MatchStartView` — **받는 즉시 판을 만든다** |
| `board` | 점수가 올라옴 | `RosterView` |
| `result` | 교사가 집계를 마침 | `ResultBroadcast` |
| `cancel` | 교사가 경기를 취소함 | `{ at }` |

```jsonc
// RosterView
{ "members": [
    { "nick": "도윤", "on": true, "status": "playing", "score": 480, "lives": 2, "progress": 0.62 }
  ],
  "joined": 27, "online": 26, "done": 12 }
```

- `status`: `"waiting"` / `"playing"` / `"done"`
- **잠깐 끊긴 사람도 목록에 남깁니다.** `on: false` 로만 표시합니다 —
  교사가 "누가 아직 안 들어왔지?" 를 봐야 하기 때문입니다.
- 명단은 닉네임 기준 한국어 정렬(`localeCompare(_, 'ko')`)입니다.
  순위 순으로 흔들리면 프로젝터에서 눈으로 못 따라갑니다.

> **브라우저는 밀어준 내용을 통째로 받습니다.** 필드 이름을 하나씩 적어 다시 만들지 않습니다
> (`takeSnapshot`). 서버에 칸이 하나 늘었을 때 그 칸이 조용히 버려지는 사고가
> 가장 찾기 어렵기 때문입니다.

### 8-5. 권한 — 제어 메시지는 교사만

`start` · `collect` · `result` · `cancel` · `reset` 은 **`hostToken` 을 가진 기기만** 보낼 수 있습니다.
아니면 `진행 권한이 없습니다.` 로 거절합니다.

`hostToken` 은 `role: "host"` 로 `join` 할 때 정해집니다.

- 교사 자리는 **한 자리**입니다.
- 다만 **원래 교사가 끊겨 있으면 다른 기기가 다시 잡을 수 있습니다.**
  교사 노트북이 새로고침되거나 배터리가 나가서 수업 전체가 멈추면 안 되기 때문입니다.
- 원래 교사가 **아직 붙어 있는 동안**에는 다른 기기가 가져갈 수 없습니다
  (`이미 다른 기기가 이 수업을 진행하고 있습니다.`).

토큰이 노출되면 남이 진행을 가로챌 수 있습니다. 코드 6자리와 마찬가지로
**교실 안에서만 통하는 수준의 보호**입니다. 이 정도로 충분한 용도에만 쓰세요(9절).

`leave` 만 권한 없이 됩니다 — 자기 기기가 남긴 것을 지우는 것뿐이기 때문입니다.
데모봇 정리에도 이걸 씁니다. 교사 화면이 새로고침되어 `leave` 를 못 보냈을 때를 위해
`reset { what: "demo" }` 가 있고, 토큰이 `demo-` 로 시작하는 참가자만 걷어냅니다.

### 8-6. 늦게 온 메시지 — `matchId` 로 거른다

`score` 와 `done` 은 지금 진행 중인 경기의 `matchId` 와 다르면 **버립니다.**

```jsonc
{ "t": "ack", "i": 12, "d": { "ignored": true } }
```

오류가 아니라 `ignored: true` 로 조용히 알립니다. 끊겼다 돌아온 폰이 지난 판의 점수를
뒤늦게 올려 **새 판의 점수판을 오염시키는 것**을 막기 위한 것입니다.
경기를 취소하면 `match` 가 `null` 이 되므로 그 뒤의 보고도 전부 버려집니다.

### 8-7. 방송은 묶어 보낸다

30명이 동시에 움직이면 변경이 초당 수십 번 일어납니다. 그대로 내보내면 방송이 폭주합니다.

| 종류 | 간격 | 이유 |
|---|---|---|
| `roster` | **250ms** | 들어오고 나가는 것은 바로 보여야 한다 |
| `board` | **700ms** | 덩치가 커서 더 느슨하게 |
| `match` · `result` · `cancel` | **즉시** | 묶으면 안 되는 것 — 시작이 늦으면 판이 어긋난다 |

학생 폰이 점수를 올리는 간격은 **800ms**(`SCORE_SHARE_MS`)입니다.

### 8-8. 보관과 재접속

| | 값 |
|---|---|
| 방 보관 기간(TTL) | **8일** — 마지막으로 쓴 시점 기준 |
| 교사 기기가 기억하는 최근 코드 | **5개**, 8일이 지나면 목록에서 제거 |

- 8일 안에는 **같은 코드로 돌아가면 명단과 점수가 그대로 있습니다.**
  두 차시가 한 주 떨어져 있어도 이어집니다.
- 같은 기기(같은 `token`)로 다시 `join` 하면 닉네임만 갱신하고 **점수는 살립니다.**
- 브라우저는 끊기면 스스로 다시 붙습니다 — 0.8초부터 늘려 가며 **6번**까지,
  최대 간격 8초. 그래도 안 되면 `연결이 끊겼습니다. 새로고침해 주세요.` 를 띄웁니다.
- **그동안에도 게임은 돌아갑니다.** 집계는 부가 기능입니다.

### 8-9. iframe 프로토콜과의 관계

**둘은 섞이지 않습니다.**

| | iframe / npm (1~7절) | 실시간 참여 (8절) |
|---|---|---|
| 참가자 식별 | 수업 앱이 준 `id` | 기기가 만든 무작위 `token` |
| 이름 | 수업 앱이 준 `nickname` | 학생이 그 자리에서 정한 닉네임 |
| 결과 | `BrickPickResult` 를 수업 앱에 돌려줌 | 교사 화면에 남고, 가벼운 형태만 학생에게 방송 |
| 봉투 | `{ channel, protocolVersion, type, messageId, sessionId, payload }` | `{ t, i, d }` |
| 버전 | `PROTOCOL_VERSION` `"1.0"` | `LIVE_PROTOCOL_VERSION` `"1.0"` |

수업 앱이 **이미 학생 명단을 가지고 있다면 iframe 방식이 낫습니다.**
학생이 닉네임을 다시 정할 필요가 없고, 결과가 수업 앱의 ID 체계로 그대로 돌아옵니다.
실시간 참여는 **명단이 없을 때**를 위한 것입니다.

---

## 9. 서버 검증이 아니라는 점

점수와 순위는 **참가자의 브라우저에서 계산**됩니다.
서버가 검증한 성적이 아니므로, 개발자 도구를 쓸 줄 아는 사람은 조작할 수 있습니다.

**실시간 참여(8절)에서도 마찬가지입니다.** 실시간 서버가 생겼다고 해서 점수를 검증하지
않습니다. 서버는 올라온 숫자가 화면을 깨뜨리지 않을 범위인지만 자르고, 계산은 학생 폰이
끝냅니다. 이 구조를 고른 이유는 [live-mode.md](./live-mode.md) 2절에 있습니다.

이 게임은 **수업 중 발표자를 정하는 용도**로 설계됐습니다. 그 용도에는 충분하며,
불필요한 인증 시스템을 넣지 않았습니다. 성적이 평가에 반영되는 등
조작이 실제 문제가 되는 상황이라면 이 게임을 그대로 쓰지 마세요.

수업 앱은 받은 결과를 **자신의 참가자 ID 체계와 발표 이력 체계에 맞춰** 저장하면 됩니다.
게임은 선정 결과를 돌려줄 뿐, 아무것도 저장하지 않습니다.
