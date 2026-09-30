<script lang="ts">
  /** The bar over a page: back, forward, reload, the address, a clip, what has been
   *  downloaded, and the dots.
   *
   *  A browser's row, in nib's shapes. The same `.nib-glyph` squares the find bar and
   *  the sidebar's foot are made of, the same `.nib-field` every box you type in is,
   *  and the same row scale, so a thumb gets 56px where a pointer gets 28 without a
   *  second design for a small screen. Under the strip and above the page, which is
   *  where the find bar sits too: a bar over the page would cover the first line of
   *  it.
   *
   *  The field is one control with two faces. Nobody typing in it wants to read a
   *  title, and nobody reading wants to read an address: so it holds the whole
   *  address while it has the keyboard and the site and the page's own name while it
   *  does not. The site is there whichever face is up - it is the one part of an
   *  address worth being sure of, and an `http:` page says so in front of its own
   *  name.
   *
   *  Nothing here decides anything. Every press is handed up to the tab. */

  import { onMount, untrack } from 'svelte'
  import { scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import ArrowDownToLine from 'lucide/dist/esm/icons/arrow-down-to-line.mjs'
  import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
  import ArrowRight from 'lucide/dist/esm/icons/arrow-right.mjs'
  import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
  import Globe from 'lucide/dist/esm/icons/globe.mjs'
  import Lock from 'lucide/dist/esm/icons/lock.mjs'
  import RotateCw from 'lucide/dist/esm/icons/rotate-cw.mjs'
  import Scissors from 'lucide/dist/esm/icons/scissors.mjs'
  import X from 'lucide/dist/esm/icons/x.mjs'
  import { t } from '../i18n.svelte'
  import { longPress } from '../longpress'
  import { dur } from '../motion'
  import { middleOpens } from '../new-tab'
  import { overlays } from '../overlays'
  import { shortcuts } from '../shortcuts.svelte'
  import { showTab } from '../shortcuts/registry'
  import { present } from '../slides/present.svelte'
  import AddressField from './AddressField.svelte'
  import { barKey, stops } from './bar-keys'
  import { plainOrigin } from './address'
  import { downloads, progressOf } from './downloads.svelte'
  import { addressing } from './passed.svelte'
  import { clipSource } from './note'
  import type { Page } from './pages.svelte'

  const {
    page,
    /** Whether a clip can read the page's words. In a browser it cannot - the
     *  frame's document is the site's - so the glyph says it will keep the link. */
    reads,
    /** Whether the pane this bar is in has the focus, so the address key lands in
     *  one bar rather than in all of them. */
    focused,
    /** Which history the address field offers from: its space's; see web-data.ts. */
    book,
    onstep,
    onhistory,
    onaddress,
    onclip,
    onmenu,
    onsite,
    ondownloads,
    ontyping,
  }: {
    page: Page
    reads: boolean
    focused: boolean
    book: string
    /** An arrow or reload pressed, and how: with the middle button or a modifier an
     *  arrow opens its step in a tab of its own, and reload opens this page again in
     *  one; see new-tab.ts. A key has no press. */
    onstep: (step: 'back' | 'forward' | 'reload' | 'fresh' | 'stop', press?: MouseEvent) => void
    /** A right click or a held finger on an arrow: the pages that way, as a list. */
    onhistory: (forward: boolean, event: MouseEvent) => void
    onaddress: (typed: string, aside: boolean) => void
    onclip: () => void
    onmenu: (event: MouseEvent) => void
    onsite: () => void
    ondownloads: () => void
    ontyping: (on: boolean) => void
  } = $props()

  /** How far the files on their way have got, for the ring round the downloads glyph;
   *  see `progressOf`. The circle's own length is 2πr with r = 10. */
  const progress = $derived(progressOf(downloads.list))
  const RING = 2 * Math.PI * 10

  /** Whether the site's own mark arrived. A site with none, or one the engine will not
   *  fetch, leaves a broken picture where a mark should be, and the lock reads better
   *  than that. */
  let marked = $state(true)

  // A new page is a new mark to look for.
  $effect(() => {
    if (page.icon) marked = true
  })

  let field = $state<{ take(): void }>()

  /** Whether there is a page to clip at all.
   *
   *  A tab opened by "Open a website" has an address field and no page behind it yet,
   *  and an address field nobody has typed into is the empty string rather than null -
   *  so the glyph was pressable and wrote a note whose `source:` was empty. The glyph
   *  says so by not being pressable, which is what this bar does everywhere else:
   *  before the press rather than as an apology after it. See `clipSource`. */
  const clippable = $derived(clipSource(page.url, null) !== null)

  /** The site, plainly, and the page's own name after it. The name is the page's
   *  while it has said one and the address's host until then, so the bar never reads
   *  as empty. */
  const resting = $derived.by(() => {
    if (page.url === null) return ''

    const site = plainOrigin(page.url)
    return page.title ? `${site} - ${page.title}` : site
  })

  /** Whether this tab had nowhere to go when the bar was built, which is the one thing
   *  `onMount` needs to know and the one moment it cannot ask.
   *
   *  Read here, in the instance body, rather than inside `onMount`. A pane is swapped by
   *  destroying one and building the next, and both happen in the same flush: a read
   *  from inside the new bar's `onMount` reaches the page through the pane's `$derived`
   *  at a moment when Svelte has already marked that graph inert, which is
   *  `derived_inert` and a read of a value nobody is keeping up to date. The instance
   *  body runs while the parent is building this component, which is the one moment the
   *  chain is certainly alive - and once is all this wants, which is what `untrack`
   *  says out loud. */
  const started = untrack(() => page.url === null)

  /** A browser's keys - the address field, reload, the tabs by number - read here
   *  rather than off the window, and only by the bar in the focused pane: an app-level
   *  key never reaches the editor, and these share chords with it and with Present. A
   *  pane showing a page has neither; see bar-keys.ts.
   *
   *  Read before the app's own handler, which is what lets F5 reload here and present
   *  a note everywhere else, and not while anything is open over the page or a note is
   *  being presented: those have the keyboard.
   *
   *  While the page itself has the keyboard, the crate hands the address keys over and
   *  F5 is the engine's own reload; see web_keys.rs.
   *
   *  A tab with nowhere to go yet takes the keyboard as it arrives, because typing
   *  an address is the only thing to do with an empty tab. */
  onMount(() => {
    if (started && focused) take()

    const key = (event: KeyboardEvent) => {
      if (!focused || overlays.depth > 0 || present.on) return

      const said = barKey(event, shortcuts)
      if (!said) return

      event.preventDefault()
      if (said.to === 'address') take()
      else if (said.to === 'step') onstep(said.step)
      else showTab(said.at)
    }

    // Escape last: whatever is open over the page, and the field being typed in, have
    // their own first.
    const escape = (event: KeyboardEvent) => {
      if (!focused || !stops(event, page.loading, shortcuts)) return

      event.preventDefault()
      onstep('stop')
    }

    window.addEventListener('keydown', key, true)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keydown', escape)
    }
  })

  function take() {
    field?.take()
  }

  // Ctrl+L or Alt+D pressed inside this bar's page, which the page let go by: the
  // address field takes the keyboard, as Chrome's does. See passed.svelte.ts.
  // Only an ask made while this bar is up: one from before it was built was answered.
  const answered = untrack(() => addressing.asked)
  $effect(() => {
    const asked = addressing.asked
    if (asked && asked !== answered && asked.page === page) untrack(take)
  })
