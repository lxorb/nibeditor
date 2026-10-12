/** `nibd`'s hold on one session's holder (hold.ts): the holder found again at its socket
 *  after `nibd` restarted, or started for a new shell; then what is typed and the size
 *  going down, and the output and the shell's end coming up.
 *
 *  What is typed or resized before the holder answers waits here and goes once it does,
 *  so a key pressed while `nibd` is still finding its sessions after a restart lands in
 *  the program rather than nowhere. */

import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import {
  frameOf,
  Frames,
  type FromHolder,
  fromHolderOf,
  type Hello,
  HOLD_SPEC,
  type Spec,
  type ToHolder,
} from './hold-wire'
import { killSession } from './limits'

/** How long a holder that took the connection has to say hello, and a new one to start:
 *  node and node-pty loading, on a machine that may be busy. Where nothing is there the
 *  connection is refused at once; one that is there is waited for rather than taken for
 *  gone, since a holder started over it would leave its program out of reach. */
const ANSWER_WITHIN = 30_000
const START_WITHIN = 15_000
const LOOK_EVERY = 25

export interface Events {
  out(seq: number, data: Uint8Array): void
  /** The shell ended, or its holder went without saying so. */
  exit(code: number | null): void
}

const waited = (ms: number) => new Promise((settle) => setTimeout(settle, ms))

/** Where a session's holder listens, in the folder of them all. A session id is a file
 *  name already (`isSessionId`). */
export function socketOf(holds: string, session: string): string {
  return join(holds, `${session}.sock`)
}

export class Held {
  private socket: Socket | null = null
  private readonly waiting: ToHolder[] = []
  private attached = false
  /** Let go of on purpose: `nibd` stopping, or the session ending. */
  private letGo = false
  private killing = false
  private ended = false
  hello: Hello | null = null

  constructor(
    readonly path: string,
    private readonly events: Events,
  ) {}

  /** The holder at the socket, said hello by; null where none answers - none was ever
   *  started, or it is gone and its socket left behind. */
  async find(): Promise<Hello | null> {
    const socket = connect(this.path)
    const frames = new Frames()
    const hello = await new Promise<Hello | null>((settle) => {
      const timer = setTimeout(() => {
        settle(null)
      }, ANSWER_WITHIN)
      const done = (value: Hello | null) => {
        clearTimeout(timer)
        settle(value)
      }
      socket.once('error', () => {
        done(null)
      })
      socket.once('close', () => {
        done(null)
      })
      socket.on('data', (chunk: Buffer) => {
        for (const raw of frames.push(chunk)) {
          const frame = fromHolderOf(raw)
          if (frame?.t === 'hello' && !this.hello) {
            this.hello = frame
            done(frame)
          } else if (frame) this.heard(frame)
        }
        if (frames.broken) socket.destroy()
      })
    })
    if (!hello || this.letGo) {
      socket.destroy()
      if (hello && this.killing) this.kill()
      return null
    }
    this.socket = socket
    socket.removeAllListeners('close')
    socket.on('error', () => undefined)
    socket.on('close', () => {
      this.gone()
    })
    if (this.killing) this.kill()
    return hello
  }

  /** A holder started for a new shell (`spec`, in `env`), and found once it listens. */
  async start(holder: string, spec: Spec, env: Record<string, string>): Promise<Hello> {
    const child = spawn(process.execPath, [holder], {
      detached: true,
      stdio: 'ignore',
      env: { ...env, [HOLD_SPEC]: JSON.stringify(spec) },
    })
    const started = { gone: false }
    child.once('exit', () => {
      started.gone = true
    })
    child.once('error', () => {
      started.gone = true
    })
    child.unref()
    const until = Date.now() + START_WITHIN
    while (!started.gone && !this.letGo && Date.now() < until) {
      const hello = await this.find()
      if (hello) return hello
      await waited(LOOK_EVERY)
    }
    // Not when `nibd` is merely going away: the next one finds it at its socket.
    if (!started.gone && (this.killing || !this.letGo)) child.kill('SIGKILL')
    throw new Error('the holder did not start')
  }

  /** Output from `since` on, then everything as it is read; and whatever waited. */
  attach(since: number): void {
    this.attached = true
    this.say({ t: 'attach', since })
    for (const frame of this.waiting.splice(0)) this.say(frame)
  }

  write(data: Uint8Array): void {
    this.tell({ t: 'in', data })
  }

  resize(cols: number, rows: number): void {
    this.tell({ t: 'size', cols, rows })
  }

  /** The holder not read while the link is behind: its pty waits in turn. */
  pause(paused: boolean): void {
    if (paused) this.socket?.pause()
    else this.socket?.resume()
  }

  /** Let go of, the holder and its shell running on: `nibd` is going away. */
  detach(): void {
    this.letGo = true
    this.socket?.destroy()
    this.socket = null
  }

  /** The holder and every process its shell's session holds, ended: the session's End,
   *  where no cgroup does it. A holder not found yet is ended once it is. */
  kill(): void {
    this.killing = true
    this.detach()
    const hello = this.hello
    if (!hello) return
    killSession(hello.shell)
    try {
      process.kill(hello.holder, 'SIGKILL')
    } catch {
      // Gone already.
    }
    // A holder ended this way leaves its socket, which nothing will listen on again.
    rmSync(this.path, { force: true })
  }

  private tell(frame: ToHolder): void {
    if (this.attached) this.say(frame)
    else this.waiting.push(frame)
  }

  private say(frame: ToHolder): void {
    if (this.socket?.writable) this.socket.write(frameOf(frame))
  }

  private heard(frame: FromHolder): void {
    if (frame.t === 'out') this.events.out(frame.seq, frame.data)
    else if (frame.t === 'exit') this.end(frame.code)
  }

  /** The socket closed under a holder nobody let go of: it ended, said or not. */
  private gone(): void {
    if (!this.letGo) this.end(null)
  }

  private end(code: number | null): void {
    if (this.ended) return
    this.ended = true
    this.letGo = true
    this.socket = null
    this.events.exit(code)
  }
}
