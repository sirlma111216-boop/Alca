# 브릭픽 BrickPick

**▶ 지금 바로 써 보기: https://brickpick.sirlma.workers.dev**

수업 참여자의 닉네임을 받아 **벽돌깨기 경기**를 치르고, 그 결과로 **발표자를 정하는** 웹 게임입니다.

1980~90년대 아케이드 벽돌깨기의 인상을 현대적으로 해석했습니다. 원작의 로고·스프라이트·음악·
효과음은 전혀 쓰지 않았고, 화면과 소리를 모두 코드로 그리고 합성합니다.

```
교사 혼자 진행    닉네임 입력  →  경기 방식·난이도  →  선정 규칙  →  규칙 요약  →  경기  →  결과

학생 폰 참여      수업 코드 띄우기  →  학생이 들어옴  →  설정  →  동시 경기  →  집계  →  결과
```

---

## 무엇을 할 수 있나

**경기 방식 두 가지**

- **자동 경기** — 참가자별로 독립된 경기장이 생기고 전부 동시에 진행됩니다.
  참가자는 조작하지 않고 관전합니다. 기본 30초(15/30/60초 선택).
  화면에 **"자동 경기 · 게임으로 진행하는 추첨"** 이라고 표시됩니다.
  결과는 실력 평가가 아니라 게임으로 진행하는 추첨입니다.
- **직접 조작** — 같은 기기에서 한 명씩 차례로 플레이합니다. 마우스·키보드·터치.
  전원이 끝나면 점수와 순위를 집계합니다. 1인 연습 플레이도 됩니다.

**발표자 선정 규칙 여섯 가지**

최고 성적 1명 · 최저 성적 1명 · 지정 순위 1명(예: 3위) · 상위 N명 · 하위 N명 ·
지정한 복수 순위(예: 2위, 5위, 8위)

**이미 발표한 사람 제외** — 제외한 뒤의 후보 순위를 기준으로 뽑습니다.
전체 순위와 후보 순위를 결과에 **둘 다** 담고, 화면에도 어느 기준인지 적습니다.

**아이템 7종** — 패들 확장 · 캐치 · 멀티볼 · 슬로우 · 레이저 · 보호막 · 추가 목숨.
벽돌을 부수면 캡슐이 떨어지고, **패들로 받아야** 효과가 적용됩니다.

**쓰는 방법 네 가지 (같은 게임 엔진)**

1. **독립 웹사이트** — 교사가 닉네임을 직접 입력하고 진행
2. **iframe 삽입** — 다른 수업 앱이 배포된 게임을 열고 참가자를 넘긴 뒤 결과를 받음
3. **코드 모듈** — npm 패키지로 설치해 컴포넌트/함수로 사용
4. **실시간 참여** — 교사가 6자리 수업 코드를 띄우면 **학생이 각자 폰으로** 들어와
   동시에 플레이하고, 점수가 교사 화면에 모여 발표자가 정해짐.
   계정·로그인·앱 설치 없음. → [docs/live-mode.md](docs/live-mode.md)

---

## 빠르게 시작하기

Node 22 이상이 필요합니다 (`.nvmrc` 참고).

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 을 엽니다.
임베드 화면은 `http://localhost:5173/embed/` 입니다.

### 실시간 참여까지 확인하려면

개발 서버는 정적 파일만 내려주므로 참여 칸이 접힌 채로 보입니다.
실시간 서버(`/ws`, `/api/*`)를 함께 띄우려면 이렇게 합니다.

```bash
npm run build:app
npx wrangler dev        # http://localhost:8787
```

`http://localhost:8787/api/health` 가 `{"ok":true,"live":true, ...}` 를 주면 준비된 것입니다.

### 전체 검증

```bash
npm run verify
```

타입 검사 → 테스트 → 앱 빌드 → 라이브러리 빌드를 차례로 돌립니다.

### 배포 결과를 그대로 확인

```bash
npm run build:app
npm run serve:dist
```

`http://localhost:4178` 과 `http://localhost:4178/embed/` 가 모두 열려야 합니다
(주소를 직접 입력하거나 새로고침해도 됩니다).

---

## 수업에서 쓰는 법 (독립 실행)

1. **참가자 입력** — 닉네임을 줄바꿈이나 쉼표로 한꺼번에 붙여 넣습니다.
   "예시 참가자 채우기" 로 먼저 연습해 볼 수 있습니다.
   같은 닉네임이 있어도 됩니다(화면에서 보조 번호로 구별합니다).
   기본 지원 범위는 1~40명입니다.
