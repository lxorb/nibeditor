/** The page each web tab is on, and the webview drawing it.
 *
 *  A web tab is a pane with a hole in it. On a desktop the page is not in the
 *  document at all: it is a second webview inside the same window, placed over the
 *  rectangle the pane leaves for it, because a frame cannot show most of the web -
 *  the sites worth reading refuse to be framed, and a tab that showed a refusal
 *  where the page should be would not be a tab. So the pane measures itself and this
 *  tells the crate where to put the page; see src-tauri/src/web_tabs.rs.
 *
 *  In a browser there is no second webview to place, and the state here is the same
 *  state with nothing behind it: the address, the title, and whether the pane is
 *  holding the card or the frame the reader asked for. One store for both builds, so
 *  the bar above the page is one bar.
 *
 *  Memory is honest about itself. A page nobody has looked at for a few minutes is
 *  taken down and the tab remembers where it was, so a window left open for a day
 *  with eight sites in it is not eight browsers; looking at it again opens it where
 *  it was. */

import { invoke, isDesktop } from '../tauri'
import { isWebAddress } from './address'
import { grants, type Grant, siteOf } from './permissions.svelte'

/** How long a page goes on running after the tab showing it went away.
 *
 *  Five minutes, which is long enough that switching between two tabs never reloads
 *  and short enough that a window somebody left open overnight is holding nothing.
 *  A page that is taken down keeps its address, so coming back to the tab is a load
 *  and not a loss. */
const ASLEEP_AFTER = 5 * 60 * 1000

/** Where the pane left room for the page, in the window's own pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Which way a step goes, as the crate names them. */
export type Step = 'back' | 'forward' | 'reload'

/** Where a page should be and whether it should be seen at all: what the pane asked
 *  for while the page was still being built.
 *
 *  Building one is not instant. The crate answers when the platform has handed it a
 *  webview, and in that time the pane can have moved, the tab can have stopped being
 *  the one showing, or the tab can have been closed altogether - so what the pane
 *  asked for in the meantime is kept and applied, rather than assumed not to have
 *  happened. */
interface Wanted {
  pane: Rect
  visible: boolean
}

/** What a browser build is showing in the pane: the card that stands for the page,
 *  or the frame the reader asked for. A desktop has neither - the page is a webview
 *  of its own; see frame.ts for why a browser is asked at all. */
export type Framing = 'card' | 'frame'

/** What the crate says when a page moves. Read rather than trusted: an event is a
 *  boundary like any other. */
interface Moved {
  tab: string
  url: string
  title: string
  back: boolean
  forward: boolean
  loading: boolean
}

function readMoved(value: unknown): Moved | null {
  if (typeof value !== 'object' || value === null) return null

  const said = value as Record<string, unknown>
  if (typeof said.tab !== 'string' || typeof said.url !== 'string') return null

  return {
    tab: said.tab,
    url: said.url,
    title: typeof said.title === 'string' ? said.title : '',
    back: said.back === true,
    forward: said.forward === true,
    loading: said.loading === true,
  }
}

/** One web tab's page. */
export class Page {
  /** Where the page is. The tab's own address until the page says otherwise, so a
   *  tab restored from a session knows where it is going before it gets there. */
  url = $state<string | null>(null)
  /** What the page calls itself, or the empty string before it has said. */
  title = $state('')
  back = $state(false)
  forward = $state(false)
  loading = $state(false)
  /** Whether a webview could be made for this tab at all.
   *
   *  False only when the crate refused to build one - a platform where a second
   *  webview is not to be had, or an address it would not open. The pane then shows
   *  the card a browser build shows, because that is the one surface with somewhere
   *  to send the reader. Given a new address it is worth trying again. */
  openable = $state(true)
  /** What a browser build has in the pane. The card until the reader presses it,
   *  and the frame from then on: one press per tab, because saying yes to a site is
   *  about the tab rather than about each page in it. Never read on a desktop. */
  framing = $state<Framing>('card')

  /** Whether there is a webview behind this tab at the moment. */
  live = $state(false)

  /** Whether one is being built at this moment.
   *
   *  Not reactive and not drawn: the bar and the hole are on screen from the first
   *  frame, and a page arriving is the page appearing. This is here so that a second
   *  placement while the first is in the air does not ask for a second webview under
   *  the same label; the crate refuses that too, and this saves the round trip. */
  opening = false

  /** What the pane asked for while the page was being built. */
  wanted: Wanted | null = null

