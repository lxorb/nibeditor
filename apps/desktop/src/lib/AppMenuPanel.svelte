<script lang="ts">
  /** The app menu itself: the popover under the three bars, or the sheet from the
   *  bottom on a phone, with its groups, its rows, its one level of submenus and the
   *  keys that walk them. Apart from the button in AppMenu.svelte because the button
   *  is on screen from the first frame and this is not: it is fetched at the launch's
   *  last turn with the rows it shows, rather than carried in front of the first
   *  paint. */
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { DIVIDER, isSubmenu, type MenuGroup, type MenuRow, walkableRows } from './menu-item'
  import { closeOnBack } from './backstack.svelte'
  import { steppedKey } from './direction'
  import { overlays } from './overlays'
  import { pullsAway } from './sheet-pull'
  import { trap } from './trap'
  import { t } from './i18n.svelte'
  import { viewport } from './viewport.svelte'
  import { walked } from './walk'
  import { dur } from './motion'

  /* eslint-disable prefer-const -- `open` is bindable, and a $props() pattern cannot be split */
  let {
    open = $bindable(false),
    groups,
  }: {
    open?: boolean
    /** Built afresh for every open, so a new list is a new open: what is ticked and
     *  what is greyed out describes now. */
    groups: MenuGroup[]
  } = $props()
  /* eslint-enable prefer-const */

  let current = $state('file')
  /** The submenu that is open, by its label. One at a time, and only ever one
   *  level deep: a menu that goes deeper than that is a menu nobody can hold in
   *  their head. */
  let into = $state<string | null>(null)

  /** Which row a key would act on, as a place in `walkable`. Null until a key is
   *  pressed, so a menu opened with the mouse shows nothing lit under a hand
   *  that is already pointing at what it wants. */
  let at = $state<number | null>(null)
  let surface = $state<HTMLElement>()

  /** The way back out of a submenu, which is a row a key can land on like any
   *  other but is not one of the group's own. */
  const BACK = -1

  function choose(id: string) {
    current = id
    into = null
    at = null
  }

  const shown = $derived(groups.find((one) => one.id === current))

  /** Whichever list is in front: the group's own rows, or the rows of the
   *  submenu somebody stepped into. */
  const rows = $derived.by((): MenuRow[] => {
    const all = shown?.rows ?? []
    if (into === null) return all

    const found = all.find((row) => isSubmenu(row) && row.label === into)
    return found && isSubmenu(found) ? found.rows : all
  })

  /** Where a key may stand, in the order the rows are drawn. Inside a submenu
   *  the way back out is the first of them. */
  const walkable = $derived(into === null ? walkableRows(rows) : [BACK, ...walkableRows(rows)])

  /** The row the cursor is on, as a place in `rows`. */
  const cursor = $derived(at === null ? null : (walkable[at] ?? null))

  /** The menu takes the keyboard when it opens, so the first press is the
   *  menu's and not the note's underneath it. */
  $effect(() => {
    if (open) surface?.focus()
  })

  /** Into a submenu. A key that stepped in stands on its first row, the way a
   *  hand that arrives from a keyboard expects to; a pointer that clicked in is
   *  already aiming at what it wants and lights nothing. */
  function enter(label: string, standing = false) {
    into = label
    at = standing ? Math.min(1, walkable.length - 1) : null
  }

  /** Back out to the group's own rows, standing on the row that led in: coming
   *  out of a submenu should leave the hand where it went in. */
  function leave() {
    const label = into
    into = null

    const led = rows.findIndex((row) => row !== DIVIDER && isSubmenu(row) && row.label === label)
    const found = walkable.indexOf(led)
    at = found < 0 ? null : found
  }

  /** The group beside this one, which is what left and right mean where the row
   *  under the cursor leads nowhere. */
  function sideways(direction: number) {
    const index = groups.findIndex((one) => one.id === current)
    const next = groups[(index + direction + groups.length) % groups.length]
    if (next) choose(next.id)
  }

  /** The row under the cursor, pressed. A submenu steps in, the way back steps
   *  out, and anything else runs and closes the menu, exactly as a click does. */
  function activate() {
    if (cursor === null) return
    if (cursor === BACK) {
      leave()
      return
    }

    const row = rows[cursor]
    if (row === undefined || row === DIVIDER) return
    if (isSubmenu(row)) {
      enter(row.label, true)
      return
    }

    open = false
    row.run()
  }

  function onKey(event: KeyboardEvent) {
    // A long menu wraps: that is how a hand reaches the last row of one.
    const moved = walked(event.key, at, walkable.length, true)
    if (moved !== null) {
      event.preventDefault()
      at = moved
      return
    }

    const row = cursor === null || cursor === BACK ? null : rows[cursor]

    // In reading terms: a submenu opens towards the end of the line, so under an
    // interface that reads right to left it is the left arrow that goes into one
    // and the right arrow that comes back out. See `steppedKey` in direction.ts.
    switch (steppedKey(event.key)) {
      case 'Enter':
      case ' ':
        event.preventDefault()
        activate()
        return
      case 'ArrowRight':
        event.preventDefault()
        if (row && isSubmenu(row)) enter(row.label, true)
        else sideways(1)
        return
      case 'ArrowLeft':
        event.preventDefault()
        if (into !== null) leave()
        else sideways(-1)
        return
      case 'Escape':
        // A submenu is what is open while one is, so the press closes that and
        // the next one closes the menu; see overlays.ts, which the press would
        // otherwise reach on the window.
        if (into === null) return
        event.preventDefault()
        event.stopPropagation()
        leave()
        return
      default:
        return
    }
  }

  /** A popover that grows out of the button on a desktop; a sheet from the
   *  bottom on a phone, where the thumb is. */
  function arrive(node: Element) {
    if (viewport.touch) return fly(node, { y: 40, duration: dur(220), easing: cubicOut })

    return {
      duration: dur(220),
      easing: cubicOut,
      // Out of the corner it hangs from, which is the corner the words start in:
      // `--dir` turns the sideways half of the movement round, and the origin is
      // stated as a logical corner for the same reason.
      css: (t: number) =>
        `opacity: ${t}; transform: translate(calc(var(--dir) * ${(t - 1) * 6}px), ${(t - 1) * 6}px) scale(${0.96 + 0.04 * t}); transform-origin: top var(--dir-start)`,
    }
  }

  // Escape closes it, like everything else the app puts over a note; see
  // overlays.ts.
  $effect(() => (open ? overlays.show(() => (open = false)) : undefined))
  $effect(() => closeOnBack(open, () => (open = false)))

  // Every open starts on the first group with nothing lit: a new list of groups is a
  // new open, and it lands before `open` does.
  $effect.pre(() => {
    current = groups[0]?.id ?? 'file'
    into = null
    at = null
  })
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim is-clear"
    transition:fade={{ duration: dur(130) }}
    onclick={() => (open = false)}
  ></div>

  <!-- The keyboard lands on the menu itself and the cursor is a row it names,
       rather than the focus walking from button to button: a menu is one thing
       being read down, and Tab through nineteen rows is not reading it. -->
  <div
    bind:this={surface}
    class="nib-layer nib-host menu"
    class:phone={viewport.touch}
    transition:arrive
    use:trap
    use:pullsAway={viewport.touch ? () => (open = false) : null}
    role="menu"
    tabindex="-1"
    aria-label={t('Menu')}
    aria-activedescendant={cursor === null ? undefined : `nib-menu-${cursor}`}
    onkeydown={onKey}
  >
    {#if viewport.touch}
      <div class="grip" aria-hidden="true"></div>
    {/if}

    <!-- The groups on the left, whatever is chosen on the right, the way a
         menu bar reads once it has nowhere along the top to live. On a phone
         the groups are a row of chips instead, above the rows. -->
    <ul class="groups">
      {#each groups as group (group.id)}
        <li>
          <button
            class="nib-row"
            class:is-on={group.id === current}
            onmouseenter={() => choose(group.id)}
            onclick={() => choose(group.id)}
          >
            {group.label}
          </button>
        </li>
      {/each}
    </ul>

    <ul class="rows">
      <!-- Inside a submenu the list is its rows, headed by the way back. The
           same shape on a desktop and under a thumb: one list, one step in, one
           step out, and nothing that has to be aimed at. -->
      {#if into !== null}
        <li>
          <button
            id="nib-menu-{BACK}"
            class="nib-row row back"
            class:selected={cursor === BACK}
            role="menuitem"
            onmouseenter={() => (at = walkable.indexOf(BACK))}
            onclick={leave}
          >
            <span class="tick" aria-hidden="true">
              <svg class="nib-mirror" viewBox="0 0 12 12"><path d="M7.5 2.5 4 6l3.5 3.5" /></svg>
            </span>
            <span class="nib-row-label">{into}</span>
          </button>
        </li>
        <li class="split"></li>
      {/if}

      {#each rows as row, index (index)}
        <!-- Named apart so each branch has the shape it draws: the markup cannot
             read a type guard's other half. -->
        {@const leads = row !== DIVIDER && isSubmenu(row) ? row : null}
        {@const action = row !== DIVIDER && !isSubmenu(row) ? row : null}

        {#if leads}
          <li>
            <button
              id="nib-menu-{index}"
              class="nib-row row"
              class:selected={cursor === index}
              role="menuitem"
              disabled={leads.disabled}
              onmouseenter={() => (at = walkable.indexOf(index))}
              onclick={() => enter(leads.label)}
            >
              <span class="tick"></span>
              <span class="nib-row-label">{leads.label}</span>
              <span class="more" aria-hidden="true">
                <svg class="nib-mirror" viewBox="0 0 12 12"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
              </span>
            </button>
          </li>
        {:else if action}
          <li>
            <button
              id="nib-menu-{index}"
              class="nib-row row"
              class:selected={cursor === index}
              role="menuitem"
              disabled={action.disabled}
              onmouseenter={() => (at = walkable.indexOf(index))}
              onclick={() => {
                open = false
                action.run()
              }}
            >
              <!-- Present only when it means something; the width is held by
                   CSS so the labels still line up. -->
              <span class="tick">{action.checked ? '✓' : ''}</span>
              <span class="nib-row-label">{action.label}</span>
              {#if action.hint}<span class="nib-row-meta hint">{action.hint}</span>{/if}
            </button>
          </li>
        {:else}
          <li class="split"></li>
        {/if}
      {/each}
    </ul>
  </div>
{/if}

<style>
  /* The layer behind it; see .nib-scrim in packages/themes. Clear here, where
     the menu is a popover beside a button. */
  .scrim {
    --scrim-z: var(--z-menu);
    --scrim-ink: 55%;
    --scrim-blur: 2px;
  }

  /* Under the bars it opens from, which are at the left end of the title bar -
     so it hangs off the button rather than off the panel beside it, and it is
     in the same place whether the file list is open or shut.

     The shape is `.nib-layer` in the themes package. This one used to light its
     surface a step brighter than the context menu does, so the app's two menus
     were two colours. */
  .menu {
    position: fixed;
    top: calc(var(--titlebar-height) + var(--space-1));
    inset-inline-start: var(--space-2);
    z-index: var(--z-menu);
    /* Rows to press, as the right-click menu's are; see ContextMenu.svelte. */
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    display: flex;
    max-height: 78vh;
    overflow: hidden;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    overflow-y: auto;
  }

  .groups {
    flex: none;
    width: 8.5rem;
    border-inline-end: 1px solid var(--line);
  }

  .rows {
    min-width: 15rem;
  }

  /* The rows are `.nib-row`, the same row every list in the app is made of.
     What is left here is what a menu row has that a list row does not: a row of
     words in a menu is read rather than scanned, so it is darker than a row in a
     list.

     Every button but the mark. Written as `button`, this landed on the trigger as
     well - a scoped rule is a class and an element, which out-specifies the shared
     `.nib-glyph` - and the three bars came out a shade darker than the sidebar
     button beside them in the same row. Two glyphs in one bar are one ink. */
  button:not(.nib-glyph) {
    color: var(--text);
  }

  /* The row a key is standing on wears exactly what a row under the pointer
     wears: one menu, one place in it, whichever hand is doing the moving. */
  .row.selected {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  button:not(.nib-glyph):disabled {
    color: var(--muted);
  }

  /* The width is held whether or not there is a tick in it, so the labels line up
     down the list.

     A whole em, not 0.9 of one: U+2713 is drawn by whatever font has it, and on a
     page whose lang is Japanese that is a CJK face, where every glyph is full width.
     Nine tenths of an em cut two pixels off the tick's right arm. The same fix the
     palette's rows carry, for the same glyph in the same slot; see Palette.svelte
     and scripts/locale-e2e.py, which is what reported it. */
  .tick {
    width: 1em;
    flex: none;
    color: var(--accent);
  }

  /* The chevron that says a row leads somewhere, and the one on the way back.
     Muted: it is a shape, not something to read. */
  .more,
  .back .tick {
    flex: none;
    display: grid;
    place-items: center;
    color: var(--muted);
  }

  .more svg,
  .back .tick svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .back .nib-row-label {
    color: var(--muted-strong);
  }

  .hint {
    font-family: var(--font-mono);
  }

  .split {
    height: 1px;
    margin: var(--space-2) 6px;
    background: var(--line);
  }

  /* ── On a phone ────────────────────────────────────────────────── */

  /* And dimmed here, where the sheet is a layer over the app rather than a
     popover beside a button. Beats `.nib-scrim.is-clear`, which is what the
     desktop's is. */
  :global([data-touch]) .scrim.is-clear {
    background: color-mix(in srgb, var(--bg) var(--scrim-ink), transparent);
    backdrop-filter: blur(var(--scrim-blur));
  }

  /* Anchored to the bottom, the full width, and tall enough for the longest
     group without ever covering the whole screen. */
  :global([data-touch]) .menu.phone {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    flex-direction: column;
    max-height: 72dvh;
    padding-bottom: var(--touch-bottom);
    border: none;
    border-top: 1px solid var(--line-strong);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface);
  }

  :global([data-touch]) .grip {
    flex: none;
    width: 36px;
    height: 4px;
    margin: 8px auto 2px;
    border-radius: 2px;
    background: var(--line-strong);
  }

  /* The groups as chips that wrap, so all of them are in view at once
     rather than some of them off the edge of a strip. */
  :global([data-touch]) .phone .groups {
    flex: none;
    width: auto;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-4) var(--space-3);
    border-inline-end: none;
    border-bottom: 1px solid var(--line);
    overflow: visible;
  }

  :global([data-touch]) .phone .groups button {
    width: auto;
    min-height: var(--touch-target);
    padding: 0 var(--touch-pad);
    border-radius: 99px;
    background: var(--surface-2);
    color: var(--muted-strong);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
  }

  /* The chosen chip is the filled row every "this one" in the app is: the
     surface says which, and the words go dark. They used to go to the accent on
     an accent-tinted fill, which is 3.77 to one - the accent carries three to one
     against a surface, not four and a half against a wash of itself. */
  :global([data-touch]) .phone .groups button.is-on {
    background: var(--surface-selected);
    color: var(--active-file-text-color);
  }

  :global([data-touch]) .phone .rows {
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 6px var(--space-2) var(--space-2);
    overflow-y: auto;
  }

  /* The tick at the trailing edge, where a phone puts what is on, and no
     room held for it where there is none. */
  :global([data-touch]) .phone .tick {
    order: 2;
    width: auto;
    margin-inline-start: auto;
  }

  /* The way back keeps its chevron in front of the words, where a back button
     belongs whatever the machine. The width is the one above, put back after the
     rule before this took it away: one slot, one measure, wherever a row is drawn. */
  :global([data-touch]) .phone .back .tick {
    order: 0;
    width: 1em;
    margin-inline-start: 0;
  }

  :global([data-touch]) .phone .hint {
    display: none;
  }

  :global([data-touch]) .phone .split {
    margin: var(--space-1) var(--space-3);
  }
</style>
