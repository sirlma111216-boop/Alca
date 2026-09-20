# 데이터 계약과 메시지 프로토콜

수업 앱이 브릭픽과 주고받는 **모든 데이터의 모양**과 **iframe 메시지 순서**를 정의합니다.

- 타입 원본: [`src/core/contract.ts`](../src/core/contract.ts)
- 메시지 원본: [`src/adapters/iframe/protocol.ts`](../src/adapters/iframe/protocol.ts)
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
| `roundDurationMs` | `30000` | 5,000 ~ 300,000 으로 자르고 경고 |
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

## 8. 서버 검증이 아니라는 점

점수와 순위는 **참가자의 브라우저에서 계산**됩니다.
서버가 검증한 성적이 아니므로, 개발자 도구를 쓸 줄 아는 사람은 조작할 수 있습니다.

이 게임은 **수업 중 발표자를 정하는 용도**로 설계됐습니다. 그 용도에는 충분하며,
불필요한 인증 시스템을 넣지 않았습니다. 성적이 평가에 반영되는 등
조작이 실제 문제가 되는 상황이라면 이 게임을 그대로 쓰지 마세요.

수업 앱은 받은 결과를 **자신의 참가자 ID 체계와 발표 이력 체계에 맞춰** 저장하면 됩니다.
게임은 선정 결과를 돌려줄 뿐, 아무것도 저장하지 않습니다.
