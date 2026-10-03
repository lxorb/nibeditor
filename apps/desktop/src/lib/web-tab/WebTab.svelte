<script lang="ts">
  /** A website in a pane: the bar, and under it the page.
   *
   *  Three builds, one design, and the difference is only what fills the space under
   *  the bar. On a desktop it is a hole: the page is a webview of its own, placed
   *  over this rectangle by the crate, and what is in the document here is an empty
   *  box that reports where it is. In a browser it is a card until the reader asks
   *  for the page and a frame from then on, because nothing there can tell a site
   *  that allows framing from one that refuses it; see frame.ts. On a phone it is
   *  neither - the tab never opens there and the system browser does; see
   *  `workspace.openWeb` for why.
   *
   *  The hole has to follow the pane exactly, so it is measured rather than
   *  guessed: a resize observer for the pane being dragged, the window's own resize,
   *  and a check after anything the app puts over it. A native webview draws above
   *  every pixel of HTML in the window, so what of the app's is over the page is cut
   *  out of it - otherwise a menu would come up behind it. See covers.ts. */

  import { onMount, untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import { agentMarks } from '../agent-marks.svelte'
  import { fullscreen } from '../fullscreen.svelte'
  import { t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import { dur } from '../motion'
  import { tabAsk } from '../new-tab'
  import { overlays } from '../overlays'
  import { settings } from '../settings.svelte'
  import { shareThisFile } from '../sharing.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import { startup } from '../startup.svelte'
  import { findBar } from '../surfaces.svelte'
  import { invoke, isDesktop, openExternal, platform } from '../tauri'
  import type { Tab } from '../workspace.svelte'
  import { workspace } from '../workspace.svelte'
  import { plainOrigin, webAddress } from './address'
  import type { ZoomStep } from './bar-keys'
  import { clipPage } from './clip'
  import { filling } from './filling.svelte'
  import { ALL, cutOf, layersOver, moving, strangerOver, type Cut } from './covers'
  import { ALLOW, SANDBOX } from './frame'
  import { keepPage } from './keep'
  import { trailSteps, webRows, zoomed, type WebActions } from './menu'
  import { mute, muteSite } from './mute'
  import { shownAddress } from './omnibox'
  import { type Frame, pages, type Rect, siteMark, type Step } from './pages.svelte'
  import { seek, shut, sought } from './seek'
  import { grants, siteOf } from './permissions.svelte'
  import { dialogs } from './dialogs.svelte'
  import { isMuted, keepZoom, zoomOf } from './sites'
  import { movedOn } from './used'
  import { visited } from './visited'
  import { webData } from './web-data.svelte'
  import WebAsk from './WebAsk.svelte'
  import WebDialog from './WebDialog.svelte'
  import WebBar from './WebBar.svelte'
  import WebDownloads from './WebDownloads.svelte'
  import WebExtensionPopup from './WebExtensionPopup.svelte'
  import WebExtensions from './WebExtensions.svelte'
  import { extensions, type Extension } from './extensions.svelte'
  import WebLocked from './WebLocked.svelte'
  import WebSite from './WebSite.svelte'

  const { tab: shown, focused }: { tab: Tab; focused: boolean } = $props()

  /** The tab this pane is for, held from the moment it is built.
   *
   *  The pane is keyed by the tab's id, so one of these is only ever one tab, and a
   *  tab is one object for its whole life. The prop is not: it is the parent's
   *  `$derived`, read through a getter, and it moves on before this pane is taken
   *  apart. Closing the last tab makes it null, and swapping the tab makes it the next
   *  one - and Chrome sends the address field its blur while the field is being
   *  removed, still in the document, after the prop has moved. Read through the prop,
   *  that blur threw on `null.id` when the last tab went with the field in use, and
   *  told the next tab that nobody was typing in it when a tab was swapped. */
  const tab = untrack(() => shown)

  /** How long a layer that has closed may still be in the document.
   *
   *  A little over the longest thing the app plays on the way out - a layer's own rise
   *  is 190 ms and a menu's is 120 - because that is exactly the window in which the
   *  overlay stack is already empty and the element is still there to be hit. See
   *  `look` and LAYER in motion.ts. */
  const LEAVING = 300

  const page = $derived(pages.of(tab.id))

  let hole = $state<HTMLElement>()
  /** Whether the site's own favicon arrived. A site that has none, or one the
   *  content policy will not load, leaves a broken picture where a mark should be -
   *  and a card with nothing in that box reads better than a card with that. */
  let marked = $state(true)

  /** An agent acting in this tab, or paused in it: the frame round the page and the
   *  mark on the tab (docs/agent-native.md 7.1). Written by lib/agents/ui, which is never
   *  in the first paint; see agent-marks.svelte.ts. */
  const worn = $derived(agentMarks.on[tab.id] ?? null)

  /** How wide the frame round a page an agent acts in is. The page is placed that much
   *  inside the hole and the pane draws the frame in what is left, because nothing of
   *  the app's can be drawn over a page. */
  const FRAME = 2

  /** Where the hole is, as the window measures it. Null before it is on the page. */
  function rect(): Rect | null {
    // A page holding the whole screen is placed over all of it; see filling.svelte.ts.
    if (page.filling) return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }

    const box = hole?.getBoundingClientRect()
    if (!box || box.width < 1 || box.height < 1) return null

    const inset = worn ? FRAME : 0
    return {
      x: box.x + inset,
      y: box.y + inset,
      width: box.width - inset * 2,
      height: box.height - inset * 2,
    }
  }

  /** What of the page the app's own layers are over, or null for none of it.
   *
   *  A native webview draws above every pixel of HTML in the window: nothing of nib's
   *  can be drawn on top of a page. So a layer over the page is cut out of it in its own
   *  shape, and a sheet's scrim covers all of it, with the still picture of the page
   *  standing in under the scrim - see covers.ts, and `cover` in pages.svelte.ts.
   *
   *  Asked of the layers on the window rather than of the overlay stack, and of this
   *  page rather than of the window: a tab's hover card over the strip, a menu over the
   *  file list, a popover over the other pane leave this page alone. It used to be the
   *  stack, and anything open anywhere hid every page in the window.
   *
   *  And a drag over the panes, whatever the layers say. A tab carried out of its
   *  strip, or a note out of the file list, puts the drop zones up in every pane, and
   *  the carried tab hangs under the pointer over all of them: a page left in front
   *  hid both, so the tab vanished the moment it left the strip and nobody could see
   *  where it would land. The drag is asked rather than hit-tested because the page
   *  has to go before the zones are there to be hit. */
  function coverOf(box: Rect): Cut | null {
    if (page.filling) return null
    // Another tab's page holds the screen, and this one would be drawn over it.
    if (filling.by !== null || workspace.panes.dragging !== null) return ALL
    if (!hole) return null
    // Something over the page nothing knows the shape of: a drawer, a deck.
    if (strangerOver(hole)) return ALL
    return cutOf(box, layersOver(hole))
  }

  /** Where the hole sits in the window's layout: the area every pane shares and this
   *  pane, at the window's size now. What lets the crate move the page in the window's
   *  own resize rather than a frame after it; see src-tauri/src/web_follow.rs. */
  function frameOf(): Frame | null {
    const window = { width: innerWidth, height: innerHeight }
    if (page.filling) {
      const whole = { x: 0, y: 0, ...window }
      return { window, area: whole, pane: whole }
    }
    const area = hole?.closest('[data-panes]')?.getBoundingClientRect()
    const pane = hole?.closest('[data-pane]')?.getBoundingClientRect()
    if (!area || !pane) return null
    const of = (box: DOMRect) => ({ x: box.x, y: box.y, width: box.width, height: box.height })
    return { window, area: of(area), pane: of(pane) }
  }

  let scheduled = 0
  let late: ReturnType<typeof setTimeout> | undefined
  /** The last thing the crate was told, so nothing is told to it twice. A press
   *  anywhere in the window asks this question, and most presses have not moved
   *  anything. */
  let told = ''

  /** Where the hole was, the last time anybody looked.
   *
   *  Kept here rather than measured when it is wanted, because the one moment it is
   *  wanted most is the moment it cannot be measured: Svelte takes the element out of
   *  the document before it runs this component's teardown - `destroy_effect` removes
   *  the DOM and then calls the teardowns - so a box read from there is a box of
   *  zeroes, and a pane that read zeroes had no rectangle to hide its page at and
   *  closed the page instead. Every switch away from a web tab closed the webview, and
   *  coming back was a fresh browser process and a fresh load of the site: that is
   *  what "it loads for an eternity" was. See test/effects/web-switch.effect.test.ts. */
  let last: Rect | null = null

  /** Whether a page may be asked for yet.
   *
   *  A page is the most expensive thing a tab can hold, and a window restored with
   *  one in front should not pay for it before it has finished coming up: the bar is
   *  on screen with the address and the title the file says, which is everything the
   *  file says, and the page fills in after the stages that read the space have had
   *  their turn. For a tab opened by hand every turn has passed and there is nothing
   *  to be after, so the page is asked for in the same breath as the mount. See
   *  startup.svelte.ts. */
  let ready = false

  /** When the layer that is over the hole has to have finished leaving by, or nought
   *  while nothing is over it; see `look`. */
  let leaving = 0

  /** Puts the page where the hole is. Coalesced onto a frame, because a pane being
   *  dragged reports every pixel. What set it off is taken and not looked at: an
   *  observer and a listener hand it one anyway, and an effect names by it the state
   *  it follows. */
  function follow(_cause?: unknown) {
    if (!isDesktop || !ready) return

    cancelAnimationFrame(scheduled)
    scheduled = requestAnimationFrame(look)
  }

  /** Where the hole is now, said to the crate: the page is opened if it is not there,
   *  put at that rectangle, and seen unless something of the app's is over it.
   *
   *  **Whether anything is over the hole decides how the page is placed and never
   *  whether there is one**, which is the whole of the fix for "browser tabs take an
   *  eternity to load". Every way of opening a website except clicking its row in the
   *  file list goes through a layer - the palette, the app menu, the chooser Ctrl+T
   *  opens, a row's own menu - and a layer that has closed is still in the document
   *  while it plays its way out. The pane mounts under it, the hit test says covered,
   *  and the page was simply not asked for; nothing asked again, because the rectangle
   *  never changed and the stack was already empty. The tab sat on an empty pane until
   *  the reader clicked something, which is what made the page arrive. */
  function look() {
    if (!isDesktop || !ready) return

    const box = rect()
    if (!box) return

    last = box
    const cut = coverOf(box)
    const visible = cut === null

    // A layer on its way out is on no list: it took itself off the overlay stack the
    // moment it closed, and nothing says when its own motion has finished. So while
    // the stack is empty and something is still over the hole, look again on the next
    // frame - which is the fifth of a second a layer takes to leave and no frame at all
    // once it has gone. See LAYER in motion.ts for where the number comes from. And a
    // layer still moving in or out is a shape that has not settled, so the page is cut
    // round it again on the next frame too.
    if (visible) leaving = 0
    else if (overlays.depth === 0) {
      if (leaving === 0) leaving = Date.now() + LEAVING
      if (Date.now() < leaving) follow()
    }
    if (!visible && hole && moving(hole)) follow()

    const frame = frameOf()
    const said = JSON.stringify([box, cut, frame?.window])
    // Nothing has moved *and there is a page*. The second half is what keeps a tab from
    // being left on an empty pane for good: a pane measured under a layer on its way out
    // has said its rectangle already, and the page is the thing that is missing.
    if (said === told && page.live) return

    told = said
    // Which space the tab is in, which decides the store its page is built in; said with
    // the page rather than in an effect of its own, because a tab opened by hand asks for
    // its page in the breath it mounts. See web-data.ts.
    page.space = space
    void pages.show(tab.id, address, box, visible, { cut, frame })
  }

  /** Where this tab points: the address the page is on, else the one the session
   *  remembered, else what the file says - which is where the reading got to, because
   *  a web note is a browser tab and the file says so. See web-tab/keep.ts. */
  const address = $derived(page.url ?? tab.address ?? workspace.webAddressOf(tab) ?? '')

  /** Which space the tab is in, and so which history its address field offers from and
   *  adds to and whose web data its page is built in: the space holding its file,
   *  wherever it was opened from, and for a tab with no file the space it was opened
   *  in, kept across a switch to another. See `spaceOf` in workspace.svelte.ts. */
  const space = $derived(workspace.spaceOf(tab.note))
  const book = $derived(webData.history(space))

  onMount(() => {
    // The page is the last thing the launch does. Everything below is watching for the
    // hole to move, and none of it says anything to the crate until this has come
    // round; see `ready` and `look`.
    //
    // A tab opened by hand is not the launch: every turn has passed, so the page is
    // asked for in the same breath as the mount rather than two painted frames later.
    // Those two frames were forty of the hundred and forty milliseconds a web tab cost
    // and they drew nothing - the bar and the hole are put up by this same mount.
    const asking = () => {
      ready = true
      look()
    }
    if (startup.reached('rooms')) asking()
    else void startup.turn('rooms').then(asking)

    // A change of size is answered in the frame it is laid out in rather than the one
    // after: the observer runs between the layout and the paint, so the hole is measured
    // for free and the page is told while the window is still drawing that frame. A
    // sidebar sliding open is a change of size on every frame of it, and a page a frame
    // behind each of them is a page that moves in steps. See latest.ts for the order.
    const watching = new ResizeObserver(() => {
      if (!ready) return
      cancelAnimationFrame(scheduled)
      look()
    })
    if (hole) watching.observe(hole)

    window.addEventListener('resize', follow)
    // Anything the app opens over the page is opened by a press: after one, look
    // again at what is on top. Twice, because a sheet arrives over a transition.
    const pressed = () => {
      // The press is also the last moment the page is both current and on screen, and
      // whatever it opens is about to hide it - so this is where the page is
      // photographed. Nothing waits for the picture: it is there by the time the
      // overlay is, and the pane keeps the one from a moment ago either way. See
      // `shoot` in pages.svelte.ts.
      void pages.shoot(tab.id)
      follow()
      // Again after the transition an overlay arrives on, and only once however
      // many keys were pressed while it was on its way.
      clearTimeout(late)
      late = setTimeout(follow, 220)
    }
    window.addEventListener('pointerdown', pressed, true)
    window.addEventListener('keydown', pressed, true)

    // Something opened over the note, or the last thing over it closed. Neither is a
    // press - a command from the palette opens the next overlay, and Escape closes one
    // - so the page cannot wait for a press to find out; see `coverOf`.
    const unwatch = overlays.watch(follow)

    return () => {
      cancelAnimationFrame(scheduled)
      clearTimeout(late)
      watching.disconnect()
      unwatch()
      window.removeEventListener('resize', follow)
      window.removeEventListener('pointerdown', pressed, true)
      window.removeEventListener('keydown', pressed, true)

      // Nobody is typing in a bar that has gone. The flag is what keeps the page from
      // rewriting an address somebody is halfway through, and a bar swapped away from
      // while the field had the keyboard used to leave it set for the tab's whole life:
      // the tab then took no address from the page it was showing, so the file never
      // learned where the reading had got to. Asked of the store by id rather than
      // through the pane's own `$derived`, because that graph is inert by here.
      const held = pages.of(tab.id)
      held.typing = false

      // A page holding the screen gives it back as its tab goes out of sight: a switch to
      // another tab is a hand that wants the app again, as it is in Chrome.
      if (held.filling) {
        held.filling = false
        void invoke('web_unfill', { tab: tab.id }).catch(() => undefined)
        void filling.give(tab.id)
      }

      // The tab is no longer the one showing. The page goes out of sight and goes on
      // running: a web note is a browser tab, so coming back to it is not a load. The
      // rectangle is the one the page was last placed at rather than one measured now,
      // because by here the hole is out of the document and measures nothing; see
      // `last`. A tab nothing ever placed has no page to hide.
      if (last) pages.hide(tab.id, last)
    }
  })

  // The line that the page was built again in another space's web data, for four seconds
  // of being seen: a tab moved out of sight is told when it is next looked at. See rehome.ts.
  $effect(() => {
    const said = page.rehomed
    if (said === null) return
    const gone = setTimeout(() => {
      if (page.rehomed === said) page.rehomed = null
    }, 4000)
    return () => clearTimeout(gone)
  })

  // An agent began acting here or let go: the page moves in by the frame or back out.
  $effect(() => follow(worn !== null))

  // Another computer's web login came or went. Going, the page is asked for again at
  // once, which is what makes a page come back by itself when the site is free; see
  // lease.svelte.ts.
  $effect(() => {
    if (page.lock !== null) return
    untrack(() => {
      told = ''
      follow()
    })
  })

  // A drag over the panes began or ended. Neither is a press this pane hears - the
  // tab lifts ten pixels after its own press, whenever the hand gets there - nor
  // anything on the overlay stack, so the page is told here; see `coverOf`.
  $effect(() => follow(workspace.panes.dragging))

  // A page took the whole screen or gave it back, here or in another pane: the window
  // follows, and so does where this page is placed. See filling.svelte.ts.
  $effect(() => {
    const on = page.filling
    untrack(() => void (on ? filling.take(tab.id) : filling.give(tab.id)))
  })
  $effect(() => follow([page.filling, filling.by]))

  // The size this site was left at and whether it is muted, for every page the tab
  // arrives on and every page built for it: Chrome keeps both by site, and a page built
  // again starts at a hundred per cent and heard. Once the page has arrived, because a
  // zoom set while the last page is still up is kept by the engine for the last site.
  // See sites.ts.
  $effect(() => {
    const here = site
    if (!page.live || page.loading || !here) return

    untrack(() => {
      page.zoom = zoomOf(here)
      void pages.zoom(tab.id, page.zoom)
      mute(tab.id, page, isMuted(here))
    })
  })

  // The address the tab remembers, so a restart comes back on the page it was on
  // rather than at the site's front door.
  $effect(() => {
    if (page.url !== null && page.url !== tab.address) workspace.webWalked(tab, page.url)
  })

  // A website clicked past in the list is kept once the reader goes somewhere in it,
  // the way a note is kept once they type in it; see used.ts for what counts.
  $effect(() => {
    if (movedOn(page.landed, page.url)) untrack(() => workspace.keep(tab.id))
  })

  // What the strip calls a tab with no file: what the page calls itself. Nothing is
  // written - a new web tab is a browser tab until somebody keeps it as a web note;
  // see `save` in workspace.svelte.ts.
  $effect(() => {
    const title = page.title
    untrack(() => workspace.webNamed(tab, title))
  })

  // Which file this tab is showing, so the store can write down where the reading got
  // to under the note rather than under this visit to it; see place.ts. And whether it
  // is pinned, which Memory saver never takes; see resting.ts.
  $effect(() => {
    page.path = tab.path
    page.pinned = tab.pinned
  })

  // Where the reading has got to, in the file. That is what makes reopening the note -
  // tomorrow, or on another machine the space syncs to - open the page that was open;
  // see keep.ts. The home the file keeps beside it is the address the note points at.
  $effect(() => {
    const url = page.url
    const icon = page.kept
    const path = tab.path
    if (url === null || path === null) return

    untrack(() =>
      keepPage({
        path,
        text: tab.doc,
        url,
        icon,
        wrote: (text: string) => tab.note.replace(text, false),
      }),
    )
  })

  function clip() {
    void clipPage(tab.id, { url: page.url, title: page.title })
  }

  // A new page is a new mark to look for.
  $effect(() => {
    if (address) marked = true
  })

  /** Whether the popover behind the site's mark is open. */
  let showingSite = $state(false)

  /** Whether the list of downloads under the bar is open. */
  let showingDownloads = $state(false)

  /** Whether this engine runs extensions: `WebView2`, and nib's own Chromium, which is
   *  Windows' alone for now; see src-tauri/src/extensions.rs. */
  const extending = isDesktop && platform() === 'windows'

  /** Whether the list of extensions under the puzzle is open. */
  let showingExtensions = $state(false)

  /** How far from the bar's right edge a bubble under an extension's button hangs. */
  let hangs = $state(0)

  let head = $state<HTMLElement>()

  /** The extension the store page this tab is on is about, if it is not installed yet:
   *  the bar offers Add for it. */
  let onStore = $state<string | null>(null)
  const addable = $derived(
    onStore !== null && !extensions.list.some((one) => one.id === onStore) ? onStore : null,
  )

  $effect(() => {
    const url = page.url
    if (!extending || !url) {
      onStore = null
      return
    }
    void extensions.named(url).then((id) => {
      if (page.url === url) onStore = id
    })
  })

  // The list is read with the first web tab, and heard about from then on.
  onMount(() => {
    if (extending) void extensions.start()
    return () => {
      if (extensions.popped?.tab === tab.id) extensions.close()
    }
  })

  /** The distance from the bar's right edge to a button's, so a bubble hangs under it. */
  function under(anchor: HTMLElement): number {
    const bar = head?.getBoundingClientRect()
    const button = anchor.getBoundingClientRect()
    return bar ? Math.max(0, bar.right - button.right) : 0
  }

  /** An extension's button, or its row in the list: its popup, or its options page in a
   *  tab of its own when it has no popup. */
  async function pressExtension(one: Extension, anchor: HTMLElement | null) {
    showingExtensions = false
    if (one.popup) {
      if (anchor) hangs = under(anchor)
      extensions.open(one.id, tab.id, page.store)
      return
    }
    const options = await extensions.optionsOf(one.id)
    if (options) workspace.openPage(options, 'front', tab.id)
  }

  /** The site this tab is on, which is what a permission and the popover are about. */
  const site = $derived(siteOf(page.url))

  /** An agent's request for the reader to do one step in this tab; see TakeoverBar. */
  const takeover = $derived(agentMarks.takeovers[tab.id] ?? null)

  /** The question this pane has to put on screen, if any: the first request from this
   *  tab nobody has answered. One at a time, the way a browser asks. */
  const asking = $derived(grants.asking.find((one) => one.tab === tab.id) ?? null)

  /** The dialog this tab's page has open, if any: its script is waiting on it, so it
   *  comes before anything else the pane could show. */
  const dialog = $derived(dialogs.open.find((one) => one.tab === tab.id) ?? null)

  // Open, and every page the tab arrives on while it is: the words are looked for again,
  // because the matches were the last page's. See seek.ts.
  $effect(() => {
    if (!page.find.open || page.loading) return
    untrack(() => seek(tab.id, page, page.find.query, 'fresh'))
  })

  /** The keys the app hears while it has the keyboard: Find and its steps, the developer
   *  tools and a key for Mute site, if a reader gave it one.
   *  Read off the window, because a pane with a page has no editor to read them, and
   *  the same find keys the notes and a PDF answer. Inside the page, find is the page's
   *  first and asks for this one when the page lets it go by; see seek.ts. */
  function onKeydown(event: KeyboardEvent) {
    if (!focused || !isDesktop || !page.live) return

    const either = (id: string) =>
      shortcuts.pressed(id, event) || shortcuts.pressed(`${id}.alt`, event)
    const look = shortcuts.pressed('edit.find', event)
      ? 'find'
      : either('edit.find-next')
        ? 'next'
        : either('edit.find-previous')
          ? 'previous'
          : null

    if (look) {
      event.preventDefault()
      sought(tab.id, page, look)
    } else if (either('web.devtools')) {
      event.preventDefault()
      void invoke('web_devtools', { tab: tab.id }).catch(() => undefined)
    } else if (shortcuts.pressed('web.mute', event)) {
      event.preventDefault()
      void muteSite(tab.id, !page.muted)
    }
  }

  /** Chrome's list under a held arrow: the pages that way, by what each called itself,
   *  and a row goes straight there rather than a step at a time. */
  async function showTrail(forward: boolean, event: MouseEvent) {
    event.preventDefault()
    const { urls, at } = await pages.trail(tab.id)
    const rows = trailSteps(urls, at, forward).map(({ url, by }) => ({
      label: visited.titleOf(book, url) || shownAddress(url),
      run: () => void pages.step(tab.id, forward ? 'forward' : 'back', by),
    }))
    menu.show(event, rows, { title: forward ? t('Forward') : t('Back') })
  }

  /** Draws the page at `factor`, from the dots or a key while the app has the keyboard.
   *  The engine says nothing about a zoom it was told to make, only one made in the
   *  page, so this one is kept for the site here. */
  function zoomTo(factor: number) {
    page.zoom = factor
    keepZoom(site, factor)
    void pages.zoom(tab.id, factor)
  }

  /** Chrome's own rows, and what each of them does here; see menu.ts. */
  const actions: WebActions = {
    newTab: () => workspace.openWebsite(),
    // Chrome's Bookmarks. Here they are the space's own kept files, at the top of the
    // file list, which is where the app already draws them; see Bookmarks.svelte.
    bookmarks: () => workspace.showPanel('tree'),
    zoom: (factor: number) => {
      zoomTo(factor)
      // The menu is still open on the row that was pressed, so the size it says has to
      // be the size it now is.
      menu.replace(webRows(page, factor, actions))
    },
    fullScreen: () => void fullscreen.toggle(tab.id),
    print: () => void pages.print(tab.id),
    find: isDesktop ? () => (page.find.open = true) : undefined,
    save: clip,
    share: () => {
      if (tab.path !== null) void shareThisFile(tab.path)
    },
    settings: () => settings.show(),
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="web">
  <!-- The bar, and the two things a browser hangs under it. They are placed against
       this box rather than against the pane, because "under the bar" is what they mean:
       a rectangle the height of the whole pane would put them under the *page*, which is
       off the bottom of the window. -->
  <div class="head" class:roomy={fullscreen.on} bind:this={head}>
    <WebBar
      {page}
      {focused}
      {book}
      reads={isDesktop}
      onstep={(step: Step, press?: MouseEvent) => {
        const ask = press ? tabAsk(press) : 'plain'
        if (step === 'back') workspace.goBack(tab.id, ask)
        else if (step === 'forward') workspace.goForward(tab.id, ask)
        // Reload with the middle button or Ctrl: this page again, in a tab of its own.
        else if (step === 'reload' && ask !== 'plain' && page.url !== null)
          workspace.openPage(page.url, ask, tab.id)
        else void pages.step(tab.id, step)
      }}
      onhistory={showTrail}
      onaddress={(typed: string, aside: boolean) => {
        const url = webAddress(typed)
        if (!url) return

        // Typed, or chosen from what the field offered, which Chrome counts the same:
        // either way it is an address somebody went to on purpose. See visits.ts.
        visited.typed(book, url)
        // Alt+Enter: a tab of its own, in front, and this one left where it was.
        if (aside) {
          workspace.openPage(url, 'front', tab.id)
          return
        }
        void pages.go(tab.id, url)
        // An address somebody typed is where the document points, and the file says
        // so. A link followed inside the page is not; see `workspace.webAimed`.
        void workspace.webAimed(tab, url)
      }}
      onclip={clip}
      onmenu={(event: MouseEvent) =>
        menu.show(event, webRows(page, page.zoom, actions), { title: t('Website') })}
      onsite={() => {
        showingSite = !showingSite
        showingDownloads = false
        showingExtensions = false
      }}
      ondownloads={() => {
        showingDownloads = !showingDownloads
        showingSite = false
        showingExtensions = false
      }}
      ontyping={(on: boolean) => {
        // Of the store rather than through `page`, for the reason the teardown above
        // says: the last blur arrives while the pane is being taken apart, and the page
        // this pane's `$derived` would answer with is a value nobody is keeping up to
        // date any more.
        pages.of(tab.id).typing = on
      }}
      onzoom={(step: ZoomStep) => zoomTo(step === 'reset' ? 1 : zoomed(page.zoom, step === 'in'))}
      extending={extending
        ? {
            addable,
            open: extensions.popped?.tab === tab.id ? extensions.popped.id : null,
            onpress: (id: string, anchor: HTMLElement) => {
              const one = extensions.list.find((each) => each.id === id)
              if (one) void pressExtension(one, anchor)
            },
            onlist: (anchor: HTMLElement) => {
              hangs = under(anchor)
              showingExtensions = !showingExtensions
              showingSite = false
              showingDownloads = false
            },
            onadd: () => {
              if (page.url) void extensions.install(page.url)
            },
          }
        : null}
    />

    <!-- A computer new to the account, waiting for one that has the web logins to let it
         have them: which one, and the six digits both screens show. -->
    <!-- Saved into a space that keeps its web data apart: built again there, which may
         have signed the site out, so this says so for a moment. See `rehome`. -->
    {#if page.rehomed !== null}
      <p class="waiting" transition:fade={{ duration: dur(140) }}>
        {t('Reloaded with the web data of {space}', { space: page.rehomed })}
      </p>
    {/if}
    {#if pages.waiting}
      <p class="waiting">
        {t('Waiting for {who}', { who: pages.waiting.device })}
        <span class="digits"
          >{pages.waiting.digits.slice(0, 3)} {pages.waiting.digits.slice(3)}</span
        >
      </p>
    {/if}

    <!-- What the page said, what a site asked for, and what a site is: one at a time,
         because a question waiting to be answered is the only thing worth reading, and
         the page's own dialog first, because its script is stopped until it is answered.
         Each is cut out of the page under it while it is up; see `coverOf`. -->
    {#if dialog}
      {#key dialog.id}
        <WebDialog {dialog} icon={siteMark(page.icon, page.url)} />
      {/key}
    {:else if asking}
      <WebAsk {asking} icon={siteMark(page.icon, page.url)} />
    {:else if showingSite && page.url !== null}
      <WebSite url={page.url} {site} onclose={() => (showingSite = false)} />
    {:else if showingDownloads}
      <WebDownloads onclose={() => (showingDownloads = false)} />
    {:else if extensions.popped?.tab === tab.id}
      {#key extensions.popped.id}
        <WebExtensionPopup popped={extensions.popped} right={hangs} />
      {/key}
    {:else if showingExtensions}
      <WebExtensions
        right={hangs}
        onpress={(one: Extension) => void pressExtension(one, null)}
        onclose={() => (showingExtensions = false)}
      />
    {/if}
  </div>

  <!-- An agent asked the reader to do one step here: its line and Done, under the bar
       like the find bar, so the page stays in sight to do the step in. Fetched with the
       first one; see lib/agents/ui. -->
  {#if takeover}
    {#await import('../agents/ui/TakeoverBar.svelte') then bar}
      <bar.default id={takeover.id} reason={takeover.reason} />
    {/await}
  {/if}

  <!-- Under the bar and above the page, where every surface puts its find bar: a bar
       over the page would be drawn under it, since the page is a webview of its own. -->
  {#if page.find.open}
    {#await findBar() then FindBar}
      <FindBar
        query={page.find.query}
        count={page.find.count}
        current={page.find.at}
        onstep={(by: number) => seek(tab.id, page, page.find.query, by > 0 ? 'next' : 'previous')}
        onclose={() => shut(tab.id, page)}
        onquery={(typed: string) => seek(tab.id, page, typed, 'fresh')}
      />
    {/await}
  {/if}

  {#if isDesktop && page.openable}
    <!-- The hole. Nothing is drawn in it but the last picture of the page: the page
         itself is a webview over this box, and anything here would be under it. The
         picture is what the pane holds while the webview is out of sight - under a
         menu, and while a parked page is loading again - so neither of those is a
         flash of empty pane. Its colour underneath is the app's own ground, for the
         first page in a tab, which nothing has photographed yet. -->
    <div
      class="hole"
      class:acted={worn !== null}
      class:resting={worn?.paused}
      style:--agent={worn?.colour}
      class:still={page.shot !== null}
      style:background-image={page.shot === null ? 'none' : `url(${page.shot})`}
      bind:this={hole}
    >
      {#if page.lock}
        <WebLocked lock={page.lock} icon={page.icon ?? page.kept} {address} />
      {/if}
    </div>
  {:else if page.framing === 'frame' && address}
    <iframe
      class="framed"
      class:acted={worn !== null}
      class:resting={worn?.paused}
      style:--agent={worn?.colour}
      title={page.title || plainOrigin(address)}
      src={address}
      sandbox={SANDBOX}
      allow={ALLOW}
      referrerpolicy="origin"
    ></iframe>
  {:else}
    <!-- A browser cannot say whether a site allows a frame until it has made one,
         and cannot say afterwards either: a page that arrived and a page that was
         refused report exactly the same thing. So the card asks, which is the same
         gesture a page embedded in a note already uses. See frame.ts.

         A desktop that could not make its webview lands here too, rather than on an
         empty hole: the card is the one surface that always has somewhere to send
         the reader. -->
    <div
      class="card"
      class:acted={worn !== null}
      class:resting={worn?.paused}
      style:--agent={worn?.colour}
    >
      {#if address}
        {#if marked}
          <img
            class="mark"
            src={siteMark(page.icon, address) ?? new URL('/favicon.ico', address).href}
            alt=""
            draggable="false"
            onerror={() => (marked = false)}
          />
        {/if}
        <p class="name">{page.title || plainOrigin(address)}</p>
        <p class="site">{plainOrigin(address)}</p>

        <div class="rows">
          <button
            class="nib-button"
            onclick={() => {
              page.framing = 'frame'
            }}
          >
            {t('Show it here')}
          </button>
          <button class="nib-button is-quiet" onclick={() => void openExternal(address)}>
            {t('Open in the browser')}
          </button>
        </div>
      {:else}
        <p class="site">{t('Address')}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .web {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* The bar, and what hangs under it. Relative and above the page's own room, so a
     bubble is placed against the bar rather than against the pane - and drawn over the
     hole rather than under it, which matters for the frame between the page being
     hidden and the picture of it arriving. */
  .head {
    position: relative;
    z-index: var(--z-raised);
    flex: none;
  }

  /* Full screen puts its way out in this corner, and a page draws above it: the bar
     makes the room, down and across, so neither the page nor the dots sit under the
     button. See `.leave` in App.svelte. */
  .head.roomy {
    min-height: calc(var(--leave-size) + var(--space-2) * 2);
    padding-inline-end: calc(var(--leave-size) + var(--space-2) * 2);
  }

  /* The page's own room. `--bg` rather than nothing, because for one frame between
     the hole being measured and the webview arriving this box is what shows. */
  .hole {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--bg);
  }

  /* Quiet, under the bar: the one line a computer new to the account says while it
     waits, with the digits in figures of one width so they read as a code. */
  .waiting {
    margin: 0;
    padding: var(--space-1) var(--space-3);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .digits {
    margin-inline-start: var(--space-2);
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }

  /* The still picture of the page, from the top left corner at its own size: it was
     photographed at exactly this rectangle, and a picture that stretched would read
     as the page having moved. */
  .hole.still {
    background-repeat: no-repeat;
    background-position: top left;
    background-size: 100% auto;
  }

  .framed {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: none;
    background: var(--bg);
  }

  /* The frame round a page an agent acts in: two pixels of its colour, inside the edge
     of the room the page is placed in, which the page leaves free (see FRAME). Muted
     while it is paused there. An outline, because it is drawn over whatever the room
     holds - a frame's document in the browser build included - and eased in and out,
     so a job starting or finishing is a change of colour rather than a jump. */
  .hole,
  .framed,
  .card {
    outline: 2px solid transparent;
    outline-offset: -2px;
    transition: outline-color var(--dur-base) var(--ease-out);
  }

  .acted {
    outline-color: var(--agent);
  }

  .acted.resting {
    outline-color: var(--muted);
  }

  /* A card in the middle of the space the page would have filled: the same quiet
     centred block a note still on its way shows. */
  .card {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-4);
    color: var(--muted);
    font-family: var(--font-ui);
    text-align: center;
  }

  /* Twice the largest icon in a row, because this one is the only picture on a
     card in the middle of an empty pane rather than a mark in front of a name. A
     site's favicon is drawn at 32 or 16 and both read at this size. */
  .mark {
    width: calc(var(--icon-lg) * 2);
    height: calc(var(--icon-lg) * 2);
    border-radius: var(--radius-row);
  }

  .name {
    margin: 0;
    color: var(--text-strong);
    font-size: var(--text-row);
  }

  /* The two rows the card offers, side by side at the pointer scale and stacked
     where there is no room - the same reflow the find bar's controls take. */
  .rows {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    justify-content: center;
  }

  .site {
    margin: 0;
    font-size: var(--text-sm);
  }
</style>
