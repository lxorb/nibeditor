/** `nibd` on Linux with real shells (docs/online-terminal.md 6.2, lane 2): an echo; a
 *  late joiner's screen against a watcher that saw everything, with vim on the second
 *  screen and colours mid-stream; a reconnect inside and outside the kept megabyte; the
 *  program in front; activity counted; a program going on through every restart of
 *  `nibd` (4.16), and the screens back above a fresh shell where the program is gone; a
 *  fork bomb contained. CI runs these on ubuntu-latest; elsewhere they are skipped. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import type { NibdFrame } from '@nib/online/wire'
import { KEPT } from '../src/ring'
import { sessionProcesses } from '../src/proc'
import { Nibd } from '../src/nibd'
import type { Saved } from '../src/saves'
import { Session, type Machine } from '../src/session'
import { cells, terminal, text, written } from './cells'
import { bytes, healthy, linked, until } from './link'

const linux = process.platform === 'linux'
const COLS = 100
const ROWS = 30
const here = join(import.meta.dirname, '..')

/** The holder every shell runs under, built with `nibd` before any test starts one. */
const HOLDER = join(here, 'dist', 'hold.cjs')

let home: string
/** The folder the holders listen in, shared by every `nibd` of a test as a machine's
 *  state folder is. */
let holds: string
const ended: { end: () => void }[] = []

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'nibd-home-'))
  holds = mkdtempSync(join(tmpdir(), 'nibd-holds-'))
  if (!linux) return
  const built = spawnSync(process.execPath, ['build.ts'], { cwd: here, stdio: 'inherit' })
  expect(built.status).toBe(0)
})
afterEach(() => {
  for (const one of ended.splice(0)) one.end()
})
afterAll(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(holds, { recursive: true, force: true })
})

