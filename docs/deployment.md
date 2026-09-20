# 배포 — GitHub · Cloudflare · 도메인 연결

브릭픽은 **정적 웹 앱**입니다. 브라우저가 물리 계산, 렌더링, 자동 경기, 아이템 처리를
모두 수행합니다. 데이터베이스도, 유료 API 도, 로그인도 없습니다.

여기에 **실시간 참여**(학생 폰 동시 접속)를 쓰려면 아주 작은 서버가 하나 필요합니다.
`/ws` 와 `/api/*` 두 경로에서만 도는 Cloudflare Worker + Durable Object 입니다.
**게임 화면은 여전히 Worker 를 거치지 않습니다.**

| 무엇 | 서버가 필요한가 |
|---|---|
| 단독 실행 (교사가 닉네임 입력) | ❌ 정적 파일만 |
| iframe 삽입 · npm 모듈 | ❌ 정적 파일만 |
| **실시간 참여 (학생 폰)** | ✅ **Worker + Durable Object** |

| 순위 | 플랫폼 | 설정 파일 | 실시간 참여 |
|---:|---|---|---|
| **1** | **Cloudflare Workers Static Assets** | `wrangler.jsonc` + `public/_headers` | ✅ 됨 |
| 2 | Cloudflare Pages | 같은 `dist/` + `public/_headers` | ❌ 안 됨 (정적만) |
| 대안 | Netlify | `netlify.toml` | ❌ 안 됨 |
| 참고 | GitHub Pages | `VITE_BASE` 로 하위 경로 | ❌ 안 됨 |

> 2~4순위에 올리면 **게임은 전부 돌아가되 실시간 참여 칸만 조용히 접힙니다.**
> 실시간 서버가 없으면 앱이 그것을 알아차리고 참여 칸을 접습니다 — 오류 화면이 뜨지는 않습니다.
> 실시간 참여를 쓰려면 1순위(Workers)로 배포하세요.

## 현재 상태 (2026-09-20)

| 항목 | 상태 |
|---|---|
| GitHub 저장소 | ✅ https://github.com/sirlma111216-boop/Alca (CI 통과) |
| Cloudflare Workers Static Assets 배포 | ✅ **https://brickpick.sirlma.workers.dev** |
| **실시간 참여 서버 (Worker + Durable Object)** | ✅ 같은 배포에 포함 — `/api/health` 가 `{"ok":true,"live":true}` |
| 사용자 도메인 연결 | ⬜ 아직 — 도메인명이 정해지면 3절대로 진행 |
| 수업 앱 iframe 허용 목록 | ⬜ 아직 — 수업 앱 주소가 정해지면 2-C 절대로 진행 |

아래에서 실제 도메인 대신 `brickpick.example.com` 을 예시로 씁니다.

---

## 0. 먼저 로컬에서 확인

배포하기 전에 **빌드 결과가 실제로 동작하는지** 확인합니다.

```bash
npm ci
npm run verify          # 타입 검사 + 테스트 + 앱 빌드 + 라이브러리 빌드
npm run serve:dist      # dist/ 를 정적 서버로 (4178)
```

브라우저에서 확인할 것:

- `http://localhost:4178/` — 독립 실행 화면이 뜬다
- `http://localhost:4178/embed/` — **주소를 직접 입력해도** 임베드 화면이 뜬다
- 위 두 주소에서 **새로고침(F5)** 해도 그대로 뜬다
- 존재하지 않는 주소(`/embedd`)는 404 가 된다 (앱이 조용히 열리면 안 된다)

`dist/` 에 이 파일들이 있어야 합니다.

```
dist/index.html          ← 독립 실행
dist/embed/index.html    ← 임베드 진입점
dist/_headers            ← public/_headers 가 복사된 것
dist/404.html            ← not_found_handling: "404-page" 가 쓰는 파일
dist/assets/*            ← 해시가 붙은 JS·CSS
```

### 실시간 참여까지 로컬에서 확인하려면

`npm run dev` 와 `npm run serve:dist` 는 **정적 파일만** 내려줍니다 — `/ws` 와 `/api/*` 가
없으므로 참여 칸이 접힌 상태로 보입니다. 실시간까지 보려면 Worker 를 함께 띄웁니다.

```bash
npm run build:app
npx wrangler dev          # dist/ + Worker + Durable Object 를 같이 띄운다
```

