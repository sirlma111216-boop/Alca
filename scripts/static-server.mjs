#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════
 *  브릭픽 BrickPick — 로컬 정적 파일 서버 (의존성 0개, node 내장 모듈만 사용)
 *
 *  왜 있나
 *    `npm run build:app` 으로 만든 dist/ 를 **배포된 것과 같은 방식으로** 열어 보기 위해서다.
 *    vite preview 대신 이걸 쓰는 이유는 두 가지다.
 *      1) Cloudflare Workers Static Assets 의 주소 처리(auto-trailing-slash)를 흉내 낸다.
 *         → /embed 와 /embed/ 가 둘 다 열려야 한다. 이게 실제 배포에서 자주 터지는 자리다.
 *      2) dist/_headers 를 읽어 실제 응답 헤더를 그대로 붙인다.
 *         → iframe 허용 목록(CSP frame-ancestors)이 맞는지 로컬에서 확인할 수 있다.
 *
 *  쓰는 법
 *    node scripts/static-server.mjs                 (dist 폴더, 4178 포트)
 *    node scripts/static-server.mjs dist 4178
 *    node scripts/static-server.mjs dist 4178 --no-headers   (_headers 무시)
 *    npm run serve:dist
 *
 *  이 서버는 **로컬 확인 전용**이다. 127.0.0.1 에만 붙으므로 같은 네트워크의 다른
 *  기기에서는 열리지 않는다. 운영 배포에 쓰지 마라.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// ── 명령줄 인자 ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const positional = argv.filter((a) => !a.startsWith('--'))

const ROOT_ARG = positional[0] ?? 'dist'
const PORT = Number.parseInt(positional[1] ?? '4178', 10)
const USE_HEADERS_FILE = !flags.has('--no-headers')
const HOST = '127.0.0.1'

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`[브릭픽] 포트 번호가 올바르지 않습니다: ${positional[1]}`)
  process.exit(1)
}

// 이 스크립트가 어디서 실행되든 프로젝트 기준으로 폴더를 찾는다.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = path.resolve(SCRIPT_DIR, '..')
const ROOT = path.resolve(PROJECT_DIR, ROOT_ARG)

// ── 파일 종류(Content-Type) ─────────────────────────────────────────────────
// 여기 없는 확장자는 application/octet-stream 으로 내려간다(브라우저가 받아쓰기).

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
}

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

// ── _headers 파서 ───────────────────────────────────────────────────────────
//
// Cloudflare / Netlify 가 쓰는 형식이다.
//   · 맨 왼쪽에서 시작하는 줄  → 경로 규칙  (예: /embed/*)
//   · 들여쓴 줄                → 그 규칙의 헤더  (예: "  Referrer-Policy: no-referrer")
//   · # 로 시작하는 줄         → 주석
// 한 요청에 여러 규칙이 맞으면 **전부** 적용하고, 같은 헤더 이름은 나중 규칙이 이긴다.

/** @type {{ pattern: string, regex: RegExp, headers: Array<[string, string]> }[]} */
let headerRules = []

function globToRegExp(pattern) {
  // 정규식 특수문자를 먼저 막고, 그다음 우리가 지원하는 두 가지만 되살린다.
  //   *        → 아무 글자 0개 이상 (슬래시 포함)
  //   :이름    → 슬래시를 뺀 한 칸  (예: /files/:name)
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const body = escaped.replace(/\*/g, '.*').replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '[^/]+')
  return new RegExp(`^${body}$`)
}

function parseHeadersFile(text) {
  const rules = []
  let current = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.trim() === '' || line.trim().startsWith('#')) continue

    if (/^\s/.test(rawLine)) {
      // 들여쓴 줄 = 헤더. 앞선 경로 규칙이 없으면 버린다.
      if (!current) continue
      const colon = line.indexOf(':')
      if (colon <= 0) continue
      const name = line.slice(0, colon).trim()
      const value = line.slice(colon + 1).trim()
      if (name) current.headers.push([name, value])
      continue
    }

    // 들여쓰지 않은 줄 = 새 경로 규칙.
    const pattern = line.trim()
    current = { pattern, regex: globToRegExp(pattern), headers: [] }
    rules.push(current)
  }
  // 헤더가 하나도 없는 규칙은 의미가 없으므로 뺀다.
  return rules.filter((r) => r.headers.length > 0)
}