/** A machine whose link is a list. */
function machine(pidsMax = 4096): Machine & { frames: NibdFrame[] } {
  const frames: NibdFrame[] = []
  return {
    holder: HOLDER,
    holds,
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

function session(on: Machine, id = 's_test', saved?: Saved): Session {
  const one = new Session(id, COLS, ROWS, on, saved)
  ended.push(one)
  return one
}

/** Until a session's shell is running: its holder answered. */
async function running(one: Session): Promise<number> {
  await until(() => one.pid !== undefined)
  return one.pid ?? 0
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
    const shell = await running(one)
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

/** The numbers a ticking loop printed, in order. */
function ticks(seen: string): number[] {
  return [...seen.matchAll(/tick-(\d+)/g)].map((match) => Number(match[1]))
}

const TICKING = 'n=0; while :; do n=$((n+1)); echo tick-$n; sleep 0.2; done\r'

/** A terminal that drew a stream up to `next`, drawing what `frames` add after it; it
 *  checks that nothing is missing in between. Answers the offset it reached. */
async function follow(
  term: ReturnType<typeof terminal>,
  frames: readonly NibdFrame[],
  next: number,
): Promise<number> {
  for (const frame of frames) {
    if (frame.t !== 'out') continue
    const end = frame.seq + frame.data.length
    if (end <= next) continue
    expect(frame.seq).toBeLessThanOrEqual(next)
    await written(term, frame.data.subarray(next - frame.seq))
    next = end
  }
  return next
}

/** A session's next screen, drawn. */
async function screenOf(one: Session, frames: NibdFrame[]) {
  const asked = frames.length
  await one.want(0)
  const answer = frames.slice(asked).find((frame) => frame.t === 'screen')
  if (answer?.t !== 'screen') throw new Error('no screen')
  const drawn = terminal(answer.cols, answer.rows)
  await written(drawn, answer.data)
  return { answer, drawn }
}

describe.runIf(linux)('through a restart of nibd', () => {
  test('a program goes on, and a device is sent exactly what it missed', async () => {
    const before = machine()
    const first = new Session('s_on', COLS, ROWS, before)
    const seen = watcher(before.frames)
    first.input(bytes(TICKING))
    await until(async () => {
      await seen.caught()
      return ticks(text(seen.term)).length >= 3
    })
    const saved = await first.save(Date.now())
    first.detach()
    // nibd is away: the loop goes on in its holder, which keeps what it prints.
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const after = machine()
    const again = session(after, 's_on', saved)
    let next = seen.next
    await until(async () => {
      next = await follow(seen.term, after.frames, next)
      return (ticks(text(seen.term)).at(-1) ?? 0) >= (ticks(text(seen.term))[2] ?? 0) + 15
    })
    // Every number once, in order, across the restart: nothing lost, nothing twice.
    const all = ticks(text(seen.term))
    expect(all).toEqual(all.map((_, at) => (all[0] ?? 0) + at))

    // A device joining now is drawn the same, with nothing saying it was restored.
    const { answer, drawn } = await screenOf(again, after.frames)
    expect(answer.restored).toBeUndefined()
    expect(ticks(text(drawn)).length).toBeGreaterThan(10)
    expect(after.frames.some((frame) => frame.t === 'ended')).toBe(false)
  })

  test('a full-screen program comes back whole, on its second screen, and takes keys', async () => {
    const before = machine()
    const first = new Session('s_vim', COLS, ROWS, before)
    first.input(bytes('vim -u NONE -N -i NONE notes.txt\r'))
    await settled(before.frames)
    first.input(bytes('ihello from vim\x1b'))
    await settled(before.frames)
    const saved = await first.save(Date.now())
    first.detach()

    const after = machine()
    const again = session(after, 's_vim', saved)
    const back = await screenOf(again, after.frames)
    expect(back.drawn.buffer.active.type).toBe('alternate')
    expect(text(back.drawn)).toContain('hello from vim')

    again.input(bytes('ojoined\x1b'))
    await settled(after.frames)
    const typed = await screenOf(again, after.frames)
    expect(text(typed.drawn)).toContain('joined')
    again.input(bytes(':q!\r'))
  })

  test('a shell that ended while nibd was away is said ended when it comes back', async () => {
    const before = machine()
    const first = new Session('s_gone', COLS, ROWS, before)
    first.input(bytes('sleep 1; exit 3\r'))
    await running(first)
    first.detach()
    await new Promise((resolve) => setTimeout(resolve, 2500))

    const after = machine()
    session(after, 's_gone')
    await until(() => after.frames.some((frame) => frame.t === 'ended'))
    expect(after.frames.find((frame) => frame.t === 'ended')).toMatchObject({ code: 3 })
  })

  test('where the holder is gone too, the saved screen comes back above a fresh shell', async () => {
    const before = machine()
    const first = new Session('s_rebooted', COLS, ROWS, before)
    first.input(bytes('cd /tmp; echo saved-$((5+5))\r'))
    await until(() => Buffer.concat(outOf(before.frames)).includes('saved-10'))
    const saved = await first.save(Date.now())
    // A reboot: the holder ends with everything else.
    first.end()

    const after = machine()
    const again = session(after, 's_rebooted', saved)
    const { answer, drawn } = await screenOf(again, after.frames)
    expect(answer.restored?.at).toBe(saved.at)
    expect(text(drawn)).toContain('saved-10')
    again.input(bytes('pwd\r'))
    await until(() => Buffer.concat(outOf(after.frames)).includes('/tmp\r\n'))
  })
})

/** The bytes of every output frame. */
function outOf(frames: readonly NibdFrame[]): Uint8Array[] {
  return frames.flatMap((frame) => (frame.t === 'out' ? [frame.data] : []))
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
    ended.push({ end: () => nibd.stop(true) })
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

  /** `nibd` ended by `signal`, and the code it ended with. */
  async function stopped(signal: NodeJS.Signals): Promise<number | null> {
    const exited = new Promise<number | null>((resolve) => child?.once('exit', resolve))
    child?.kill(signal)
    return await exited
  }

  /** A link to the session, opened, and the screen it is sent first. */
  async function rejoined(url: string, session: string) {
    const link = await linked(url, SECRET)
    link.send({ t: 'open', session, cols: COLS, rows: ROWS })
    link.send({ t: 'want', session, since: 0 })
    await until(() => link.frames.some((frame) => frame.t === 'screen'))
    const screen = link.frames.find((frame) => frame.t === 'screen')
    if (screen?.t !== 'screen') throw new Error('no screen')
    const drawn = terminal(screen.cols, screen.rows)
    await written(drawn, screen.data)
    return { link, screen, drawn }
  }

  test('a program goes on through SIGTERM, SIGKILL and a restart of nibd, its screen with it', async () => {
    const port = await freePort()
    const url = `ws://127.0.0.1:${String(port)}`
    child = await booted(url, port)
    const link = await linked(url, SECRET)
    link.send({ t: 'open', session: 's_kept', cols: COLS, rows: ROWS })
    link.send({
      t: 'in',
      session: 's_kept',
      data: bytes(
        'cd /tmp; echo kept-$((40+2)) "secret=${NIBD_SECRET:-none}" "hold=${NIBD_HOLD:-none}"; sleep 2; echo after-$((3+4))\r',
      ),
    })
    await until(() => link.text('s_kept').includes('kept-42'))
    // The secret opens the link and nothing else: no shell is handed it, nor the holder's
    // own instructions.
    expect(link.text('s_kept')).toContain('secret=none')
    expect(link.text('s_kept')).toContain('hold=none')

    // A deploy picked up, or systemd after a security update: the screens are saved, and
    // the program sleeps on and prints while nibd is away.
    expect(await stopped('SIGTERM')).toBe(0)
    expect(readdirSync(join(state, 'sessions'))).toEqual(['s_kept.json'])
    const saved: unknown = JSON.parse(readFileSync(join(state, 'sessions', 's_kept.json'), 'utf8'))
    expect(saved).toMatchObject({ v: 2, folder: '/tmp' })
    link.close()
    child = await booted(url, port)
    const back = await rejoined(url, 's_kept')
    expect(back.screen.restored).toBeUndefined()
    expect(text(back.drawn)).toContain('kept-42')
    await until(() => (text(back.drawn) + back.link.text('s_kept')).includes('after-7'))
    back.link.send({ t: 'in', session: 's_kept', data: bytes('pwd\r') })
    await until(() => back.link.text('s_kept').includes('/tmp\r\n'))
    back.link.close()

    // Its watchdog, a crash or the kernel: no save at all, and still the same shell.
    expect(await stopped('SIGKILL')).toBeNull()
    child = await booted(url, port)
    const killed = await rejoined(url, 's_kept')
    expect(killed.screen.restored).toBeUndefined()
    killed.link.send({ t: 'in', session: 's_kept', data: bytes('echo still-$((1+1))\r') })
    await until(() => killed.link.text('s_kept').includes('still-2'))

    // The owner's Restart, and the health path's: told down the link.
    const exited = new Promise<number | null>((resolve) => child?.once('exit', resolve))
    killed.link.send({ t: 'restart' })
    expect(await exited).toBe(75)
    killed.link.close()
    child = await booted(url, port)
    const restarted = await rejoined(url, 's_kept')
    expect(restarted.screen.restored).toBeUndefined()
    expect(text(restarted.drawn)).toContain('still-2')
    restarted.link.close()
  })

  test('where the program went with its machine, the screen comes back above a fresh shell', async () => {
    const port = await freePort()
    const url = `ws://127.0.0.1:${String(port)}`
    child?.kill('SIGKILL')
    child = await booted(url, port)
    const link = await linked(url, SECRET)
    link.send({ t: 'open', session: 's_kept', cols: COLS, rows: ROWS })
    link.send({ t: 'in', session: 's_kept', data: bytes('echo holder=$PPID\r') })
    await until(() => /holder=\d+/.test(link.text('s_kept')))
    const holder = Number(/holder=(\d+)/.exec(link.text('s_kept'))?.[1])
    expect(await stopped('SIGTERM')).toBe(0)
    link.close()
    // A reboot, as far as the session can tell: its holder ends, and the shell with it.
    process.kill(holder, 'SIGKILL')
    await until(() => !existsSync(`/proc/${String(holder)}`))

    child = await booted(url, port)
    const back = await rejoined(url, 's_kept')
    expect(back.screen.restored?.at).toBeGreaterThan(0)
    expect(text(back.drawn)).toContain('kept-42')
    back.link.send({ t: 'in', session: 's_kept', data: bytes('pwd\r') })
    await until(() => back.link.text('s_kept').includes('/tmp\r\n'))

    // Ended, its holder goes with it, and nothing of it is drawn back again.
    back.link.send({ t: 'close', session: 's_kept' })
    await until(() => !existsSync(join(state, 'holds', 's_kept.sock')))
    expect(readdirSync(join(state, 'sessions'))).toEqual([])
    back.link.close()
  })

  test('ending a session no open asked for since nibd started ends its program too', async () => {
    const port = await freePort()
    const url = `ws://127.0.0.1:${String(port)}`
    child?.kill('SIGKILL')
    child = await booted(url, port)
    const link = await linked(url, SECRET)
    link.send({ t: 'open', session: 's_quiet', cols: COLS, rows: ROWS })
    link.send({ t: 'in', session: 's_quiet', data: bytes('echo shell=$$; sleep 600\r') })
    await until(() => /shell=\d+/.test(link.text('s_quiet')))
    const shell = Number(/shell=(\d+)/.exec(link.text('s_quiet'))?.[1])
    expect(await stopped('SIGKILL')).toBeNull()
    link.close()
    expect(sessionProcesses(shell).length).toBeGreaterThan(0)

    child = await booted(url, port)
    const again = await linked(url, SECRET)
    again.send({ t: 'close', session: 's_quiet' })
    await until(() => sessionProcesses(shell).length === 0)
    await until(() => !existsSync(join(state, 'holds', 's_quiet.sock')))
    again.close()
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