주소가 `http://localhost:8787` 로 나옵니다. 거기서 `/api/health` 가
`{"ok":true,"live":true, ...}` 를 주면 준비된 것입니다.
브라우저 두 개(하나는 시크릿 창)로 같은 코드에 들어가 보세요.

---

## 1. GitHub 저장소

```bash
git init
git add .
git commit -m "브릭픽 BrickPick 초기 구현"
git branch -M main
git remote add origin https://github.com/<계정>/brickpick.git
git push -u origin main
```

`.gitignore` 에 `node_modules`, `dist`, `dist-lib`, `dist-pack`, `*.tgz`, `.wrangler`,
`.env*.local` 이 들어 있습니다. **비밀 키는 저장소에도 클라이언트 빌드에도 들어가지 않습니다**
(애초에 비밀 키를 쓰는 기능이 없습니다).

`.github/workflows/ci.yml` 이 push·pull request 마다 타입 검사 → 테스트 → 앱 빌드 →
라이브러리 빌드를 돌립니다.

---

## 2. Cloudflare Workers Static Assets (1순위)

### 왜 이걸 먼저 쓰나

- **정적 파일과 실시간 서버를 한 번에** 올릴 수 있는 유일한 선택지입니다.
- 그러면서도 게임 화면은 **Worker 를 거치지 않습니다.** `run_worker_first` 를
  `["/ws", "/api/*"]` 로 못 박아 두었기 때문입니다 (2-E 절).
  그 두 경로 밖에서는 예전과 똑같이 Cloudflare 가 파일을 바로 내려줍니다.
- 실시간 참여를 안 쓰더라도 손해가 없습니다. Worker 는 `/ws`·`/api/*` 로 요청이
  올 때만 돕니다.

### 2-A. 명령줄로 배포 (가장 빠름)

```bash
npx wrangler login          # 브라우저가 열리고 Cloudflare 계정에 연결된다
npx wrangler whoami         # 어느 계정인지 확인
npm run deploy:workers      # build:app → wrangler deploy
```

성공하면 이런 주소가 나옵니다.

```
https://brickpick.<계정이름>.workers.dev
```

**이 기본 주소에서 먼저 확인합니다.** 도메인 연결은 그 다음입니다.

- `https://brickpick.<계정>.workers.dev/`
- `https://brickpick.<계정>.workers.dev/embed/` ← 직접 접근·새로고침

### 2-B. GitHub 연결로 자동 배포

1. Cloudflare 대시보드 → **Workers & Pages** → **Create** → **Workers** 탭 →
   **Import a repository**
2. GitHub 계정을 연결하고 `brickpick` 저장소를 고릅니다.
3. 빌드 설정:

   | 항목 | 값 |
   |---|---|
   | Project name | `brickpick` |
   | Production branch | `main` |
   | **Root directory** | `/` (저장소 루트. 모노레포가 아니다) |
   | **Build command** | `npm run build:app` |
   | **Deploy command** | `npx wrangler deploy` |

   `wrangler.jsonc` 가 저장소 루트에 있으므로 출력 폴더는 거기서 읽습니다
   (`assets.directory: "./dist"`). **빌드 출력 경로와 작업 디렉터리가 같아야 합니다** —
   둘이 어긋나면 "파일이 없다" 는 오류가 납니다.

4. **환경변수** (Settings → Variables and Secrets → *Build* 변수):

   | 이름 | 값 | 언제 필요한가 |
   |---|---|---|
   | `VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS` | `https://lesson.example.com` | 수업 앱이 iframe 으로 열 때 **필수** |
   | `NODE_VERSION` | `22` | 기본값이 낮을 때만 |
   | `VITE_BASE` | (비움) | 하위 경로 배포일 때만 |

   이 변수는 **빌드 시점에 번들에 박힙니다.** 바꾸면 **다시 배포**해야 반영됩니다.
   비밀 값이 아니므로 Secret 이 아니라 일반 빌드 변수로 넣습니다.

5. `main` 에 push 하면 자동으로 다시 배포됩니다.

### 2-C. 헤더 — iframe 허용 목록

헤더는 `wrangler.jsonc` 가 아니라 [`public/_headers`](../public/_headers) 에 적습니다.
빌드하면 `dist/_headers` 로 복사되고, Workers Static Assets 가 그대로 읽습니다.