2. **경기 방식과 난이도** — 자동/직접, 쉬움·보통·어려움·사용자 설정, 경기 시간.
   아이템을 끄거나 개별로 조절할 수 있습니다. 예상 진행 시간이 표시됩니다.
3. **선정 규칙** — 여섯 가지 중 하나를 고르고, 이미 발표한 사람을 체크해 제외합니다.
4. **규칙 요약** — 점수표·동점 처리·난이도 수치·아이템·선정 규칙·seed 를 경기 전에 확인합니다.
   **시작하면 설정을 바꿀 수 없습니다.**
5. **경기** — 시작/일시정지/재개/취소, 소리 켜기·끄기, 전체 화면.
   실시간 순위와 남은 시간이 보입니다.
6. **결과** — 이번 발표자를 강조해 보여 주고, 점수·최종 순위·선정 기준·선정 이유를 함께 적습니다.
   전체 결과를 펼쳐 볼 수 있고, 결과 JSON 을 내려받거나 같은 설정으로 새 경기를 시작할 수 있습니다.

> 교실 프로젝터에서 닉네임·순위·남은 시간이 읽히도록 만들었습니다.
> 모션 감소 설정과 소리 끄기를 지원하며, 모든 조작은 키보드로도 가능합니다.

---

## 학생이 각자 폰으로 참여하기 (실시간)

교사가 닉네임을 대신 입력하지 않아도 됩니다. **6자리 수업 코드**만 띄우면 됩니다.

```
교사: [학생 폰으로 참여] → [새 수업 열기] → 코드·QR 이 뜬다 → 다 모이면 [시작]
학생: 주소를 열고 → 코드 6자리 + 닉네임 → 각자 폰에서 플레이
```

- **전원이 동시에 플레이합니다.** 30명도 30초면 끝납니다.
- **모두 똑같은 판**입니다. 같은 `seed` 로 벽돌·아이템 배치가 전부 같습니다.
- **계정·로그인·앱 설치가 없습니다.** 브라우저만 있으면 됩니다. 한 반 최대 40명.
- **서버에 올라가는 것은 닉네임과 점수뿐입니다.** 실명·학번·반은 올라가지 않고,
  8일 뒤 자동으로 사라집니다.
- **연결이 끊겨도 게임은 그대로 돌아갑니다.** 점수 모으기는 부가 기능입니다.
- 교사 기기가 새로고침돼도 **같은 코드로 다시 들어가면** 명단과 진행 권한이 돌아옵니다.

이 방식은 **배포된 주소(Cloudflare Workers)에서만** 됩니다. 정적 호스팅에 올리면
참여 칸이 조용히 접히고 나머지 기능은 그대로 동작합니다.

자세한 사용법·문제 해결·개인정보: **[docs/live-mode.md](docs/live-mode.md)**

---

## 정보 저장

- **단독 실행·iframe·모듈 방식에서는 참가자와 결과를 외부로 보내지 않습니다.**
  계정도 데이터베이스도 없습니다.
- **실시간 참여를 쓸 때만** 서버로 올라가는 것이 있습니다 — **닉네임과 점수뿐**입니다.
  실명·학번·반은 올라가지 않고, **8일 뒤 자동으로 사라집니다.**
  로그인은 여전히 없습니다([docs/live-mode.md](docs/live-mode.md) 6절).
- 기본으로 저장하는 것은 **소리·난이도·모션 감소 같은 환경설정뿐**입니다(브라우저 로컬 저장소).
- 참가자 명단과 결과를 남기려면 **"이 기기에 저장"** 을 눌러야 하며, **지우는 버튼**도 있습니다.
- 임베드/모듈 모드에서는 호스트(수업 앱)가 준 명단과 규칙을 게임이 임의로 바꾸지 않습니다.
- 닉네임은 항상 텍스트로 출력합니다(HTML 로 해석하지 않습니다).

점수는 브라우저에서 계산됩니다. **서버가 검증한 성적이 아닙니다.**
수업 중 발표자를 정하는 용도에는 충분하지만, 성적이 평가에 반영되는 상황에는 맞지 않습니다.

---

## 다른 수업 앱에 붙이기

가장 짧은 방법 두 가지입니다. 자세한 내용은 [docs/integration.md](docs/integration.md).

### iframe

```html
<iframe id="game" allow="fullscreen; autoplay"
        src="https://brickpick.example.com/embed/?parentOrigin=https%3A%2F%2Flesson.example.com">
</iframe>
```

