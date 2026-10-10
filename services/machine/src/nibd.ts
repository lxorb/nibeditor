/** `nibd`: every session on the machine, and what it says over the link to `Machine`
 *  (docs/online-terminal.md 4.6).
 *
 *  It knows nothing of nib's accounts, spaces or roles - `Machine` is the door and has
 *  decided all of that before a frame reaches here - and it never opens anything under
 *  the home but what a shell does and the pictures pasted into a session, which it writes
 *  to `~/.cache/nib/images` as the user, never as root (images.ts): no file of the agents' (`~/.claude`, `~/.codex`)
 *  is read by any code of nib's (4.7). Its whole vocabulary is the link's, from
 *  `@nib/online/wire`. */

import type { Activity } from '@nib/online/types'
import { isLoopbackUrl } from '@nib/online/urls'
import type { MachineFrame, NibdFrame } from '@nib/online/wire'
import { diskOf, Meter, homeSize } from './activity'
import { Images } from './images'
import type { Cgroups, User } from './limits'
import { Saves, isSessionId, type Saved } from './saves'
import { Session } from './session'

export interface Options {
  /** Where screens are saved: `/var/lib/nibd`. */
  state: string
  home: string
  shell: string
  user: User | null
  env: Record<string, string>
  pidsMax: number
  cgroups: Cgroups | null
  /** How often activity is reported (30 s) and the home measured (an hour). */
  activityEvery: number
  homeEvery: number
  /** How often every screen is written down while awake (5 min), so a `nibd` ended
   *  without a SIGTERM - its watchdog, a crash, the kernel - comes back with screens
   *  only minutes old; 0 for never. */
  saveEvery?: number
  /** Makes a callback's request on this machine; `fetch`, or the tests' stand-in. */
  call?: (url: string) => Promise<number>
  /** Ends `nibd` for its supervisor to start again (systemd on a server, the entrypoint in
   *  a container), once every screen is saved: `restart` from the link. */
  restart?: () => void
}

/** How long a callback's request may take: a program's sign-in listener answers at
 *  once, or it is not listening. */
const CALL_WAIT = 10_000

/** The request a callback is: a GET to the program's own listener on this machine,
 *  followed nowhere. The answer's status, or 0 where nothing answered. */
async function call(url: string): Promise<number> {
  try {
    const answer = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(CALL_WAIT) })
    await answer.body?.cancel()
    return answer.status
  } catch {
    return 0
  }
}

export class Nibd {
  private readonly sessions = new Map<string, Session>()
  private readonly saves: Saves
  private readonly options: Options
  private readonly meter = new Meter(Date.now())
  private link: ((frame: NibdFrame) => void) | null = null
  private homeBytes = 0
  /** The session typed in last, for an address asked for where none was said. */
  private lastTyped: string | null = null
  private readonly timers: ReturnType<typeof setInterval>[] = []
  private readonly images: Images

  constructor(options: Options) {
    this.options = options
    this.images = new Images(options.home, options.user)
    this.saves = new Saves(options.state)
    // Every session that was saved as the machine went to sleep comes back now, above a
    // fresh shell, so the first `open` after a wake finds it as it was left.
    for (const saved of this.saves.all()) {
      this.sessions.set(saved.session, this.session(saved.session, saved.cols, saved.rows, saved))
    }
    this.timers.push(
      setInterval(() => {
        this.report()
      }, options.activityEvery),
      setInterval(() => {
        void this.measure()
      }, options.homeEvery),
    )
    if (options.saveEvery) {
      this.timers.push(
        setInterval(() => {
          void this.saveAll(false)
        }, options.saveEvery),
      )
    }
    void this.measure()
  }

  /** The link to `Machine`, or none: frames said with none are dropped, since what
   *  they say is asked for again by the next link's `want`. */
  attach(send: ((frame: NibdFrame) => void) | null): void {
    this.link = send
  }

  private send(frame: NibdFrame): void {
    this.link?.(frame)
  }