```
/embed/*
  Content-Security-Policy: frame-ancestors 'self' https://lesson.example.com
```

**규칙 세 가지**

1. **`X-Frame-Options` 를 절대 넣지 마세요.** 그 헤더는 "같은 출처만" 또는 "전부 금지"
   두 가지뿐이라, 다른 주소의 수업 앱이 iframe 으로 게임을 못 열게 됩니다.
   허용 목록이 되는 `frame-ancestors` 만 씁니다.
2. **모든 출처를 허용하지 마세요.** `frame-ancestors *` 를 쓰면 아무 사이트나 우리 게임을
   자기 화면인 척 감쌀 수 있습니다. 주소를 하나씩 적습니다.
3. **개발용 localhost 와 운영 목록을 섞지 마세요.** `_headers` 에 개발용 블록이
   주석으로 분리돼 있습니다. 개발 서버(`npm run dev`)는 `vite.config.ts` 의
   `server.headers` 가 이미 localhost 를 허용하므로 대개 건드릴 일이 없습니다.

수업 앱이 여러 개면 공백으로 이어 씁니다.

```
frame-ancestors 'self' https://lesson.example.com https://class.example.org
```

> **브라우저의 삽입 허용(CSP)과 postMessage 의 origin 검증은 둘 다 필요합니다.**
> CSP 만 하면 게임이 메시지를 거부하고, `VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS` 만 하면
> 브라우저가 iframe 자체를 막습니다.

### 2-D. 배포 뒤 확인

```bash
# 임베드 진입점이 실제로 올라갔는지
curl -sI https://brickpick.<계정>.workers.dev/embed/ | head -20

# frame-ancestors 헤더가 붙는지 (여기에 수업 앱 주소가 보여야 한다)
curl -sI https://brickpick.<계정>.workers.dev/embed/ | grep -i content-security-policy

# 허용 목록이 번들에 들어갔는지
curl -s https://brickpick.<계정>.workers.dev/embed/ \
  | grep -o 'assets/[^"]*\.js' | head -1
# → 그 파일을 받아서 수업 앱 주소가 들어 있는지 grep
```

실제 수업 앱에서 iframe 을 열어 **전체 화면 버튼과 소리**까지 확인하세요
(`examples/html-host/index.html` 로도 확인할 수 있습니다).

**실시간 참여가 올라갔는지** 는 이것 하나로 확인합니다.

```bash
curl -s https://brickpick.<계정>.workers.dev/api/health
```

```json
{"ok":true,"live":true,"protocolVersion":"1.0","runtime":"cloudflare-workers"}
```

| 결과 | 뜻 | 처방 |
|---|---|---|
| 위 JSON 이 나온다 | ✅ 실시간 참여가 동작한다 | — |
| **HTML 이 나온다** (`<!doctype html>`) | Worker 가 그 경로를 안 잡고 있다 | `wrangler.jsonc` 의 `run_worker_first` 확인 후 다시 배포 |
| 404 | `main` 이 없거나 배포가 옛날 것 | `npm run deploy:workers` 를 다시 |

그 다음 실제로 한 번 돌려 보세요.

```bash
# 코드 발급이 되는지
curl -s https://brickpick.<계정>.workers.dev/api/new-code
# → {"code":"7K4M9P","protocolVersion":"1.0"}

# 그 방의 상태 (아무도 없으면 members 가 빈 배열)
curl -s https://brickpick.<계정>.workers.dev/api/room/7K4M9P
```

브라우저 두 개(하나는 교사, 하나는 시크릿 창에서 학생)로 같은 코드에 들어가
명단이 올라가는지까지 보면 확실합니다. 혼자서 여러 명을 확인해야 하면
교사 화면의 **[데모 학생 넣기]** 를 쓰고, 확인이 끝나면 **[데모 학생 빼기]** 로 지우세요.

### 2-E. `wrangler.jsonc` 가 바뀐 것

실시간 참여를 붙이면서 이 파일에 **다섯 가지**가 들어갔습니다.

