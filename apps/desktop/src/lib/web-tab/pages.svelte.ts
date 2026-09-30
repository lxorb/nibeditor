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

/** This device's history, asked for by the first page that says where it is rather
 *  than carried: this store is in front of the first paint, because the workspace
 *  names a new web note's title through it, and the history is not. Every call waits
 *  on the one import, so what the pages say lands in the order they said it. See
 *  visited.ts and test/weight.test.ts. */
function history(): Promise<typeof import('./visited').visited> {
  return import('./visited').then((module) => module.visited)
}

/** Which store each space keeps its web data in, asked for the same way and for the
 *  same reason: the first page is the first thing that needs it. See web-data.ts. */
function stores(): Promise<typeof import('./web-data.svelte').webData> {
  return import('./web-data.svelte').then((module) => module.webData)
}

/** A page's `alert`, `confirm` and `prompt`, asked for the same way: no page can open
 *  one before a page is open, so the store is not carried in front of the first paint.
 *  See dialogs.svelte.ts and test/weight.test.ts. */
function pageDialogs(): Promise<typeof import('./dialogs.svelte')> {
  return import('./dialogs.svelte')
}

/** How long a parked page's webview goes on running after the tab showing it went
 *  away.
 *
 *  Half an hour, which is what Chrome's own memory saver waits before it discards a
 *  background tab: long enough that coming back to something read this morning is
 *  still instant, short enough that a window left open overnight holds nothing. A
 *  parked page keeps its address, its place and its trail, so coming back is a load
 *  and not a loss. */
const PARKED_AFTER = 30 * 60 * 1000

/** How many pages may be running at once, beyond which the least recently looked at is
 *  parked.
 *
 *  The cost of a page is a browser's cost, and it was measured rather than guessed:
 *  `scripts/web-switch-probe.py` reads what the webview processes under this launch are
 *  holding, and one open page on this machine is about 180 MB. Six is a working set -
 *  what somebody is reading and the handful they are going back and forth to - at a bit
 *  over a gigabyte, which is what a browser with six tabs in it costs and is the honest
 *  price of never reloading one. A window with thirty web tabs in it is a window
 *  somebody has thirty bookmarks in and is reading one of. The one on screen is never
 *  the one parked. */
const LIVE_AT_MOST = 6

/** How long a still picture of a page stands for the page. Under half a second, so
 *  two overlays in a row share one and a page that has scrolled since is
 *  photographed again. */
const SHOT_KEEPS = 400

/** How long the page is given to say where it is before it is parked anyway. Half a
 *  second: the answer is a line of script in the page's own document, and a page that
 *  has not answered in that long is a page busy with something of its own. */
const LOOK_WAITS = 500

/** How long the engine is given to photograph itself, for the one caller that has to
 *  wait for it.
 *
 *  A page is normally photographed on the press that is about to open something over it
 *  and again as it finishes loading, which costs the overlay nothing at all: the picture
 *  is already there. This is the cap for the one case that has to wait - the first thing
 *  ever drawn over a page nothing has photographed - and it is set from what the engine
 *  actually takes, which is about 105 ms for a pane-sized PNG on this machine. */
const SHOT_WAITS = 300

/** How long after a page has loaded its mark still counts as the one it arrived with,
 *  which is the one its file keeps. Three seconds: a site that sets its mark with a
 *  script does it in the breath after the load - web.whatsapp.com adds its own 1.3 s
 *  after it, measured - and one that redraws its mark with an unread count does it when
 *  a message comes, which is later than that. */
const ARRIVES = 3000

/** Where the pane left room for the page, in the window's own pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Which way a step goes, as the crate names them: `fresh` is Chrome's Ctrl+Shift+R,
 *  the page again past the cache, and `stop` the cross the reload glyph turns into
 *  while a page is coming. */
export type Step = 'back' | 'forward' | 'reload' | 'fresh' | 'stop'

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
  /** Why it is out of sight, for the one case where the two answers differ: something
   *  of the app's is over the page, which leaves the tab in front and nothing counting
   *  down for it. A tab that was switched away from is the other, and that one starts
   *  the countdown to being parked. */
  covering: boolean
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

/** What the crate says when a page's mark changes: which tab, and the picture, as an
 *  address nothing has to fetch again - or the empty string for a page with none. See
 *  web_icons.rs. */
interface Iconed {
  tab: string
  icon: string
}