async function loadHeaderRules() {
  if (!USE_HEADERS_FILE) return []
  const file = path.join(ROOT, '_headers')
  try {
    const text = await readFile(file, 'utf8')
    const rules = parseHeadersFile(text)
    console.log(`[브릭픽] _headers 읽음 — 규칙 ${rules.length}개 (${path.relative(PROJECT_DIR, file)})`)
    return rules
  } catch {
    console.log('[브릭픽] _headers 가 없어 기본 헤더만 붙입니다. (npm run build:app 을 먼저 돌리세요)')
    return []
  }
}

/** 요청 경로에 맞는 헤더들을 모은다. 같은 이름은 뒤 규칙이 덮어쓴다. */
function headersForPath(urlPath) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const rule of headerRules) {
    if (!rule.regex.test(urlPath)) continue
    for (const [name, value] of rule.headers) out[name] = value
  }
  return out
}

// ── 주소 → 파일 찾기 (Cloudflare auto-trailing-slash 흉내) ──────────────────

async function statFile(p) {
  try {
    const s = await stat(p)
    return s.isFile() ? s : null
  } catch {
    return null
  }
}

/**
 * @returns {Promise<
 *   | { kind: 'file', file: string, stat: import('node:fs').Stats }
 *   | { kind: 'redirect', to: string }
 *   | { kind: 'not-found' }
 * >}
 */
async function resolveRequest(urlPath) {
  // 1) %ED%95%9C%EA%B8%80 같은 인코딩을 풀고, 경로를 정규화한다.
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return { kind: 'not-found' }
  }
  if (decoded.includes('\0')) return { kind: 'not-found' }

  // 2) 상위 폴더 탈출(../)을 막는다. 정규화한 뒤 루트 밖이면 거절.
  const normalized = path.posix.normalize(decoded)
  if (normalized.startsWith('..')) return { kind: 'not-found' }
  const relative = normalized.replace(/^\/+/, '')
  const target = path.resolve(ROOT, relative)
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return { kind: 'not-found' }

  // 3) 끝이 / 인 주소(= 디렉터리 요청) → 그 안의 index.html
  if (normalized.endsWith('/')) {
    const index = path.join(target, 'index.html')
    const s = await statFile(index)
    return s ? { kind: 'file', file: index, stat: s } : { kind: 'not-found' }
  }

  // 4) 파일이 그대로 있으면 그것을 준다. (/assets/app-abc123.js 등)
  const direct = await statFile(target)
  if (direct) return { kind: 'file', file: target, stat: direct }

  // 5) 확장자 없는 주소 → 같은 이름의 .html  (/about → /about.html)
  if (path.extname(target) === '') {
    const asHtml = await statFile(`${target}.html`)
    if (asHtml) return { kind: 'file', file: `${target}.html`, stat: asHtml }

    // 6) 그다음 폴더의 index.html  (/embed → /embed/index.html)
    //    Cloudflare 는 여기서 끝 슬래시를 붙인 주소로 넘겨 준다(auto-trailing-slash).
    //    그 동작을 그대로 따라 해야 상대경로 자산이 배포와 같은 방식으로 풀린다.
    const index = await statFile(path.join(target, 'index.html'))
    if (index) return { kind: 'redirect', to: `${normalized}/` }
  }

  return { kind: 'not-found' }
}

// ── 응답 ────────────────────────────────────────────────────────────────────

function send(res, status, urlPath, extraHeaders, body) {
  const headers = { ...headersForPath(urlPath), ...extraHeaders }
  res.writeHead(status, headers)
  if (body === undefined) res.end()
  else res.end(body)
}