| 설정 | 값 | 왜 |
|---|---|---|
| `main` | `"worker/index.ts"` | Worker 진입점. 전에는 아예 없었다 |
| `durable_objects.bindings` | `[{ name: "ROOM", class_name: "RoomSession" }]` | 수업 하나 = 객체 하나 |
| `migrations` | `[{ tag: "v1", new_sqlite_classes: ["RoomSession"] }]` | **무료 요금제에서 쓰려면 이것이어야 한다** |
| `assets.binding` | `"ASSETS"` | Worker 코드가 정적 파일을 꺼내 쓰기 위해 |
| `assets.run_worker_first` | `["/ws", "/api/*"]` | **★ 아래 참고** |
| `compatibility_flags` | `["nodejs_compat"]` | Durable Object + WebSocket hibernation |

#### `run_worker_first` 를 `true` 로 두지 않은 이유

이 설정은 **"어느 요청에서 Worker 가 먼저 도는가"** 를 정합니다.

```jsonc
"run_worker_first": true              // ✗ 모든 요청이 Worker 를 거친다
"run_worker_first": ["/ws", "/api/*"] // ✓ 이 두 경로에서만
```

`true` 로 두면 **게임 HTML·JS·CSS·이미지까지 전부** 우리 Worker 코드를 한 번 거칩니다.

- **느려집니다.** 정적 파일마다 JS 한 번이 더 도는 셈입니다.
- **요금이 늡니다.** 정적 자산 요청은 원래 **과금 대상이 아닌데**, Worker 를 거치는
  순간 **Worker 요청으로 세어집니다.** 게임 한 번 열면 자산 요청이 10~20건이므로
  요청 수가 통째로 10~20배가 됩니다.
- **버그가 낄 자리가 생깁니다.** 우리 코드가 잘못되면 게임 화면 자체가 안 뜹니다.
  지금 구조에서는 Worker 가 죽어도 게임은 열리고 실시간 칸만 접힙니다.

경로 목록으로 두면 이 셋이 전부 사라집니다. **목록을 `true` 로 바꾸지 마세요.**
새 API 경로를 더할 때는 목록에 그 경로를 추가하세요.

#### `new_sqlite_classes` 여야 하는 이유

```jsonc
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["RoomSession"] }]
```

Durable Object 저장소에는 두 종류가 있습니다.

| | 요금제 |
|---|---|
| `new_sqlite_classes` (SQLite 기반) | **무료 요금제에서 사용 가능** |
| `new_classes` (기존 key-value 기반) | **유료(Workers Paid) 전용** |

`new_classes` 로 적으면 무료 계정에서는 배포 자체가 거절됩니다.
**이미 배포한 클래스의 종류는 나중에 바꿀 수 없습니다** — 새 클래스 이름으로 다시
만들어야 하고, 그러면 그때까지의 방이 전부 사라집니다. 처음부터 맞춰 두세요.

### 2-F. 요금 — 실시간 참여를 켜면 얼마가 드나

**결론: 한 반 30명이 한 차시를 하는 정도는 무료 요금제 안에서 끝납니다.**

| 무엇 | 과금 대상인가 | 이유 |
|---|---|---|
| 게임 화면·JS·CSS (정적 자산) | ❌ **아님** | Workers Static Assets 의 정적 요청은 무제한·무과금. `run_worker_first` 목록 밖이라 Worker 를 안 거친다 |
| `/api/new-code`, `/api/health` | ✅ Worker 요청 | 수업당 한두 건 |
| **WebSocket 연결** | ✅ **첫 연결만 요청 1건** | 연결한 뒤 주고받는 메시지는 요청으로 세지 않는다 |
| Durable Object | ✅ 요청 + 실행 시간 | `new_sqlite_classes` 라 무료 요금제 포함 |
| Durable Object 저장소 | ✅ 용량 | 방 하나가 몇 KB. 8일 뒤 자동으로 비워진다 |

한 차시(30명 + 교사 1명) 어림:

```
WebSocket 연결      31건   (학생 30 + 교사 1. 중간에 끊겼다 붙으면 그만큼 추가)
코드 발급·상태 확인   2건
────────────────────────
Worker 요청        약 33건
```

하루에 6차시를 매일 해도 요청 수는 하루 200건 남짓입니다.
무료 요금제의 하루 한도(10만 건)에 한참 못 미칩니다.

#### 무엇이 늘면 유료가 되는가

무료 범위를 벗어나는 경우는 정해져 있습니다. **이 중 하나라도 하려면 요금을 먼저 계산하세요.**

