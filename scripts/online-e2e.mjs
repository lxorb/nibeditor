/** The online terminal end to end, with no container and no Cloudflare resource
 *  (docs/online-terminal-live.md, "A drive against a local nibd"): the Worker under
 *  `wrangler dev`, its `Machine` linked to a `nibd` already listening on 127.0.0.1:7680
 *  with the secret `dev` (the image's, in CI's machine workflow), and the app's socket
 *  protocol driven as the app drives it (apps/desktop/src/lib/online/link.ts):
 *
 *  1. a session made the way a device on sync v1 makes one, `POST /v2/online/terms {}`;
 *  2. its socket opened, `echo` typed, the output read;
 *  3. the socket dropped while a command is still printing, and opened again with
 *     `since`: the rest arrives, and nothing drawn already;
 *  4. a second socket, a late joiner, is sent the screen;
 *  5. keystroke round trips, a key sent to its echo heard, at a quiet prompt and while a
 *     program prints all the time, which is what the coalescing in nibd is measured by.
 *
 *  Run from the repository's root: `node scripts/online-e2e.mjs`. Everything local goes
 *  into a temporary folder that is removed afterwards. */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SYNC = join(ROOT, 'services/sync')
const CONFIG = 'wrangler.jsonc'
const PORT = Number(process.env.E2E_PORT ?? 8788)
const BASE = `http://127.0.0.1:${PORT}`
const NIBD = process.env.E2E_NIBD ?? 'http://127.0.0.1:7680'
const TOKEN = 'e2e-token-0123456789abcdef'
const USER = 'e2e-user'
const DEVICE = 'e2edevice01'
const windows = process.platform === 'win32'
/** wrangler's own entry, run by this node: no shell between, so no argument is split. */
const WRANGLER = join(SYNC, 'node_modules/wrangler/bin/wrangler.js')

const state = mkdtempSync(join(tmpdir(), 'nib-online-e2e-'))
const vars = join(state, 'dev.vars')
let worker = null
/** Every socket opened, for the log when something fails. */
const opened = []

function log(...what) {
  console.log('[online-e2e]', ...what)
}

/** wrangler, from services/sync, waited for. */
function wrangler(args) {
  const done = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: SYNC,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  })
  if (done.status !== 0) {
    throw new Error(`wrangler ${args.join(' ')}: ${done.stdout}\n${done.stderr}`)
  }
  return done.stdout
}

function sql(command) {
  wrangler([
    'd1',
    'execute',
    'nib',
    '--local',
    '--persist-to',
    state,
    '--config',
    CONFIG,
    '--command',
    command,
  ])
}

const pause = (ms) => new Promise((settle) => setTimeout(settle, ms))

async function until(what, check, ms) {
  const end = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await pause(200)
  }
}

/** What the door answered a socket it would not take, for the log. */
function refusal(url) {
  return new Promise((settle) => {
    const asked = request(url.replace(/^ws/, 'http'), {
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'ZTJlZTJlZTJlZTJlZTJlMg==',
        'sec-websocket-protocol': `nib.token.${TOKEN}, nib.device.${DEVICE}`,
      },
    })
    asked.on('upgrade', () => settle('it upgraded the second time'))
    asked.on('response', (answer) => {
      let body = ''
      answer.on('data', (chunk) => (body += chunk))
      answer.on('end', () => settle(`${answer.statusCode} ${body}`))
    })
    asked.on('error', (error) => settle(String(error)))
    asked.end()
  })
}

/** One socket as the app opens one: the token and the device in the subprotocols, a
 *  `hello`, and everything it hears kept. */
