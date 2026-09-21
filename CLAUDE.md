# CLAUDE.md — 브릭픽 BrickPick 작업 지침

수업용 알카노이드 스타일 벽돌깨기 발표자 선정 게임. TypeScript + React + Vite + Canvas 2D.

## 먼저 읽을 것

- [docs/architecture.md](docs/architecture.md) — 계층 구조와 책임 분리
- [docs/design.md](docs/design.md) — 화면 디자인 언어 (색·글자·면·모양)
- [docs/game-rules.md](docs/game-rules.md) — 점수·난이도·아이템·순위·동점 규칙
- [docs/protocol.md](docs/protocol.md) — 데이터 계약과 iframe 메시지
- [docs/claude-code-handoff.md](docs/claude-code-handoff.md) — 다른 수업 앱에서 연동할 때

## 명령

```bash
npm run dev            # 개발 서버 (5173). /  와 /embed/ 두 진입점
npm run typecheck      # 앱(tsconfig.json) + Worker(tsconfig.worker.json) 둘 다
npm test               # vitest run
npm run build:app      # 정적 사이트 → dist/
npm run build:lib      # 라이브러리 → dist-lib/   (앱 빌드와 출력이 분리돼 있다)
npm run verify         # typecheck + test + build
npm run serve:dist     # dist/ 를 정적 서버로 (4178). 배포 결과 확인용
npm run test:integration  # 라이브러리를 예제 앱에 실제로 설치해 빌드까지 확인

# 실시간 참여(학생 폰)를 건드렸다면
npm run build:app && npx wrangler dev   # dist/ + Worker + Durable Object (8787)
npm run verify:live                     # 교사 1명 + 학생 3명으로 WebSocket 왕복 검증
```

`npm run dev` 와 `serve:dist` 는 **정적 파일만** 내려준다 — 실시간 참여는 `wrangler dev` 에서만 뜬다.

Node 22 (`.nvmrc`). 패키지 관리자는 **npm** 하나만 쓴다 (`package-lock.json`).

## 계층 규칙 (깨지 말 것)

| 폴더 | 할 수 있는 일 | 할 수 없는 일 |
|---|---|---|
| `src/core` | 게임 상태·물리·난수·점수·순위·선정 | **DOM·React·오디오·배포 업체 API 를 절대 쓰지 않는다.** Node 에서 그대로 돌아야 한다 |
| `src/renderer` | Canvas·효과·입력·오디오 | 엔진 상태를 **바꾸지 않는다** (읽기만) |
| `src/adapters` | React 컴포넌트, mount API, iframe 통신 | 게임 규칙을 새로 만들지 않는다 |
| `src/standalone` | 참가자 입력·설정·결과 화면, 실시간 교사·학생 화면 | 라이브러리 빌드에 들어가지 않는다 |
| `src/live` | 실시간 참여의 **브라우저 쪽** (WebSocket·재접속·기기 토큰) | 게임 규칙을 만들지 않는다 |
| `worker/` | 실시간 참여의 **서버 쪽** (Cloudflare Worker + Durable Object) | `src/` 를 import 하지 않는다. 점수·순위를 계산하지 않는다 |

`src/adapters/index.ts` (기본 진입점) 는 **React 를 import 하지 않는다.**
React 가 필요하면 `src/adapters/react.tsx` 에만 둔다.

## 절대 바꾸면 안 되는 성질

1. **결정성** — 같은 seed + 같은 설정 + 같은 입력이면 항상 같은 결과.
   `core` 안에서 `Math.random()` 과 `Date.now()` 를 쓰지 마라. 난수는 `createRng(seed)`,
   시각은 `Match` 에 주입되는 `now()` 만 쓴다.
2. **고정 스텝** — 물리는 `STEP_MS`(1/120초) 단위로만 전진한다. 경기 시간은 스텝 수로 센다.
   프레임 저하가 결과에 영향을 주면 안 된다.
3. **공정성** — 참가자 스트림은 `해시(seed) XOR 해시(참가자 ID)`. 입력 순서·이름·화면 위치가
   결과에 영향을 주면 안 된다. 아이템 배치는 매치 seed **만** 쓴다(참가자별로 달라지면 안 된다).
4. **외부 ID 보존** — 호스트가 준 참가자 `id` 를 내부 인덱스로 바꾸지 않는다. 그대로 돌려준다.
5. **취소 ≠ 완료** — 취소된 경기는 `BrickPickResult` 를 만들지 않는다.
6. **두 가지 순위** — `rank`(전체)와 `eligibleRank`(제외 후 후보)를 항상 함께 낸다.
   선정은 `eligibleRank` 기준.

## 수치를 바꾸려면

`src/core/config.ts` 만 고친다. 난이도 프리셋·아이템 수치·점수표·경기장 크기가 전부 거기 있다.
바꿨으면 `docs/game-rules.md` 의 표도 같이 고쳐라.

## 색·글자·여백을 바꾸려면

`src/styles/tokens.css` 만 고친다. 다른 스타일시트는 거기 있는 `--t-*` 만 쓴다.
자세한 규칙은 [docs/design.md](docs/design.md) 에 있고, 요약하면 이렇다.

