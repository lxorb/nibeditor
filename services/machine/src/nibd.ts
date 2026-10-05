/** `nibd`: every session on the machine, and what it says over the link to `Machine`
 *  (docs/online-terminal.md 4.6).
 *
 *  It knows nothing of nib's accounts, spaces or roles - `Machine` is the door and has
 *  decided all of that before a frame reaches here - and it never opens anything under
 *  the home but what a shell does: no file of the agents' (`~/.claude`, `~/.codex`) is
 *  read by any code of nib's (4.7). Its whole vocabulary is the link's, from
 *  `@nib/online/wire`. */

import type { Activity } from '@nib/online/types'
import type { MachineFrame, NibdFrame } from '@nib/online/wire'
import { Meter, homeSize } from './activity'
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
}

export class Nibd {
  private readonly sessions = new Map<string, Session>()
  private readonly saves: Saves
  private readonly options: Options
  private readonly meter = new Meter(Date.now())
  private link: ((frame: NibdFrame) => void) | null = null
  private homeBytes = 0
  private readonly timers: ReturnType<typeof setInterval>[] = []

  constructor(options: Options) {
    this.options = options
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
    }
  }

  /** Every screen written down, then `saved`: as the machine sleeps, and on SIGTERM. */
  async saveAll(): Promise<void> {
    const at = Date.now()
    for (const session of this.sessions.values()) {
      try {
        this.saves.write(await session.save(at))
      } catch {
        // A full disk loses this one screen, never the others or the sleep.
      }
    }
    this.send({ t: 'saved' })
  }

  /** The last stretch's activity, as the awake rule reads it. */
  activity(): Activity {
    const now = Date.now()
    const { cpu, net } = this.meter.since(now)
    let output = 0
    for (const session of this.sessions.values()) output += session.taken()
    return { at: now, output, cpu, net, homeBytes: this.homeBytes }
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
