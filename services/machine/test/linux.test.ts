/** `nibd` on Linux with real shells (docs/online-terminal.md 6.2, lane 2): an echo; a
 *  late joiner's screen against a watcher that saw everything, with vim on the second
 *  screen and colours mid-stream; a reconnect inside and outside the kept megabyte; the
 *  program in front; activity counted; the screens back after SIGTERM and a restart; a
 *  fork bomb contained. CI runs these on ubuntu-latest; elsewhere they are skipped. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import type { NibdFrame } from '@nib/online/wire'
import { KEPT } from '../src/ring'
import { sessionProcesses } from '../src/proc'
import { Nibd } from '../src/nibd'
import { Session, type Machine } from '../src/session'
import { cells, terminal, text, written } from './cells'
import { bytes, healthy, linked, until } from './link'

const linux = process.platform === 'linux'
const COLS = 100
const ROWS = 30
const here = join(import.meta.dirname, '..')

let home: string
const ended: { end: () => void }[] = []

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'nibd-home-'))
})
afterEach(() => {
  for (const one of ended.splice(0)) one.end()
})
afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

/** A machine whose link is a list. */
function machine(pidsMax = 4096): Machine & { frames: NibdFrame[] } {
  const frames: NibdFrame[] = []
  return {
    shell: '/bin/bash',
    home,
    user: null,
    env: {
      HOME: home,
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      TERM: 'xterm-256color',
      LANG: 'C.UTF-8',
    },
    pidsMax,
    cgroups: null,
    frames,
    send: (frame) => frames.push(frame),
  }
}

function session(on: Machine, id = 's_test'): Session {
  const one = new Session(id, COLS, ROWS, on)
  ended.push(one)
  return one
}

/** A terminal fed every output frame of a session in order, as a device watching from
 *  the start draws it; it checks that the offsets run on without a gap. */
function watcher(frames: NibdFrame[], from = 0) {
  const term = terminal(COLS, ROWS)
  let read = from
  let next = 0
  return {
    term,
    get next() {
      return next
    },
    /** Every frame that has arrived since the last call, drawn. */
    async caught(): Promise<void> {
      for (; read < frames.length; read++) {
        const frame = frames[read]
        if (frame?.t !== 'out') continue
        if (frame.seq + frame.data.length <= next) continue
        expect(frame.seq).toBe(next)
        next = frame.seq + frame.data.length
        await written(term, frame.data)
      }
    },
  }
}

/** Until nothing has arrived for a while: the program has drawn what it will. */
async function settled(frames: NibdFrame[], quiet = 600): Promise<void> {
  let seen = -1
  let since = Date.now()
  await until(() => {
    if (frames.length !== seen) {
      seen = frames.length
      since = Date.now()
    }
    return Date.now() - since > quiet
  }, 60_000)
}

async function typed(one: Session, frames: NibdFrame[], keys: string): Promise<void> {
  one.input(bytes(keys))
  await settled(frames)
}