| 바뀌는 것 | 무엇이 는다 | 얼마나 위험한가 |
|---|---|---|
| **`run_worker_first: true` 로 바꾸기** | Worker 요청이 **10~20배** | ⚠️ 가장 위험. 절대 하지 마세요 |
| **점수 보고 간격을 줄이기** (800ms → 100ms) | Durable Object 실행 시간·쓰기가 8배 | ⚠️ 위험. 화면은 더 나아지지 않습니다 |
| **점수가 올라올 때마다 저장하기** | Durable Object 쓰기 횟수 | ⚠️ 묶어 보내기(250/700ms)를 없애면 그렇게 됩니다 |
| 한 학교 전체가 동시에 쓰기 (수십 반) | 연결 수 · 동시 실행 | 여전히 무료 범위일 가능성이 높지만 확인 필요 |
| **보관 기간(TTL)을 8일에서 늘리기** | 저장 용량 | 방이 안 지워지고 쌓입니다 |
| **결과·통계를 서버에 영구 저장하기** | 저장 용량 + 읽기·쓰기 | 지금은 그런 기능이 없습니다 |
| 리플레이 로그·이벤트를 서버로 올리기 | 메시지 크기 · 저장 용량 | 점수만 올리는 지금 구조를 깨는 변경입니다 |

> **요금이 늘어나는 변경을 제안할 때는 "왜 필요한지"와 "요금이 얼마나 늘어나는지"를
> 먼저 설명하고 결정하세요.** 지금 구조는 그 계산을 이미 한 번 한 결과입니다.

---

## 3. 보유 도메인 연결

사용자가 Cloudflare 에서 관리하는 도메인을 가지고 있다는 전제입니다.
**실제 도메인명은 아직 받지 못해 `brickpick.example.com` 을 예시로 씁니다.**

### 3-A. 먼저 확인할 것

1. Cloudflare 대시보드 첫 화면의 도메인 목록에 그 도메인이 있고 상태가 **Active** 인가?
   (Pending 이면 네임서버 변경이 아직 반영되지 않은 것입니다.)
2. Workers 프로젝트와 **같은 계정** 안에 있는가? 다른 계정의 zone 에는 붙일 수 없습니다.

### 3-B. 게임 전용 서브도메인을 쓴다

기존 수업 앱과 함께 쓰려면 **서브도메인**이 맞습니다.

```
lesson.example.com     ← 기존 수업 앱 (그대로 둔다)
brickpick.example.com  ← 게임 (새로 만든다)
```

최상위 도메인(`example.com`)에 붙이면 기존 사이트가 게임으로 바뀝니다.

### 3-C. 기존 레코드와 충돌하는지 먼저 본다

Cloudflare 대시보드 → 해당 도메인 → **DNS** → **Records** 에서
`brickpick` 이라는 이름의 레코드가 **이미 있는지** 확인합니다.

- 있으면: 무엇에 쓰는 것인지 확인하고, 다른 이름(`game`, `pick`)을 고르거나
  그 레코드를 옮깁니다.
- **다른 레코드를 덮어쓰지 마세요.** 특히 `MX`(메일), `TXT`(SPF/DKIM/도메인 인증),
  `@`·`www`(기존 사이트)는 건드리면 메일과 사이트가 끊깁니다.

### 3-D. 연결

1. Cloudflare 대시보드 → **Workers & Pages** → `brickpick` → **Settings** →
   **Domains & Routes** → **Add** → **Custom Domain**
2. `brickpick.example.com` 을 입력하고 저장합니다.
3. Cloudflare 가 필요한 DNS 레코드를 **자동으로 만들고** 인증서를 발급합니다.
   수동으로 CNAME 을 만들 필요가 없습니다.
4. 상태가 **Active** 가 될 때까지 기다립니다(보통 1분 이내, 길면 몇 분).

### 3-E. 확인

```bash
curl -sI https://brickpick.example.com/ | head -5          # 200 이 나와야 한다
curl -sI https://brickpick.example.com/embed/ | head -5    # 200
curl -sv https://brickpick.example.com/ 2>&1 | grep -i "SSL certificate verify"
```

브라우저에서 자물쇠 아이콘이 보이고 인증서 경고가 없어야 합니다.

### 3-F. 연결한 뒤 할 일

