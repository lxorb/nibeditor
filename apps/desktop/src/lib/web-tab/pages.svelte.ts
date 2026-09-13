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
 *  **A web note is a browser tab.** While the app is running, an open web tab keeps
 *  its page: switching to a note and back hides the webview and shows it again, and
 *  never closes it, because closing one is a browser process and a load of the site
 *  and everything the reader had done on the page. Where the tab is - the address,
 *  the place on the page, the trail behind it - is kept whether the page is running or
 *  not, so reopening the note tomorrow on another machine opens the page that was
 *  open and not the site's front door. Which half is kept where is one rule, written
 *  down in docs/web-tabs.md: the address is in the file, because that is the document
 *  and it syncs; the place and the trail are this device's, because they are about
 *  this screen.
 *
 *  Memory is bounded, the way Chrome bounds it. A page nobody has looked at for half
 *  an hour is parked - the webview goes, the tab keeps everything about itself - and
 *  so is the least recently looked at page over the cap, so a window left open all
 *  day with thirty sites in it is not thirty browsers. Looking at a parked tab again
 *  opens the page where it was, at the place it was at. */

import { invoke, isDesktop } from '../tauri'
import { isWebAddress } from './address'
import { grants, readAsked } from './permissions.svelte'
import { placeOf, placeKept } from './place'

/** How long a parked page's webview goes on running after the tab showing it went
 *  away.
 *
 *  Half an hour, which is what Chrome's own memory saver waits before it discards a
 *  background tab: long enough that coming back to something read this morning is
 *  still instant, short enough that a window left open overnight holds nothing. A
 *  parked page keeps its address, its place and its trail, so coming back is a load
 *  and not a loss. */
const PARKED_AFTER = 30 * 60 * 1000

/** How many pages may be running at once.
 *
 *  Eight, beyond which the least recently looked at is parked: the cost of a page is
 *  a browser's cost, and a window with thirty web tabs in it is a window somebody
 *  has thirty bookmarks in and is reading one of. The one on screen is never the one
 *  parked. */
const LIVE_AT_MOST = 8

/** How long a still picture of a page stands for the page. Under half a second, so
 *  two overlays in a row share one and a page that has scrolled since is
 *  photographed again. */
const SHOT_KEEPS = 400

/** How long the engine is given to photograph itself, for the one caller that has to
 *  wait for it.
 *
 *  A page is normally photographed on the press that is about to open something over
 *  it, which costs the overlay nothing at all. This is the cap for an overlay that
 *  arrived without a press, where the menu is behind the page until the picture lands
 *  and a slow picture would be worse than none. */
