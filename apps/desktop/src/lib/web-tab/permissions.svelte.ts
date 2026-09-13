/** What a site in a web tab is allowed, asked the way a browser asks.
 *
 *  Emil, 2026-09-13: *"a lot of stuff is still done extremely bad, e.g. having explicit
 *  buttons for allow clipboard or allow camera. I don't think chrome does it like
 *  this."* He is right, and the old design here was exactly that: the APIs were taken
 *  off `Navigator.prototype` before the page's first script, so the engine never had a
 *  request to raise, and the only way to give a site the camera was a row in a menu
 *  saying so - which nobody goes looking for, which has to be pressed before the site
 *  asks rather than when it does, and which cost the page being built again.
 *
 *  So: the APIs are left where they are, the engine raises its own request when the page
 *  calls one, and **the request is held open while the reader is asked** - a bubble
 *  under the address bar, with the site's name and Allow or Block, which is what Chrome
 *  puts there. The answer is remembered for that origin, so a site is asked about once.
 *  See `ask` in src-tauri/src/web_tabs.rs for the half that holds the request open.
 *
 *  **Clipboard write and paste need no prompt**, because they need none in Chrome: a
 *  page may write to the clipboard on a gesture, and a paste is the reader pressing
 *  paste. Only *reading* the clipboard without one is a request, and the engine raises
 *  that one itself.
 *
 *  By origin, because that is what a permission is about - a grant to `docs.example` is
 *  not a grant to every page that links to it - and this device's, because it is about
 *  this machine's camera. So it lives in local storage beside the other things a device
 *  decides for itself, and never on the account. */

import { invoke, isDesktop } from '../tauri'
import { withOrWithout } from '../records'
import { isRecord, keep, stored } from '../stored'
import { plainOrigin } from './address'

const STORAGE_KEY = 'nib:web-grants'

/** What a site can ask a browser for, as the crate names them.
 *
 *  The list is the engine's, not a choice: these are the permission kinds `WebView2`
 *  raises a request for, which is also the list Chrome's own site settings show. What
 *  is **not** here is the hardware buses - Bluetooth, USB, serial, HID - and the
 *  credential store, which are taken away outright before the page's first script,
 *  because a notes app has no business letting a page talk to a USB device and no
 *  sentence about it would help anybody decide. */
export const ASKS = [
  'camera',
  'microphone',
  'location',
  'notifications',
  'clipboard',
  'sensors',
  'downloads',
  'fonts',
  'midi',
  'windows',
] as const

export type Ask = (typeof ASKS)[number]

/** What was said about one of them. There is no third answer: a site nobody has
 *  decided about has no entry at all, which is what makes the bubble appear. */
export type Answer = 'allow' | 'block'

function isAsk(value: string): value is Ask {
  return ASKS.some((one) => one === value)
}

function isAnswer(value: unknown): value is Answer {
  return value === 'allow' || value === 'block'
}

/** The origin a grant is about: the host as the bar shows it, so what somebody allowed
 *  reads as the site they were looking at. */
export function siteOf(url: string | null): string {
  return url === null ? '' : plainOrigin(url)
}

/** A request a site has made and nobody has answered yet.
 *
 *  It is held open in the engine while this exists, so the page is waiting on the
 *  bubble exactly the way it waits on Chrome's. */
export interface Asking {
  /** Which request, as the crate calls it: what the answer is sent back with. */
  id: number
  /** The tab whose page asked, so the bubble appears over that pane and no other. */
  tab: string
  /** The origin, as the bubble shows it. */
  site: string
  ask: Ask
}

/** What the crate says when a site asks for something. Read rather than trusted: an
 *  event is a boundary like any other. */
export function readAsked(value: unknown): Asking | null {
  if (!isRecord(value)) return null

  const { tab, id, origin, kind } = value
  if (typeof tab !== 'string' || typeof id !== 'number') return null
  if (typeof origin !== 'string' || typeof kind !== 'string' || !isAsk(kind)) return null

  return { id, tab, site: plainOrigin(origin) || origin, ask: kind }
}

class Grants {
  /** What each site was told, by origin and then by what it asked for. */
  private by = $state<Record<string, Partial<Record<Ask, Answer>>>>({})