도메인이 바뀌었으니 **수업 앱 쪽도** 고쳐야 합니다.

1. 수업 앱의 `gameOrigin` 을 `https://brickpick.example.com` 으로.
2. 게임의 `VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS` 에 수업 앱 주소가 들어 있는지 확인.
3. `public/_headers` 의 `frame-ancestors` 에 수업 앱 주소가 들어 있는지 확인.
4. **게임을 다시 배포**합니다(환경변수는 빌드 시점에 박히므로).

### 3-G. 비용

| 항목 | 무엇 | 요금 |
|---|---|---|
| **도메인 구매·갱신** | `example.com` 소유권. 등록 기관(Cloudflare Registrar 등)에 내는 연회비 | 도메인마다 다름 (보통 연 1~2만원대) |
| **호스팅 (Workers Static Assets)** | 게임 파일을 내려주는 것 | **정적 자산 요청은 무료 플랜에서 무제한·무과금** |
| **Custom Domain 연결** | 서브도메인 붙이기, HTTPS 인증서 | **추가 요금 없음** |
| **실시간 참여 (Worker + Durable Object)** | 수업 코드·명단·점수 모으기 | **한 반 30명 한 차시 기준 무료 범위** (2-F 절) |

**이것들은 별개의 요금입니다.** 도메인은 이미 사고 관리 중인 비용이고,
브릭픽을 얹는다고 호스팅 요금이 새로 생기지 않습니다.

> 실시간 참여는 서버를 쓰지만, **정적 자산은 여전히 Worker 를 거치지 않으므로**
> 과금 대상이 아닙니다. 무엇이 늘면 유료가 되는지는 **2-F 절**에 표로 정리해 두었습니다.
> 서버 쪽 기능(결과 영구 저장, 통계, 상시 API 등)을 넣자는 제안이 나오면
> **왜 필요한지와 요금 영향을 먼저 설명**하고 결정하세요.

---

## 4. Cloudflare Pages (2순위)

Workers 배포가 계정 권한 등으로 막힐 때 **같은 `dist/`** 를 Pages 에 올립니다.

> **Pages 에는 실시간 참여가 올라가지 않습니다.** `wrangler pages deploy dist` 는
> `dist/` 폴더만 올리고 `worker/` 와 Durable Object 설정은 보지 않습니다.
> 게임은 전부 돌아가되 **참여 칸만 조용히 접힙니다** — `/ws` 와 `/api/*` 가 없기 때문입니다.
> 학생 폰 참여가 필요하면 1순위(Workers)로 배포하세요.

### 명령줄

```bash
npm run deploy:pages
# = npm run build:app && wrangler pages deploy dist --project-name brickpick
```

### GitHub 연결

Cloudflare 대시보드 → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git**

| 항목 | 값 |
|---|---|
| Production branch | `main` |
| Framework preset | **None** (Vite 프리셋을 쓰지 마세요 — 빌드 명령이 `npm run build` 로 바뀌어 라이브러리까지 빌드합니다) |
| Build command | `npm run build:app` |
| **Build output directory** | `dist` |
| Root directory | `/` |

환경변수는 Workers 와 같습니다 (`VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS`, `NODE_VERSION=22`).

Pages 도 `dist/_headers` 를 읽으므로 iframe 허용 설정이 그대로 적용됩니다.
`_redirects` 파일은 **만들지 않았습니다** — SPA 리다이렉트를 넣으면 `/embed/` 가
독립 실행 화면으로 바뀌고 오타 주소가 조용히 앱을 엽니다.

도메인 연결은 Pages 프로젝트 → **Custom domains** → **Set up a domain** 으로 같습니다.

---

## 5. Netlify (외부 대안)

Cloudflare 밖으로 옮겨야 할 분명한 사유가 있을 때를 위한 설정입니다.
[`netlify.toml`](../netlify.toml) 이 준비돼 있습니다.

> **Netlify 에도 실시간 참여는 올라가지 않습니다.** Durable Object 가 Cloudflare 전용이기
> 때문입니다. 단독 실행·iframe·npm 모듈은 전부 그대로 됩니다.

```toml
[build]
  command = "npm run build:app"
  publish = "dist"
[build.environment]
  NODE_VERSION = "22"
```