  /** The grant count the live webview was built under, so a change to what this
   *  site may do is a page built again rather than a page that quietly kept the old
   *  answer. */
  builtAt = 0

  /** Set while the address field is being typed in, so the page reporting a new
   *  title does not rewrite what somebody is halfway through typing. */
  typing = $state(false)

  asleep: ReturnType<typeof setTimeout> | undefined
}

class Pages {
  /** Which tab has which page.
   *
   *  A plain map, deliberately, and this is the one line in the file worth being sure
   *  about. Nothing draws the collection: what a pane draws is one `Page`, and every
   *  field of a page that anything reads is `$state` of its own. A reactive map would
   *  add nothing to that and would take the app down, because a pane asks for its
   *  page from a `$derived` - the tab under a pane can be swapped - and a reaction may
   *  not write to state that was made outside it. Making a page the first time it is
   *  asked for would then throw `state_unsafe_mutation` while Svelte was flushing,
   *  which abandons the batch and leaves the window drawn and no longer reactive: no
   *  menu opens and no button answers. See test/effects/web-pages.effect.test.ts. */
  private readonly held = new Map<string, Page>()

  /** Started once, on the first web tab, and never taken down: the window hears
   *  about every page in it through one listener. */
  private listening = false

  /** The state for a tab, made the first time it is asked for. */
  of(tabId: string): Page {
    const found = this.held.get(tabId)
    if (found) return found

    const made = new Page()
    this.held.set(tabId, made)
    return made
  }

  /** What the tab is pointing at, for the session and for the bar. */
  addressOf(tabId: string): string | null {
    return this.held.get(tabId)?.url ?? null
  }

  /** Puts the page on screen where the pane says, opening it if it is not there.
   *
   *  One call for the whole of "this tab is showing, and this is its rectangle",
   *  because that is one fact: the pane says it on every resize and on every scroll,
   *  and a page that had to be opened, then placed, then shown would flash where the
   *  last one was. */
  async show(tabId: string, url: string, pane: Rect): Promise<void> {
    const page = this.of(tabId)
    this.wake(page)
    page.url ??= url

    if (!isDesktop) {
      page.live = true
      return
    }

    await this.listen()

    const site = siteOf(page.url)
    const stale = page.live && page.builtAt !== grants.changed
    if (stale) await this.sleep(tabId)

    if (page.live) {
      await this.place(tabId, pane, true)
      return
    }

    // A page already on its way. Where the pane is now is where it will be put when
    // it arrives; see `place`.
    if (page.opening) {
      page.wanted = { pane, visible: true }
      return
    }

    await this.build(tabId, page, site, pane)
  }

  /** The webview for a tab, and then whatever happened while it was being built.
   *
   *  The crate builds a page on the window's own thread and answers when the platform
   *  has handed it one, which is long enough for the pane to have moved, for the tab
   *  to have been switched away from, or for the tab to have been closed. None of
   *  those used to be possible - the command was answered inline, which is what froze
   *  the window - so all three are answered here now. */
  private async build(tabId: string, page: Page, site: string, pane: Rect): Promise<void> {
    page.opening = true
    page.builtAt = grants.changed
    const granted: Grant[] = grants.of(site)

    try {
      await invoke('web_open', { tab: tabId, url: page.url, pane, granted })
      page.live = true
      page.openable = true
    } catch {
      // No webview to be had here. Reported by the pane rather than by a message:
      // it shows the card, which offers the page in the reader's own browser.
      page.openable = false
    } finally {
      page.opening = false
    }

    const wanted = page.wanted
    page.wanted = null
    if (!page.live) return

    // The tab was closed while its page was being built. Nothing is left to place it,
    // and a page nothing places is a browser running behind the window.
    if (this.held.get(tabId) !== page) {
      page.live = false
      await invoke('web_close', { tab: tabId }).catch(() => undefined)
      return
    }

    if (!wanted) return
    if (wanted.visible) await this.place(tabId, wanted.pane, true)
    // Out of sight, and counting down to being taken down: the countdown that should
    // have started when the tab was switched away from found no page to start it on.
    else this.hide(tabId, wanted.pane)
  }