async function sendFile(req, res, urlPath, status, file, fileStat) {
  const headers = {
    ...headersForPath(urlPath),
    'Content-Type': contentTypeFor(file),
    'Content-Length': String(fileStat.size),
    'Last-Modified': fileStat.mtime.toUTCString(),
  }
  res.writeHead(status, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(file)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

async function handle(req, res) {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    send(res, 405, '/', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' },
      '이 서버는 GET 과 HEAD 만 처리합니다.')
    return
  }

  // 쿼리(?parentOrigin=...)는 파일 찾기에 쓰지 않는다. 그대로 브라우저가 읽는다.
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
  const urlPath = url.pathname

  const resolved = await resolveRequest(urlPath)

  if (resolved.kind === 'redirect') {
    const to = resolved.to + url.search
    send(res, 308, urlPath, { Location: to, 'Content-Type': 'text/plain; charset=utf-8' },
      `끝 슬래시를 붙인 주소로 이동합니다: ${to}`)
    console.log(`  308  ${urlPath} → ${to}`)
    return
  }

  if (resolved.kind === 'file') {
    await sendFile(req, res, urlPath, 200, resolved.file, resolved.stat)
    console.log(`  200  ${urlPath}`)
    return
  }

  // 없는 주소 → wrangler.jsonc 의 not_found_handling: "404-page" 와 같게,
  // 루트의 404.html 을 404 상태로 돌려준다. 앱을 대신 열어 주지 않는다.
  const notFoundPage = path.join(ROOT, '404.html')
  const s = await statFile(notFoundPage)
  if (s) {
    await sendFile(req, res, urlPath, 404, notFoundPage, s)
  } else {
    send(res, 404, urlPath, { 'Content-Type': 'text/html; charset=utf-8' },
      '<!doctype html><meta charset="utf-8"><title>404</title>' +
      '<body style="font-family:system-ui;background:#0b1020;color:#e8ecff;padding:40px">' +
      '<h1>404 — 그런 주소는 없습니다</h1>' +
      '<p>브릭픽의 주소는 <code>/</code> 와 <code>/embed/</code> 두 곳입니다.</p></body>')
  }
  console.log(`  404  ${urlPath}`)
}

// ── 시작 ────────────────────────────────────────────────────────────────────

async function main() {
  const rootStat = await stat(ROOT).catch(() => null)
  if (!rootStat || !rootStat.isDirectory()) {
    console.error(`[브릭픽] 폴더를 찾을 수 없습니다: ${ROOT}`)
    console.error('        먼저 빌드하세요:  npm run build:app')
    process.exit(1)
  }

  headerRules = await loadHeaderRules()

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[브릭픽] 처리 중 오류:', err)
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('서버 오류')
    })
  })

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`[브릭픽] ${PORT} 포트를 이미 다른 프로그램이 쓰고 있습니다.`)
      console.error(`        다른 포트로 여세요:  node scripts/static-server.mjs ${ROOT_ARG} ${PORT + 1}`)
    } else {
      console.error('[브릭픽] 서버를 열지 못했습니다:', err)
    }
    process.exit(1)
  })

  server.listen(PORT, HOST, () => {
    console.log('')
    console.log('  브릭픽 로컬 서버가 열렸습니다.')
    console.log(`    제공 폴더 : ${ROOT}`)
    console.log(`    독립 실행 : http://${HOST}:${PORT}/`)
    console.log(`    임베드    : http://${HOST}:${PORT}/embed/   (끝 슬래시 없이도 열립니다)`)
    console.log('')
    console.log('  끄려면 Ctrl+C.')
    console.log('')
  })

  const shutdown = () => {
    console.log('\n[브릭픽] 서버를 닫습니다.')
    server.close(() => process.exit(0))
    // 연결이 남아 있어도 오래 붙잡지 않는다.
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
