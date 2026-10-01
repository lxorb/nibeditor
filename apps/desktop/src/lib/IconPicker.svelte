<script lang="ts">
  /** The one picker in the app, for everything that can wear an icon: a note, a
   *  canvas or a folder in the file list, and the space itself. What is being chosen
   *  for is in icon-choice.svelte.ts rather than in a prop, because a row is drawn deep
   *  inside a tree of these components and a space is named somewhere else entirely;
   *  this is mounted once, over the whole page.
   *
   *  Three sets, thousands of icons, one search field. Which set is a chooser rather
   *  than three sheets, because the question is always the same question - what should
   *  this wear - and the answer happens to live in three places; see icon-sets.ts. A
   *  set's data arrives the first time its tab is opened, and the tab you were last in
   *  is the one it opens on.
   *
   *  The grid draws only the rows on screen. Two thousand emoji is two thousand
   *  elements, and a sheet that took a second to open every time would be a sheet
   *  nobody used; what is drawn is the window plus a row on either side, which is a
   *  hundred-odd cells however large the set is.
   *
   *  What is left is where the icon is kept, and that is the one thing that differs
   *  between the targets: a note's and a canvas's belong to the file and are written
   *  into it, a folder's to the space that holds it, a space's to this device. Hence
   *  the last row, which says what the thing falls back to when it wears nothing - a
   *  letter for a space, and for everything in the file list the mark that says what
   *  it is. */
  import { ACCENTS } from './accents'
  import { closeOnBack } from './backstack.svelte'
  import { chosenIcon, chosenTint } from './chosen-icon'
  import { setFileIcon } from './file-icon'
  import Icon from './Icon.svelte'
  import { iconChoice } from './icon-choice.svelte'
  import { iconLibrary } from './icon-library.svelte'
  import { iconRecent } from './icon-recent.svelte'
  import { DEFAULT_SET, ICON_SETS } from './icon-sets'
  import { rankIcons, readIcon, sameIcon, writtenIcon } from './icons'
  import { t } from './i18n.svelte'
  import { dur, LAYER } from './motion'
  import { overlays } from './overlays'
  import { segmented } from './slide'
  import { trap } from './trap'
  import { viewport } from './viewport.svelte'
  import { workspace } from './workspace.svelte'
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'

  /** How wide and tall one cell is, in pixels: a comfortable click under a pointer,
   *  and a thumb's target under a finger.
   *
   *  One number, in script rather than in the stylesheet, because the window is worked
   *  out from it: a cell the CSS made larger than the arithmetic thought it was would
   *  draw the wrong rows. The stylesheet takes it from here.
   *
   *  `MARGIN` is how far past the window the drawn rows reach, which is what keeps a
   *  fast scroll from showing a gap. */
  const POINTER_CELL = 38
  const TOUCH_CELL = 48
  const MARGIN = 2

  /** How many a search answers with. Past this nobody is reading, they are typing
   *  another word - and the ranking is over every icon in the set either way. */
  const FOUND = 300

  let query = $state('')
  let field = $state<HTMLInputElement>()
  let scroller = $state<HTMLElement>()
  let width = $state(0)
  let height = $state(0)
  let top = $state(0)
  /** Which cell the arrows are on, as an index into `cells`. */
  let at = $state(0)
  /** The colour the next pick is drawn in. Starts as the one the thing already wears,
   *  so changing the icon keeps the colour and changing the colour keeps the icon. */
  let tint = $state<string | null>(null)

  const cell = $derived(viewport.touch ? TOUCH_CELL : POINTER_CELL)
  const target = $derived(iconChoice.target)
  const set = $derived(iconRecent.set || DEFAULT_SET)
  const held = $derived(iconLibrary.loaded[set])

  /** What the thing being chosen for wears now, as written. */
  const worn = $derived(
    target === null
      ? null
      : target.kind === 'space'
        ? workspace.iconFor(target.id)
        : chosenIcon(target.path),
  )

  const written = $derived(readIcon(worn))

  /** The value a cell of the open set would write. */
  const value = (name: string) => writtenIcon(set, name)

  /** Every cell of the open set, in the order it is shown: what a search found, or the
   *  set's own order when nothing has been typed. */
  const cells = $derived(
    held ? rankIcons(held.entries, query, query ? FOUND : held.entries.length) : [],
  )

  const columns = $derived(Math.max(1, Math.floor((width || cell * 8) / cell)))

  /** A row of the grid: a heading where a group begins, or a run of cells. Every row is
   *  one cell tall, headings included, which is what lets the window be worked out
   *  with one division rather than a table of heights. */
  type Row = { head: string } | { names: string[] }

  /** Groups only where the set has them and nothing has been typed. A search is
   *  already an order - the best answer first - and cutting it into Unicode's
   *  categories would bury the answer under a heading. */
  const rows = $derived.by((): Row[] => {
    if (!held) return []

    const runs = (names: readonly string[]): Row[] => {
      const out: Row[] = []
      for (let from = 0; from < names.length; from += columns) {
        out.push({ names: names.slice(from, from + columns) })
      }

      return out
    }

    if (query || !held.groups.length) return runs(cells)

    return held.groups.flatMap((group) => [{ head: group.label }, ...runs(group.names)])
  })

  /** What each cell is called, for a reader who cannot see it. The set's own words
   *  rather than its name: an emoji's name is the character itself, which a screen
   *  reader announces as the picture and not as "rocket". */
  const words = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()

    for (const entry of held?.entries ?? []) map.set(entry.name, entry.words)

    return map
  })

  const called = (name: string) => words.get(name) ?? name

  /** Which row each cell sits on, so the arrows can put the one they moved onto in
   *  view. */
  const rowOf = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, number>()

    rows.forEach((row, index) => {
      if ('names' in row) for (const name of row.names) map.set(name, index)
    })

    return map
  })

  const shown = $derived({
    from: Math.max(0, Math.floor(top / cell) - MARGIN),
    to: Math.min(rows.length, Math.ceil((top + height) / cell) + MARGIN),
  })

  /** Reads a value for its own sake, so the effect around it follows it. The same
   *  helper PromptSheet uses, and for the same reason. */
  const reads = (_value: unknown) => undefined

  /** How long the field waits for the sheet's own transition before it takes the
   *  keyboard. Focusing an element that is still scaling up scrolls the sheet. */
  const FOCUS = 40

  let focusing: ReturnType<typeof setTimeout> | undefined

  // The sheet is up the moment somebody asks for it; a set of icons is a chunk of its
  // own and arrives after, which is what the quiet line in the middle says.
  $effect(() => {
    const asked = iconChoice.target
    if (!asked) return

    query = ''
    at = 0
    top = 0
    tint = asked.kind === 'space' ? workspace.tintFor(asked.id) : chosenTint(asked.path)

    clearTimeout(focusing)
    focusing = setTimeout(() => field?.focus(), dur(FOCUS))
  })

  // Whichever set the tab is on, fetched once; see icon-library.svelte.ts.
  $effect(() => {
    if (target) iconLibrary.load(set)
  })

  // A fresh set of answers starts at the first of them: the cell the arrows were on is
  // no longer the one under them.
  $effect(() => {
    reads(query)
    reads(set)
    at = 0
  })

  // Nothing is waiting to be focused once the sheet has gone.
  $effect(() => () => clearTimeout(focusing))

  // Escape closes it, like everything else the app puts over a note; see overlays.ts.
  $effect(() => (target ? overlays.show(() => iconChoice.close()) : undefined))
  $effect(() => closeOnBack(target !== null, () => iconChoice.close()))

  /** One written value onto the thing being chosen for, and the sheet shut. The three
   *  targets differ in nothing but where the value goes. */
  function chose(said: string | null) {
    const asked = iconChoice.target
    if (!asked) return

    const colour = said === null ? null : tint

    if (asked.kind === 'space') workspace.setIcon(asked.id, said, colour)
    else if (asked.kind === 'folder') workspace.setFolderIcon(asked.path, said, colour)
    else void setFileIcon(asked.path, said, colour)

    iconRecent.add(said)
    iconChoice.close()
  }

  /** A colour on its own, which only means anything for something already wearing a
   *  stroked icon: an emoji and a coloured drawing have their own colours. Written at
   *  once, so a row of dots reads as a row of dots rather than as a setting to confirm. */
  function paint(colour: string | null) {
    tint = colour

    const asked = iconChoice.target
    if (!asked || written?.kind !== 'lucide' || worn === null) return

    if (asked.kind === 'space') workspace.setIcon(asked.id, worn, colour)
    else if (asked.kind === 'folder') workspace.setFolderIcon(asked.path, worn, colour)
    else void setFileIcon(asked.path, worn, colour)
  }

  /** The arrows walk the grid and Enter takes what they are on. Read from the search
   *  field, which is where the keyboard already is: a grid that had to be tabbed into
   *  would be a grid nobody reached. */
  function onKey(event: KeyboardEvent) {
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    }

    const step = steps[event.key]
    if (step !== undefined && cells.length) {
      event.preventDefault()
      at = Math.min(cells.length - 1, Math.max(0, at + step))
      reach(cells[at])
      return
    }

    const here = cells[at]
    if (event.key === 'Enter' && here !== undefined) {
      event.preventDefault()
      chose(value(here))
    }
  }

  /** Scrolls the row a cell sits on into view, which is what keeps the arrows from
   *  walking off the bottom of the window. */
  function reach(name: string | undefined) {
    const row = name === undefined ? undefined : rowOf.get(name)
    if (row === undefined || !scroller) return

    const start = row * cell
    if (start < scroller.scrollTop) scroller.scrollTop = start
    else if (start + cell > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = start + cell - scroller.clientHeight
    }
  }
