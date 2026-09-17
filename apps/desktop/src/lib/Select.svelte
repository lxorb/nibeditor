<script lang="ts">
  /** A dropdown that is ours all the way down. The native `<select>` closes
   *  the way it is told to but opens the way the operating system likes, with
   *  a highlight in whatever blue that is. This one opens a list in the
   *  theme's colours: under the trigger on a desktop, as a sheet from the
   *  bottom on a phone, where a list the size of a finger is what a picker
   *  looks like anyway. */
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from './backstack.svelte'
  import { chorded } from './keys'
  import { opensAt, type Walk, walk } from './list-keys'
  import { overlays } from './overlays'
  import { viewport } from './viewport.svelte'
  import { dur } from './motion'

  interface Option {
    value: string
    label: string
    /** A choice that takes something away rather than changing it: taking
     *  somebody out of a space. Last in the list, and in the one colour the app
     *  says that in. */
    danger?: boolean
    /** One thing worth knowing about this choice before it is made: the language
     *  list uses it to say that a catalogue was written in one pass and never read
     *  through. Drawn as a footnote mark against the name, with these words in its
     *  tooltip and said for anybody who cannot see one. A sentence, not a
     *  paragraph: a list of forty rows is not the place for prose. */
    note?: string
  }

  const {
    value,
    options,
    onchange,
    label,
    plain = false,
    disabled = false,
  }: {
    value: string
    options: Option[]
    onchange: (value: string) => void
    /** Names the control for a screen reader, and heads the sheet on a phone. */
    label?: string
    /** Borderless, with the value at the right: how a settings row shows one. */
    plain?: boolean
    /** Set while what the control would change is out of anybody's hands: a
     *  request about this very row is in the air. */
    disabled?: boolean
  } = $props()

  let open = $state(false)
  /** Where the keyboard is in the list, and what it has been spelling; see
   *  list-keys.ts. Its own state, and not the pointer's: a keystroke must not
   *  choose a row the pointer merely passed over. */
  let walking = $state<Walk>({ cursor: null, typed: '', typedAt: 0 })
  /** The row the pointer is over, which is a highlight and nothing more. */
  let hovered = $state<number | null>(null)
  /** The list opens upward when there is no room beneath the trigger. */
  let above = $state(false)
  let host = $state<HTMLElement>()
  let list = $state<HTMLElement>()

  const current = $derived(options.find((one) => one.value === value))
  const id = `select-${Math.random().toString(36).slice(2, 8)}`

  /** Which row the highlight is on: the pointer's while it is over the list, the
   *  keyboard's otherwise. Only one row is ever lit, and which of the two lit it
   *  is what decides what a keystroke chooses. */
  const lit = $derived(hovered ?? walking.cursor)

  /** Room the list needs beneath the trigger, before it is drawn. */
  const ROW = 32
  const MOST = 280

  function show() {
    walking = opensAt(options.findIndex((one) => one.value === value))
    hovered = null

    if (host && !viewport.touch) {
      // Measured against the nearest thing that scrolls, which is what would
      // clip a list poking out of its bottom. Scroll containers say so with
      // `data-scrolls`; without one, the window is the limit.
      const box = host.getBoundingClientRect()
      const scroller = host.closest('[data-scrolls]') ?? document.documentElement
      const limit = scroller.getBoundingClientRect().bottom
      const needed = Math.min(MOST, options.length * ROW + 8) + 6
      above = box.bottom + needed > limit && box.top - needed > 0
    }

    open = true
  }

  function close() {
    open = false
  }

  function choose(next: string) {
    close()
    if (next !== value) onchange(next)
  }

  function onKey(event: KeyboardEvent) {
    // Ctrl, Alt or Cmd and this key is a chord passing through on its way to the
    // window, not a dropdown's Space; a picker that took it would make that chord
    // dead for as long as the keyboard was on this control. Same rule as every
    // other list in the app: see `chorded` in keys.ts and `onKey` in roving.ts.
    if (chorded(event)) return

    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        show()
      }
      return
    }

    const step = walk(
      event.key,
      event.timeStamp,
      options.map((one) => one.label),
      walking,
    )

    if (step.took) event.preventDefault()
    walking = step.walk

    if (step.chose !== undefined) {
      const chosen = options[step.chose]
      if (chosen) choose(chosen.value)
      return
    }

    if (step.shut) {
      close()
      return
    }

    // The keyboard has moved, so the pointer's highlight steps aside: whatever
    // is lit from here on is the row a keystroke would choose.
    hovered = null
    if (walking.cursor !== null) {
      list?.children[walking.cursor]?.scrollIntoView({ block: 'nearest' })
    }
  }

  // Tapping anywhere else closes it, the way a menu closes.
  function outside(event: PointerEvent) {
    if (open && host && !host.contains(event.target as Node)) close()
  }

  // Back closes the sheet before it leaves the app.
  // A dropdown can be over another overlay - one inside the settings, say -
  // so Escape closes it and leaves what is underneath standing.
  $effect(() => (open ? overlays.show(close) : undefined))
  $effect(() => closeOnBack(open && viewport.touch, close))