</script>

<div class="webbar">
  <!-- Back and forward. A right click or a held finger on either lists the pages that
       way, the way Chrome's do. -->
  <button
    class="nib-glyph"
    title={t('Back')}
    aria-label={t('Back')}
    disabled={!page.back}
    onclick={(event) => onstep('back', event)}
    use:middleOpens={(event) => onstep('back', event)}
    oncontextmenu={(event) => onhistory(false, event)}
    use:longPress={(event) => onhistory(false, event)}
  >
    <svg class="nib-mirror" viewBox="0 0 24 24" aria-hidden="true">
      {#each ArrowLeft as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  <button
    class="nib-glyph"
    title={t('Forward')}
    aria-label={t('Forward')}
    disabled={!page.forward}
    onclick={(event) => onstep('forward', event)}
    use:middleOpens={(event) => onstep('forward', event)}
    oncontextmenu={(event) => onhistory(true, event)}
    use:longPress={(event) => onhistory(true, event)}
  >
    <svg class="nib-mirror" viewBox="0 0 24 24" aria-hidden="true">
      {#each ArrowRight as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  <!-- One glyph for both, the way a browser has one: a cross while the page is
       coming, which stops it, and the arrow again once it is here. The tab's own mark
       turns meanwhile, so this says only what a press would do. The middle button,
       or Ctrl, opens the page again in a tab of its own. -->
  <button
    class="nib-glyph"
    title={page.loading ? t('Stop') : t('Reload')}
    aria-label={page.loading ? t('Stop') : t('Reload')}
    onclick={(event) => onstep(page.loading ? 'stop' : 'reload', event)}
    use:middleOpens={(event) => onstep('reload', event)}
  >
    {#key page.loading}
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        in:scale={{ start: 0.6, duration: dur(120), easing: cubicOut }}
      >
        {#each page.loading ? X : RotateCw as [tag, attrs], index (index)}
          <svelte:element this={tag} {...attrs} />
        {/each}
      </svg>
    {/key}
  </button>

  <!-- The site, at the left of the field, which is where every browser puts it: the
       page's own mark, and the lock for a site that has none or whose mark will not
       load. Pressing it says what this site is and what it has been allowed; see
       WebSite.svelte. -->
  <button
    class="nib-glyph site"
    title={t('Site information')}
    aria-label={t('Site information')}
    aria-haspopup="dialog"
    disabled={page.url === null}
    onclick={onsite}
  >
    {#if page.icon && marked}
      <img class="mark" src={page.icon} alt="" draggable="false" onerror={() => (marked = false)} />
    {:else}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {#each page.url?.startsWith('https:') ? Lock : Globe as [tag, attrs], index (index)}
          <svelte:element this={tag} {...attrs} />
        {/each}
      </svg>
    {/if}
  </button>

  <AddressField
    bind:this={field}
    {resting}
    {book}
    address={page.url ?? ''}
    onenter={onaddress}
    {ontyping}
  />

  <button
    class="nib-glyph"
    title={reads ? t('Clip this page') : t('Clip the link')}
    aria-label={reads ? t('Clip this page') : t('Clip the link')}
    disabled={!clippable}
    onclick={onclip}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each Scissors as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  <!-- What has been downloaded, the way Chrome has it: a glyph that is not there until
       the first file is, in the accent with a ring filling round it while anything is on
       its way. -->
  {#if downloads.list.length > 0}
    <button
      class="nib-glyph saving"
      class:is-on={progress !== null}
      title={t('Downloads')}
      aria-label={t('Downloads')}
      aria-haspopup="dialog"
      onclick={ondownloads}
      transition:scale={{ start: 0.6, duration: dur(160), easing: cubicOut }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {#each ArrowDownToLine as [tag, attrs], index (index)}
          <svelte:element this={tag} {...attrs} />
        {/each}
      </svg>
      {#if progress !== null}
        <svg
          class="ring"
          class:sweeping={progress === 'unknown'}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke-dasharray={RING}
            stroke-dashoffset={RING * (1 - (progress === 'unknown' ? 0.25 : progress))}
          />
        </svg>
      {/if}
    </button>
  {/if}

  <button
    class="nib-glyph"
    title={t('More')}
    aria-label={t('More')}
    aria-haspopup="menu"
    onclick={onmenu}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each Ellipsis as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>
</div>

<style>
  /* The find bar's own row, because it is the same kind of thing in the same place:
     a row of controls between the strip and what is being read. */
  .webbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }

  /* The site's mark sits against the field rather than in the row of arrows, so the
     bar reads as "where you have been" and then "where you are". */
  .site {
    margin-left: var(--space-1);
  }

  .mark {
    width: var(--icon-md);
    height: var(--icon-md);
    border-radius: var(--radius-sm);
  }

  /* The ring sits over the glyph's own square, a little inside its edge, and starts at
     the top the way a clock's hand does. */
  .saving {
    position: relative;
  }

  .nib-glyph > .ring {
    position: absolute;
    top: 2px;
    left: 2px;
    width: calc(100% - 4px);
    height: calc(100% - 4px);
    transform: rotate(-90deg);
  }

  .ring > circle {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    transition: stroke-dashoffset var(--dur-base) var(--ease-out);
  }

  /* A file of no known size is a quarter of the ring going round. */
  .nib-glyph > .ring.sweeping {
    animation: turn 1s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .nib-glyph > .ring.sweeping {
      animation: none;
    }
  }

  @keyframes turn {
    to {
      transform: rotate(1turn);
    }
  }
</style>