const SHOT_WAITS = 120

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
  icon: string
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
    icon: typeof said.icon === 'string' ? said.icon : '',
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
  /** The site's own mark, as an address the window can load: what the page's
   *  `<link rel=icon>` says, or the site's `/favicon.ico` where it says nothing.
   *
   *  Null until the page has loaded, and the tab strip draws the one the file
   *  remembered until then - so a tab has the site's mark before the page is there
   *  and on a machine that has never opened it. See shortcut.ts for where it is
   *  kept. */
  icon = $state<string | null>(null)
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

  /** Set while the address field is being typed in, so the page reporting a new
   *  title does not rewrite what somebody is halfway through typing. */
  typing = $state(false)

  /** A still picture of the page, as a data address, from the last time anything was
   *  about to be drawn over it.
   *
   *  A native webview cannot be drawn under the window's own HTML, so a menu over a
   *  page means hiding the page - and a pane that went blank under every menu was the
   *  worst thing about a web tab. The picture is what the hole holds while the page is
   *  out of sight, which is also what stands in while a parked page is loading again,
   *  so nothing about an overlay or a revival flashes. */
  shot = $state<string | null>(null)
  /** When that picture was taken, so two overlays in a row share one. */
  shotAt = 0

  /** The file this tab is showing, or null for a tab with no file yet. Set by the
   *  pane, because the store keeps what is about the page and the tab keeps what is
   *  about the document - and where the reading got to is kept by path, so that
   *  closing the tab and opening the note tomorrow lands back on it. See place.ts. */
  path: string | null = null

  /** When this tab was last looked at, so the least recently looked at is the one
   *  parked when there are more pages running than a window should hold. */
  looked = Date.now()

  /** The countdown to being parked, running while nobody is looking at this tab. */
  parking: ReturnType<typeof setTimeout> | undefined
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

    await this.build(tabId, page, pane)
  }

  /** The webview for a tab, and then whatever happened while it was being built.
   *
   *  The crate builds a page on the window's own thread and answers when the platform
   *  has handed it one, which is long enough for the pane to have moved, for the tab
   *  to have been switched away from, or for the tab to have been closed. None of
   *  those used to be possible - the command was answered inline, which is what froze
   *  the window - so all three are answered here now. */
  private async build(tabId: string, page: Page, pane: Rect): Promise<void> {
    page.opening = true

    // Where this tab was left, if it is the page being opened: a parked tab comes back
    // at the place it was parked at, and a note opened again tomorrow comes back at the
    // place the reading got to. The crate restores it inside the page as it loads,
    // which is the only moment it can be done without a jump; see web_tabs.rs.
    const kept = placeOf(page.path)
    const place = kept && kept.url === page.url ? { x: kept.x, y: kept.y } : null
    const trail = kept?.url === page.url ? (kept?.trail ?? []) : []

    try {
      await invoke('web_open', {
        tab: tabId,
        url: page.url,
        pane,
        revived: { place, trail, at: kept?.at ?? Math.max(0, trail.length - 1) },
      })
      page.live = true
      page.openable = true
      this.bound(tabId)
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
      await invoke('web_close', { tab: tabId, keep: false }).catch(() => undefined)
      return
    }

    if (!wanted) return
    if (wanted.visible) await this.place(tabId, wanted.pane, true)
    // Out of sight, and counting down to being taken down: the countdown that should
    // have started when the tab was switched away from found no page to start it on.
    else this.hide(tabId, wanted.pane)
  }

  /** Where the page sits, and whether it is on screen at all.
   *
   *  A page is hidden for two quite different reasons and closed for neither. The tab
   *  is not the one showing, which is `hide`; or something of the app's is over it,
   *  which is `covering` - and that one takes a picture of the page first, so what the
   *  pane holds under the menu is the page rather than nothing. */
  async place(tabId: string, pane: Rect, visible: boolean, covering = false): Promise<void> {
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
    if (covering) await this.shoot(tabId)

    try {
      await invoke('web_place', { tab: tabId, pane, visible })
    } catch {
      // The webview has gone - the window closed under it, or the page was taken
      // down while this was in the air. The next show opens it again.
      page.live = false
    }
  }

  /** The tab is no longer the one showing.
   *
   *  The page goes out of sight and **goes on running**: a web note is a browser tab,
   *  so coming back to it is not a load. What starts here is the countdown to being
   *  parked - the one thing that does close a webview - and a note of where the reading
   *  had got to, which is what makes reopening the note tomorrow land on this page at
   *  this place. */
  hide(tabId: string, pane: Rect) {
    const page = this.held.get(tabId)
    if (!page) return

    void this.place(tabId, pane, false)
    if (!isDesktop) return

    void this.look(tabId)
    clearTimeout(page.parking)
    page.parking = setTimeout(() => void this.park(tabId), PARKED_AFTER)
  }

  /** Parks the page and keeps the tab: the webview goes and everything about where the
   *  tab is stays, so looking at it again opens the page it was on at the place it was
   *  at. What a window left open all day costs after half an hour of nobody looking,
   *  and what the page over the cap costs the moment there is one too many. */
  async park(tabId: string): Promise<void> {
    const page = this.held.get(tabId)
    if (!page?.live) return

    await this.look(tabId)
    page.live = false
    page.loading = false
    clearTimeout(page.parking)
    // The trail stays in the crate, so the arrows over a page that has just been
    // revived are right from the first frame.
    await invoke('web_close', { tab: tabId, keep: true }).catch(() => undefined)
  }

  /** Reads where the page has got to and writes it down for this device. Quiet about
   *  failure: a page that has gone is a page whose place was already written when it
   *  went. */
  private async look(tabId: string): Promise<void> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live || !page.path) return

    try {
      const said = await invoke<{ url: string; x: number; y: number; trail: string[]; at: number }>(
        'web_look',
        { tab: tabId },
      )
      placeKept(page.path, {
        url: said.url,
        x: said.x,
        y: said.y,
        trail: said.trail,
        at: said.at,
      })
    } catch {
      // Nothing to write down. The next look answers, or the tab has closed.
    }
  }

  /** A still picture of the page as it is now, kept on the page's state for the hole to
   *  hold while the webview is out of sight.
   *
   *  Taken on the press that is about to open something over the page - which is what
   *  the pane calls this on, and the last moment at which the page is both current and
   *  visible - and once more, with a cap on the wait, for an overlay that arrived
   *  without a press. One picture per few hundred milliseconds, so a menu and the sheet
   *  it opens share one. */
  async shoot(tabId: string): Promise<void> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live) return
    if (page.shot && Date.now() - page.shotAt < SHOT_KEEPS) return

    try {
      // Raced against a clock, because the overlay is behind the page until this
      // answers: the engine photographs itself in a handful of milliseconds or it is
      // not going to, and a menu waiting on a picture is worse than a menu over an
      // empty pane.
      const said = await Promise.race([
        invoke<string | null>('web_shot', { tab: tabId }),
        new Promise<null>((go) => setTimeout(() => go(null), SHOT_WAITS)),
      ])
      if (said) {
        page.shot = said
        page.shotAt = Date.now()
      }
    } catch {
      // A platform with no way to photograph a webview. The hole keeps its own
      // ground, which is what it held before there was a picture to hold.
    }
  }

  /** This tab has just been looked at: nothing is counting down for it, and it is the
   *  newest thing in the window. */
  private wake(page: Page) {
    clearTimeout(page.parking)
    page.parking = undefined
    page.looked = Date.now()
  }

  /** Keeps the number of pages running inside the cap, by parking the ones nobody has
   *  looked at for longest. Called when one more has just been built.
   *
   *  The tab that has just been opened is the newest looked at, so it is never the one
   *  parked; a tab on screen beside it in another pane was looked at a moment ago and
   *  is only parked once the window holds nine pages, which is a window nobody is
   *  reading. */
  private bound(tabId: string) {
    this.of(tabId).looked = Date.now()

    const live = [...this.held.entries()].filter(([, page]) => page.live)
    if (live.length <= LIVE_AT_MOST) return

    const oldest = live.sort(([, one], [, other]) => one.looked - other.looked)
    for (const [id] of oldest.slice(0, live.length - LIVE_AT_MOST)) void this.park(id)
  }

  /** Somewhere else, in this tab. */
  async go(tabId: string, url: string): Promise<void> {
    const page = this.of(tabId)
    if (!isWebAddress(url)) return

    page.url = url
    page.openable = true
    // The title, the mark and the picture all belonged to the page that was there.
    // Until the new one says what it is called the bar shows the site, which is true
    // of both.
    page.title = ''
    page.icon = null
    page.shot = null

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

  /** How large the page is drawn: a browser's own zoom, on the tab it was asked for.
   *  See `ZOOMS` in menu.ts for the ladder the rows step along. */
  async zoom(tabId: string, factor: number): Promise<void> {
    if (!isDesktop || !this.held.get(tabId)?.live) return
    await invoke('web_zoom', { tab: tabId, factor }).catch(() => undefined)
  }

  /** The engine's own print dialog for the page - the one the reader knows from their
   *  browser, rather than anything of nib's, which is about a note. */
  async print(tabId: string): Promise<void> {
    if (!isDesktop || !this.held.get(tabId)?.live) return
    await invoke('web_print', { tab: tabId }).catch(() => undefined)
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

  /** The tab has closed. The webview goes with it, and so does the trail: a tab
   *  somebody closed is not a tab anybody is coming back to. Where the reading got to
   *  stays on the device, because the note can be opened again. */
  forget(tabId: string) {
    const page = this.held.get(tabId)
    if (!page) return

    clearTimeout(page.parking)
    this.held.delete(tabId)
    grants.dropped(tabId)
    if (isDesktop) void invoke('web_close', { tab: tabId, keep: false }).catch(() => undefined)
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

  /** Two listeners for the window, started by the first web tab that needs them: where
   *  every page in the window has got to, and what every site in it has asked for. */
  private async listen(): Promise<void> {
    if (this.listening || !isDesktop) return
    this.listening = true

    const { listen } = await import('@tauri-apps/api/event')

    // A site has asked for the camera, the microphone, where you are, notifications or
    // the clipboard to read. The request is held open in the engine until this is
    // answered, which is what lets the reader be asked at the moment they pressed
    // something rather than in a menu beforehand; see permissions.svelte.ts.
    await listen('nib://web-ask', (event) => {
      const said = readAsked(event.payload)
      if (said && this.held.has(said.tab)) grants.heard(said)
    })
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
      if (said.icon) page.icon = said.icon
      // The page has arrived, so the picture of the last one is no longer a picture of
      // this page. Nothing is drawn from it while the webview is on top.
      if (!said.loading) page.shot = null
    })
  }
}

export const pages = new Pages()