describe.runIf(linux)('a session', () => {
  test('echoes what is typed', async () => {
    const on = machine()
    const one = session(on)
    const seen = watcher(on.frames)
    one.input(bytes('echo nib-$((6*7))\r'))
    await until(async () => {
      await seen.caught()
      return text(seen.term).includes('nib-42')
    })
  })

  test('a late joiner past the kept megabyte draws what a watcher saw, vim and colours', async () => {
    const on = machine()
    const one = session(on)
    const seen = watcher(on.frames)
    await typed(one, on.frames, 'seq 1 200000; echo counted-$((1+1))\r')
    await until(async () => {
      await seen.caught()
      return text(seen.term).includes('counted-2')
    }, 60_000)
    expect(seen.next).toBeGreaterThan(KEPT)
    await typed(
      one,
      on.frames,
      "printf '\\e[1;31mred \\e[38;5;200mpink \\e[38;2;1;2;3;48;5;22mtrue\\e[0m plain \\e[4mline\\n'\r",
    )
    await typed(one, on.frames, 'vim -u NONE -N -i NONE notes.txt\r')
    await typed(one, on.frames, 'ihello from vim\x1b')
    await typed(one, on.frames, ':set number\r')
    await seen.caught()

    const asked = on.frames.length
    await one.want(0)
    const answer = on.frames[asked]
    expect(answer?.t).toBe('screen')
    if (answer?.t !== 'screen') return
    const joiner = terminal(answer.cols, answer.rows)
    await written(joiner, answer.data)
    let next = answer.seq

    // The stream after the screen: more typing in vim, drawn by both.
    await typed(one, on.frames, 'ojoined\x1b')
    await seen.caught()
    for (const frame of on.frames.slice(asked + 1)) {
      if (frame.t !== 'out') continue
      expect(frame.seq).toBe(next)
      next += frame.data.length
      await written(joiner, frame.data)
    }
    expect(joiner.buffer.active.type).toBe('alternate')
    expect(text(joiner)).toContain('joined')
    expect(cells(joiner)).toEqual(cells(seen.term))
    await typed(one, on.frames, ':q!\r')
  })

  test('a reconnect inside the kept megabyte is sent the bytes it missed, outside it the screen', async () => {
    const on = machine()
    const one = session(on)
    const seen = watcher(on.frames)
    await typed(one, on.frames, 'echo first\r')
    await seen.caught()
    const drew = seen.next
    const behind = terminal(COLS, ROWS)
    await written(behind, collected(on.frames, 0, drew))

    await typed(one, on.frames, 'printf "\\e[32msecond\\e[0m\\n"\r')
    await seen.caught()
    const asked = on.frames.length
    await one.want(drew)
    const answer = on.frames[asked]
    expect(answer).toMatchObject({ t: 'out', seq: drew })
    if (answer?.t !== 'out') return
    await written(behind, answer.data)
    expect(cells(behind)).toEqual(cells(seen.term))

    await typed(one, on.frames, 'head -c 1300000 /dev/zero | tr "\\0" x; echo\r')
    await seen.caught()
    const again = on.frames.length
    await one.want(drew)
    expect(on.frames[again]?.t).toBe('screen')
  })

  test('says the program in front, and the shell again after it', async () => {
    const on = machine()
    const one = session(on)
    one.input(bytes('sleep 30\r'))
    await until(() => on.frames.some((frame) => frame.t === 'program' && frame.name === 'sleep'))
    one.input(bytes('\x03'))
    await until(() => {
      const last = on.frames.filter((frame) => frame.t === 'program').at(-1)
      return last?.t === 'program' && last.name === null
    })
  })

  test('a fork bomb is held at the process limit, and ending the session ends all of it', async () => {
    const mine = spawnSync('ps', [
      '-L',
      '-u',
      String(process.getuid?.()),
      '-o',
      'lwp=',
    ]).stdout.toString()
    const limit = mine.split('\n').filter(Boolean).length + 150
    const on = machine(limit)
    const one = session(on, 's_bomb')
    const shell = (one as unknown as { pty: { pid: number } }).pty.pid
    one.input(bytes('b() { b | b & }; b\r'))
    await new Promise((resolve) => setTimeout(resolve, 4000))
    expect(sessionProcesses(shell).length).toBeLessThanOrEqual(limit)

    // nibd, outside the limit, still answers and still starts programs; the sessions'
    // user is the one held, until the owner ends the session.
    const asked = on.frames.length
    await one.want(0)
    expect(on.frames[asked]?.t).toMatch(/^(out|screen)$/)
    expect(spawnSync('true').status).toBe(0)

    one.end()
    await until(() => sessionProcesses(shell).length === 0)

    const next = machine(limit)
    const after = session(next, 's_after')
    const seen = watcher(next.frames)
    after.input(bytes('echo still-$((2+3))\r'))
    await until(async () => {
      await seen.caught()
      return text(seen.term).includes('still-5')
    })
  })
})

/** The output frames' bytes between two offsets, joined. */
function collected(frames: NibdFrame[], from: number, to: number): Uint8Array {
  const parts: Uint8Array[] = []
  for (const frame of frames) {
    if (frame.t !== 'out') continue
    const start = Math.max(from, frame.seq)
    const end = Math.min(to, frame.seq + frame.data.length)
    if (end > start) parts.push(frame.data.subarray(start - frame.seq, end - frame.seq))
  }
  return Buffer.concat(parts)
}