1. Netlify 에서 **Add new site** → **Import an existing project** → GitHub 저장소 선택
2. 빌드 명령과 publish 폴더는 `netlify.toml` 에서 자동으로 읽습니다.
3. **Site configuration** → **Environment variables** 에
   `VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS` 를 넣습니다.
4. 헤더는 `netlify.toml` 의 `[[headers]]` 와 `dist/_headers` 둘 다에 있습니다.
   수업 앱 주소는 **두 곳 모두** 고치세요.
5. 리다이렉트를 넣지 않았으므로 `/embed/` 직접 접근과 새로고침이 그대로 동작합니다.

### 보유 도메인을 Netlify 에 연결

Cloudflare 에서 도메인을 관리하면서 사이트만 Netlify 에 둘 수 있습니다.

1. Netlify → Site → **Domain management** → **Add a domain** → `brickpick.example.com`
2. Netlify 가 알려 주는 대상(`<사이트이름>.netlify.app`)을 확인합니다.
3. Cloudflare DNS 에서 **CNAME** 레코드를 만듭니다.

   | Type | Name | Target | Proxy |
   |---|---|---|---|
   | CNAME | `brickpick` | `<사이트이름>.netlify.app` | **DNS only (회색 구름)** |

   프록시(주황 구름)를 켜면 Netlify 의 인증서 발급이 실패할 수 있습니다.
4. Netlify 가 인증서를 발급할 때까지 기다린 뒤 `https://brickpick.example.com` 을 확인합니다.
5. **기존 레코드를 덮어쓰지 마세요.** `brickpick` 이름의 레코드가 이미 있는지 먼저 봅니다.

---

## 6. GitHub Pages — 하위 경로 배포

`https://<계정>.github.io/brickpick/` 처럼 **하위 경로**에 올릴 때는 base 를 바꿔야 합니다.

```bash
VITE_BASE=/brickpick/ npm run build:app
```

이렇게 하면 모든 자산 주소에 `/brickpick/` 가 붙습니다.

| | 주소 |
|---|---|
| 독립 실행 | `https://<계정>.github.io/brickpick/` |
| **임베드 진입점** | `https://<계정>.github.io/brickpick/embed/` |
| iframe `gameOrigin` | `https://<계정>.github.io` |
| iframe `embedPath` | `/brickpick/embed/` |

```js
createBrickPickHost({
  gameOrigin: 'https://<계정>.github.io',
  embedPath: '/brickpick/embed/',
  ...
})
```

**GitHub Pages 의 한계**

- 응답 헤더를 설정할 수 없습니다. → **`frame-ancestors` 를 지정할 수 없습니다.**
  GitHub Pages 는 `X-Frame-Options` 를 붙이지 않으므로 iframe 삽입 자체는 되지만,
  **아무 사이트나 감쌀 수 있는 상태**가 됩니다. 운영 임베드 용도로는 권장하지 않습니다.
  (postMessage origin 검증은 그대로 동작하므로 데이터가 새지는 않습니다.)
- `_headers` / `netlify.toml` 이 무시됩니다.
- 404 페이지는 저장소 설정에 따릅니다.
- **실시간 참여가 안 됩니다.** 정적 파일만 올라가므로 `/ws` 와 `/api/*` 가 없습니다.

독립 실행만 쓸 때, 또는 시연용으로만 쓰세요.

---

## 7. 문제가 생기면 — 원인을 구분하기

배포가 안 될 때 **네 가지를 구분**하세요. "로그인이 안 돼 있다" 는 이유만으로
"이 플랫폼에서는 배포할 수 없다" 고 결론짓지 마세요.

| 구분 | 증상 | 확인 방법 |
|---|---|---|
| **빌드 오류** | 배포 로그의 `npm run build:app` 단계에서 멈춤 | 로컬에서 `npm run verify` 가 통과하는지 |
| **계정 권한** | `wrangler deploy` 가 401/403 | `npx wrangler whoami` 로 계정 확인, 필요하면 `npx wrangler login` |
| **도메인 설정** | 배포는 됐는데 주소가 안 열림 | 기본 주소(`*.workers.dev`)는 열리는지 먼저 확인 |
| **플랫폼 제한** | 위 셋이 아닌데 안 됨 | 그때 비로소 대체 플랫폼 고려 |

### 자주 나오는 것

