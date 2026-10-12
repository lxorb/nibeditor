/** A session's holder: the one process that owns a session's pty, so the program in it
 *  outlives every restart of `nibd` (docs/online-terminal.md 4.16). dtach's shape, with
 *  what dtach leaves out: the last few megabytes of output kept while nobody is attached,
 *  numbered by the session's own offsets, so the `nibd` after a restart hears exactly what
 *  it missed and a full-screen program is drawn back as it is.
 *
 *  `nibd` starts one per shell, in a session of its own, and on a server it moves itself
 *  into the session's cgroup before the shell exists, so neither a signal to `nibd` nor
 *  systemd stopping `nibd`'s unit reaches it or anything the shell started. It listens on
 *  one Unix socket in `nibd`'s state folder, which only root reaches, and takes one `nibd`
 *  at a time; a second replaces the first, as on the link. The pty is read whether
 *  anybody is attached or not, so a program never waits on a `nibd` that is restarting;
 *  it is paused only while the `nibd` that is attached falls behind, which is the back
 *  pressure the link already has.
 *
 *  Kept small on purpose. It runs until its shell ends, so whatever version started it is
 *  the one every later `nibd` speaks to (hold-wire.ts). */

import { rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { spawn } from 'node-pty'
import {
  type Exit,
  frameOf,
  Frames,
  type FromHolder,
  HOLD_SPEC,
  HOLD_VERSION,
  type Raw,
  type Spec,
  specOf,
  toHolderOf,
} from './hold-wire'
import { enterCgroup } from './limits'
import { Ring } from './ring'

/** How much output a holder keeps for the `nibd` after a restart: minutes of an agent's
 *  redrawing, so a save a few minutes old still meets what followed it. */
export const HELD = 4 * 1024 * 1024

/** What one output frame carries at most, kept or read. */
const PART = 64 * 1024

/** Past this much not yet taken by `nibd` the pty waits; see the header. */
const BEHIND = 1024 * 1024

function hold(spec: Spec, env: Record<string, string>): void {
  const ring = new Ring(spec.base, HELD)
  let size = { cols: spec.cols, rows: spec.rows }
  let client: Socket | null = null
  /** Whether the client asked for output yet: until then it hears nothing but `hello`. */
  let attached = false
  let exited: Exit | null = null

  const pty = spawn(spec.file, spec.args, {
    name: 'xterm-256color',
    cols: spec.cols,
    rows: spec.rows,
    cwd: spec.cwd,
    env,
    encoding: null,
  })

  const say = (socket: Socket, frame: FromHolder): void => {
    socket.write(frameOf(frame))
  }
  const behind = (): void => {
    if (client && client.writableLength > BEHIND) pty.pause()
  }
  const quit = (): void => {
    server.close()
    rmSync(spec.socket, { force: true })
    process.exit(0)
  }
  /** The shell's end said, once everything before it is, and then nothing is left. */
  const finish = (socket: Socket): void => {
    say(socket, { t: 'exit', ...(exited ?? { code: null }) })
    socket.end(quit)
  }

  pty.onData((data: string | Buffer) => {
    const bytes = typeof data === 'string' ? Buffer.from(data) : data
    const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const seq = ring.append(view)
    if (client && attached) {
      say(client, { t: 'out', seq, data: view })
      behind()
    }
  })
  pty.onExit(({ exitCode, signal }) => {
    exited = { code: signal ? null : exitCode }
    if (client && attached) finish(client)
  })

  const heard = (socket: Socket, raw: Raw): void => {
    const frame = toHolderOf(raw)
    if (!frame || socket !== client) return
    switch (frame.t) {
      case 'attach': {
        const from = Math.min(Math.max(frame.since, ring.start), ring.end)
        const kept = ring.since(from) ?? new Uint8Array(0)
        for (let at = 0; at < kept.length; at += PART) {
          say(socket, { t: 'out', seq: from + at, data: kept.subarray(at, at + PART) })
        }
        attached = true
        behind()
        if (exited) finish(socket)
        return
      }
      case 'in':
        if (!exited) pty.write(Buffer.from(frame.data))
        return
      case 'size':
        size = { cols: frame.cols, rows: frame.rows }
        if (!exited) pty.resize(frame.cols, frame.rows)
        return
    }
  }

  const server = createServer((socket) => {
    client?.destroy()
    client = socket
    attached = false
    pty.resume()
    say(socket, {
      t: 'hello',
      v: HOLD_VERSION,
      holder: process.pid,
      shell: pty.pid,
      base: spec.base,
      from: ring.start,
      end: ring.end,
      ...size,
      exited,
    })
    const frames = new Frames()
    socket.on('data', (chunk: Buffer) => {
      for (const raw of frames.push(chunk)) heard(socket, raw)
      if (frames.broken) socket.destroy()
    })
    socket.on('drain', () => {
      if (client === socket) pty.resume()
    })
    socket.on('error', () => {
      // A `nibd` that went away mid-write; its close below lets the pty go on.
    })
    socket.on('close', () => {
      if (client !== socket) return
      client = null
      attached = false
      pty.resume()
    })
  })
  // A socket left by a holder that is gone (a reboot keeps /var/lib) is not this one's.
  rmSync(spec.socket, { force: true })
  // Root's alone, as the folder it is in: the socket is a way into the shell. Only while
  // it is made, which is at once: the shell keeps the umask it was started with.
  const umask = process.umask(0o077)
  server.listen(spec.socket)
  process.umask(umask)
}

function main(): void {
  const spec = specOf(process.env[HOLD_SPEC])
  Reflect.deleteProperty(process.env, HOLD_SPEC)
  if (!spec) process.exit(2)
  // The holder's one job is to stay: a stray error in it must never take the program
  // with it, and there is nobody to tell (its output goes nowhere).
  process.on('uncaughtException', () => undefined)
  if (spec.cgroup) enterCgroup(spec.cgroup, process.pid)
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  hold(spec, env)
}

main()
