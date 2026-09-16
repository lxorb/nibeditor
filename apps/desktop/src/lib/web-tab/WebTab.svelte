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
   *  every pixel of HTML in the window, so while something of the app's is over the
   *  page the page is hidden - otherwise a menu would come up behind it. */

  import { onMount, untrack } from 'svelte'
  import { fullscreen } from '../fullscreen.svelte'
  import { t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import { overlays } from '../overlays'
  import { settings } from '../settings.svelte'
  import { shareThisFile } from '../sharing.svelte'
  import { startup } from '../startup.svelte'
  import { isDesktop, openExternal } from '../tauri'
  import type { Tab } from '../workspace.svelte'
  import { workspace } from '../workspace.svelte'
  import { plainOrigin, webAddress } from './address'
  import { clipPage } from './clip'
  import { ALLOW, SANDBOX } from './frame'
  import { keepPage } from './keep'
  import { webRows, type WebActions } from './menu'
  import { pages, type Rect, type Step } from './pages.svelte'
  import { grants, siteOf } from './permissions.svelte'
  import WebAsk from './WebAsk.svelte'
  import WebBar from './WebBar.svelte'
  import WebSite from './WebSite.svelte'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

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

  /** Where the hole is, as the window measures it. Null before it is on the page. */
  function rect(): Rect | null {
    const box = hole?.getBoundingClientRect()
    if (!box || box.width < 1 || box.height < 1) return null

    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }

  /** Whether the page has to be out of sight, because something of the app's is over
   *  it.
   *
   *  A native webview draws above every pixel of HTML in the window: nothing of nib's
   *  can be drawn on top of a page, so while anything is over the note the page is
   *  hidden and the still picture of it stands in - see `shot` in pages.svelte.ts.
   *
   *  Asked once, of the overlay stack, rather than of each kind of overlay in turn:
   *  every menu, sheet, dropdown, the palette, the theme store and the settings put
   *  themselves on that stack already, because that is what Escape closes. So a kind
   *  of overlay nobody has written yet is covered on the day it is written, and there
   *  is no list here to keep in step with the app. See overlays.ts.
   *
   *  The document is asked as well, for the few things that are over the page without
   *  being something Escape closes - a drag preview, a bubble that follows the
   *  pointer - and at nine points rather than at the middle, because a menu that
   *  covers a corner of the page is just as much in front of it as one that covers the
   *  middle. That was the bug: the page went on being drawn over a menu it did not
   *  happen to cover the centre of, and a menu behind a page is a menu nobody can
   *  see. */
  function covered(): boolean {
    if (overlays.depth > 0) return true

    const box = hole?.getBoundingClientRect()
    if (!box || !hole) return false

    for (const x of [0.08, 0.5, 0.92]) {
      for (const y of [0.08, 0.5, 0.92]) {
        const on = document.elementFromPoint(box.x + box.width * x, box.y + box.height * y)
        if (on !== null && on !== hole && !hole.contains(on)) return true
      }
    }

    return false
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
   *  dragged reports every pixel. */
  function follow() {
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
    const visible = !covered()

    // A layer on its way out is on no list: it took itself off the overlay stack the
    // moment it closed, and nothing says when its own motion has finished. So while
    // the stack is empty and something is still over the hole, look again on the next
    // frame - which is the fifth of a second a layer takes to leave and no frame at all
    // once it has gone. See LAYER in motion.ts for where the number comes from.
    if (visible) leaving = 0
    else if (overlays.depth === 0) {
      if (leaving === 0) leaving = Date.now() + LEAVING
      if (Date.now() < leaving) follow()
    }

    const said = `${box.x},${box.y},${box.width},${box.height},${String(visible)}`
    // Nothing has moved *and there is a page*. The second half is what keeps a tab from
    // being left on an empty pane for good: a pane measured under a layer on its way out
    // has said its rectangle already, and the page is the thing that is missing.
    if (said === told && page.live) return

    told = said
    void pages.show(tab.id, address, box, visible)
  }

  /** Where this tab points: the address the page is on, else the one the session
   *  remembered, else what the file says - which is where the reading got to, because
   *  a web note is a browser tab and the file says so. See web-tab/keep.ts. */
  const address = $derived(page.url ?? tab.address ?? workspace.webAddressOf(tab) ?? '')

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

    const watching = new ResizeObserver(follow)
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
    // - so the page cannot wait for a press to find out; see `covered`.
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
      pages.of(tab.id).typing = false

      // The tab is no longer the one showing. The page goes out of sight and goes on
      // running: a web note is a browser tab, so coming back to it is not a load. The
      // rectangle is the one the page was last placed at rather than one measured now,
      // because by here the hole is out of the document and measures nothing; see
      // `last`. A tab nothing ever placed has no page to hide.
      if (last) pages.hide(tab.id, last)
    }
  })

  // The address the tab remembers, so a restart comes back on the page it was on
  // rather than at the site's front door.
  $effect(() => {
    if (page.url !== null && page.url !== tab.address) workspace.webWalked(tab, page.url)
  })

  // What the strip calls a tab with no file: what the page calls itself. Nothing is
  // written - a new web tab is a browser tab until somebody saves it, which is Ctrl+S
  // and writes the shortcut; see `keepWeb` in workspace.svelte.ts.
  $effect(() => {
    const title = page.title
    untrack(() => workspace.webNamed(tab, title))
  })

  // Which file this tab is showing, so the store can write down where the reading got
  // to under the note rather than under this visit to it; see place.ts.
  $effect(() => {
    page.path = tab.path
  })

  // Where the reading has got to, in the file. That is what makes reopening the note -
  // tomorrow, or on another machine the space syncs to - open the page that was open;
  // see keep.ts. The home the file keeps beside it is the address the note points at.
  $effect(() => {
    const url = page.url
    const icon = page.icon
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

  /** How large the page is drawn, as a browser's own zoom. The tab's, because a reader
   *  who made one site larger did not ask for every site to be. */
  let zoom = $state(1)

  /** Whether the popover behind the site's mark is open. */
  let showingSite = $state(false)

  /** The site this tab is on, which is what a permission and the popover are about. */
  const site = $derived(siteOf(page.url))

  /** The question this pane has to put on screen, if any: the first request from this
   *  tab nobody has answered. One at a time, the way a browser asks. */
  const asking = $derived(grants.asking.find((one) => one.tab === tab.id) ?? null)

  /** Chrome's own rows, and what each of them does here; see menu.ts. */
  const actions: WebActions = {
    newTab: () => workspace.openWebsite(),
    // Chrome's Bookmarks. Here they are the space's own kept files, at the top of the
    // file list, which is where the app already draws them; see Bookmarks.svelte.
    bookmarks: () => workspace.showPanel('tree'),
    zoom: (factor: number) => {
      zoom = factor
      void pages.zoom(tab.id, factor)
      // The menu is still open on the row that was pressed, so the size it says has to
      // be the size it now is.
      menu.replace(webRows(page, factor, actions))
    },
    fullScreen: () => void fullscreen.toggle(tab.id),
    print: () => void pages.print(tab.id),
    save: clip,
    share: () => {
      if (tab.path !== null) void shareThisFile(tab.path)
    },
    settings: () => settings.show(),
  }
</script>

<div class="web">
  <!-- The bar, and the two things a browser hangs under it. They are placed against
       this box rather than against the pane, because "under the bar" is what they mean:
       a rectangle the height of the whole pane would put them under the *page*, which is
       off the bottom of the window. -->
  <div class="head">
    <WebBar
      {page}
      {focused}
      reads={isDesktop}
      onstep={(step: Step) => void pages.step(tab.id, step)}
      onaddress={(typed: string) => {
        const url = webAddress(typed)
        if (!url) return

        void pages.go(tab.id, url)
        // An address somebody typed is where the document points, and the file says
        // so. A link followed inside the page is not; see `workspace.webAimed`.
        void workspace.webAimed(tab, url)
      }}
      onclip={clip}
      onmenu={(event: MouseEvent) =>
        menu.show(event, webRows(page, zoom, actions), { title: t('Website') })}
      onsite={() => (showingSite = !showingSite)}
      ontyping={(on: boolean) => {
        // By id, for the reason the teardown above says: a blur arrives while the pane is
        // being taken apart, and the page this pane's `$derived` would answer with is a
        // value nobody is keeping up to date any more.
        pages.of(tab.id).typing = on
      }}
    />

    <!-- What a site asked for, and what a site is: one at a time, because a question
         waiting to be answered is the only thing worth reading. Both are on the overlay
         stack, so the page is out of sight while either is up and the still picture of
         it stands in; see `covered`. -->
    {#if asking}
      <WebAsk {asking} icon={page.icon} />
    {:else if showingSite && page.url !== null}
      <WebSite url={page.url} {site} onclose={() => (showingSite = false)} />
    {/if}
  </div>

  {#if isDesktop && page.openable}
    <!-- The hole. Nothing is drawn in it but the last picture of the page: the page
         itself is a webview over this box, and anything here would be under it. The
         picture is what the pane holds while the webview is out of sight - under a
         menu, and while a parked page is loading again - so neither of those is a
         flash of empty pane. Its colour underneath is the app's own ground, for the
         first page in a tab, which nothing has photographed yet. -->
    <div
      class="hole"
      class:still={page.shot !== null}
      style:background-image={page.shot === null ? 'none' : `url(${page.shot})`}
      bind:this={hole}
    ></div>
  {:else if page.framing === 'frame' && address}
    <iframe
      class="framed"
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
    <div class="card">
      {#if address}
        {#if marked}
          <img
            class="mark"
            src={new URL('/favicon.ico', address).href}
            alt=""
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
    z-index: 1;
    flex: none;
  }

  /* The page's own room. `--bg` rather than nothing, because for one frame between
     the hole being measured and the webview arriving this box is what shows. */
  .hole {
    flex: 1;
    min-height: 0;
    background: var(--bg);
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
