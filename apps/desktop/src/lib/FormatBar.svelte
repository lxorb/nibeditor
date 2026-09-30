<script lang="ts">
  import {
    selectedImage,
    toggleHighlight,
    type EditorView,
    type StateCommand,
    type Transaction,
  } from '@nib/editor'
  import { HIGHLIGHT_COLOURS, type HighlightColour } from '@nib/markdown/highlights'
  import type { IconNode } from 'lucide'
  import { tick } from 'svelte'
  import CanvasIcon from './CanvasIcon.svelte'
  import { t } from './i18n.svelte'
  import { modes } from './modes.svelte'
  import { roving } from './roving'
  import { type AppContext, runEntry } from './shortcuts/registry'
  import { titled } from './titled'
  import { glyphFor, lowMark, markFor, nameFor, toolbar } from './toolbar.svelte'
  import { viewport } from './viewport.svelte'

  const {
    view,
    context,
  }: {
    view?: EditorView | undefined
    /** What a registry command needs that only the running app has; see
     *  App.svelte, which builds the same one for the keyboard. */
    context?: (() => AppContext) | undefined
  } = $props()

  let at = $state<{ x: number; y: number } | null>(null)

  /** The editor the bar was last placed over. Not a rune: nothing is drawn from it,
   *  and the effect that asks after it must not wake when `follow` writes it. */
  let over: EditorView | null = null

  let bar = $state<HTMLElement>()
  /** Whether the colours are showing instead of the actions. */
  let colouring = $state(false)

  /** One tab stop with the arrows inside it, which is what every strip in the app
   *  is; see roving.ts and docs/keyboard.md. Enter and Space press the button the
   *  arrows are on, and Escape gives the note the keyboard back. The colours are
   *  buttons in that same row, so each is a stop of its own and the arrows reach
   *  them without a second rule. */
  const keys = { across: true, rows: 'button' } as const

  /** Whether the keyboard is typing into the note the bar writes into, or into the
   *  bar itself, which the arrows walk. The keys come up for any field - a name
   *  being changed in the file list, a card on a plane, a table's cell - and the
   *  bar only ever acts on the note: over the others it put its marks into the note
   *  behind and took the keyboard off the field, or did nothing at all. */
  let writing = $state(false)

  $effect(() => {
    const note = view?.contentDOM
    let live = true
    // Read once the focus has landed, a microtask on: a focus lost because Svelte
    // took the element away is announced in the middle of Svelte's own update,
    // and a rune written from there is one Svelte refuses outright.
    const follow = () =>
      queueMicrotask(() => {
        if (!live) return
        const at = document.activeElement
        writing = !!note && (at === note || (!!at && !!bar?.contains(at)))
      })

    follow()
    document.addEventListener('focusin', follow)
    document.addEventListener('focusout', follow)
    return () => {
      live = false
      document.removeEventListener('focusin', follow)
      document.removeEventListener('focusout', follow)
    }
  })

  /** Docked above the keyboard on a phone: there is no hovering over a
   *  selection with a thumb, and the buttons are wanted before the selection
   *  exists rather than after it. */
  const docked = $derived(viewport.touch && viewport.typing && writing)

  // A bar that has gone covers nothing: the height bound below is left at whatever
  // it last was when the bar leaves, so it is taken back here.
  $effect(() => {
    if (!docked) viewport.covered = 0
  })

  /** An editor taken down takes its callout with it, and so does one the window's
   *  keyboard has left. The bar only hears from editors, and one that has gone reports
   *  no last selection on the way: a tab turned into its reading view, the last tab of
   *  a pane closed with a line selected, the keyboard gone to another pane. So once the
   *  window's editor is not the one the bar stands over, there is nothing to format. */
  $effect(() => {
    if (view === over) return
    at = null
    colouring = false
  })

  /** The colours are a moment's choice rather than a mode, so the row goes back
   *  to the actions whenever the bar leaves. A phone's bar leaves every time the
   *  keyboard does, and one that came back showing colours would be answering a
   *  question nobody had asked. */
  $effect(() => {
    if (!docked && !at) colouring = false
  })

  /** Follows the selection, and hides the moment there is nothing selected.
   *  A selected picture has a toolbar of its own, in the same place, and a
   *  note being read has nothing to format: every button here writes.
   *
   *  Only where there is a pointer. On a phone this answers with no position at
   *  all, because the bar there is the docked strip; see below. */
  export function follow(current: EditorView) {
    const range = current.state.selection.main

    // The bar goes when the note stops being written in - but not while the bar
    // itself has the keyboard, or reaching a button with a key would take the bar
    // away from under it and leave the focus on nothing at all.
    const ours = bar?.contains(document.activeElement) ?? false

    if (
      range.empty ||
      (!current.hasFocus && !ours) ||
      current.state.readOnly ||
      selectedImage(current.state)
    ) {
      at = null
      colouring = false
      return
    }

    // A finger has one bar and it is the strip over the keyboard. The callout is
    // the pointer's answer - there is nothing to hover with and the thumb is over
    // the words - and a callout placed while the keyboard was up is what was left
    // sitting in the middle of the screen when the keyboard went down: `docked`
    // turns off with the keyboard, and the branch below it must not catch what
    // falls through. So a touch device has no `at` at all, and the bar arrives and
    // leaves with the keyboard and nothing else.
    if (viewport.touch) {
      at = null
      return
    }

    const start = current.coordsAtPos(range.from)
    const end = current.coordsAtPos(range.to)
    if (!start || !end) {
      at = null
      return
    }

    // Kept clear of both edges: the bar is centred on the selection, but a
    // selection near the margin would otherwise push it off screen.
    const half = 150
    const middle = (start.left + end.right) / 2
    const x = Math.min(Math.max(middle, half), window.innerWidth - half)

    over = current
    at = { x, y: Math.min(start.top, end.top) }
  }

  function run(command: StateCommand) {
    if (!view) return
    command({ state: view.state, dispatch: (t: Transaction) => view.dispatch(t) })
    view.focus()
  }

  /** Presses one of the reader's own buttons, which is a command in the app's
   *  registry: the same thing the key for it presses, run through the same
   *  function. See toolbar.svelte.ts. */
  function act(id: string) {
    runEntry(id, context?.() ?? { view, palette: () => undefined, fullscreen: () => undefined })
  }

  /** The one action the dot of colours stands beside. By id rather than by its
   *  name, so the markup below does not match on a translated string. */
  const HIGHLIGHT = 'format.highlight'

  /** What the bar holds: the reader's list, or the nine it has always held. What
   *  each of them wears - a letter, a glyph, a mark that sits high in its own em
   *  box - is toolbar.svelte.ts, because the list is the reader's and the marks
   *  have to answer for whatever is on it. */
  const held = $derived(toolbar.ids)

  /** A colour as the dot that offers it: the tone at full strength, the way the
   *  row of dots on the canvas draws the same six. The wash `--mark-*` is for the
   *  words behind a highlight, which have to be read through; a dot is the colour
   *  itself or it is not a colour.
   *
   *  Null is the highlight with no colour of its own, which is drawn as the ring
   *  the others fill - the canvas says "no colour" the same way. */
  const dotFor = (tone: number | null) => (tone === null ? undefined : `var(--canvas-${tone})`)

  /** Shows the colours, or puts the actions back, and leaves the keyboard with
   *  something to stand on.
   *
   *  The row swaps rather than opening a surface of its own, so the button the
   *  keyboard was on is one of the buttons that go - and focus would fall to the
   *  page, which is the same "focus on nothing" the bar already guards against in
   *  `follow`. So the dot the arrows would want next takes it: the first colour on
   *  the way in, the one dot on the way back. Only when the keyboard was in the
   *  bar at all - a pointer never focuses these buttons, because the press
   *  prevents it, and a hand that clicked a dot has not asked for the focus. */
  async function showColours(on: boolean) {
    const keyboard = bar?.contains(document.activeElement) ?? false
    colouring = on
    if (!keyboard) return

    await tick()
    bar?.querySelector<HTMLElement>('button.swatch')?.focus()
  }

  /** Highlights the selection in this colour, and keeps it: the button, the
   *  shortcut and the menu row all write it from now on. The command puts the
   *  keyboard back in the note, which is where it belongs once a word is
   *  formatted, so the row swapping back needs no help here. */
  function pick(colour: HighlightColour) {
    modes.setHighlightTone(colour.tone)
    colouring = false
    run(toggleHighlight(colour))
  }