```js
import { createBrickPickHost } from 'brickpick/host'

const host = createBrickPickHost({
  container: document.getElementById('game-box'),
  gameOrigin: 'https://brickpick.example.com',
  input: {
    sessionId: 'lesson-7:activity-3',
    participants: [{ id: 'stu_a1', nickname: '김민준' }, { id: 'stu_b2', nickname: '이서연' }],
    mode: 'auto',
    selectionRule: { kind: 'ranks', ranks: [3] },
    excludedParticipantIds: ['stu_b2'],
  },
  autoStart: true,
  onComplete: (result) => {
    // result.selectedParticipantIds 에 **우리가 준 ID 그대로** 들어 있다
    savePresenters(result.selectedParticipantIds)
  },
})
```

### React 컴포넌트

```tsx
import { BrickPick } from 'brickpick/react'
import 'brickpick/style.css'

<BrickPick
  participants={roster}                       // [{ id, nickname }]
  mode="auto"
  selectionRule={{ kind: 'top', count: 1 }}
  excludedParticipantIds={alreadyPresented}
  autoStart
  onComplete={(result) => savePresenters(result.selectedParticipantIds)}
/>
```

게임은 **선정 결과만 돌려줍니다.** 로그인·수업 관리·참가자 관리·발표 이력 저장은
수업 앱이 하던 대로 합니다. 게임이 다시 구현하지 않습니다.

---

## 문서

| 문서 | 내용 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 엔진과 어댑터 구조, 계층 규칙 |
| **[docs/live-mode.md](docs/live-mode.md)** | **학생 폰 실시간 참여 — 교사용 사용법, 문제 해결, 개인정보** |
| [docs/integration.md](docs/integration.md) | 모듈·iframe 연동 방법 |
| [docs/protocol.md](docs/protocol.md) | 데이터 타입, 메시지 순서, 오류 처리, 실시간 프로토콜(8절) |
| [docs/deployment.md](docs/deployment.md) | Cloudflare Workers / Pages / Netlify 배포와 도메인 연결 |
| [docs/game-rules.md](docs/game-rules.md) | 점수·난이도·아이템·순위·동점 규칙 |
| [docs/claude-code-handoff.md](docs/claude-code-handoff.md) | 다른 수업 앱에서 연동할 때 읽을 인수인계 문서 |

실행 가능한 예제: [`examples/html-host`](examples/html-host) (순수 HTML + iframe),
[`examples/react-host`](examples/react-host) (npm 패키지 설치)

---

## 명령 모음

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 (5173) |
| `npm run build:app` | 정적 사이트 → `dist/` |
| `npm run build:lib` | 라이브러리 → `dist-lib/` |
| `npm run typecheck` | 타입 검사 (앱 + **실시간 서버** 두 벌) |
| `npm test` | 테스트 |
| `npm run verify` | 타입 검사 + 테스트 + 빌드 전부 |
| `npm run serve:dist` | 빌드 결과를 정적 서버로 (4178). **실시간은 안 뜬다** |
| `npx wrangler dev` | 정적 파일 + **실시간 서버**를 함께 띄운다 (8787). 실시간 확인용 |
| `npm run test:integration` | 라이브러리를 예제 앱에 실제로 설치해 빌드 |
| `npm run deploy:workers` | Cloudflare Workers 배포 (정적 + **실시간 서버**) |
| `npm run deploy:pages` | Cloudflare Pages 배포 (정적만 — 실시간 없음) |

---

## 범위 밖

- **여러 학생이 같은 경기장을 함께 하는 멀티플레이** — 없습니다.
  실시간 참여(4번)는 학생들이 **각자 자기 경기장에서 똑같은 판을 따로** 하는 방식입니다.
  남의 공이 내 화면에 들어오지 않고, 서로의 패들이 보이지도 않습니다.
  같은 판에서 공을 주고받으려면 상태 동기화와 지연 보정이 필요한데,
  30초짜리 수업용 추첨에 그만한 구조를 들이지 않았습니다.
  (패들 입력을 서버로 왕복시키면 지연 때문에 게임 자체가 성립하지 않습니다 —
  이유는 [docs/live-mode.md](docs/live-mode.md) 2절에 있습니다.)
- **서버가 검증한 점수** — 없습니다. 점수는 실시간 모드에서도 **학생 폰에서** 계산됩니다.
  발표자를 뽑는 용도에는 충분하지만 **성적 반영 용도로는 쓰지 마세요.**
- **로그인·수업 관리·참가자 관리** — 수업 앱의 몫입니다.
  실시간 참여에도 계정과 데이터베이스는 없습니다(수업 코드 6자리가 전부입니다).

## 라이선스

MIT