</script>

{#if target}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => iconChoice.close()}
  ></div>

  <div
    class="nib-screen sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={t('Choose an icon')}
    style:--cell="{cell}px"
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <input
      class="nib-field"
      bind:this={field}
      bind:value={query}
      onkeydown={onKey}
      placeholder={t('Search icons - work, journal, money…')}
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
    />

    <!-- Which set, as one control rather than three sheets. Somebody else drew two of
         them, so the tab carries who and under what licence: that belongs where a
         person is looking at the drawings rather than in a panel nobody opens. The
         emoji have no credit, being the platform's own font. -->
    <div class="nib-segmented" role="radiogroup" aria-label={t('Icons')} use:segmented>
      {#each ICON_SETS as one (one.id)}
        <button
          type="button"
          title={one.credit || undefined}
          aria-pressed={one.id === set}
          class:on={one.id === set}
          onclick={() => iconRecent.open(one.id)}
        >
          {t(one.label)}
        </button>
      {/each}
    </div>

    <!-- The last few, whichever set each came from: somebody marking a month of
         folders reaches for the same handful, and reaching for them should not mean
         typing the same words again. -->
    {#if iconRecent.list.length}
      <div class="recent">
        {#each iconRecent.list as one (one)}
          <button
            type="button"
            class="cell"
            title={one}
            aria-label={one}
            class:active={sameIcon(one, worn)}
            onclick={() => chose(one)}
          >
            <span class="glyph"><Icon icon={readIcon(one)} {tint} /></span>
          </button>
        {/each}
      </div>
    {/if}

    <div
      class="grid"
      bind:this={scroller}
      bind:clientWidth={width}
      bind:clientHeight={height}
      onscroll={() => (top = scroller?.scrollTop ?? 0)}
    >
      {#if iconLibrary.absent[set]}
        <!-- A set that is not in this build, or a chunk that would not come down.
             Said once, calmly, rather than left loading for ever. -->
        <p class="empty">{t('That set is not here')}</p>
      {:else if !held}
        <p class="empty">{t('Loading…')}</p>
      {:else if !cells.length}
        <p class="empty">{t('Nothing found')}</p>
      {:else}
        <div class="tall" style:height="{rows.length * cell}px">
          {#each rows.slice(shown.from, shown.to) as row, index (shown.from + index)}
            <div class="row" style:top="{(shown.from + index) * cell}px">
              {#if 'head' in row}
                <span class="head">{row.head}</span>
              {:else}
                {#each row.names as name (name)}
                  <!-- What this icon is written as and what it is called, once
                       each: the cell asked the first three times and the second
                       twice, over a window of a few hundred cells. -->
                  {@const written = value(name)}
                  {@const label = called(name)}
                  <button
                    type="button"
                    class="cell"
                    title={label}
                    aria-label={label}
                    class:active={sameIcon(written, worn)}
                    class:at={cells[at] === name}
                    onclick={() => chose(written)}
                  >
                    <span class="glyph"><Icon icon={readIcon(written)} {tint} /></span>
                  </button>
                {/each}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- The colour a line icon is drawn in. Only for the line set: an emoji and a
         coloured drawing are already pictures in their own colours, and painting over
         one would be painting over somebody's drawing. -->
    {#if set === DEFAULT_SET}
      <div class="tints" role="group" aria-label={t('Colour')}>
        <button
          type="button"
          class="tint plain"
          aria-label={t('Plain')}
          aria-pressed={tint === null}
          class:on={tint === null}
          onclick={() => paint(null)}
        ></button>
        {#each ACCENTS as accent (accent.id)}
          <button
            type="button"
            class="tint"
            aria-label={accent.name}
            aria-pressed={tint === accent.id}
            class:on={tint === accent.id}
            style:--dot={accent.dark}
            onclick={() => paint(accent.id)}
          ></button>
        {/each}
      </div>
    {/if}

    <button class="clear" onclick={() => chose(null)}>
      {target.kind === 'space'
        ? t('Use the first letter instead')
        : t('Use the plain mark instead')}
    </button>
  </div>
{/if}

<style>
  /* `.nib-screen` in the themes package: where it hangs, how tall it may get, and a
     sheet's width of the scale. */
  .sheet {
    --screen-width: var(--screen-sheet);

    z-index: var(--z-sheet);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  /* The window, and inside it a box as tall as every row there is, so the scrollbar
     tells the truth about a set of two thousand while only a screenful is drawn. It
     is what gives way when the sheet reaches the most it may be. */
  .grid {
    min-height: 0;
    max-height: 46vh;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .tall {
    position: relative;
  }

  .row {
    position: absolute;
    inset-inline: 0;
    height: var(--cell);
    display: flex;
    align-items: center;
  }

  /* A group's name, in the same row height as the cells: one height for every row is
     what keeps the window one division rather than a table. */
  .head {
    padding: 0 4px;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted);
  }

  /* One row of them and no scrollbar: a second row of recent icons would be a second
     grid, and the grid is right below it. */
  .recent {
    display: flex;
    overflow: hidden;
  }

  .cell {
    width: var(--cell);
    height: var(--cell);
    flex: none;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  .cell.at {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  /* Only under a pointer that hovers. WebKit leaves the last tap's hover on
     whatever is under the finger when the picker rises, and in a grid of marks it
     read as a second one chosen beside the one that is. */
  @media (hover: hover) {
    .cell:hover {
      background: var(--accent-soft);
      color: var(--text-strong);
    }
  }

  .cell.active {
    background: var(--accent);
    color: var(--accent-ink);
  }

  /* The box Icon.svelte fills, and the size an emoji in it is set at. */
  .glyph {
    display: block;
    width: var(--icon-lg);
    height: var(--icon-lg);
    font-size: var(--icon-lg);
    stroke: currentColor;
    stroke-width: 1.8;
  }

  .empty {
    margin: 0;
    padding: var(--space-5) 0;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .tints {
    display: flex;
    gap: 6px;
  }

  .tint {
    width: 18px;
    height: 18px;
    flex: none;
    border: 1px solid var(--line-strong);
    border-radius: 50%;
    background: var(--dot);
    cursor: default;
  }

  /* No colour is a colour too: the foreground the rest of the list is drawn in. */
  .plain {
    background: var(--text);
  }

  .tint.on {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3px var(--accent);
  }

  .clear {
    align-self: flex-start;
    padding: 6px 10px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
  }

  .clear:hover {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  /* On the keys rather than under them, as every other sheet is; see Sheet.svelte.
     The marks give up what the keys take: at the foot of the screen they ran on
     under the keyboard, and what a search found there could not be reached. */
  :global([data-touch]) .sheet {
    top: auto;
    bottom: var(--keyboard);
    left: 0;
    translate: none;
    width: 100%;
    max-height: min(88dvh, calc(100dvh - var(--keyboard) - var(--inset-top)));
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: var(--touch-bottom);
  }
</style>
