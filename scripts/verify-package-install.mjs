#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════
 *  브릭픽 BrickPick — npm 패키지 설치 통합 검증
 *
 *  무엇을 확인하나
 *    "다른 수업 앱이 브릭픽을 npm 으로 설치해서 실제로 빌드할 수 있는가"를 끝까지 해 본다.
 *    타입 검사와 단위 테스트가 통과해도 여기서 걸리는 실수가 따로 있다.
 *      · package.json 의 files 에 빠진 파일이 있어 설치본에 안 들어감
 *      · exports 경로(./react, ./style.css)가 실제 산출물 이름과 다름
 *      · 타입 선언(dist-lib/types)이 생성되지 않음
 *    이런 건 "우리 저장소 안에서" 돌릴 때는 절대 안 드러난다. 그래서 진짜로 설치해 본다.
 *
 *  하는 일 (순서대로)
 *    1) npm run build:lib                         — 라이브러리 산출물을 만든다
 *    2) npm pack --pack-destination <임시폴더>     — 배포될 모습 그대로 .tgz 로 묶는다
 *    3) examples/react-host 에 그 .tgz 를 설치한다 — 남이 설치하는 것과 같은 경로
 *    4) examples/react-host 에서 npm install && npm run build
 *    5) 결과를 한국어로 알려 주고, 실패하면 종료 코드 1
 *
 *  쓰는 법
 *    node scripts/verify-package-install.mjs        (= npm run test:integration)
 *    node scripts/verify-package-install.mjs --keep (임시 파일·설치 상태를 남긴다)
 *
 *  ▣ 예제의 package.json 은 원래대로 되돌린다.
 *    3번에서 npm 이 examples/react-host/package.json 의 의존성을 임시 tarball 경로로
 *    바꿔 쓴다. 그대로 두면 저장소에 "내 컴퓨터의 임시 폴더 경로"가 커밋되므로,
 *    검증이 끝나면(실패해도) 원래 내용인 "brickpick": "file:../.." 로 복원한다.
 *    package-lock.json 도 같은 이유로 되돌리거나, 없던 것이면 지운다.
 *    examples/react-host/node_modules 와 dist 는 지우지 않는다(.gitignore 에 있다).
 *
 *  ▣ Windows 와 Linux 둘 다에서 돈다.
 *    경로는 전부 node:path 로 만들고, 셸 기능(&&, 와일드카드)에 기대지 않는다.
 *    spawnSync 는 shell:false 로 부른다. Windows 의 npm 은 배치 파일(npm.cmd)이라
 *    shell 없이는 실행이 거절되므로, npm 의 알맹이(npm-cli.js)를 node 로 직접 돌린다.
 *    자세한 사정은 아래 resolveNpmRunner() 주석에 적어 두었다.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, readdir, access } from 'node:fs/promises'