  private session(id: string, cols: number, rows: number, saved?: Saved): Session {
    return new Session(
      id,
      cols,
      rows,
      {
        ...this.options,
        send: (frame) => {
          this.send(frame)
        },
      },
      saved,
    )
  }

  async receive(frame: MachineFrame): Promise<void> {
    if (frame.t === 'sleep') {
      await this.saveAll()
      return
    }
    if (frame.t === 'restart') {
      await this.saveAll(false)
      this.options.restart?.()
      return
    }
    // Answered by the server as it arrives (server.ts); here only from a test.
    if (frame.t === 'ping') {
      this.send({ t: 'pong' })
      return
    }
    if (!isSessionId(frame.session)) return
    const session = this.sessions.get(frame.session)
    switch (frame.t) {
      case 'open':
        if (!session) {
          this.sessions.set(frame.session, this.session(frame.session, frame.cols, frame.rows))
        } else if (!session.alive) {
          session.restart()
        }
        return
      case 'in':
        session?.input(frame.data)
        if (session) this.lastTyped = frame.session
        return
      case 'size':
        session?.resize(frame.cols, frame.rows)
        return
      case 'want':
        await session?.want(frame.since)
        return
      case 'close':
        session?.end()
        this.sessions.delete(frame.session)
        this.saves.forget(frame.session)
        return
      case 'callback': {
        // Checked by the codec already; asked again, since this one goes to the network.
        if (!isLoopbackUrl(frame.url)) return
        const status = await (this.options.call ?? call)(frame.url)
        this.send({ t: 'called', session: frame.session, url: frame.url, status })
        return
      }
      case 'image': {
        // A picture pasted in the session, a file here once its last part is (images.ts).
        const path = await this.images.part(frame.id, frame.kind, frame.data, frame.last)
        if (path !== undefined)
          this.send({ t: 'image', session: frame.session, id: frame.id, path })
        return
      }
    }
  }

  /** An address a program asked a browser for (opener.ts): said up the link for the
   *  session it was asked in, or the one typed in last. False where no link hears it or
   *  there is no session to say it for. */
  open(url: string, session: string): boolean {
    const id = this.sessions.has(session) ? session : this.lastTyped
    if (!this.link || id === null || !this.sessions.has(id)) return false
    this.send({ t: 'browse', session: id, url })
    return true
  }

  /** Every screen written down, then `saved`: as the machine sleeps, and on SIGTERM;
   *  quietly, with nobody waiting on it, every few minutes. */
  async saveAll(say = true): Promise<void> {
    const at = Date.now()
    for (const session of this.sessions.values()) {
      try {
        this.saves.write(await session.save(at))
      } catch {
        // A full disk loses this one screen, never the others or the sleep.
      }
    }
    if (say) this.send({ t: 'saved' })
  }

  /** The last stretch's activity, as the awake rule reads it. */
  activity(): Activity {
    const now = Date.now()
    const { cpu, net } = this.meter.since(now)
    let output = 0
    for (const session of this.sessions.values()) output += session.taken()
    const disk = diskOf(this.options.home)
    return { at: now, output, cpu, net, homeBytes: this.homeBytes, ...(disk ? { disk } : {}) }
  }

  private report(): void {
    if (!this.link) return
    this.send({ t: 'activity', activity: this.activity() })
  }

  private async measure(): Promise<void> {
    const bytes = await homeSize(this.options.home)
    if (bytes !== null) this.homeBytes = bytes
  }

  /** Every pty stops being read while the link is too far behind, so a flood waits
   *  for the link rather than filling `nibd`'s memory. */
  pause(paused: boolean): void {
    for (const session of this.sessions.values()) session.pause(paused)
  }

  /** Everything stopped: the timers, and every session's processes. */
  stop(): void {
    for (const timer of this.timers) clearInterval(timer)
    for (const session of this.sessions.values()) session.end()
    this.sessions.clear()
  }
}
