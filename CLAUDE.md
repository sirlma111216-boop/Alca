# CLAUDE.md — 브릭픽 BrickPick 작업 지침

수업용 알카노이드 스타일 벽돌깨기 발표자 선정 게임. TypeScript + React + Vite + Canvas 2D.

## 먼저 읽을 것

- [docs/architecture.md](docs/architecture.md) — 계층 구조와 책임 분리
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

## 화면 문구

- **한국어 기본.** 비개발자 교사가 읽을 수 있게.
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
