<script lang="ts">
  /** The theme store, as a sheet over the settings.
   *
   *  A grid of live miniatures rather than a list of names: a theme is a look,
   *  and the only honest way to offer one is to show it. Each card is the same
   *  small note drawn with that theme's own tokens by the app's own prose rules,
   *  so what is on the card is what the reader will get. Clicking one opens it
   *  larger, with its palette laid out, and the one button that applies to where
   *  that theme stands. */

  import { closeOnBack } from './backstack.svelte'
  import { fade, fly, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { plural, t } from './i18n.svelte'
  import { overlays } from './overlays'
  import { scrollbar } from './scrollbar'
  import Select from './Select.svelte'
  import { type Scheme, theme } from './theme.svelte'
  import { viewport } from './viewport.svelte'
  import type { StoreTheme } from './themes/registry'
  import { FRAME, FULL_HEIGHT, miniatureCss, paletteCss, sampleHtml } from './themes/sample'
  import { PAINT, store } from './themes/store.svelte'
  import { dur, LAYER } from './motion'
  import { trap } from './trap'
  import Cross from './Cross.svelte'

  const STYLE_ID = 'nib-theme-miniatures'
  const PALETTE_ID = 'nib-theme-palettes'

  /** The tokens the full preview lays out as swatches, in the order somebody
   *  judging a theme reads them: the ground it sits on, the lines, the words,
   *  the accent, then the two colours that mean something. */
  const SWATCHES = [
    '--bg',
    '--surface',
    '--surface-2',
    '--line-strong',
    '--muted',
    '--text',
    '--text-strong',
    '--accent',
    '--danger',
    '--success',
  ]

  /** How many cards stand in for the catalogue while it is on its way. Enough
   *  to fill the first row or two, so the sheet does not jump when they land. */
  const WAITING = [0, 1, 2, 3, 4, 5]

  /** Which card is under the pointer, so a theme with both schemes can show the
   *  other one. One piece of state for the whole grid rather than one each. */
  let hovered = $state<string | null>(null)

  /** Which side of a pair the full preview is showing, once it has been asked
   *  for. Null follows the app, which is what the grid does. */
  let previewing = $state<Scheme | null>(null)

  /** The sample note, in whatever language the app is in. Built once per
   *  language rather than once per card: thirty cards show the same note. The
   *  preview shows more of the same one, since it has the room. */
  const sample = $derived(sampleHtml())
  const fullSample = $derived(sampleHtml(true))

  // Escape closes whichever overlay is on top, and Back does the same on a
  // phone. Inside the settings, so this is a second overlay over that one.
  $effect(() => (store.open ? overlays.show(() => store.close()) : undefined))
  $effect(() => closeOnBack(store.open, () => store.close()))

  /** Writes a stylesheet into the head, or takes it away again. The app's own
   *  way of putting a theme on the page; see theme.svelte.ts. */
  function inject(id: string, css: string) {
    let style = document.getElementById(id)

    if (!css) {
      style?.remove()
      return
    }

    if (!style) {
      style = document.createElement('style')
      style.id = id
      document.head.append(style)
    }

    if (style.textContent !== css) style.textContent = css
  }

  // The miniature's rules: the app's own, re-scoped, once per session. Asked for
  // when the gallery first opens rather than at startup, because that is when
  // the text they are built from is worth loading.
  $effect(() => {
    if (!store.open || document.getElementById(STYLE_ID)) return

    void miniatureCss().then((css) => inject(STYLE_ID, css))
  })

  // One block per theme and scheme, rebuilt when the catalogue changes. This is
  // what a card is painted from: no stylesheet is fetched to draw a miniature.
  $effect(() => inject(PALETTE_ID, store.open ? paletteCss(store.themes) : ''))

  // How long the grid takes from the catalogue arriving to being on the screen.
  // Read on the frame after the cards are laid out, which is the number that
  // matters: the mark is set where the index is parsed.
  $effect(() => {
    const themes = store.shown
    if (!store.open || !themes.length) return

    const frame = requestAnimationFrame(() => {
      if (!performance.getEntriesByName(`${PAINT}:index`).length) return

      performance.measure(PAINT, `${PAINT}:index`)
      // Taken away once it is spent, so a later re-render cannot be measured
      // against a catalogue that arrived minutes ago.
      performance.clearMarks(`${PAINT}:index`)
    })

    return () => cancelAnimationFrame(frame)
  })

  /** Which scheme a miniature shows.
   *
   *  The app's own, so the grid reads as the app reads. A theme that only states
   *  the other one shows that instead: half a card would be no preview at all.
   *  `wanted` is what a preview was asked to show; on the grid nothing asks, and
   *  pointing at a pair shows its other side. */
  function schemeOf(one: StoreTheme, wanted?: Scheme | null): Scheme {
    const shows = wanted ?? theme.current
    if (!one.variants.includes(shows)) return one.variants[0] ?? shows

    const pointed = hovered === one.id && one.variants.length > 1
    return pointed && !wanted ? (shows === 'dark' ? 'light' : 'dark') : shows
  }

  /** The one tag worth putting on a card. A theme that tags itself `light` is
   *  saying what the miniature above the line already says, and saying it wrong
   *  half the time for a pair; so the scheme words are passed over and the first
   *  tag that describes the mood is taken instead. */
  function moodOf(one: StoreTheme): string | undefined {
    return one.tags.find((tag) => tag !== 'light' && tag !== 'dark')
  }

  /** What the swatches show for the theme being previewed: whichever scheme it
   *  is being previewed in, with the tokens it does not state left out. */
  function swatchesOf(one: StoreTheme, scheme: Scheme) {
    const palette = one.palettes[scheme]
    return SWATCHES.filter((token) => palette[token]).map((token) => ({
      token,
      value: palette[token] ?? '',
    }))
  }

  const ORDERS = $derived([
    { value: 'newest', label: t('Newest') },
    { value: 'name', label: t('Name') },
  ])
</script>

{#if store.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => store.close()}
  ></div>

  <!-- Named by whatever heads it, which is the theme being looked at or the
       store itself: the same words, once. -->
  <div
    class="sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={store.chosen?.name ?? t('Themes')}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <!-- The head of a sheet, and not the head of the page: a bare `header` is the
         page's banner wherever it is not inside an article or a section, so this
         one was a second banner over the app's own. It is the row the title and the
         find box sit in, which is nothing in itself. -->
    <header role="presentation">
      {#if store.chosen}
        <button
          class="nib-glyph back"
          onclick={() => {
            store.opened = null
            previewing = null
          }}
          aria-label={t('Back')}
        >
          <svg class="nib-mirror" viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" /></svg>
        </button>
        <p class="title">{store.chosen.name}</p>
      {:else}
        <input
          class="find"
          bind:value={store.query}
          placeholder={t('Search themes')}
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
          aria-label={t('Search themes')}
        />
        <div class="sort">
          <Select
            value={store.order}
            options={ORDERS}
            onchange={(value: string) => (store.order = value === 'name' ? 'name' : 'newest')}
            label={t('Sort')}
            plain={viewport.touch}
          />
        </div>
      {/if}

      <button class="nib-glyph shut" onclick={() => store.close()} aria-label={t('Close')}>
        <Cross />
      </button>
    </header>

    <div class="body" data-scrolls use:scrollbar={store.opened ?? 'grid'}>
      {#if store.chosen}
        {@render preview(store.chosen)}
      {:else if store.loading && !store.themes.length}
        <!-- The grid is the report: cards with nothing in them yet, in the shape
             the real ones will take, so the sheet does not jump when they land. -->
        <div class="grid">
          {#each WAITING as slot (slot)}
            <div class="card waiting"><div class="frame"></div></div>
          {/each}
        </div>
      {:else if store.shown.length}
        <div class="grid">
          {#each store.shown as one (one.id)}
            <!-- What the theme is for, once rather than twice. -->
            {@const mood = moodOf(one)}
            <button
              class="card"
              onclick={() => {
                store.opened = one.id
                // Each theme is looked at from the side the app is on, whatever
                // side the last one was being looked at from.
                previewing = null
              }}
              onmouseenter={() => (hovered = one.id)}
              onmouseleave={() => (hovered = null)}
              onfocus={() => (hovered = one.id)}
              onblur={() => (hovered = null)}
            >
              <div class="frame {FRAME}" data-palette={one.id} data-theme={schemeOf(one)}>
                <!-- The same markup the renderer writes, drawn by the same
                     rules. Ours, not the theme author's: a theme brings colours
                     and nothing else. -->
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                <div class="nib-mini-page">{@html sample}</div>
              </div>

              <div class="label">
                <span class="who">
                  <span class="name">{one.name}</span>
                  <span class="by"
                    >{one.author}{#if mood}
                      · {mood}{/if}</span
                  >
                </span>
                {@render mark(one)}
              </div>
            </button>
          {/each}
        </div>
      {:else}
        <p class="note">{store.error ? t(store.error) : t('Nothing matches.')}</p>
      {/if}
    </div>
  </div>
{/if}

<!-- Where a theme stands, as a shape rather than a sentence: a tick for one in
     the folder, the accent for the one being used, an arrow for one the store is
     ahead of. -->
{#snippet mark(one: StoreTheme)}
  {#if store.updatable(one)}
    <svg class="state up" viewBox="0 0 16 16" role="img" aria-label={t('Update')}
      ><path d="M8 12.5V4M4.5 7.5L8 4l3.5 3.5" /></svg
    >
  {:else if store.installed(one.id)}
    <svg
      class="state"
      class:using={store.using(one.id)}
      viewBox="0 0 16 16"
      role="img"
      aria-label={store.using(one.id) ? t('In use') : t('Installed')}
      ><path d="M3.5 8.5l3 3 6-7" /></svg
    >
  {/if}
{/snippet}

{#snippet preview(one: StoreTheme)}
  {@const scheme = schemeOf(one, previewing)}

  <div class="full" in:fly={{ y: 8, duration: dur(180), easing: cubicOut }}>
    <div class="shown">
      <div
        class="frame big {FRAME}"
        data-palette={one.id}
        data-theme={scheme}
        style:--mini-page="{FULL_HEIGHT}px"
      >
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="nib-mini-page">{@html fullSample}</div>
      </div>

      <!-- A pair is looked at from both sides before it is chosen. -->
      {#if one.variants.length > 1}
        <div class="sides">
          {#each one.variants as variant (variant)}
            <button
              class="side"
              class:at={variant === scheme}
              onclick={() => (previewing = variant)}
            >
              {variant === 'light' ? t('Light') : t('Dark')}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="about">
      <div class="palette">
        {#each swatchesOf(one, scheme) as swatch (swatch.token)}
          <span class="chip" style:--chip={swatch.value} title={swatch.token}></span>
        {/each}
      </div>

      {#if one.description}
        <p class="says">{one.description}</p>
      {/if}

      <div class="facts">
        <span>{one.author}</span>
        <span>{one.version}</span>
        {#if one.licence}<span>{one.licence}</span>{/if}
        {#each one.tags as tag (tag)}<span class="tag">{tag}</span>{/each}
      </div>

      <div class="row">
        {#if store.installed(one.id) && !store.updatable(one)}
          <button
            class="nib-button"
            disabled={store.using(one.id) || store.working !== null}
            onclick={() => store.use(one.id)}>{store.using(one.id) ? t('In use') : t('Use')}</button
          >
          <button
            class="nib-button is-quiet"
            disabled={store.working !== null}
            onclick={() => void store.remove(one.id)}>{t('Remove')}</button
          >
        {:else}
          <button
            class="nib-button"
            disabled={store.working !== null}
            onclick={() => void store.install(one)}
            >{store.updatable(one) ? t('Update') : t('Install')}</button
          >
        {/if}
      </div>

      {#if store.error}
        <p class="note bad">{t(store.error)}</p>
      {/if}

      <!-- What the theme asked for and did not get. Said once, plainly, under
           the thing it is about: a theme with one line the app will not apply is
           still a theme, and pretending otherwise would be the lie. -->
      {#if store.refused.id === one.id && store.refused.notes.length}
        <p class="note">
          {plural(store.refused.notes.length, {
            one: '{count} thing in this theme was left out.',
            other: '{count} things in this theme were left out.',
          })}
        </p>
      {/if}
    </div>
  </div>
{/snippet}

<style>
  /* The layer behind it; see .nib-scrim in packages/themes. */
  .scrim {
    --scrim-z: var(--z-store);
    --scrim-ink: 55%;
  }

  /* A little inside the settings sheet it sits on, so the one underneath is
     still visibly there. */
  .sheet {
    position: fixed;
    top: 13vh;
    left: 50%;
    translate: -50% 0;
    width: min(52rem, calc(100vw - 4rem));
    height: 68vh;
    z-index: var(--z-store);
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }

  .find {
    flex: 1;
    min-width: 0;
    padding: 7px 11px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .sort {
    flex: none;
    width: 8.5rem;
  }

  .title {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The way back and the way out are `.nib-glyph` in the themes package. They
     were a hard-coded 28px square with a 14px mark and `--radius-sm`, which made
     them the one pair of icon buttons in the app that did not grow under a thumb
     and did not share the corner the rest are drawn with. */

  .body {
    padding: var(--space-4);
    overflow-y: auto;
  }

  /* ── The grid ──────────────────────────────────────────────────── */

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: var(--space-3);
  }

  .card {
    display: flex;
    flex-direction: column;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    text-align: start;
    cursor: default;
    overflow: hidden;
    transition:
      translate var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .card:hover {
      translate: 0 -2px;
      border-color: var(--line-strong);
      box-shadow: var(--shadow-md);
    }
  }

  .card:active {
    translate: 0 0;
  }

  .card:focus-visible {
    outline-offset: 2px;
  }

  /* The miniature. Its own colours come from the theme; the size is the card's
     business, and the scale is what turns a note into a miniature of one. */
  .frame {
    --mini-scale: 0.62;
    width: 100%;
    border-bottom: 1px solid var(--line);
  }

  /* Not scaled at all: the preview is the reading view at the size a note is
     really read at, so what is being judged is the thing itself. */
  .frame.big {
    --mini-scale: 1;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .card.waiting {
    /* Nothing to show yet, and nothing to say about it either. */
    border-style: dashed;
    opacity: 0.6;
  }

  .card.waiting .frame {
    background: var(--surface-3);
  }

  .label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 9px 11px;
  }

  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .name {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .by {
    font-size: var(--text-xs);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .state.using,
  .state.up {
    stroke: var(--accent);
  }

  /* ── The full preview ──────────────────────────────────────────── */

  /* The sample takes the room; what is known about the theme stands beside it,
     so the sheet is the same size whichever half of the store is showing. */
  .full {
    display: grid;
    grid-template-columns: 1fr 16rem;
    gap: var(--space-4);
    align-items: start;
  }

  .shown,
  .about {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .sides {
    display: flex;
    gap: var(--space-1);
  }

  .side {
    padding: 4px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  /* The side being looked at is the filled row every "this one" in the app is:
     the surface says which, and the words go dark. The accent on a wash of itself
     is the one combination this palette does not carry - it clears three to one
     against a surface, not four and a half against a tint of itself. The same
     answer the menu's chosen chip was given; see AppMenu.svelte. */
  .side.at {
    background: var(--surface-selected);
    color: var(--active-file-text-color);
  }

  .palette {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  /* A ring rather than a border, so the chip is only the colour it names and a
     colour the same as the surface still has an edge. */
  .chip {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    background: var(--chip);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 18%, transparent);
  }

  .says {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.55;
    color: var(--muted-strong);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .facts .tag {
    padding: 1px 7px;
    border-radius: 99px;
    background: var(--surface-2);
  }

  .row {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  /* Using, installing and removing a theme are `.nib-button` in the themes
     package, the same pair every sheet in the app offers. */

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .note.bad {
    color: var(--danger);
  }

  /* On the keys while the search has them, as every sheet is; see Sheet.svelte.
     At the foot of the screen what a search found ran on under the keyboard. */
  :global([data-touch]) .sheet {
    top: auto;
    bottom: var(--keyboard);
    left: 0;
    translate: none;
    width: 100%;
    height: min(90dvh, calc(100dvh - var(--keyboard) - var(--inset-top)));
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }

  :global([data-touch]) .grid {
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  }

  /* No room for two columns, so the sample and what is known about it stack
     the way every other pane does on a phone. */
  :global([data-touch]) .full {
    grid-template-columns: 1fr;
  }
</style>