async function socket(session, since) {
  const url = `${BASE.replace(/^http/, 'ws')}/v2/online/${encodeURIComponent(session)}/socket`
  const ws = new WebSocket(url, [`nib.token.${TOKEN}`, `nib.device.${DEVICE}`])
  ws.binaryType = 'arraybuffer'
  const heard = { frames: [], out: [], closed: false }
  /** Those waiting for output with something in it; see `echoOf`. */
  const waiting = new Set()
  opened.push(heard)
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      heard.frames.push(JSON.parse(event.data))
      return
    }
    const bytes = new Uint8Array(event.data)
    const seq = new DataView(bytes.buffer, bytes.byteOffset).getFloat64(0)
    const data = Buffer.from(bytes.subarray(8)).toString('utf8')
    heard.out.push({ seq, length: bytes.length - 8, data })
    for (const one of waiting) one(data)
  }
  ws.onclose = () => (heard.closed = true)
  await new Promise((opened, failed) => {
    ws.onopen = opened
    ws.onerror = () =>
      void refusal(url).then((why) => failed(new Error(`socket to ${url} failed: ${why}`)))
  })
  ws.send(
    JSON.stringify({ t: 'hello', cols: 100, rows: 30, ...(since === undefined ? {} : { since }) }),
  )
  return {
    heard,
    /** Everything printed, as the screen frames and the output say it. */
    text: () =>
      heard.frames
        .filter((one) => one.t === 'screen')
        .map((one) => one.data)
        .join('') + heard.out.map((one) => one.data).join(''),
    /** The offset after the last byte heard. */
    end: () => Math.max(0, ...heard.out.map((one) => one.seq + one.length)),
    type: (data) => ws.send(JSON.stringify({ t: 'in', data })),
    /** Input as bytes, as the app sends a key xterm.js encoded itself. */
    typeBytes: (data) => ws.send(new TextEncoder().encode(data)),
    close: () => ws.close(),
    /** Milliseconds from `key` sent to output with `key` in it heard. */
    echoOf: (key) =>
      new Promise((settle, failed) => {
        const from = performance.now()
        const timer = setTimeout(() => {
          waiting.delete(heardIt)
          failed(new Error(`no echo of ${JSON.stringify(key)}`))
        }, 10_000)
        const heardIt = (data) => {
          if (!data.includes(key)) return
          waiting.delete(heardIt)
          clearTimeout(timer)
          settle(performance.now() - from)
        }
        waiting.add(heardIt)
        ws.send(new TextEncoder().encode(key))
      }),
  }
}

/** Keystroke round trips on `on`, one key at a time with a typist's pause between. */
async function roundTrips(on, label) {
  const times = []
  for (let at = 0; at < 40; at++) {
    times.push(await on.echoOf('x'))
    await pause(40 + Math.random() * 60)
  }
  times.sort((a, b) => a - b)
  const pick = (share) => times[Math.min(times.length - 1, Math.floor(times.length * share))]
  const ms = (value) => `${value.toFixed(1)} ms`
  log(`echo ${label}: p50 ${ms(pick(0.5))}, p90 ${ms(pick(0.9))}, max ${ms(pick(1))}`)
}