1. **다섯 번째 강조색을 만들지 마라.** 주황 `#fc4c02` → 자홍 `#ef2cc1` → 연보라 `#bdbbff`
   그라디언트와 민트 `#c8f6f9` 가 전부다. 그라디언트는 **하나의 덩어리**다 —
   한 색만 떼어 쓰거나, 순서를 바꾸거나, 네 번째 색을 더하지 않는다.
2. **면은 짙은 남색 `#010120` 아니면 흰색 `#ffffff`** 둘뿐이다. 중간 회색 면이 없다.
   연한 면 `#ebebeb`(`--t-hairline`)은 **칠하는 면** 전용이다 — 표 머리줄과 단계 표시 레일.
   **테두리에 쓰지 마라. 흰 면에서 1.19:1 이라 안 보인다.**
   선은 역할이 둘이다 — 부품 안쪽을 가르는 `--t-line`(2.2:1),
   부품의 경계를 긋는 `--t-border`(3.3:1). 짙은 면에서는 `--t-line-dark` / `--t-border-dark`.
3. **깊이는 1px 선과 면의 명암으로만.** 밝은 면의 카드에 그림자를 깔지 마라.
   그림자와 완전한 원은 떠 있는 발사 버튼(`.bp-fire`) 하나에만 허용된다.
4. **라벨·버튼 글씨는 대문자 고정폭, 제목은 문장형 산세.** 고정폭이 문단을 나르지 않는다.
   음수 자간은 산세만, 양수 자간은 고정폭만.
   **라벨을 13px 아래로 내리지 마라** — 한글은 라틴보다 획이 빽빽해서 11px 이면 교실에서 안 읽힌다.
5. **기본 버튼은 검정 사각형(모서리 4px) 하나.** 알약 모양으로 만들지 마라.
   민트·흰색 버튼은 짙은 면에서만 쓴다.

짙은 면 위에 버튼을 놓을 새 화면을 만들면, `standalone.css` 의 "짙은 면 위에서는…" 주석 옆
선택자 목록에 그 화면 이름을 **반드시 더해라.** 안 그러면 검정 글씨가 짙은 면에 묻혀 안 보인다.
`tokens.css` 의 `.t-eyebrow` 짙은 면 목록에도 같이 더해라.

색이나 선을 건드렸으면 **눈으로 보지 말고 재라.** 브라우저에서 실제 요소의 계산된 색을 읽어
명도 대비를 계산하는 게 가장 확실하다 (글자 4.5:1, 큰 글자·테두리 3:1).
"흐려 보인다"는 인상으로는 1.19:1 과 3:1 을 구별하지 못한다.

`src/styles/brickpick.css` 는 규칙이 다르다 — npm 패키지로 나가므로 `tokens.css` 를
불러오지 않고 `:root`·`body`·`*` 도 쓰지 않는다. 토큰을 `.bp-root` 안에 다시 적는다.

## 화면 문구

- **한국어 기본.** 비개발자 교사가 읽을 수 있게.
- 제목은 **문장형**으로 쓴다. 대문자로 지르는 제목을 만들지 마라 (디자인 규칙).
- 자동 경기에는 항상 **"자동 경기 · 게임으로 진행하는 추첨"** 을 표시한다.
  결과를 실제 참가자의 게임 실력처럼 설명하지 않는다.
- 중립 표현만: "꼴찌"·"실패자" ✗ → "하위 순위"·"이번 발표자" ✓
- 닉네임은 항상 `textContent` 로. `innerHTML` 금지.

## Windows 작업 시 주의

- 소스 파일은 Write/Edit 도구로 쓴다. **Bash heredoc 은 백슬래시를 먹어** TypeScript 가 깨진다.
  여러 곳을 한 번에 고쳐야 하면 스크래치패드에 `.mjs` 패치 스크립트를 쓰고 `node` 로 돌린다.
  (못 찾으면 반드시 throw 하게 쓸 것.)
- prettier 를 돌리지 마라. 프로젝트에 설정이 없어서 파일 전체가 재정렬된다.
- 포트 정리: `netstat -ano | grep ":4178 .*LISTENING"` → `taskkill //PID <pid> //F` (슬래시 두 개).

## 배포

1순위 **Cloudflare Workers** (`wrangler.jsonc`) — 정적 파일 + 실시간 참여 서버를 한 번에 올린다.
`run_worker_first` 는 `["/ws", "/api/*"]` 로 못 박아 둔다. `true` 로 바꾸면 **모든 요청**이
Worker 를 거쳐 느려지고 요금이 는다.
2순위 Cloudflare Pages, 외부 대안 Netlify — 둘 다 정적만이라 **실시간 참여가 안 된다.**
자세한 절차는 [docs/deployment.md](docs/deployment.md).

`public/_headers` 에 `X-Frame-Options` 를 **절대 넣지 마라** — 수업 앱이 iframe 으로 못 연다.
삽입 허용은 `/embed/*` 의 CSP `frame-ancestors` 로만 한다.