  /** The requests waiting for an answer, oldest first: one bubble at a time, like a
   *  browser, and the next one appears as the last is answered. */
  asking = $state<Asking[]>([])

  constructor() {
    const read = stored(STORAGE_KEY)
    if (!isRecord(read)) return

    const out: Record<string, Partial<Record<Ask, Answer>>> = {}
    for (const [site, value] of Object.entries(read)) {
      if (!isRecord(value)) continue

      const said: Partial<Record<Ask, Answer>> = {}
      for (const [kind, answer] of Object.entries(value)) {
        if (isAsk(kind) && isAnswer(answer)) said[kind] = answer
      }
      if (Object.keys(said).length) out[site] = said
    }
    this.by = out
  }

  /** Everything this site has been told, which is nothing until it asked. */
  of(site: string): Partial<Record<Ask, Answer>> {
    return this.by[site] ?? {}
  }

  /** What this site was told about one thing, or null for one nobody has decided. */
  said(site: string, ask: Ask): Answer | null {
    return this.of(site)[ask] ?? null
  }

  /** Remembers an answer. A site with nothing left is taken out, so the store holds the
   *  sites somebody has decided about and no others. */
  remember(site: string, ask: Ask, answer: Answer | null) {
    if (!site) return

    const kept = { ...this.of(site) }
    if (answer === null) delete kept[ask]
    else kept[ask] = answer

    const all = withOrWithout(this.by, site, Object.keys(kept).length ? kept : null)
    this.by = all

    // A device that cannot keep this asks again next time, which is the answer that
    // matters; it just forgets what was said.
    keep(STORAGE_KEY, JSON.stringify(all))
  }

  /** A site has asked for something. Either the reader has already said what this site
   *  may do, in which case the request is answered before anything appears on screen,
   *  or the bubble goes up.
   *
   *  A second request for the same thing while the bubble is up is the same question:
   *  one bubble, and both requests answered by the one press. */
  heard(said: Asking) {
    const already = this.said(said.site, said.ask)
    if (already !== null) {
      void this.tell(said.id, already === 'allow')
      return
    }

    this.asking = [...this.asking, said]
  }

  /** The reader answered. The request is let go of in the engine, the answer is
   *  remembered for this site, and every other request the same press answers goes with
   *  it - a page that asked for the camera twice asked one question. */
  answer(said: Asking, allow: boolean) {
    this.remember(said.site, said.ask, allow ? 'allow' : 'block')

    const same = this.asking.filter((one) => one.site === said.site && one.ask === said.ask)
    this.asking = this.asking.filter((one) => !same.includes(one))
    for (const one of same) void this.tell(one.id, allow)
  }

  /** The bubble was dismissed rather than answered - Escape, or the tab going away
   *  under it. The site is told no and **nothing is remembered**, which is what Chrome
   *  does with a dismissal: somebody who pressed Escape has not decided about the site,
   *  and the next time it asks is a fair time to ask them again. */
  dismiss(said: Asking) {
    this.asking = this.asking.filter((one) => one.id !== said.id)
    void this.tell(said.id, false)
  }

  /** The tab has gone, so its questions have. A request nobody let go of is a promise
   *  the page is still waiting on, which is what a browser leaves behind for a bubble
   *  somebody dismissed - but a closed tab has no page to wait. */
  dropped(tab: string) {
    const gone = this.asking.filter((one) => one.tab === tab)
    if (!gone.length) return

    this.asking = this.asking.filter((one) => one.tab !== tab)
    for (const one of gone) void this.tell(one.id, false)
  }

  private async tell(id: number, allow: boolean): Promise<void> {
    if (!isDesktop) return
    await invoke('web_answer', { id, allow }).catch(() => undefined)
  }

  /** Everything this site was told, forgotten - Chrome's Reset permissions. The page
   *  goes on running: what it already holds it keeps until it asks again, which is
   *  what happens in a browser too. */
  forget(site: string) {
    if (!this.by[site]) return

    const all = withOrWithout(this.by, site, null)
    this.by = all
    keep(STORAGE_KEY, JSON.stringify(all))
  }
}

export const grants = new Grants()
