<script lang="ts">
  /** Every theme there is, each shown on the whole app while it is pointed at.
   *
   *  VS Code's colour theme list, where the arrows try each theme on the window and
   *  Escape takes it back, with what that list lacks: a card of each theme in its own
   *  colours rather than a name, the pointer trying them as well as the keys, and the
   *  scheme and the accent beside them, as a Mac's Appearance pane has them. Opened by
   *  a right click on the light and dark switch or from the palette; see
   *  picking.svelte.ts for what pointing and keeping do.
   *
   *  Over the app without dimming it, because the app is what is being looked at:
   *  the scrim only catches the press that closes it. */
  import { tick } from 'svelte'
  import { fade, fly, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { accentTokens } from '../accents'
  import AccentSwatches from '../AccentSwatches.svelte'
  import { closeOnBack } from '../backstack.svelte'
  import { t } from '../i18n.svelte'
  import { LAYER } from '../motion'
  import { overlays } from '../overlays'
  import { SCHEME_CHOICES, SCHEME_NAMES } from '../schemes'
  import { scrollbar } from '../scrollbar'
  import { settings } from '../settings.svelte'
  import { pullsAway } from '../sheet-pull'
  import { segmented } from '../slide'
  import { type Scheme, type SchemeChoice, theme } from '../theme.svelte'
  import { store } from '../themes/store.svelte'
  import { trap } from '../trap'
  import { viewport } from '../viewport.svelte'
  import { type Look, lookOf } from './looks'
  import Mini from './Mini.svelte'
  import { picking } from './picking.svelte'

  /** The order a card that has both schemes draws them in: light above the
   *  diagonal, dark below. */
  const SIDES: Scheme[] = ['light', 'dark']

  /** The app's own tokens as text, which every card is worked out from. Fetched
   *  with the picker rather than carried by the app, and null for the frame or two
   *  before it lands, in which the cards are their bare shape. */
  let tokens = $state<string | null>(null)
  void import('@nib/themes/tokens.css?raw').then((one) => (tokens = one.default))

  /** custom.css, which sits on top of every theme on the page and so on every card.
   *  Read as the picker opens: it is a sheet on the page, and not a reactive one. */
  const custom = $derived(
    picking.open ? (document.getElementById('nib-custom-css')?.textContent ?? '') : '',
  )

  type Info = (typeof theme.all)[number]

  /** A theme's card, one look per scheme it states. The reader's accent is written
   *  in, as the app writes it onto the page, unless the theme brings its own. */
  function looksOf(one: Info): Look[] {
    if (tokens === null) return []

    const sheets = [tokens, one.css ?? '', custom]
    return SIDES.filter((side) => one.variants.includes(side)).map((side) =>
      lookOf(sheets, side, one.ownAccent ? {} : accentTokens(theme.accent, side)),
    )
  }

  /** What was typed, narrowed to, in the order the cards stand in. A word anywhere in
   *  the name on the card, the lookup the store's own search makes: a theme is looked
   *  for by a word it is called, and a dozen names need no ranking to be read. */
  const shown = $derived.by(() => {
    const term = picking.query.trim().toLowerCase()
    return term ? theme.all.filter((one) => t(one.name).toLowerCase().includes(term)) : theme.all
  })

  /** Whether the keys are on the last card, which is the way to the store rather
   *  than a theme. */
  let browsing = $state(false)

  /** Which card the keys are on: the one pointed at, else the one kept. */
  const cursor = $derived(
    browsing
      ? shown.length
      : shown.findIndex((one) => one.id === (picking.pointed.id ?? picking.kept.id)),
  )

  /** Three across, in the popover and on a phone's sheet alike; the arrows move by
   *  a row, so they have to know how many that is. */
  const COLUMNS = 3

  /** Which of the three marks is on: what was kept, or the one scheme a theme that
   *  states only one has. */
  const keptScheme = $derived<SchemeChoice>(theme.switchable ? picking.kept.scheme : theme.current)

  /** Where it stands. A popover over the point it was asked from, rising from it
   *  when that is in the lower half of the window - the switch is at the foot of the
   *  panel - and hanging from it otherwise; where the palette stands when it was
   *  asked for by a command; and a sheet on a phone. */
  const place = $derived.by(() => {
    const at = picking.at
    if (viewport.touch || !at) return null

    const rtl = document.documentElement.dir === 'rtl'
    const tall = window.innerHeight
    const above = at.top > tall / 2
    return {
      above,
      // From the pointer along the line, pulled back inside the window.
      left: rtl
        ? `clamp(8px, calc(${at.x + 24}px - var(--picker-width)), calc(100vw - var(--picker-width) - 8px))`
        : `clamp(8px, ${at.x - 24}px, calc(100vw - var(--picker-width) - 8px))`,
      // Clear of what was pressed, by the gap a menu keeps from its button.
      y: above ? tall - at.top + 6 : at.bottom + 6,
      room: above ? at.top - 14 : tall - at.bottom - 14,
      rtl,
    }
  })

  let grid = $state<HTMLElement>()

  // Escape closes it, like everything else the app puts over a note, and Back does
  // on a phone; both give the kept look back. See overlays.ts.
  $effect(() => (picking.open ? overlays.show(() => picking.close()) : undefined))
  $effect(() => closeOnBack(picking.open, () => picking.close()))

  /** How it arrives: rising into place over the app, or up from the foot of a
   *  phone's screen like every other sheet there. */
  function arriving(node: Element) {
    return viewport.touch
      ? fly(node, { y: 48, duration: LAYER.rise, easing: cubicOut })
      : scale(node, { duration: LAYER.rise, start: LAYER.start, easing: cubicOut })
  }

  /** The keys moved: point at the card they are on, and keep it in view. The
   *  pointer does not scroll the grid, so a card never slides under it and is
   *  tried without having been pointed at. */
  async function moveTo(index: number) {
    const last = shown.length
    const to = Math.max(0, Math.min(index, last))
    const one = shown[to]

    browsing = to === last
    picking.point('id', one ? one.id : null)

    await tick()
    grid?.querySelector('.card.is-on')?.scrollIntoView({ block: 'nearest' })
  }

  function typed(text: string) {
    picking.query = text
    browsing = false

    // The first match is tried as it is found, the way VS Code's list tries the row
    // its filter lands on; with nothing typed, nothing is being tried. A word no
    // theme answers to leaves the keys on the store, which is where more are.
    const first = shown[0]
    if (!text.trim()) picking.point('id', null)
    else if (first) picking.point('id', first.id)
    else void moveTo(shown.length)
  }

  /** A theme chosen: kept, and on a desktop that is the end of it. A phone has no
   *  pointer to try with, so a tap is the trying and the sheet stays for the next. */
  function choose(id: string) {
    picking.keepTheme(id)
    if (!viewport.touch) picking.close()
  }

  /** The store, over Settings where it lives, looking for whatever was typed here. */
  function browse() {
    const term = picking.query.trim()
    picking.close()
    settings.show('appearance')
    store.query = term
    store.show()
  }

  /** A key this answered goes no further: the app reads its own keys off the window,
   *  and an arrow or Enter there means something to whatever is behind this. */
  function spend(event: KeyboardEvent) {
    event.preventDefault()
    event.stopPropagation()
  }

  function onKeydown(event: KeyboardEvent) {
    const rtl = document.documentElement.dir === 'rtl'
    const steps: Record<string, number> = {
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
    }
    const step = steps[event.key]

    if (step !== undefined) {
      spend(event)
      // From nothing, the first step lands on the first card either way.
      void moveTo(cursor < 0 ? 0 : cursor + step)
      return
    }

    // The two ends, with a modifier: Home and End alone belong to the words.
    if ((event.key === 'Home' || event.key === 'End') && (event.ctrlKey || event.metaKey)) {
      spend(event)
      void moveTo(event.key === 'Home' ? 0 : shown.length)
      return
    }

    if (event.key !== 'Enter') return
    spend(event)
    // Kept by Enter the way it is by a click; the store if the keys are on it.
    if (browsing) browse()
    else choose(picking.pointed.id ?? picking.kept.id)
  }
</script>

<!-- A window resized under a popover leaves it hanging from where the switch was, so
     it goes, as a menu does. Not the sheet: a phone's keyboard coming up resizes it. -->
<svelte:window onresize={() => place && picking.close()} />

{#if picking.open}
  <!-- Clear, so the app it is trying themes on is seen as it will be. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim is-clear scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => picking.close()}
  ></div>

  <div
    class="picker nib-host"
    class:nib-layer={place !== null}
    class:nib-screen={place === null && !viewport.touch}
    class:sheet={viewport.touch}
    class:above={place?.above}
    class:rtl={place?.rtl}
    style:left={place?.left}
    style:top={place && !place.above ? `${place.y}px` : undefined}
    style:bottom={place?.above ? `${place.y}px` : undefined}
    style:max-height={place ? `${place.room}px` : undefined}
    use:trap
    use:pullsAway={viewport.touch ? () => picking.close() : null}
    role="dialog"
    aria-modal="true"
    aria-label={t('Themes')}
    tabindex="-1"
    transition:arriving
  >
    {#if viewport.touch}<div class="grip" aria-hidden="true"></div>{/if}

    <div class="head">
      <!-- A box with a grid under it is one control, as the palette's box with its
           list is: the keys never leave the box and the arrows move which card it
           points at. See Palette.svelte. -->
      <div class="nib-field find">
        <input
          value={picking.query}
          oninput={(event) => typed(event.currentTarget.value)}
          onkeydown={onKeydown}
          placeholder={t('Search themes')}
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
          role="combobox"
          aria-expanded="true"
          aria-controls="nib-theme-cards"
          aria-activedescendant={cursor >= 0 ? `nib-theme-${cursor}` : undefined}
          aria-label={t('Search themes')}
          data-lands
        />
      </div>

      <!-- Which side of the theme the app shows, as the three marks rather than
           three words: the sun and moon are the switch's own. -->
      <div
        class="nib-segmented modes"
        role="radiogroup"
        tabindex="-1"
        aria-label={t('Mode')}
        use:segmented
        onpointerleave={() => picking.point('scheme', null)}
      >
        {#each SCHEME_CHOICES as choice (choice)}
          <button
            type="button"
            class:on={choice === keptScheme}
            title={t(SCHEME_NAMES[choice])}
            aria-label={t(SCHEME_NAMES[choice])}
            aria-pressed={choice === keptScheme}
            disabled={!theme.offers(choice)}
            onpointermove={() => theme.offers(choice) && picking.point('scheme', choice)}
            onclick={() => picking.keepScheme(choice)}
          >
            <svg viewBox="0 0 14 14" aria-hidden="true">
              {#if choice === 'system'}
                <circle cx="7" cy="7" r="5.2" /><path
                  class="half"
                  d="M7 1.8a5.2 5.2 0 0 1 0 10.4z"
                />
              {:else if choice === 'dark'}
                <path d="M12 8.6A5.6 5.6 0 1 1 5.4 2a4.4 4.4 0 0 0 6.6 6.6z" />
              {:else}
                <circle cx="7" cy="7" r="3" /><path
                  d="M7 0v2M7 12v2M0 7h2M12 7h2M2.5 2.5l1.4 1.4M10.1 10.1l1.4 1.4M11.5 2.5l-1.4 1.4M3.9 10.1l-1.4 1.4"
                />
              {/if}
            </svg>
          </button>
        {/each}
      </div>
    </div>

    <div
      bind:this={grid}
      id="nib-theme-cards"
      class="grid"
      style:--columns={COLUMNS}
      role="listbox"
      tabindex="-1"
      aria-label={t('Themes')}
      data-scrolls
      use:scrollbar={shown.length}
      onpointerleave={() => {
        browsing = false
        picking.point('id', null)
      }}
    >
      {#each shown as one, index (one.id)}
        <button
          type="button"
          class="card"
          class:is-on={index === cursor}
          class:kept={one.id === picking.kept.id}
          id="nib-theme-{index}"
          role="option"
          tabindex="-1"
          aria-selected={index === cursor}
          onpointermove={() => {
            browsing = false
            picking.point('id', one.id)
          }}
          onclick={() => choose(one.id)}
        >
          <Mini looks={looksOf(one)} />
          <span class="name">{t(one.name)}</span>
        </button>
      {/each}

      <!-- More themes than are installed, which is the store: last, and there
           whatever was typed, since a name nothing here answers to is the name of
           one to go and find. -->
      <button
        type="button"
        class="card browse"
        class:is-on={browsing}
        id="nib-theme-{shown.length}"
        role="option"
        tabindex="-1"
        aria-selected={browsing}
        onpointermove={() => {
          browsing = true
          picking.point('id', null)
        }}
        onclick={browse}
      >
        <span class="more">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
        </span>
        <span class="name">{t('Browse')}</span>
      </button>
    </div>

    <!-- The accent under it all, as a Mac has it under the appearance. Still there
         while a theme that brings its own is being tried, only out of reach, so
         nothing moves under the pointer on its way across the cards. -->
    <div class="foot" class:owned={theme.accentIsTheme} inert={theme.accentIsTheme}>
      <AccentSwatches
        chosen={picking.kept.accent}
        onchoose={(id: string) => picking.keepAccent(id)}
        onpoint={(id: string | null) => picking.point('accent', id)}
      />
    </div>
  </div>
{/if}

<style>
  /* The layer behind it; see .nib-scrim in packages/themes. Over the panes and
     under a menu, which is the one thing that can be opened on top of it. */
  .scrim {
    --scrim-z: 57;
  }

  /* The surface is `.nib-layer` where it hangs from a point and `.nib-screen` where
     it stands where the palette does, so it is the shape of whichever it was opened
     like. Its width is its own. */
  .picker {
    --picker-width: 24rem;
    --screen-width: var(--picker-width);

    position: fixed;
    z-index: 58;
    width: min(var(--picker-width), calc(100vw - 16px));
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - 16px);
    overflow: hidden;
    transform-origin: top left;
  }

  .picker.nib-screen {
    top: 16vh;
    max-height: 72vh;
    transform-origin: top center;
  }

  .picker.above {
    transform-origin: bottom left;
  }

  .picker.rtl {
    transform-origin: top right;
  }

  .picker.above.rtl {
    transform-origin: bottom right;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-bottom: 1px solid var(--line);
  }

  .find {
    flex: 1;
    min-width: 0;
  }

  .modes {
    flex: none;
  }

  .modes button {
    padding: 0 var(--space-2);
  }

  .modes svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The half of System's disc that is dark. */
  .modes .half {
    fill: currentColor;
  }

  .grid {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
    align-content: start;
    gap: var(--space-2);
    padding: var(--space-2);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    padding: 5px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    text-align: start;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  /* The one the pointer or the keys are on: the row every list in the app lights,
     and its miniature lifted a little out of the card. */
  .card.is-on {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .card :global(.mini) {
    transition:
      translate var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .card.is-on :global(.mini) {
    translate: 0 -1px;
  }

  /* The one kept: the ring the chosen accent wears, in the accent, outside the
     miniature's own edge. */
  .card.kept :global(.mini) {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--text) 12%, transparent),
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }

  .card:active {
    background: var(--surface-press);
  }

  .name {
    padding: 0 2px;
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card.kept .name {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  /* The store's card: the same shape with nothing in it yet but the way to more. */
  .more {
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 10;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-sm);
    color: var(--muted);
  }

  .more svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  .foot {
    flex: none;
    padding: var(--space-2) var(--space-3) var(--space-3);
    border-top: 1px solid var(--line);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  /* A theme that brings its own accent keeps it, so the dots are quiet while one
     is being tried or kept; see `paintAccent` in theme.svelte.ts. */
  .foot.owned {
    opacity: 0.4;
  }

  /* ── On a phone ────────────────────────────────────────────────── */

  /* A sheet from the foot of the screen, the full width, as a phone's menus are;
     see ContextMenu.svelte. */
  .sheet {
    top: auto;
    left: 0;
    right: 0;
    bottom: var(--keyboard, 0px);
    width: 100%;
    max-height: min(80dvh, calc(100dvh - var(--keyboard, 0px) - var(--space-5)));
    padding-bottom: var(--touch-bottom);
    border-top: 1px solid var(--line-strong);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface);
    box-shadow: var(--shadow-lg);
  }

  .grip {
    flex: none;
    width: 36px;
    height: 4px;
    margin: 8px auto 2px;
    border-radius: 2px;
    background: var(--line-strong);
  }
</style>