import { constants as FS, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// ── 기본 경로 ───────────────────────────────────────────────────────────────

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = path.resolve(SCRIPT_DIR, '..')
const EXAMPLE_DIR = path.join(PROJECT_DIR, 'examples', 'react-host')
const EXAMPLE_PKG = path.join(EXAMPLE_DIR, 'package.json')
const EXAMPLE_LOCK = path.join(EXAMPLE_DIR, 'package-lock.json')

const KEEP = process.argv.includes('--keep')

/**
 * npm 을 어떻게 부를지 정한다. 이 부분이 Windows 와 Linux 가 갈리는 유일한 자리다.
 *
 * Windows 의 'npm' 은 실행 파일이 아니라 배치 파일(npm.cmd)이다. 예전에는
 * spawnSync('npm.cmd', ...) 가 그냥 됐지만, Node 가 배치 파일 실행에 얽힌 보안 문제
 * (CVE-2024-27980)를 막으면서 **shell 없이는 EINVAL 로 거절**하게 바뀌었다.
 * 그렇다고 shell:true 를 쓰면 경로에 공백·한글·괄호가 있을 때 인자가 쪼개진다.
 *
 * 그래서 배치 파일을 건너뛰고 npm 의 알맹이(JavaScript)를 node 로 직접 실행한다.
 *   node <어딘가>/npm/bin/npm-cli.js  install ...
 * 이러면 Windows 와 Linux 가 같은 길을 타고, shell 을 전혀 거치지 않는다.
 *
 * @returns {{ file: string, prefix: string[], shell: boolean, label: string }}
 */
function resolveNpmRunner() {
  const nodeDir = path.dirname(process.execPath)
  const candidates = []

  // ① npm 이 이 스크립트를 부른 경우(npm run test:integration) npm 이 알려 준다.
  const fromEnv = process.env.npm_execpath
  if (fromEnv && fromEnv.endsWith('.js')) candidates.push(fromEnv)

  // ② Windows 기본 설치 위치
  candidates.push(path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  // ③ Linux·macOS 기본 설치 위치 (/usr/bin/node → /usr/lib/node_modules/...)
  candidates.push(path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))

  for (const cli of candidates) {
    if (existsSync(cli)) {
      return { file: process.execPath, prefix: [cli], shell: false, label: `node ${path.basename(cli)}` }
    }
  }

  // ④ 못 찾았을 때만 예전 방식으로 물러선다.
  //    Windows 에서는 배치 파일을 돌려야 하므로 shell 이 필요하다.
  //    (인자는 전부 우리가 만든 값이라 외부 입력이 섞이지 않는다)
  if (process.platform === 'win32') {
    return { file: 'npm.cmd', prefix: [], shell: true, label: 'npm.cmd (shell)' }
  }
  return { file: 'npm', prefix: [], shell: false, label: 'npm' }
}

const RUNNER = resolveNpmRunner()

// ── 출력 도우미 ─────────────────────────────────────────────────────────────

let stepNo = 0
const startedAt = Date.now()

function step(title) {
  stepNo += 1
  console.log('')
  console.log('─'.repeat(68))
  console.log(`[${stepNo}/5] ${title}`)
  console.log('─'.repeat(68))
}

function info(msg) {
  console.log(`      ${msg}`)
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}초`
}

/**
 * 명령을 실행하고 실패하면 사람이 읽을 오류를 던진다.
 * @param {string[]} args npm 에 넘길 인자
 * @param {{ cwd: string, capture?: boolean, label: string }} opts
 */
function npm(args, opts) {
  const shown = `npm ${args.join(' ')}`
  info(`실행: ${shown}`)
  info(`위치: ${path.relative(PROJECT_DIR, opts.cwd) || '.'}`)
  // 보통은 셸을 전혀 거치지 않는다(shell:false) — 경로에 공백·한글이 있어도 안전하다.
  const res = spawnSync(RUNNER.file, [...RUNNER.prefix, ...args], {
    cwd: opts.cwd,
    shell: RUNNER.shell,
    encoding: 'utf8',
    stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false' },
  })

  if (res.error) {
    if (res.error.code === 'ENOENT') {
      throw new Error(
        `npm 을 찾지 못했습니다(${RUNNER.label}). Node.js 와 npm 이 설치돼 있고 PATH 에 있는지 확인해 주세요.`,
      )
    }
    throw new Error(`${opts.label} 실행에 실패했습니다: ${res.error.message} (${RUNNER.label})`)
  }
  if (res.status !== 0) {
    throw new Error(`${opts.label} 이(가) 실패했습니다. (종료 코드 ${res.status}) — 위 출력에 원인이 있습니다.`)
  }
  return res.stdout ?? ''
}

async function exists(p) {
  try {
    await access(p, FS.F_OK)
    return true
  } catch {
    return false
  }
}

// ── 본체 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('')
  console.log('╔══════════════════════════════════════════════════════════════════╗')
  console.log('║  브릭픽 npm 패키지 설치 검증                                     ║')
  console.log('║  "다른 앱이 설치해서 빌드할 수 있는가"를 실제로 해 봅니다.       ║')
  console.log('╚══════════════════════════════════════════════════════════════════╝')
  info(`플랫폼: ${process.platform} / Node ${process.version} / npm 실행 방식: ${RUNNER.label}`)

  if (!(await exists(EXAMPLE_PKG))) {
    throw new Error(
      `예제 앱을 찾을 수 없습니다: ${EXAMPLE_PKG}\n` +
        '      examples/react-host 가 있어야 설치 검증을 할 수 있습니다.',
    )
  }

  // 되돌리기 위한 원본 보관. (문자열로 들고 있다가 finally 에서 그대로 다시 쓴다)
  const originalPkg = await readFile(EXAMPLE_PKG, 'utf8')
  const hadLock = await exists(EXAMPLE_LOCK)
  const originalLock = hadLock ? await readFile(EXAMPLE_LOCK, 'utf8') : null

  let tmpDir = null
  let restored = false

  const restore = async () => {
    if (restored) return
    restored = true
    if (KEEP) {
      console.log('')
      info('--keep 이 붙어 있어 예제의 package.json 을 되돌리지 않습니다.')
      info(`직접 확인해 보세요: ${EXAMPLE_DIR}`)
      return
    }
    await writeFile(EXAMPLE_PKG, originalPkg, 'utf8')
    if (originalLock !== null) await writeFile(EXAMPLE_LOCK, originalLock, 'utf8')
    else await rm(EXAMPLE_LOCK, { force: true })
    info('예제 앱의 package.json 을 원래 내용으로 되돌렸습니다.')
  }

  try {
    // ── 1) 라이브러리 빌드 ──────────────────────────────────────────────────
    step('라이브러리 빌드 (dist-lib/ 만들기)')
    npm(['run', 'build:lib'], { cwd: PROJECT_DIR, label: '라이브러리 빌드' })
    info('완료 — dist-lib/ 에 진입점과 타입 선언이 생겼습니다.')

    // ── 2) 패키지 묶기 ──────────────────────────────────────────────────────
    step('패키지 묶기 (npm pack — 배포될 모습 그대로 .tgz 로)')
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'brickpick-pack-'))
    info(`임시 폴더: ${tmpDir}`)

    const packOut = npm(['pack', '--json', '--pack-destination', tmpDir], {
      cwd: PROJECT_DIR,
      capture: true,
      label: '패키지 묶기(npm pack)',
    })

    let tarballName = null
    try {
      const parsed = JSON.parse(packOut)
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0].filename === 'string') {
        tarballName = parsed[0].filename
      }
    } catch {
      // npm 버전에 따라 --json 출력이 섞일 수 있다. 폴더를 직접 뒤져 찾는다.
    }
    if (!tarballName) {
      const files = (await readdir(tmpDir)).filter((f) => f.endsWith('.tgz'))
      if (files.length !== 1) {
        throw new Error(
          `묶인 패키지 파일(.tgz)을 찾지 못했습니다. 임시 폴더에 ${files.length}개가 있습니다.`,
        )
      }
      tarballName = files[0]
    }
    // npm pack 이 알려 주는 이름은 파일 이름뿐이라 임시 폴더와 합쳐 절대경로로 만든다.
    const tarball = path.join(tmpDir, path.basename(tarballName))
    if (!(await exists(tarball))) {
      throw new Error(`묶인 패키지 파일이 없습니다: ${tarball}`)
    }
    info(`묶음 완료: ${path.basename(tarball)}`)

    // ── 3) 예제 앱에 tarball 설치 ───────────────────────────────────────────
    step('예제 앱에 설치 (examples/react-host ← 방금 묶은 패키지)')
    info('여기서 예제의 package.json 이 임시 경로로 바뀝니다. 끝나면 되돌립니다.')
    npm(['install', tarball, '--no-audit', '--no-fund'], {
      cwd: EXAMPLE_DIR,
      label: '예제 앱에 브릭픽 설치',
    })
    info('완료 — 예제 앱의 node_modules/brickpick 이 방금 묶은 패키지입니다.')

    // ── 4) 예제 앱 빌드 ─────────────────────────────────────────────────────
    step('예제 앱 빌드 (나머지 의존성 설치 → vite 빌드)')
    npm(['install', '--no-audit', '--no-fund'], {
      cwd: EXAMPLE_DIR,
      label: '예제 앱 의존성 설치',
    })
    npm(['run', 'build'], { cwd: EXAMPLE_DIR, label: '예제 앱 빌드' })
    info('완료 — 설치한 패키지로 실제 앱이 빌드됐습니다.')

    // ── 5) 마무리 ───────────────────────────────────────────────────────────
    step('정리')
    await restore()

    console.log('')
    console.log('╔══════════════════════════════════════════════════════════════════╗')
    console.log('║  ✔ 통과 — 다른 앱이 브릭픽을 설치해서 빌드할 수 있습니다.        ║')
    console.log('╚══════════════════════════════════════════════════════════════════╝')
    info(`걸린 시간: ${seconds(Date.now() - startedAt)}`)
    info('확인된 것: files 목록 · exports 경로(./react, ./style.css) · 타입 선언 · 실제 빌드')
    console.log('')
    return 0
  } catch (err) {
    await restore().catch(() => {})
    console.log('')
    console.log('╔══════════════════════════════════════════════════════════════════╗')
    console.log('║  ✘ 실패 — 지금 상태로는 다른 앱이 설치해서 쓸 수 없습니다.       ║')
    console.log('╚══════════════════════════════════════════════════════════════════╝')
    console.error('')
    console.error(`      원인: ${err instanceof Error ? err.message : String(err)}`)
    console.error('')
    console.error('      자주 걸리는 자리')
    console.error('        · package.json 의 "files" 에 dist-lib 가 빠졌다')
    console.error('        · "exports" 의 경로가 dist-lib 의 실제 파일 이름과 다르다')
    console.error('        · npm run build:types 가 실패해 타입 선언이 없다')
    console.error('        · examples/react-host 의 의존성 버전이 맞지 않는다')
    console.error('')
    console.error(`      걸린 시간: ${seconds(Date.now() - startedAt)}`)
    console.error('')
    return 1
  } finally {
    if (tmpDir && !KEEP) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    } else if (tmpDir) {
      info(`임시 폴더를 남겨 둡니다: ${tmpDir}`)
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('')
    console.error(`[브릭픽] 검증 스크립트 자체가 멈췄습니다: ${err instanceof Error ? err.message : String(err)}`)
    console.error('')
    process.exit(1)
  })
