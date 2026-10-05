/** An address a program on the machine asked a browser for, opened on this computer
 *  (docs/online-terminal.md 4.13): VS Code Remote's `BROWSER` helper and its port
 *  forwarding, for the one thing a sign-in needs.
 *
 *  - **Where.** In nib, as a link from a local terminal opens: a web tab beside the
 *    terminal, in front when the terminal is what the person is looking at and behind
 *    otherwise, so an agent working alone never takes the window from them. A phone hands
 *    it to the system browser. A browser build cannot open a window nobody pressed for,
 *    so it offers the address on the terminal's quiet bar, one press away.
 *  - **The sign-in's way back.** A provider sends the browser back to the program's own
 *    listener, `http://localhost:<port>/callback` - on the machine, not here. So a tab
 *    opened for an address that names such a page is watched, and when it lands there
 *    the request is made on the machine instead (`callback`); once the program has
 *    answered, the tab goes and the terminal comes back to the front, where the program
 *    says it is signed in. Only nib's own tabs can be watched, so a phone and a browser
 *    build do not open such an address at all, and the program's printed one stands.
 *  - **Bounds.** Only the web, six a minute a terminal, and the same address once in a
 *    few seconds: a program in a loop is a few tabs, never a wall of them. */

import { callbacksIn, isCallbackOf, isWebUrl } from '@nib/online/urls'
import { untrack } from 'svelte'
import { openExternal } from '../tauri'
import { pages } from '../web-tab/pages.svelte'
import { workspace } from '../workspace.svelte'

/** Where an address goes: a web tab of nib's, the system's browser, the bar's offer, or
 *  nowhere. */
export type Where = 'tab' | 'system' | 'offer' | 'none'

/** What this build has: tabs that hold pages (a desktop), and whether it is an app at
 *  all rather than a page in a browser. */
export interface Build {
  pages: boolean
  native: boolean
}

export function whereToOpen(url: string, build: Build): Where {
  if (!isWebUrl(url)) return 'none'
  if (build.pages && build.native) return 'tab'
  // Nobody here could carry the sign-in's way back to the machine.
  if (callbacksIn(url).length) return 'none'
  return build.native ? 'system' : 'offer'
}

/** How many a minute, and how soon the same address again. */
const A_MINUTE = 6
const AGAIN_AFTER = 3000

/** The bounds above, by the clock given. */
export class Pace {
  private times: number[] = []
  private last = { url: '', at: -Infinity }

  allows(url: string, now: number): boolean {
    if (url === this.last.url && now - this.last.at < AGAIN_AFTER) return false
    this.times = this.times.filter((at) => now - at < 60_000)
    if (this.times.length >= A_MINUTE) return false
    this.times.push(now)
    this.last = { url, at: now }
    return true
  }
}

/** How long a sign-in tab is watched for its way back. */
const WATCHED_FOR = 15 * 60_000

/** One terminal's opener. `callback` sends a landing up the socket; `offer` puts an
 *  address on the bar. */
export class Opener {
  private readonly pace = new Pace()
  /** The sign-in tabs being watched, by the landing they are waiting on once landed. */
  private readonly watched = new Map<string, { stop: () => void; landed: string | null }>()

  constructor(
    private readonly terminal: () => string,
    private readonly build: Build,
    private readonly callback: (url: string) => void,
    private readonly offer: (url: string) => void,
  ) {}

  /** Opens `url`; `front` when the terminal is what the person is looking at. */
  open(url: string, front: boolean, now = Date.now()): void {
    const where = whereToOpen(url, this.build)
    if (where === 'none' || !this.pace.allows(url, now)) return
    if (where === 'system') void openExternal(url)
    else if (where === 'offer') this.offer(url)
    else {
      const id = workspace.openPage(url, front ? 'front' : 'behind', this.terminal())
      if (id !== null && callbacksIn(url).length) this.watch(id, url)
    }
  }

  /** The tab `id` is watched until it lands on the page `url` sends it back to. */
  private watch(id: string, url: string): void {
    let sent = false
    const stop = $effect.root(() => {
      $effect(() => {
        const at = pages.of(id).url
        const open = workspace.tabs.some((tab) => tab.id === id)
        untrack(() => {
          if (!open) {
            this.forget(id)
            return
          }
          if (sent || at === null || !isCallbackOf(url, at)) return
          sent = true
          const one = this.watched.get(id)
          if (one) one.landed = at
          this.callback(at)
        })
      })
    })
    const timer = setTimeout(() => this.forget(id), WATCHED_FOR)
    this.watched.set(id, {
      stop: () => {
        clearTimeout(timer)
        stop()
      },
      landed: null,
    })
  }

  private forget(id: string): void {
    this.watched.get(id)?.stop()
    this.watched.delete(id)
  }

  /** The program on the machine answered the landing: the tab has done its work, and
   *  goes, and the terminal is in front again. A refusal leaves the tab as it is. */
  called(url: string, status: number): void {
    for (const [id, one] of this.watched) {
      if (one.landed !== url) continue
      this.forget(id)
      if (status < 200 || status >= 400) return
      workspace.close(id, false)
      workspace.activeTabId = this.terminal()
      return
    }
  }

  end(): void {
    for (const id of [...this.watched.keys()]) this.forget(id)
  }
}