async function main() {
  log('state in', state)
  await until(
    'nibd at ' + NIBD,
    () =>
      fetch(NIBD + '/health').then(
        (answer) => answer.ok,
        () => false,
      ),
    120_000,
  )
  // The built app is the Worker's assets; a drive of the API needs only the folder.
  mkdirSync(join(ROOT, 'apps/desktop/dist'), { recursive: true })
  writeFileSync(vars, `MACHINE_DEV_NIBD="${NIBD}"\nMACHINE_DEV_SECRET="dev"\n`)

  wrangler([
    'd1',
    'migrations',
    'apply',
    'nib',
    '--local',
    '--persist-to',
    state,
    '--config',
    CONFIG,
  ])
  const hash = createHash('sha256').update(TOKEN).digest('hex')
  const now = Date.now()
  sql("update online_service set value = 'on' where key = 'online'")
  sql(
    `insert into users (id, email, created_at, online) values ('${USER}', 'e2e@nib.test', ${now}, 1);
     insert into sessions (token_hash, user_id, created_at, expires_at, id, name, last_used_at)
       values ('${hash}', '${USER}', ${now}, ${now + 86_400_000}, 'e2e-session', 'e2e', ${now});`,
  )
  log('database ready')

  worker = spawn(
    process.execPath,
    [
      WRANGLER,
      'dev',
      '--config',
      CONFIG,
      '--local',
      '--enable-containers=false',
      '--ip',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--persist-to',
      state,
      '--env-file',
      vars,
      '--show-interactive-dev-session=false',
    ],
    {
      cwd: SYNC,
      detached: !windows,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    },
  )
  worker.stdout.on('data', (chunk) => process.stdout.write(`[wrangler] ${chunk}`))
  worker.stderr.on('data', (chunk) => process.stdout.write(`[wrangler] ${chunk}`))

  const api = (path, init = {}) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    })
  await until(
    'the Worker',
    () =>
      api('/v2/online/machine').then(
        (answer) => answer.status === 200,
        () => false,
      ),
    120_000,
  )
  log('Worker up')

  // 1. A session the way a device on sync v1 makes one: no file id.
  const made = await api('/v2/online/terms', { method: 'POST', body: '{}' })
  const term = await made.json()
  if (made.status !== 200 || term.v !== 1 || !term.machine || !term.session) {
    throw new Error(`POST /v2/online/terms {} answered ${made.status} ${JSON.stringify(term)}`)
  }
  log('session', term.session, 'on', term.machine)

  // 2. Opened, typed into, answered.
  const first = await socket(term.session)
  await until(
    'the machine awake',
    () => first.heard.frames.some((one) => one.t === 'machine' && one.state === 'awake'),
    60_000,
  )
  first.type('echo hi-$((6*7))\r')
  await until('hi-42 printed', () => first.text().includes('hi-42'), 30_000)
  first.typeBytes('echo bytes-$((5*5))\r')
  await until('bytes-25 printed', () => first.text().includes('bytes-25'), 30_000)
  log('typed and answered, as text and as bytes')

  // 3. Dropped while a command still prints, and back with `since`: the rest, and only it.
  first.type('sleep 3; echo later-$((7*6))\r')
  await pause(500)
  const since = first.end()
  first.close()
  await pause(5000)
  const back = await socket(term.session, since)
  await until('the rest after a reconnect', () => back.text().includes('later-42'), 30_000)
  const resent = back.heard.out.filter((one) => one.seq < since && one.seq + one.length <= since)
  if (back.text().includes('hi-42') || resent.length > 0) {
    throw new Error(
      `a reconnect from ${since} was sent what it drew: ${JSON.stringify(back.heard)}`,
    )
  }
  log('reconnected from', since, 'and got the rest')

  // 4. A late joiner, with nothing drawn, is sent the screen.
  const late = await socket(term.session)
  await until(
    'the late joiner’s screen',
    () => late.heard.frames.some((one) => one.t === 'screen') && late.text().includes('later-42'),
    30_000,
  )
  if (!late.text().includes('hi-42')) throw new Error('the late joiner’s screen is missing hi-42')
  log('late joiner got the screen')

  // 5. Keystroke round trips: at a quiet prompt, read by the line editor; and while a
  // loop prints a dot every few milliseconds, echoed by the kernel's line discipline.
  await roundTrips(back, 'at a quiet prompt')
  back.type('\x15')
  back.type('while :; do printf .; sleep 0.003; done\r')
  await pause(1000)
  await roundTrips(back, 'under steady output')
  back.type('\x03')
  await pause(500)

  back.close()
  late.close()
  log('passed')
}

/** The Worker stopped, and waited for, so its files can go. */
async function stop() {
  if (worker && worker.exitCode === null) {
    const exited = new Promise((settle) => worker.once('exit', settle))
    if (windows) spawnSync('taskkill', ['/PID', String(worker.pid), '/T', '/F'])
    else process.kill(-worker.pid, 'SIGTERM')
    await Promise.race([exited, pause(10_000)])
  }
  try {
    rmSync(state, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch (error) {
    log('left', state, String(error))
  }
}

let failed = false
try {
  await main()
} catch (error) {
  console.error('[online-e2e] FAILED:', error)
  for (const [at, heard] of opened.entries()) log(`socket ${at} heard`, JSON.stringify(heard))
  failed = true
}
await stop()
process.exit(failed ? 1 : 0)
