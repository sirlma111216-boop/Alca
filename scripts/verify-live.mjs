// 실시간 참여 왕복 검증 — 교사 1명 + 학생 3명으로 전체 흐름을 돌린다.
//
// 쓰는 법
//   1) 로컬:  npx wrangler dev --port 8787 --local   (다른 창에서)
//             node scripts/verify-live.mjs
//   2) 배포본: node scripts/verify-live.mjs https://brickpick.sirlma.workers.dev
//
// vitest 에 넣지 않은 이유: 서버(Worker)가 떠 있어야 하기 때문이다.
// 실시간 기능을 고친 뒤에는 반드시 한 번 돌려라.
// 주소를 인자로 줄 수 있다:  node scripts/verify-live.mjs https://brickpick.sirlma.workers.dev
const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/+$/, '')
const WS = BASE.replace(/^http/, 'ws')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

function open(code) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/ws?code=${code}`)
    const pending = new Map()
    let seq = 1
    const pushes = []
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.t === 'ack') {
        const cb = pending.get(m.i)
        if (cb) { pending.delete(m.i); cb(m.err ?? null, m.d) }
        return
      }
      pushes.push(m)
    })
    ws.addEventListener('open', () =>
      resolve({
        ws,
        pushes,
        req(t, d) {
          return new Promise((res, rej) => {
            const i = seq++
            pending.set(i, (err, data) => (err ? rej(new Error(err)) : res(data)))
            ws.send(JSON.stringify({ t, i, d }))
            setTimeout(() => pending.has(i) && (pending.delete(i), rej(new Error('timeout ' + t))), 5000)
          })
        },
        notify(t, d) { ws.send(JSON.stringify({ t, d })) },
        close() { ws.close() },
      }),
    )
    ws.addEventListener('error', () => reject(new Error('WebSocket 연결 실패')))
  })
}

const ok = (cond, msg) => log(`${cond ? '  ✔' : '  ✘ 실패 —'} ${msg}`)
let failures = 0
const must = (cond, msg) => { if (!cond) failures++; ok(cond, msg) }

const { code } = await fetch(`${BASE}/api/new-code`).then((r) => r.json())
log(`수업 코드: ${code}\n`)

// ── 교사가 방을 연다
const host = await open(code)
const hostToken = 'host-tok-1'
const j = await host.req('join', { token: hostToken, role: 'host' })
must(j.isHost === true, '교사가 진행 권한을 잡는다')
must(j.phase === 'lobby', '방이 lobby 상태로 시작한다')

// ── 학생 3명이 들어온다
const students = []
for (const [i, nick] of ['가람', '나래', '다올'].entries()) {
  const s = await open(code)
  const token = `demo-${i}-abc`
  const r = await s.req('join', { token, nick, role: 'student' })
  students.push({ s, token, nick })
  must(r.joined === i + 1, `학생 ${i + 1}명 참여 (${nick})`)
}

// ── 권한 없는 학생이 시작을 시도한다
let denied = false
try { await students[0].s.req('start', { token: students[0].token, match: { matchId: 'x', seed: 'S' } }) }
catch (e) { denied = /권한/.test(e.message) }
must(denied, '학생은 경기를 시작할 수 없다 (권한 거부)')

// ── 닉네임 다듬기
const bad = await open(code)
const badR = await bad.req('join', { token: 'demo-bad', nick: '  <script>공격</script>매우매우매우긴이름  ', role: 'student' })
const badNick = badR.members.find((m) => /공격|script/.test(m.nick))?.nick ?? ''
must(!badNick.includes('<') && !badNick.includes('>'), `닉네임에서 태그 기호 제거 → "${badNick}"`)
must(badNick.length <= 12, `닉네임 12자 제한 (${badNick.length}자)`)
await bad.req('leave', { token: 'demo-bad' })
bad.close()

// ── 교사가 경기를 시작한다
const matchId = 'm-test-1'
await host.req('start', {
  token: hostToken,
  match: { matchId, seed: 'SEED-LIVE', difficulty: 'normal', roundDurationMs: 15000, soundEnabled: false, reducedMotion: false },
})
await wait(300)
const gotMatch = students.every((x) => x.s.pushes.some((p) => p.t === 'match' && p.d.matchId === matchId))
must(gotMatch, '학생 전원이 match 신호를 받는다 (같은 seed)')
const seeds = new Set(students.map((x) => x.s.pushes.find((p) => p.t === 'match').d.seed))
must(seeds.size === 1 && seeds.has('SEED-LIVE'), '전원이 같은 seed 를 받는다')

// ── 학생들이 경기 중 점수를 올린다 (진짜 학생과 같은 시점: 800ms 마다)
for (let tick = 1; tick <= 3; tick++) {
  for (const [i, x] of students.entries()) {
    x.s.notify('score', { token: x.token, matchId, score: (i + 1) * 40 * tick, lives: 3, bricksDestroyed: tick * 2, progress: tick / 3 })
  }
  await wait(120)
}
await wait(900)
const board = [...host.pushes].reverse().find((p) => p.t === 'board')
must(!!board, '교사 화면이 board 방송을 받는다')
must(board?.d.members.some((m) => m.score > 0), '경기 중에 점수가 올라온다 (0 아님)')

// ── 지난 경기의 뒤늦은 메시지는 버린다
const stale = await students[0].s.req('score', { token: students[0].token, matchId: 'm-옛날', score: 99999, lives: 9, bricksDestroyed: 0, progress: 1 })
must(stale.ignored === true, '지난 matchId 의 메시지는 무시된다')

// ── 2명만 완주, 1명은 미완료
for (const x of students.slice(0, 2)) {
  await x.s.req('done', {
    token: x.token, matchId, score: x.nick === '가람' ? 320 : 180,
    livesRemaining: 2, bricksDestroyed: 14, playedMs: 15000, wavesCleared: 0, items: [],
  })
}
await wait(900)
const collected = await host.req('collect', { token: hostToken })
must(collected.finals.length === 3, '교사가 3명의 기록을 가져온다')
const doneCount = collected.finals.filter((f) => f.status === 'done').length
must(doneCount === 2, '완주 2명 / 미완료 1명이 구분된다')
must(collected.finals.find((f) => f.nick === '다올').final === null, '미완료자는 final 이 null (0점이 아님)')

// ── 결과 방송
await host.req('result', { token: hostToken, result: { matchId, selectedNicks: ['가람'], reasons: ['후보 2명 중 1위'], board: [] } })
await wait(300)
const gotResult = students.every((x) => x.s.pushes.some((p) => p.t === 'result'))
must(gotResult, '학생 전원이 결과를 받는다')

// ── 재접속: 같은 토큰으로 다시 붙으면 기록이 살아난다
students[0].s.close()
await wait(200)
const again = await open(code)
const back = await again.req('join', { token: students[0].token, nick: students[0].nick, role: 'student' })
must(back.members.find((m) => m.nick === '가람')?.score === 320, '같은 기기로 다시 들어오면 점수가 살아난다')
again.close()

// ── 데모봇 정리
await host.req('reset', { token: hostToken, what: 'demo' })
await wait(300)
const after = await host.req('collect', { token: hostToken })
must(after.finals.length === 0, 'reset demo 로 봇이 서버에서 전부 지워진다')

for (const x of students) x.s.close()
host.close()

log(`\n${failures === 0 ? '✔ 전부 통과' : `✘ ${failures}건 실패`}`)
process.exit(failures === 0 ? 0 : 1)
