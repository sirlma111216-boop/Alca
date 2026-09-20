# 예제 2 — React 호스트 (npm 패키지로 설치해 쓰기)

브릭픽을 **npm 패키지로 설치해서** 수업 앱 안에 직접 넣는 예제입니다.
iframe 이 아니라 같은 페이지 안에서 돌기 때문에 메시지를 주고받을 일이 없습니다.
콜백으로 결과를 바로 받습니다.

같은 게임을 붙이는 두 가지 길을 나란히 보여 줍니다.

| 길 | 가져오는 곳 | 언제 쓰나 |
| --- | --- | --- |
| `<BrickPick {...옵션} />` | `brickpick/react` | 수업 앱이 React 일 때 |
| `mountBrickPick(요소, 옵션)` | `brickpick` | React 를 쓰지 않을 때 (Vue·Svelte·순수 JS) |

둘은 **완전히 같은 옵션**을 받고 **완전히 같은 결과**를 돌려줍니다.
화면에서 ①과 ②를 번갈아 눌러 확인해 보세요.

---

## 실행 방법

### 1) 라이브러리를 먼저 빌드합니다

이 예제는 저장소 루트를 `file:../..` 로 설치합니다.
즉 **빌드 산출물(`dist-lib/`)이 있어야** 불러올 수 있습니다.

저장소 루트에서:

```
npm install
npm run build:lib
```

### 2) 예제를 설치하고 띄웁니다

이 폴더(`examples/react-host`)에서:

```
npm install
npm run dev
```

`http://localhost:5174/` 가 열립니다.

### 3) 빌드해 보기

```
npm run build      # dist/ 를 만든다
npm run preview    # 빌드 결과를 열어 본다
npm run typecheck  # 타입 선언(dist-lib/types)이 제대로 붙는지 확인한다
```

---

## `file:../..` 에 대해

`package.json` 의 의존성은 이렇게 돼 있습니다.

```json
"dependencies": {
  "brickpick": "file:../.."
}
```

- npm 이 저장소 루트를 `node_modules/brickpick` 에 **심볼릭 링크**로 걸어 줍니다.
- 그래서 npm 에 공개 게시하지 않아도, 남이 설치한 것과 **같은 경로**로 불러오게 됩니다.
  (`brickpick`, `brickpick/react`, `brickpick/style.css` — 전부 `package.json` 의 `exports` 를 탑니다.)
- 루트에서 `npm run build:lib` 을 다시 돌리면 이 예제에도 바로 반영됩니다. 재설치할 필요가 없습니다.

링크 때문에 React 가 두 벌 로드되어 `Invalid hook call` 이 나는 일이 있어서,
`vite.config.ts` 에 `resolve.dedupe: ['react', 'react-dom']` 을 적어 두었습니다.

### 설치 검증 스크립트를 돌리면

저장소 루트의 `npm run test:integration` (= `node scripts/verify-package-install.mjs`) 은
이 예제를 **진짜 tarball 설치**로 한 번 더 검증합니다.

1. `npm run build:lib`
2. `npm pack` 으로 배포될 모습 그대로 `.tgz` 를 만들고
3. 이 폴더에 그 `.tgz` 를 설치한 다음
4. `npm install && npm run build` 가 되는지 확인합니다.

**그 과정에서 이 폴더의 `package.json` 이 임시 tarball 경로로 잠깐 바뀝니다.**
스크립트가 끝날 때(실패해도) 원래 내용인 `"brickpick": "file:../.."` 으로 **되돌립니다.**
`package-lock.json` 도 같이 되돌리거나, 원래 없던 것이면 지웁니다.
`node_modules` 와 `dist` 는 그대로 둡니다(둘 다 `.gitignore` 에 있습니다).
다만 검증 직후의 `node_modules/brickpick` 은 **심볼릭 링크가 아니라 tarball 을 푼 복사본**입니다.
다시 링크로 돌리려면 이 폴더에서 `npm install` 을 한 번 더 돌리세요.

되돌리기 전 상태를 직접 보고 싶으면 `--keep` 을 붙여 실행하세요.

```
node scripts/verify-package-install.mjs --keep
```

그렇게 남긴 뒤에는 `git checkout examples/react-host/package.json` 으로 직접 되돌리면 됩니다.

---

## 옵션 바꿔 보기

`src/App.tsx` 의 `options` 하나만 고치면 됩니다.

```ts
selectionRule: { kind: 'top', count: 1 }       // 최고 성적 1명
selectionRule: { kind: 'bottom', count: 1 }    // 최저 성적 1명
selectionRule: { kind: 'ranks', ranks: [2, 5] } // 2위와 5위
```

- `mode: 'auto'` 는 모두가 동시에 자동으로 플레이합니다. `'manual'` 은 한 명씩 직접 조작합니다.
- `excludedParticipantIds` 에 넣은 사람은 순위에는 남고 **선정에서만** 빠집니다.
- `seed` 가 같고 설정이 같으면 결과가 같습니다. 수업 회차 이름을 그대로 쓰면 재현하기 좋습니다.
- `reducedMotion: true` 는 OS 설정과 별개로 화면 효과를 줄입니다.

---

## 정리(destroy)를 빼먹지 마세요

`mountBrickPick` 으로 직접 붙였다면, 화면을 떠날 때 반드시 정리해야 합니다.
타이머·오디오·`requestAnimationFrame` 이 남아 계속 돕니다.

```ts
const controller = mountBrickPick(el, options)
// ...
controller.destroy()   // 여러 번 불러도 안전하다
```

`<BrickPick />` 컴포넌트는 언마운트될 때 알아서 정리합니다.

---

## 자주 막히는 자리

**`Failed to resolve import "brickpick"`**
→ 루트에서 `npm run build:lib` 을 아직 돌리지 않았습니다. `dist-lib/` 가 있어야 합니다.

**게임이 글자만 쌓인 모습으로 나온다**
→ `src/main.tsx` 의 `import 'brickpick/style.css'` 가 빠졌습니다.

**`Invalid hook call`**
→ React 가 두 벌 로드된 것입니다. `vite.config.ts` 의 `resolve.dedupe` 를 확인하세요.

**`package.json` 에 낯선 임시 경로가 들어 있다**
→ 설치 검증 스크립트가 `--keep` 으로 돌았거나 중간에 강제로 멈췄습니다.
`"brickpick": "file:../.."` 으로 되돌리면 됩니다.