| 증상 | 원인 | 처방 |
|---|---|---|
| `/embed/` 가 404 | `dist/embed/index.html` 이 안 만들어졌다 | `vite.config.ts` 의 `rollupOptions.input` 에 embed 가 있는지, 빌드 로그 확인 |
| 없는 주소가 앱을 연다 | `not_found_handling` 이 `single-page-application` | `"404-page"` 로 (기본 설정이 그렇게 돼 있다) |
| 404 에서 빈 화면 | `dist/404.html` 이 없다 | `public/404.html` 이 있는지 확인 |
| iframe 이 빈 칸 | `frame-ancestors` 에 수업 앱 주소 없음 | `public/_headers` 고치고 **다시 배포** |
| iframe 은 뜨는데 메시지가 안 옴 | `VITE_BRICKPICK_ALLOWED_PARENT_ORIGINS` 누락 | 빌드 변수 넣고 **다시 빌드·배포** |
| 환경변수를 바꿨는데 그대로 | Vite 변수는 **빌드 시점에 박힌다** | 다시 배포 |
| 자산이 404 (하위 경로 배포) | `VITE_BASE` 를 안 줬다 | `VITE_BASE=/brickpick/` |
| Pages 빌드가 라이브러리까지 돈다 | Framework preset 이 Vite 로 잡혀 `npm run build` 가 됐다 | preset 을 None, 명령을 `npm run build:app` 으로 |

### 실시간 참여가 안 될 때

| 증상 | 원인 | 처방 |
|---|---|---|
| 교사 화면에 참여 칸이 아예 없다 | `/api/health` 가 응답하지 않는다 | 2-D 절의 `curl` 로 확인. Pages/Netlify 배포면 원래 안 된다 |
| `/api/health` 가 **HTML** 을 준다 | `run_worker_first` 목록에 `/api/*` 가 없다 | `wrangler.jsonc` 고치고 다시 배포 |
| 배포가 `new_classes ... paid plan` 으로 거절 | `migrations` 가 `new_classes` 다 | `new_sqlite_classes` 로 (2-E 절) |
| `Cannot find name 'DurableObject'` | Worker 타입 검사 설정 누락 | `npm run typecheck` 가 `tsconfig.worker.json` 도 돌리는지 확인 |
| 학생만 못 들어온다 (교사는 됨) | 학교 망이 WebSocket 을 막는다 | 데이터로 바꿔 시험. [live-mode.md](./live-mode.md) 5절 |
| 명단이 8일 뒤 비어 있다 | 방 보관 기간(TTL)이 지났다 | 정상 동작. 새 코드를 연다 |
| 교사 권한을 못 잡는다 | 원래 교사 기기가 **아직 붙어 있다** | 그 기기를 닫거나, 끊길 때까지 기다린다 ([protocol.md](./protocol.md) 8-5) |

---

## 8. 배포에 넣지 않은 것

- **호스팅 전용 API 를 `core` 에 넣지 않았습니다.** 엔진은 어느 플랫폼에 올리든 같습니다.
  실시간 참여가 생긴 뒤에도 `core` 는 `WebSocket` 도 Cloudflare 도 모릅니다.
- **비밀 키가 없습니다.** 클라이언트 빌드에도 저장소에도 들어가지 않습니다.
  (`wrangler secret` 같은 것을 쓸 일이 없습니다. 실시간 참여에도 API 키가 없습니다 —
  수업 코드 6자리가 전부입니다.)
- **`dist-lib/` 는 배포하지 않습니다.** npm 패키지용이고, 앱 배포에는 `dist/` 만 올립니다.
  `worker/` 도 npm 패키지에 들어가지 않습니다.
- **자산 요청마다 Worker 를 실행시키지 않습니다.** `run_worker_first` 는 `true` 가 아니라
  `["/ws", "/api/*"]` 목록입니다 (2-E 절).
- **외부 데이터베이스를 쓰지 않습니다.** 방 상태는 Durable Object 안에만 있고 8일 뒤
  자동으로 비워집니다. KV·D1·R2 를 붙이지 않았습니다.
- **로그인·계정이 없습니다.** 실시간 참여에도 없습니다.
- **SPA 리다이렉트를 넣지 않았습니다.** 멀티페이지 정적 사이트라 필요 없고,
  넣으면 오타 주소가 조용히 앱을 엽니다.