</script>

<!-- A row of buttons that acts on what is selected, which is what a toolbar is,
     and it says so: the words on the buttons are one letter each, so the name of
     the row is the only thing that says what the row is for.

     Every action runs on the click and not on the press. A press is how a pointer
     arrives and a click is how a pointer and a key both do, and reading the press
     meant the whole bar was a row of buttons that answered a finger, a mouse and
     nothing else: Enter on one of them focused it and did not format a word. The
     press is still read, for the one thing it is for - keeping the caret, and on a
     phone the keyboard, where they are. Both handlers, because the two bars arrive
     by different events and one list of buttons serves both.

     One list of buttons for both bars, because they are the same bar in two
     places: a strip over the keyboard on a phone, a callout by the selection
     everywhere else. What the press prevents is the default that would move the
     focus: on a phone the keyboard would close under the bar, and on a desktop
     the selection the buttons are about would go. -->
{#snippet press(
  title: string,
  label: string,
  act: () => void,
  glyph: IconNode | null = null,
  low = false,
  key: string | null = null,
)}
  <button
    title={titled(title, key)}
    aria-label={title}
    onpointerdown={(event) => event.preventDefault()}
    onmousedown={(event) => event.preventDefault()}
    onclick={act}
  >
    {#if glyph}
      <CanvasIcon node={glyph} />
    {:else if low}
      <span class="low">{label}</span>
    {:else}
      {label}
    {/if}
  </button>
{/snippet}

<!-- A colour, as the dot the whole app asks "which colour" with. The one in hand
     is ringed; a dot with no colour is the ring the others fill. Named by the
     colour itself, which is the word the Format menu's own rows use - a highlight
     is red or it is not, and one vocabulary is one design. -->
{#snippet dot(colour: HighlightColour, on: boolean, act: () => void)}
  <button
    class="swatch"
    class:on
    class:bare={colour.tone === null}
    title={t(colour.name)}
    aria-label={t(colour.name)}
    aria-pressed={on}
    style:--dot={dotFor(colour.tone)}
    onpointerdown={(event) => event.preventDefault()}
    onmousedown={(event) => event.preventDefault()}
    onclick={act}
  ></button>
{/snippet}

{#snippet buttons()}
  {#if colouring}
    <!-- The colours in the bar rather than over it: a phone's bar is the width of
         the screen and has nowhere to put a second surface, and one row is the
         same bar on both devices. -->
    {#each HIGHLIGHT_COLOURS as colour (colour.name)}
      {@render dot(colour, colour.tone === modes.highlight.tone, () => pick(colour))}
    {/each}
    {@render press(t('Highlight colour'), '×', () => void showColours(false))}
  {:else}
    <!-- The reader's own list of commands, by id: a mark to press and the
         command's own name behind it. See toolbar.svelte.ts, which decides what a
         mark is, and the Mobile pane in the settings, which is where the list is
         put together. -->
    {#each held as id (id)}
      {@render press(nameFor(id), markFor(id), () => act(id), glyphFor(id), lowMark(id), id)}

      <!-- The colours sit behind one dot, next to the button they are about, so
           the bar says which colour that button is loaded with. -->
      {#if id === HIGHLIGHT}
        {@render dot(modes.highlight, false, () => void showColours(true))}
      {/if}
    {/each}
  {/if}
{/snippet}

<!-- Sitting on the keyboard, and riding it: `viewport.keyboard` is what the visual
     viewport leaves covered, re-measured on every resize and scroll of it, so the
     bar follows the keys down rather than being placed once and left there. In the
     phone app it is nought, because the window itself is shortened to end where
     the keys begin, and the bar sits on the bottom edge. Either way the whole bar
     goes when the keyboard does; see viewport.svelte.ts. -->
{#if docked}
  <div
    class="nib-bar docked"
    role="toolbar"
    aria-label={t('Format')}
    bind:this={bar}
    bind:offsetHeight={viewport.covered}
    use:roving={keys}
    style:bottom="{viewport.keyboard}px"
  >
    {@render buttons()}
  </div>
{:else if at}
  <div
    class="nib-bar nib-bar-at"
    role="toolbar"
    aria-label={t('Format')}
    bind:this={bar}
    use:roving={keys}
    style:left="{at.x}px"
    style:top="{at.y}px"
  >
    {@render buttons()}
  </div>
{/if}

<style>
  /* The bar's own shape is `.nib-bar` in the theme, which the two bars that
     float over a surface share; see base.css. Only what is different about a
     bar docked over the keyboard is here.

     A strip across the bottom, sitting on the keyboard. Full width so every
     button is a thumb's width, and positioned by `bottom` rather than by a
     transform. */
  .docked {
    position: fixed;
    z-index: var(--z-bar);
    left: 0;
    right: 0;
    justify-content: space-around;
    gap: 0;
    padding: 4px max(4px, var(--inset-left)) 4px max(4px, var(--inset-right));
    border-radius: 0;
    border-width: 1px 0 0;
  }

  .docked button {
    flex: 1;
    min-width: 0;
    height: 44px;
    font-size: var(--text-base);
  }

  /* The one mark on the bar that is a glyph rather than a letter, at the size of the
     letters beside it: a stroke drawn on Lucide's 24 unit grid reads as the cap
     height of the words around it at about one and a fifth of their size, and it is
     said in `em` so the callout's 12.5px row and the docked strip's 17px one both
     come out as one bar.

     Block, and that is the load-bearing word: an `svg` is inline by default and
     would sit on the baseline of the button's own line box, which is a pixel lower
     than the box it was given - the same thing Icon.svelte says about a mark in a
     badge. Out of the line box it is centred both ways by the button. */
  button :global(svg) {
    --mark: 1.2em;

    display: block;
    margin: 0 auto;
  }

  /* A quotation mark is cut where quotes belong in running text, which is up against
     the top of its own em box: on a row of letters read across the middle it was the
     one mark sitting high in its cell. Dropped onto that middle by a fifth of its
     size - a transform, so nothing about the row is laid out again, and nothing on
     the bar moves but the ink. */
  .low {
    display: inline-block;
    transform: translateY(0.2em);
  }

  /* A colour, as the dot the whole app asks "which colour" with; the row of them
     on the canvas is the same shape at a larger size - see CanvasColours.svelte.
     The hairline is the page's own ink at a whisper rather than black at a
     whisper, so a pale dot on a pale bar still has an edge in both themes. */
  .swatch {
    display: grid;
    place-items: center;
  }

  .swatch::after {
    content: '';
    display: block;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
    transition: scale var(--dur-fast) var(--ease-spring);
  }

  .swatch:hover::after {
    scale: 1.14;
  }

  .swatch:active::after {
    scale: 1.04;
  }

  /* The colour in hand: the ring the rest of the app draws round a choice. */
  .swatch.on::after {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent),
      0 0 0 2px var(--surface-3),
      0 0 0 3px var(--accent);
  }

  /* No colour at all, drawn as the ring the others fill - which is how a card
     with no colour of its own is drawn on the canvas. */
  .swatch.bare::after {
    background: none;
    box-shadow: inset 0 0 0 2px var(--muted);
  }

  .swatch.bare.on::after {
    box-shadow:
      inset 0 0 0 2px var(--muted),
      0 0 0 2px var(--surface-3),
      0 0 0 3px var(--accent);
  }

  /* The bar tints a button on hover, which would swallow a dot's own colour. */
  .swatch:hover,
  .swatch:active {
    background: none;
  }

  :global([data-touch]) .swatch::after {
    width: 20px;
    height: 20px;
  }
</style>