  /** Where the page sits, and whether it is on screen at all. A tab that is not the
   *  one showing hides its page rather than closing it: coming back to a tab should
   *  not be a reload. */
  async place(tabId: string, pane: Rect, visible: boolean): Promise<void> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page) return

    // The page is still being built. Where it goes, and whether it is seen at all, is
    // what the pane says now rather than what it said when the page was asked for: a
    // tab switched away from while its page was on its way must not have the page
    // arrive over the tab that took its place.
    if (page.opening) {
      page.wanted = { pane, visible }
      return
    }

    if (!page.live) return

    try {
      await invoke('web_place', { tab: tabId, pane, visible })
    } catch {
      // The webview has gone - the window closed under it, or the page was taken
      // down while this was in the air. The next show opens it again.
      page.live = false
    }
  }

  /** The tab is no longer the one on top: the page goes out of sight and starts
   *  counting down to being taken down altogether. */
  hide(tabId: string, pane: Rect) {
    const page = this.held.get(tabId)
    if (!page) return

    void this.place(tabId, pane, false)

    clearTimeout(page.asleep)
    if (!isDesktop) return

    page.asleep = setTimeout(() => void this.sleep(tabId), ASLEEP_AFTER)
  }

  /** Takes the page down but keeps the tab: what a window left open all day costs
   *  after a few minutes of nobody looking. The address stays, so the tab opens
   *  where it was. */
  async sleep(tabId: string): Promise<void> {
    const page = this.held.get(tabId)
    if (!page?.live) return

    page.live = false
    page.loading = false
    await invoke('web_close', { tab: tabId }).catch(() => undefined)
  }

  private wake(page: Page) {
    clearTimeout(page.asleep)
    page.asleep = undefined
  }

  /** Somewhere else, in this tab. */
  async go(tabId: string, url: string): Promise<void> {
    const page = this.of(tabId)
    if (!isWebAddress(url)) return

    page.url = url
    page.openable = true
    // The title belonged to the page that was there. Until the new one says what it
    // is called the bar shows the site, which is true of both.
    page.title = ''

    // A browser build shows the page in whatever the pane already holds: a frame is
    // told where to go by its `src`, which the component watches `url` for, and a
    // card that has not been pressed stays a card.
    if (!isDesktop) return

    if (!page.live) return

    try {
      await invoke('web_navigate', { tab: tabId, url })
    } catch {
      // The webview has gone - unloaded while this was in the air, or the window
      // closed under it. It holds the new address already, so the next placement
      // opens it there.
      page.live = false
    }
  }

  /** Back, forward, or the same page again. The same keys a note tab steps its own
   *  trail with; see `workspace.goBack`. */
  async step(tabId: string, step: Step): Promise<void> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live) return

    await invoke('web_step', { tab: tabId, step }).catch(() => {
      // Same as an address that could not be sent: the page has gone, and the next
      // placement opens it again where it was.
      page.live = false
    })
  }

  /** The page, read for a clip: where it is, what it is called, and the HTML of the
   *  part worth keeping. Null where there is nothing to read, which is a browser
   *  build - a frame's document belongs to the site and not to us. */
  async read(
    tabId: string,
    selection: boolean,
  ): Promise<{ url: string; title: string; html: string } | null> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live) return null

    try {
      return await invoke<{ url: string; title: string; html: string }>('web_clip', {
        tab: tabId,
        selection,
      })
    } catch {
      // A page that cannot be read is a clip of what the app knows about it: the
      // address and the title, which is what a browser build always writes. See
      // clip.ts.
      return null
    }
  }

  /** The tab has closed. Nothing is kept: the webview goes with it. */
  forget(tabId: string) {
    const page = this.held.get(tabId)
    if (!page) return

    clearTimeout(page.asleep)
    this.held.delete(tabId)
    if (isDesktop) void invoke('web_close', { tab: tabId }).catch(() => undefined)
  }

  /** Every page whose tab has gone, closed.
   *
   *  For the one way tabs disappear without being closed one at a time: an
   *  arrangement put in place over the top of them - a saved layout, a session, a
   *  window becoming a phone. A webview nothing is left to place is a browser
   *  running behind an app with nowhere to draw it. */
  keepOnly(ids: readonly string[]) {
    const kept = new Set(ids)
    for (const tabId of [...this.held.keys()]) {
      if (!kept.has(tabId)) this.forget(tabId)
    }
  }

  /** One listener for the window, started by the first web tab that needs it. */
  private async listen(): Promise<void> {
    if (this.listening || !isDesktop) return
    this.listening = true

    const { listen } = await import('@tauri-apps/api/event')
    await listen('nib://web-tab', (event) => {
      const said = readMoved(event.payload)
      if (!said) return

      const page = this.held.get(said.tab)
      if (!page) return

      page.loading = said.loading
      page.back = said.back
      page.forward = said.forward
      if (said.url && !page.typing) page.url = said.url
      if (said.title) page.title = said.title
    })
  }
}

export const pages = new Pages()
