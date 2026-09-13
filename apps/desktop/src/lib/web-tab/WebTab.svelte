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
  import { t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import { startup } from '../startup.svelte'
  import { isDesktop, openExternal } from '../tauri'
  import type { Tab } from '../workspace.svelte'
  import { workspace } from '../workspace.svelte'
  import { plainOrigin, webAddress } from './address'
  import { clipPage } from './clip'
  import { ALLOW, SANDBOX } from './frame'
  import { webRows } from './menu'
  import { pages, type Rect, type Step } from './pages.svelte'
  import WebBar from './WebBar.svelte'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

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

  /** Whether something of the app's is over the middle of the hole.
   *
   *  Asked of the document rather than of a list of everything that can be opened: a
   *  menu, a sheet, the palette and the settings are all just the topmost element at
   *  a point, and the browser already knows which that is. */
  function under(): boolean {
    const box = hole?.getBoundingClientRect()
    if (!box || !hole) return false

    const on = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return on !== null && on !== hole && !hole.contains(on)
  }

  let scheduled = 0
  let late: ReturnType<typeof setTimeout> | undefined
  /** The last thing the crate was told, so nothing is told to it twice. A press
   *  anywhere in the window asks this question, and most presses have not moved
   *  anything. */
  let told = ''

  /** Whether a page may be asked for yet.
   *
   *  A page is the most expensive thing a tab can hold, and a window restored with
   *  one in front should not pay for it before it has finished coming up: the bar is
   *  on screen with the address and the title the file says, which is everything the
   *  file says, and the page fills in after the stages that read the space have had
   *  their turn. For a tab opened by hand every turn has passed and the wait is one
   *  painted frame - which is what puts the bar up before the page is asked for. See
   *  startup.svelte.ts. */
  let ready = false

  /** Puts the page where the hole is. Coalesced onto a frame, because a pane being
   *  dragged reports every pixel, and silent when nothing has changed. */
  function follow() {
    if (!isDesktop || !ready) return

    cancelAnimationFrame(scheduled)
    scheduled = requestAnimationFrame(() => {
      const box = rect()
      if (!box) return

      const visible = !under()
      const said = `${box.x},${box.y},${box.width},${box.height},${String(visible)}`
      if (said === told) return

      told = said
      if (visible) void pages.show(tab.id, address, box)
      else void pages.place(tab.id, box, false)
    })
  }

  /** Where this tab points: the address the page is on, else the one the session
   *  remembered, else what the file says. */
  const address = $derived(page.url ?? tab.address ?? workspace.webAddressOf(tab) ?? '')

  onMount(() => {
    // The page is the last thing the launch does, and one painted frame after that.
    // Everything below is watching for the hole to move, and none of it says anything
    // to the crate until this has come round; see `ready` and `follow`.
    void startup.turn('rooms').then(() => {
      ready = true
      follow()
    })

    const watching = new ResizeObserver(follow)
    if (hole) watching.observe(hole)

    window.addEventListener('resize', follow)
    // Anything the app opens over the page is opened by a press: after one, look
    // again at what is on top. Twice, because a sheet arrives over a transition.
    const pressed = () => {
      follow()
      // Again after the transition an overlay arrives on, and only once however
      // many keys were pressed while it was on its way.
      clearTimeout(late)
      late = setTimeout(follow, 220)
    }
    window.addEventListener('pointerdown', pressed, true)
    window.addEventListener('keydown', pressed, true)

    return () => {
      cancelAnimationFrame(scheduled)
      clearTimeout(late)
      watching.disconnect()
      window.removeEventListener('resize', follow)
      window.removeEventListener('pointerdown', pressed, true)
      window.removeEventListener('keydown', pressed, true)

      // The tab is no longer the one showing. The page goes out of sight and, if
      // nobody comes back to it, is taken down; see pages.svelte.ts.
      const last = rect()
      if (last) pages.hide(tab.id, last)
      else void pages.sleep(tab.id)
    }
  })

  // The address the tab remembers, so a restart comes back on the page it was on
  // rather than at the site's front door.
  $effect(() => {
    if (page.url !== null && page.url !== tab.address) workspace.webWalked(tab, page.url)
  })

  // A website in the space keeps itself, the way a note in a space does: as soon as
  // the page has said what it is called, there is a file. Nothing to press.
  $effect(() => {
    const url = page.url
    const title = page.title
    if (url === null) return

    void untrack(() => workspace.keepWeb(tab, url, title))
  })

  function clip() {
    void clipPage(tab.id, { url: page.url, title: page.title })
  }

  // A new page is a new mark to look for.
  $effect(() => {
    if (address) marked = true
  })
</script>

<div class="web">
  <WebBar
    {page}
    {focused}
    reads={isDesktop}
    onstep={(step: Step) => void pages.step(tab.id, step)}
    onaddress={(typed: string) => {
      const url = webAddress(typed)
      if (url) void pages.go(tab.id, url)
    }}
    onclip={clip}
    onmenu={(event: MouseEvent) => menu.show(event, webRows(page, clip), { title: t('Website') })}
    ontyping={(on: boolean) => {
      page.typing = on
    }}
  />

  {#if isDesktop && page.openable}
    <!-- The hole. Nothing is drawn in it: the page is a webview over this box, and
         anything here would be under it. Its colour is the page's own background
         while a page is loading, so the pane does not flash. -->
    <div class="hole" bind:this={hole}></div>
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

  /* The page's own room. `--bg` rather than nothing, because for one frame between
     the hole being measured and the webview arriving this box is what shows. */
  .hole {
    flex: 1;
    min-height: 0;
    background: var(--bg);
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