function readIconed(value: unknown): Iconed | null {
  if (typeof value !== 'object' || value === null) return null

  const said = value as Record<string, unknown>
  if (typeof said.tab !== 'string' || typeof said.icon !== 'string') return null

  return { tab: said.tab, icon: said.icon }
}

/** What the crate says when a page asks for a window of its own: which tab asked,
 *  where it wants to go, and whether the reader asked for it behind - a Ctrl+click,
 *  the middle button, the page's own "open in a new tab" - or in front. Read rather
 *  than trusted, like everything else that crosses that line - and this one carries an
 *  address a site chose, so the rule about which addresses a tab may hold is asked
 *  again on the side that would open one. */
interface Opening {
  tab: string
  url: string
  behind: boolean
}

export function readOpening(value: unknown): Opening | null {
  if (typeof value !== 'object' || value === null) return null

  const said = value as Record<string, unknown>
  if (typeof said.tab !== 'string' || typeof said.url !== 'string') return null

  return isWebAddress(said.url)
    ? { tab: said.tab, url: said.url, behind: said.behind === true }
    : null
}

/** One web tab's page. */
export class Page {
  /** Where the page is. The tab's own address until the page says otherwise, so a
   *  tab restored from a session knows where it is going before it gets there. */
  url = $state<string | null>(null)
  /** What the page calls itself, or the empty string before it has said. */
  title = $state('')
  /** The site's own mark as the page shows it now, as an address the window draws
   *  without fetching anything: the picture the engine chose for the page, from inside
   *  the page's own profile. It follows the page, so a site that redraws its mark with
   *  an unread count is redrawn here too. See web_icons.rs.
   *
   *  Null until the page has said, and the tab strip draws the one the file
   *  remembered until then - so a tab has the site's mark before the page is there
   *  and on a machine that has never opened it. */
  icon = $state<string | null>(null)
  /** The mark the page arrived with: the last one it showed between its load
   *  beginning and `ARRIVES` after the load ended, which is the one its file keeps.
   *  Not every one after that, because a mark a site redraws with an unread count
   *  would rewrite the note - and sync it - on every message; the next visit brings a
   *  site's new mark to the file instead. See keep.ts and shortcut.ts. */
  kept = $state<string | null>(null)
  /** Until when the mark the page shows is the one it arrived with, as a time; while
   *  it is loading, for ever. Not drawn. */
  arriving = Infinity
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
  /** The picture being taken at this moment, if one is.
   *
   *  Photographing a page is the most expensive thing the crate does for one - a fifth
   *  of a second, measured - and the engine says where a page is several times in the
   *  breath after it loads: once for the load, once for the title and once for the
   *  mark. Each of those used to throw the picture away and ask for another, so a page
   *  arriving cost three photographs at once. One at a time, and the ones behind it
   *  wait for the one in front rather than asking again. */
  shooting: Promise<void> | null = null

  /** Whether the webview is on screen at this moment.
   *
   *  Not drawn and not reactive: it is here so that nothing photographs a page that is
   *  out of sight. A hidden webview has no composited frame to hand over, and a blank
   *  picture would be worse than none - it is what the pane holds under the next menu. */
  shown = false

  /** The file this tab is showing, or null for a tab with no file yet. Set by the
   *  pane, because the store keeps what is about the page and the tab keeps what is
   *  about the document - and where the reading got to is kept by path, so that
   *  closing the tab and opening the note tomorrow lands back on it. See place.ts. */
  path: string | null = null

  /** Where the first load in this tab finished, or null before it has. What the
   *  page leaving it is measured against, which is what keeps a previewed website;
   *  see used.ts. Not drawn, and read only alongside `url`, which is. */
  landed: string | null = null

  /** Whether a document of the page's own has arrived: the engine named one. A tab a
   *  page asked for whose only address turned out to be a file never has one, and that
   *  is the tab a browser closes again; see `downloaded`. Not drawn. */
  titled = false

  /** Which space the tab belongs to, which decides the store its page is built in and
   *  the history it adds to. Set by the pane, which knows the space the way it knows the
   *  file; see web-data.ts. */
  space: string | null = null

  /** Where the pane last put the page, so a page built again in another store goes back
   *  where it was; see `restore`. */
  pane: Rect | null = null

  /** When this tab was last looked at, so the least recently looked at is the one
   *  parked when there are more pages running than a window should hold. */
  looked = Date.now()