describe.runIf(linux)('the machine', () => {
  test('counts the output and the CPU of the last stretch', async () => {
    const state = mkdtempSync(join(tmpdir(), 'nibd-state-'))
    const frames: NibdFrame[] = []
    const nibd = new Nibd({
      ...machine(),
      state,
      activityEvery: 60_000,
      homeEvery: 60 * 60_000,
    })
    ended.push({ end: () => nibd.stop() })
    nibd.attach((frame) => frames.push(frame))
    await nibd.receive({ t: 'open', session: 's_busy', cols: COLS, rows: ROWS })
    nibd.activity()
    await nibd.receive({
      t: 'in',
      session: 's_busy',
      data: bytes('timeout 3 sh -c "while :; do :; done"; echo spun\r'),
    })
    await until(() =>
      frames.some((frame) => frame.t === 'out' && Buffer.from(frame.data).includes('spun\r\n')),
    )
    const activity = nibd.activity()
    expect(activity.output).toBeGreaterThan(0)
    expect(activity.cpu).toBeGreaterThan(0.01)
    expect(nibd.activity().output).toBe(0)
    rmSync(state, { recursive: true, force: true })
  })
})

describe.runIf(linux)('nibd, the program', () => {
  const SECRET = 'boot-secret'
  let state: string
  let child: ChildProcess | null = null

  beforeAll(() => {
    const built = spawnSync(process.execPath, ['build.ts'], { cwd: here, stdio: 'inherit' })
    expect(built.status).toBe(0)
    state = mkdtempSync(join(tmpdir(), 'nibd-boot-'))
  })
  afterAll(() => {
    child?.kill('SIGKILL')
    rmSync(state, { recursive: true, force: true })
  })

  async function booted(url: string, port: number): Promise<ChildProcess> {
    const started = spawn(process.execPath, [join(here, 'dist', 'nibd.cjs')], {
      env: {
        ...process.env,
        HOME: home,
        SHELL: '/bin/bash',
        NIBD_SECRET: SECRET,
        NIBD_PORT: String(port),
        NIBD_HOST: '127.0.0.1',
        NIBD_STATE: state,
      },
      stdio: 'inherit',
    })
    await healthy(url)
    return started
  }

  test('saves every screen on SIGTERM and draws it back after the next boot', async () => {
    const port = await freePort()
    const url = `ws://127.0.0.1:${String(port)}`
    child = await booted(url, port)
    const link = await linked(url, SECRET)
    link.send({ t: 'open', session: 's_kept', cols: COLS, rows: ROWS })
    link.send({
      t: 'in',
      session: 's_kept',
      data: bytes('cd /tmp; echo kept-$((40+2)) "secret=${NIBD_SECRET:-none}"\r'),
    })
    await until(() => link.text('s_kept').includes('kept-42'))
    // The secret opens the link and nothing else: no shell is handed it.
    expect(link.text('s_kept')).toContain('secret=none')

    const exited = new Promise<number | null>((resolve) => child?.once('exit', resolve))
    child.kill('SIGTERM')
    expect(await exited).toBe(0)
    expect(readdirSync(join(state, 'sessions'))).toEqual(['s_kept.json'])
    const saved = JSON.parse(readFileSync(join(state, 'sessions', 's_kept.json'), 'utf8')) as {
      folder: string
    }
    expect(saved.folder).toBe('/tmp')
    link.close()

    child = await booted(url, port)
    const back = await linked(url, SECRET)
    back.send({ t: 'open', session: 's_kept', cols: COLS, rows: ROWS })
    back.send({ t: 'want', session: 's_kept', since: 0 })
    await until(() => back.frames.some((frame) => frame.t === 'screen'))
    const screen = back.frames.find((frame) => frame.t === 'screen')
    if (screen?.t !== 'screen') throw new Error('no screen')
    expect(screen.restored?.at).toBeGreaterThan(0)
    const drawn = terminal(screen.cols, screen.rows)
    await written(drawn, screen.data)
    expect(text(drawn)).toContain('kept-42')
    back.send({ t: 'in', session: 's_kept', data: bytes('pwd\r') })
    await until(() => back.text('s_kept').includes('/tmp\r\n'))
    back.close()
  })
})

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}