</script>

<svelte:window onpointerdown={outside} />

<!-- One row's name, with the footnote mark a choice can carry after it. Written
     once and rendered in both lists - the dropdown and the phone's sheet - because
     they are one control in two shapes and a mark on only one of them would be two
     designs.

     The mark is against the name with nothing between them, so it reads as a
     footnote on that word. Its words are in the tooltip for a pointer and said for
     a screen reader; the mark itself is out of the reading, since saying
     "asterisk" would be neither. -->
{#snippet named(option: Option)}
  <span class="text"
    >{option.label}{#if option.note}<span class="mark" title={option.note} aria-hidden="true"
        >*</span
      >{/if}</span
  >
  {#if option.note}<span class="nib-said">{option.note}</span>{/if}
{/snippet}

<div class="select" class:plain class:open bind:this={host}>
  <!-- A select-only combobox, in ARIA's terms: a button that opens a listbox
       and keeps the focus while the arrow keys walk the list. -->
  <button
    type="button"
    class="trigger"
    {disabled}
    role="combobox"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={label}
    aria-controls={open ? id : undefined}
    aria-activedescendant={open && walking.cursor !== null ? `${id}-${walking.cursor}` : undefined}
    onclick={() => (open ? close() : show())}
    onkeydown={onKey}
  >
    <span class="text">{current?.label ?? ''}</span>
    <svg class="chevron" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" /></svg>
  </button>

  {#if open && viewport.touch}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="nib-scrim scrim" transition:fade={{ duration: dur(130) }} onclick={close}></div>

    <div class="sheet" transition:fly={{ y: 32, duration: dur(220), easing: cubicOut }}>
      {#if label}<p class="heading">{label}</p>{/if}

      <ul {id} role="listbox" aria-label={label}>
        {#each options as option, index (option.value)}
          <li
            id="{id}-{index}"
            role="option"
            aria-selected={option.value === value}
            class:chosen={option.value === value}
          >
            <button type="button" class:danger={option.danger} onclick={() => choose(option.value)}>
              {@render named(option)}
              {#if option.value === value}
                <svg class="tick" viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 5" /></svg>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {:else if open}
    <ul
      {id}
      class="nib-layer list"
      class:above
      role="listbox"
      aria-label={label}
      bind:this={list}
      onmouseleave={() => (hovered = null)}
      transition:fly={{ y: above ? 4 : -4, duration: dur(120), easing: cubicOut }}
    >
      {#each options as option, index (option.value)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="{id}-{index}"
          role="option"
          aria-selected={option.value === value}
          class:cursor={index === lit}
          class:chosen={option.value === value}
          class:danger={option.danger}
          onmouseenter={() => (hovered = index)}
          onclick={() => choose(option.value)}
        >
          {@render named(option)}
          {#if option.value === value}
            <svg class="tick" viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 5" /></svg>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .select {
    position: relative;
    display: block;
    width: 100%;
  }

  /* The closed control reads like every other input in the app. */
  .trigger {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    /* Said rather than left to the padding, which is what makes it a thumb's
       target: 28 under a pointer, 56 under a finger, and the words and their room
       take it past 28 anyway. It was 36px tall on every screen, so the one kind
       of control the settings are mostly made of was the one thing on a phone
       under the touch floor. */
    min-height: var(--row-height);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.4;
    text-align: start;
    cursor: default;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .trigger:hover {
    border-color: var(--muted);
  }

  /* Open, which is a state and not a focus: the list is hanging off it, and it
     says so the way the native control does. Where the keyboard is, is the one
     ring in the themes package - this used to draw a copy of the field's answer
     on `:focus-visible` as well, which is two answers to one question. */
  .open .trigger {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .trigger:disabled {
    opacity: 0.55;
  }

  /* A choice may be a name rather than a word of the app's own - a folder, a
     font, a language written in its own script - so each one is placed as a
     whole. See .nib-row-label in base.css. */
  .trigger .text,
  .list li .text,
  .sheet li button .text {
    unicode-bidi: isolate;
  }

  .trigger .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The footnote mark on a row that has something to say about itself. Quiet and
     small, raised the way a footnote is: it says there is something to know, and
     the something is in the tooltip, in the words a screen reader is given, and in
     the caption under the list. The same mark in the dropdown and in the sheet. */
  .mark {
    margin-inline-start: 1px;
    color: var(--muted);
    font-size: 0.78em;
    line-height: 1;
    vertical-align: super;
  }

  /* A mark inside a control rather than in front of a name, which is `--icon-sm`
     - the size the find bar's own chevron is drawn at. It was 10px, a third
     size for one shape. */
  .chevron {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .open .chevron {
    transform: rotate(180deg);
  }

  /* In a settings row: no box of its own, the value at the right edge, like
     the value of anything else in the list. */
  .plain .trigger {
    justify-content: flex-end;
    padding: 6px 0 6px 6px;
    border: none;
    background: none;
    color: var(--muted-strong);
  }

  .plain .trigger .text {
    flex: none;
    max-width: 100%;
  }

  .plain.open .trigger {
    box-shadow: none;
    color: var(--text-strong);
  }

  .plain .trigger:focus-visible {
    color: var(--text-strong);
  }

  /* ── The list, on a desktop ────────────────────────────────────── */

  /* A floating list of choices, so its shape is `.nib-layer` in the themes
     package. It used to light its own surface a step brighter than the menus do
     and spend a smaller shadow than they do, which made a dropdown and the menu
     beside it two kinds of thing. What is left here is where it hangs. */
  .list {
    position: absolute;
    top: calc(100% + var(--space-1));
    inset-inline-end: 0;
    min-width: 100%;
    max-height: 280px;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    overflow-y: auto;
    z-index: 5;
  }

  .list.above {
    top: auto;
    bottom: calc(100% + var(--space-1));
  }

  .list li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 30px;
    padding: 5px 9px;
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    white-space: nowrap;
    cursor: default;
  }

  .list li .text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The row under the pointer or the arrow keys, in the theme's own accent
     and not the platform's. */
  .list li.cursor {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  .list li.chosen {
    color: var(--text-strong);
  }

  /* A choice that takes something away. The colour is the whole of the warning:
     it is still a row in the list, and it is still one press. */
  .list li.danger,
  .sheet li button.danger {
    color: var(--danger);
  }

  .list li.danger.cursor {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  .tick {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* ── The sheet, on a phone ─────────────────────────────────────── */

  /* The layer behind it; see .nib-scrim in packages/themes. */
  .scrim {
    --scrim-z: 60;
    --scrim-ink: 55%;
    --scrim-blur: 2px;
  }

  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 61;
    max-height: 70dvh;
    display: flex;
    flex-direction: column;
    padding-bottom: var(--touch-bottom);
    background: var(--surface);
    border-top: 1px solid var(--line-strong);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: var(--shadow-lg);
  }

  .heading {
    flex: none;
    margin: 0;
    padding: 14px 20px 8px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted);
  }

  .sheet ul {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 4px 8px 8px;
    list-style: none;
    overflow-y: auto;
  }

  .sheet li button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--touch-text);
    text-align: start;
    cursor: default;
  }

  .sheet li button:active {
    background: var(--surface-2);
  }

  .sheet li.chosen button {
    color: var(--text-strong);
  }

  .sheet li button .text {
    flex: 1;
    min-width: 0;
  }

  .sheet .tick {
    width: 18px;
    height: 18px;
  }

  /* A control inside a row, so the floor rather than the row size, and past
     16px, which is where iOS stops zooming into a control on focus. */
  :global([data-touch]) .trigger {
    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }

  /* The borderless one too. It said `min-height: 0`, which is what a control
     says to stop itself making the row taller - but the row it sits in is
     already `--touch-row`, so all the zero did was leave the one thing that
     opens the list 36px tall inside a 56px row. The floor fits inside the row
     with ten pixels to spare, and a settings pane is mostly these. */
  :global([data-touch]) .plain .trigger {
    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }
</style>
