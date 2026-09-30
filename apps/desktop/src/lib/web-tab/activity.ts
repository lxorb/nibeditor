/** Whether somebody is at this computer: what lets a web login stay here while it is in
 *  use and go to another computer without anybody pressing anything once it is not.
 *
 *  Active while a key was pressed or the pointer moved in nib in the last five minutes,
 *  or a page is playing sound, or an agent is at work here (docs/agent-native.md 7.4);
 *  idle otherwise. The hub is told on the change and only then, which is what it decides
 *  a handover by; see docs/sync-v2.md section 6.2.
 *
 *  Two ears, because one would miss most of it. The app's own page hears its own keys
 *  and pointer, and nothing that goes to a web page: a page is a webview of its own, so
 *  somebody typing a mail for ten minutes is ten minutes of silence here. So the system
 *  is asked as well, every half minute, when it last had any input and whether a nib
 *  window is in front (src-tauri/src/presence.rs) - which together are input to nib -
 *  and where the system cannot say, the app's own page is what is gone on. */

import { IDLE_AFTER, INPUT_EVERY } from '../backoff'

/** What the system says about its input; see presence.rs. */
export interface SystemInput {
  idleMs: number
  front: boolean
}

/** What activity needs from around it, handed in so a test can drive the clock. */
export interface ActivityWorld {
  now(): number
  /** The system's answer, or null where it has none. */
  system(): Promise<SystemInput | null>
  /** Whether something other than a hand keeps the computer in use: a page playing
   *  sound, an agent at work. */
  busy(): boolean
  /** Hears input in the app's own page; answers how to stop. */
  listen(heard: () => void): () => void
  /** A clock; answers how to stop it. */
  every(ms: number, tick: () => void): () => void
}

/** Reads `input_idle`'s answer, which crossed the IPC and is unknown until looked at. */
export function readSystemInput(value: unknown): SystemInput | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  return typeof said.idleMs === 'number' && typeof said.front === 'boolean'
    ? { idleMs: said.idleMs, front: said.front }
    : null
}

export class Activity {
  /** Whether somebody is at this computer. Starts true: the app was just opened, which
   *  is somebody at it. */
  active = true

  private last: number
  private readonly heard = new Set<(active: boolean) => void>()
  private stops: (() => void)[] = []

  constructor(private readonly world: ActivityWorld) {
    this.last = world.now()
  }

  /** Starts listening. Answers how to stop. */
  start(): () => void {
    this.stops = [
      this.world.listen(() => {
        this.touched()
      }),
      this.world.every(INPUT_EVERY, () => void this.check()),
    ]
    return () => {
      for (const stop of this.stops) stop()
      this.stops = []
    }
  }

  /** Runs on every change, with what it changed to. */
  changed(run: (active: boolean) => void): () => void {
    this.heard.add(run)
    return () => this.heard.delete(run)
  }

  /** Input, of whatever kind: somebody is here now. */
  touched(): void {
    this.last = this.world.now()
    this.become(true)
  }

  /** Asks everything that can say whether somebody is here, and becomes that. */
  async check(): Promise<void> {
    const system = await this.world.system().catch(() => null)
    if (system?.front) this.last = Math.max(this.last, this.world.now() - system.idleMs)

    this.become(this.world.busy() || this.world.now() - this.last < IDLE_AFTER)
  }

  private become(active: boolean): void {
    if (active === this.active) return
    this.active = active
    for (const run of this.heard) run(active)
  }
}

/** The keys and the pointer the app's own page hears. A move is counted as much as a
 *  press: somebody reading and scrolling is somebody here. Throttled, because a move is
 *  sixty events a second and one a second says the same. */
export function listenForInput(heard: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined

  let at = 0
  const input = () => {
    const now = Date.now()
    if (now - at < 1000) return
    at = now
    heard()
  }
  const kinds = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const
  for (const kind of kinds) window.addEventListener(kind, input, { capture: true, passive: true })
  return () => {
    for (const kind of kinds) window.removeEventListener(kind, input, { capture: true })
  }
}