  /** The countdown to being parked, running while nobody is looking at this tab. */
  parking: ReturnType<typeof setTimeout> | undefined

  /** The page's mark has changed. Empty is a page with none, which leaves the tab
   *  the file's mark again and the file its own. */
  marked(icon: string) {
    this.icon = icon || null
    if (icon && Date.now() <= this.arriving) this.kept = icon
  }

  /** A load began or ended, which opens the window a mark arrives in or starts it
   *  closing. */
  loaded(loading: boolean) {
    this.arriving = loading ? Infinity : Date.now() + ARRIVES
  }

  /** What the engine says beside where the page is; see heard.ts. */
  playing = $state(false)
  muted = $state(false)
  filling = $state(false)
  zoom = $state(1)
  find = $state({ open: false, query: '', count: 0, at: -1 })
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

    // The window's two listeners, started with the first page in the window rather
    // than with the first placement. They are a fetch and two round trips, and they
    // used to sit in front of `web_open` on the one path that decides how long a site
    // takes to appear: nine milliseconds of a hundred and forty, spent doing something
    // that had nothing to do with this tab. Asked for here they are answered by the
    // time a pane has measured itself. Nothing is awaited - a listener that is not
    // ready yet is one the placement still waits for; see `show`.
    void this.listen()

    const made = new Page()
    this.held.set(tabId, made)
    return made
  }

  /** What the tab is pointing at, for the session and for the bar. */
  addressOf(tabId: string): string | null {
    return this.held.get(tabId)?.url ?? null
  }

  /** Puts the page where the pane says, opening it if it is not there, and lets it be
   *  seen unless something of the app's is over it.
   *
   *  One call for the whole of "this tab is showing, and this is its rectangle",
   *  because that is one fact: the pane says it on every resize and on every scroll,
   *  and a page that had to be opened, then placed, then shown would flash where the
   *  last one was.
   *
   *  **What is over the hole decides how the page is placed and never whether there is
   *  one.** It used to decide both - a covered pane asked for no page at all - and that
   *  is what "browser tabs take an eternity to load" was: every way of opening a
   *  website except clicking its row goes through a layer, the pane is measured while
   *  that layer is still playing its way out, and the one moment the page was ever
   *  asked for was spent on a hit test. See `look` in WebTab.svelte. */
  async show(tabId: string, url: string, pane: Rect, visible = true): Promise<void> {
    const page = this.of(tabId)
    this.wake(page)
    page.url ??= url

    if (!isDesktop) {
      page.live = true
      return
    }

    await this.listen()

    if (page.live) {
      await this.place(tabId, pane, visible, !visible)
      return
    }

    // A page already on its way. Where the pane is now is where it will be put when
    // it arrives; see `place`.
    if (page.opening) {
      page.wanted = { pane, visible, covering: !visible }
      return
    }

    await this.build(tabId, page, pane, visible)
  }

  /** An agent's page handed to a tab just made for it, without loading it again
   *  (docs/agent-native.md 6.7). The page counts as on its way until `handing` answers,
   *  so the pane's first look is kept rather than answered with a second page; one the
   *  crate could not hand over (parked) is built the ordinary way. */
  async adopt(tabId: string, handing: () => Promise<void>): Promise<void> {
    const page = this.of(tabId)
    if (!isDesktop) {
      await handing()
      return
    }

    page.opening = true
    let handed = false
    try {
      await this.listen()
      await handing()
      handed = true
      page.live = true
      page.openable = true
      this.bound(tabId)
    } catch {
      // Nothing to hand over: built below like any other.
    } finally {
      page.opening = false
    }

    const wanted = page.wanted
    page.wanted = null
    if (!wanted) return
    if (handed) await this.place(tabId, wanted.pane, wanted.visible, wanted.covering)
    else await this.build(tabId, page, wanted.pane, wanted.visible)
  }

  /** The webview for a tab, and then whatever happened while it was being built.
   *
   *  The crate builds a page on the window's own thread and answers when the platform
   *  has handed it one, which is long enough for the pane to have moved, for the tab
   *  to have been switched away from, or for the tab to have been closed. None of
   *  those used to be possible - the command was answered inline, which is what froze
   *  the window - so all three are answered here now. */
  private async build(tabId: string, page: Page, pane: Rect, visible: boolean): Promise<void> {
    page.opening = true

    // Out of sight from the frame it arrives in, where something of the app's is over
    // the hole: a native webview draws above every pixel of HTML in the window, so a
    // page built under a menu would be a page in front of it. Said here rather than
    // after the build because the build is what takes the time, and the pane is free to
    // say something else while it happens; the tail below applies whichever came last.
    if (!visible) page.wanted = { pane, visible, covering: true }

    // Where this tab was left, if it is the page being opened: a parked tab comes back
    // at the place it was parked at, and a note opened again tomorrow comes back at the
    // place the reading got to. The crate restores it inside the page as it loads,
    // which is the only moment it can be done without a jump; see web_tabs.rs.
    // Only when it is this page's place: a tab that followed a link on the way in is a
    // tab whose place belongs to the page it came from.
    const kept = placeOf(page.path)
    const here = kept?.url === page.url ? kept : null
    const place = here ? { x: here.x, y: here.y } : null
    const trail = here?.trail ?? []

    page.pane = pane

    try {
      await invoke('web_open', {
        tab: tabId,
        url: page.url,
        pane,
        revived: { place, trail, at: kept?.at ?? Math.max(0, trail.length - 1) },
        // Which store the site's cookies and storage go in, which is its space's
        // choice; see web-data.ts.
        store: await (await stores()).store(page.space, page.url),
      })
      page.live = true
      page.openable = true
      // A webview the crate has just built is on screen at the rectangle it was built
      // at: nothing has to place it to make that true, and the first thing drawn over
      // the page would otherwise photograph nothing. See `shoot`.
      page.shown = true
      this.bound(tabId)
    } catch {
      // No webview to be had here. Reported by the pane rather than by a message:
      // it shows the card, which offers the page in the reader's own browser.
      // The label is cleared first: the crate refuses a second page under a label that
      // has one, and a page nothing places any more is drawn over the whole app.
      await invoke('web_close', { tab: tabId, keep: false }).catch(() => undefined)
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
    // Something of the app's is over the hole. Out of sight and still the tab in front,
    // so nothing counts down for it - and nothing is photographed either: a page that
    // has this moment been built has nothing on it worth standing in for it.
    else if (wanted.covering) await this.place(tabId, wanted.pane, false)
    // Out of sight, and counting down to being taken down: the countdown that should
    // have started when the tab was switched away from found no page to start it on.
    else this.hide(tabId, wanted.pane)
  }

  /** Where the page sits, and whether it is on screen at all.
   *
   *  A page is hidden for two quite different reasons and closed for neither. The tab
   *  is not the one showing, which is `hide`; or something of the app's is over it,
   *  which is `covering` - and that one takes a picture of the page first, so what the
   *  pane holds under the menu is the page rather than nothing.
   *
   *  **`live` gates showing a page and never hiding one.** It is only the window's
   *  belief, and a page wrongly believed gone was left drawn over the whole app; see
   *  docs/web-tabs.md. Hiding a page that has gone costs one refused call. */
  async place(tabId: string, pane: Rect, visible: boolean, covering = false): Promise<void> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page) return

    // The page is still being built. Where it goes, and whether it is seen at all, is
    // what the pane says now rather than what it said when the page was asked for: a
    // tab switched away from while its page was on its way must not have the page
    // arrive over the tab that took its place.
    if (page.opening) {
      page.wanted = { pane, visible, covering }
      return
    }

    if (!page.live && visible) return

    // Something is about to be drawn over the page, so the page is photographed first -
    // and how long that may hold the overlay up depends on whether there is already a
    // picture. A page with none pays for one, because a menu over an empty pane is what
    // this is here to stop; a page with one from a moment ago is hidden at once and the
    // new picture lands under the menu. The engine takes about a tenth of a second over
    // it, measured; see `SHOT_WAITS`.
    if (covering) {
      if (page.shot === null) await this.shoot(tabId)
      else void this.shoot(tabId)
    }

    try {
      await invoke('web_place', { tab: tabId, pane, visible })
      // A picture is of one size of page. Shown at another - the notices row came or
      // went, a divider moved - it would leave a band of empty pane under the next menu,
      // so it goes and the next cover waits for a fresh one.
      if (visible && (page.pane?.width !== pane.width || page.pane.height !== pane.height)) {
        page.shot = null
      }
      page.pane = pane
      page.shown = visible
    } catch {
      // The webview has gone, and the next show opens it again. Only a refused show may
      // conclude that: a page wrongly thought gone is built again, where one wrongly
      // given up on is left over the app.
      if (visible) page.live = false
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
    page.playing = false
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
    if (!page?.path) return

    const said = await this.whereIs(tabId)
    if (!said) return

    placeKept(page.path, {
      url: said.url,
      x: said.x,
      y: said.y,
      trail: said.trail,
      at: said.at,
    })
  }

  /** Where a live page is, and the trail behind it, or null for a page that has gone
   *  or will not say.
   *
   *  Raced against a clock, because the answer comes out of the page itself: a page
   *  busy in a loop of its own answers nothing, and parking is what takes the memory
   *  back - so a page that will not say where it is is parked without its place rather
   *  than left running for ever. */
  private async whereIs(
    tabId: string,
  ): Promise<{ url: string; x: number; y: number; trail: string[]; at: number } | null> {
    if (!isDesktop || !this.held.get(tabId)?.live) return null

    try {
      return await Promise.race([
        invoke<{ url: string; x: number; y: number; trail: string[]; at: number }>('web_look', {
          tab: tabId,
        }),
        new Promise<null>((go) => setTimeout(() => go(null), LOOK_WAITS)),
      ])
    } catch {
      // Nothing to read. The next look answers, or the tab has closed.
      return null
    }
  }

  /** The address one step back or on would land on, for the arrow pressed with the
   *  middle button or a modifier, which opens it in a tab of its own the way Chrome
   *  does; see `workspace.stepAside`. Null where there is no step to take. */
  async stepAddress(tabId: string, by: -1 | 1): Promise<string | null> {
    const said = await this.whereIs(tabId)
    return said?.trail[said.at + by] ?? null
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
    if (!isDesktop || !page?.live || !page.shown) return
    if (page.shot && Date.now() - page.shotAt < SHOT_KEEPS) return
    // One at a time. The picture already being taken is this page as it is now, and a
    // second engine capture alongside it is a fifth of a second of the window's own
    // thread spent twice for one answer; see `shooting`.
    if (page.shooting) return page.shooting

    const taking = this.photograph(page, tabId)
    page.shooting = taking
    try {
      await taking
    } finally {
      page.shooting = null
    }
  }

  /** The picture itself, raced against a clock. Split from `shoot` so that the one
   *  going on at the moment is something a second caller can wait for. */
  private async photograph(page: Page, tabId: string): Promise<void> {
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
   *  **A page on screen is never parked**, whatever the clock says: two panes side by
   *  side are two pages somebody is looking at, and a page that went out from under the
   *  reader because a seventh tab was opened somewhere else would be the worst kind of
   *  saving. So the cap is only ever spent on pages nobody can see, and a window with
   *  more panes than the cap keeps them all. */
  private bound(tabId: string) {
    this.of(tabId).looked = Date.now()

    const running = [...this.held.values()].filter((page) => page.live).length
    const over = running - LIVE_AT_MOST
    if (over <= 0) return

    const hidden = [...this.held.entries()].filter(([, page]) => page.live && !page.shown)
    const oldest = hidden.sort(([, one], [, other]) => one.looked - other.looked)
    for (const [id] of oldest.slice(0, over)) void this.park(id)
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
    // card that has not been pressed stays a card. The frame's document is the site's
    // and says nothing back, so going there is the whole of the visit it can see.
    if (!isDesktop) {
      void this.saw(tabId, url, '')
      return
    }

    if (!page.live) return

    try {
      await invoke('web_navigate', { tab: tabId, url })
    } catch {
      // Not a page that has gone: the next placement finds that out, and opens the
      // address the tab already holds. See `place`.
    }
  }

  /** Back, forward, or the same page again. The same keys a note tab steps its own
   *  trail with; see `workspace.goBack`. `by` is how many steps back or forward, for a
   *  row of the history under the arrows. */
  async step(tabId: string, step: Step, by = 1): Promise<void> {
    const page = this.held.get(tabId)
    if (!isDesktop || !page?.live) return

    // Nor is a refused step; see `place`.
    await invoke('web_step', { tab: tabId, step, by }).catch(() => undefined)
  }

  /** Where this tab has been and where along it it is, for the history under a held
   *  arrow; see `trailSteps` in menu.ts. Nothing for a page that is not running, whose
   *  arrows are not lit either. */
  async trail(tabId: string): Promise<{ urls: string[]; at: number }> {
    const none = { urls: [], at: 0 }
    if (!isDesktop || !this.held.get(tabId)?.live) return none

    return invoke<[string[], number]>('web_trail', { tab: tabId })
      .then(([urls, at]) => ({ urls, at }))
      .catch(() => none)
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

  /** A page the tab has been to, in the history of the tab's space; see visited.ts. */
  private async saw(tabId: string, url: string, title: string): Promise<void> {
    const space = this.held.get(tabId)?.space ?? null
    const [visited, webData] = await Promise.all([history(), stores()])
    visited.saw(webData.history(space), tabId, url, title)
  }

  /** Every running page of a space built again, in whichever store the space now keeps
   *  its web data in. A webview's store is fixed when it is built, so a choice made in
   *  the space's menu is a choice for the pages built after it - and a tab left in the
   *  store it was opened in would be a setting that did nothing on screen. Each is parked
   *  first, so it comes back on the page and at the place it was at; the one on screen is
   *  built again where it was, the others as they are next looked at. */
  async restore(space: string): Promise<void> {
    const running = [...this.held.entries()].filter(([, page]) => page.live && page.space === space)
    for (const [tabId, page] of running) {
      const shown = page.shown ? page.pane : null
      await this.park(tabId)
      if (shown && page.url) await this.show(tabId, page.url, shown)
    }
  }

  /** The tab has closed. The webview goes with it, and so does the trail: a tab
   *  somebody closed is not a tab anybody is coming back to. Where the reading got to
   *  stays on the device, because the note can be opened again. */
  forget(tabId: string) {
    const page = this.held.get(tabId)
    if (!page) return

    clearTimeout(page.parking)
    void history().then((visited) => visited.left(tabId))
    this.asked.delete(tabId)

    if (!isDesktop || !page.live) {
      this.held.delete(tabId)
      grants.dropped(tabId)
      void pageDialogs().then(({ dialogs }) => dialogs.dropped(tabId))
      if (isDesktop) void invoke('web_close', { tab: tabId, keep: false }).catch(() => undefined)
      return
    }

    void this.closing(tabId)
  }

  /** Where the reading got to, written down before the webview goes.
   *
   *  A tab switched away from has already had its place written by `hide`, and a
   *  parked one by `park` - but the tab a reader closes is usually the one in front of
   *  them, and that road wrote nothing: the page was taken down with the place still
   *  only inside it, so opening the note again landed at the top of the site with no
   *  trail behind the arrows. The place is read first and the page closed after,
   *  because `look` asks the page itself and a webview that has gone answers nothing.
   *  The tab is out of the map before the close either way, so nothing draws a page
   *  that is on its way out. */
  private async closing(tabId: string): Promise<void> {
    await this.look(tabId)

    this.held.delete(tabId)
    grants.dropped(tabId)
    void pageDialogs().then(({ dialogs }) => dialogs.dropped(tabId))
    await invoke('web_close', { tab: tabId, keep: false }).catch(() => undefined)
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

  /** The tabs opened because a page asked for a window, and the tab that asked for
   *  each: the ones a download may take away again, and where the reader goes back to
   *  when it does. */
  private readonly asked = new Map<string, string>()

  /** The tab a page asked for, beside the page that asked and in its pane: behind it
   *  or in front, as the press that asked said. */
  private async openAsked(said: Opening): Promise<void> {
    const { workspace } = await import('../workspace.svelte')
    const opened = workspace.openPage(said.url, said.behind ? 'behind' : 'front', said.tab)
    if (opened !== null) this.asked.set(opened, said.tab)
  }

  /** A download has started in a tab.
   *
   *  A tab a page opened for a link that turned out to be a file is an empty tab with
   *  nothing to show, and a browser takes it away the moment the file starts -
   *  `target="_blank"` on a download link is common, and Moodle's own resource links
   *  are one. So the reader is put back on the page that asked and the empty tab
   *  closes; its webview stays out of sight until the file is in, because that webview
   *  is what is fetching it (see `linger` in src-tauri/src/downloads.rs). Only that
   *  kind of tab: one the reader opened, or one that has shown a page, stays. */
  private async downloaded(tabId: string): Promise<void> {
    const page = this.held.get(tabId)
    const opener = this.asked.get(tabId)
    if (opener === undefined || !page || page.titled) return

    const { workspace } = await import('../workspace.svelte')
    if (workspace.tabs.some((one) => one.id === opener)) workspace.activate(opener)
    workspace.close(tabId)
  }

  /** Five listeners for the window, started by the first web tab that needs them:
   *  where every page in the window has got to, what every site in it has asked for,
   *  which of them has asked for a window of its own, the browser's own keys pressed
   *  in one, and what they are downloading. */
  private async listen(): Promise<void> {
    // A window to listen on, because that is what the runtime's own `listen` needs and
    // this is now started with the first page in the window rather than with the first
    // placement: a test that says it is a desktop without putting a document under it
    // reaches here, where it never used to. The same guard tauri.ts puts on the line
    // that decides which platform this is, and for the same reason.
    if (this.listening || !isDesktop || typeof window === 'undefined') return
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

    // A page has opened `alert`, `confirm` or `prompt`, or asks before it is left. Its
    // script waits for the answer, which the card over the pane gives; see
    // dialogs.svelte.ts and web_dialogs.rs.
    const { dialogs, readDialog } = await pageDialogs()
    await listen('nib://web-dialog', (event) => {
      const said = readDialog(event.payload)
      if (said && this.held.has(said.tab)) dialogs.heard(said)
    })

    // A page has asked for a window of its own - `target="_blank"`, `window.open`, a
    // Ctrl+click or the middle button on a link. Every browser answers that with a tab,
    // so this one does: beside the page that asked, in its pane, and in front unless
    // the reader asked for it behind. The crate refuses the engine its second webview
    // and hands the address over; see `on_new_window` in web_tabs.rs.
    //
    // Opened through an import rather than a name at the top, because the workspace
    // is what holds this store: asking for it by name here would be a circle.
    await listen('nib://web-open', (event) => {
      const said = readOpening(event.payload)
      if (said && this.held.has(said.tab)) void this.openAsked(said)
    })
    // A key the browser keeps for itself, pressed while a page had the keyboard: played
    // on the window as the key it was, so it means what it means everywhere else. See
    // keys.ts and web_keys.rs. Fetched with the first page rather than carried, like
    // the listening itself.
    const { readPressed, replay } = await import('./keys')
    await listen('nib://web-key', (event) => {
      const one = readPressed(event.payload)
      if (one) replay(one)
    })
    // A file one of the pages is saving has started, moved or ended; the crate saves it
    // and this only keeps the list the bar draws. See downloads.svelte.ts. Fetched here
    // rather than imported at the top, so the first paint does not carry it: nothing is
    // downloaded before a page is open.
    const { downloads, readDownload } = await import('./downloads.svelte')
    await listen('nib://web-download', (event) => {
      const said = readDownload(event.payload)
      if (said && downloads.heard(said)) void this.downloaded(said.tab)
    })
    // A page's mark has changed, which the engine says for as long as the page is open.
    await listen('nib://web-icon', (event) => {
      const said = readIconed(event.payload)
      if (said) this.held.get(said.tab)?.marked(said.icon)
    })
    // Sound, full screen, zoom and find; see heard.ts.
    await (await import('./heard')).listening(listen, (tab) => this.held.get(tab))
    await listen('nib://web-tab', (event) => {
      const said = readMoved(event.payload)
      if (!said) return

      const page = this.held.get(said.tab)
      if (!page) return

      const was = page.loading
      page.loading = said.loading
      // A load beginning is a page arriving, and the mark it settles on is the one the
      // file keeps.
      if (said.loading !== was) page.loaded(said.loading)
      page.back = said.back
      page.forward = said.forward
      if (said.url && !page.typing) page.url = said.url
      if (said.title) {
        page.title = said.title
        page.titled = true
      }
      // Where the tab has got to is a page it has been to, for the address field to
      // offer; see visited.ts.
      if (said.url) void this.saw(said.tab, said.url, said.title)

      // The page has arrived, so the picture of the last one is no longer a picture of
      // this page - and the new one is taken now rather than when something is waiting
      // for it. Nothing is drawn from either while the webview is on top.
      //
      // On the moment it stops loading rather than on every report that it is not
      // loading. The engine says where a page is again whenever its title arrives, and
      // with the mark that was three reports in the eight milliseconds after a page lands,
      // and each of them threw the picture away and asked for another: three engine
      // captures at once, a fifth of a second each, on the window's own thread in the
      // breath the reader is watching the page appear.
      if (was && !said.loading) {
        page.landed ??= page.url
        page.shot = null
        void this.shoot(said.tab)
      }
    })
  }
}

export const pages = new Pages()
