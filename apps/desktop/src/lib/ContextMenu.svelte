<script lang="ts">
  import { fade, fly, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { type Spelling, spelled } from './list-keys'
  import { DIVIDER, menu, trim, type MenuEntry, type MenuItem } from './menu.svelte'
  import { overlays } from './overlays'
  import { trap } from './trap'
  import { viewport } from './viewport.svelte'
  import { walked } from './walk'
  import { dur } from './motion'

  let element = $state<HTMLDivElement>()
  let position = $state({ x: 0, y: 0 })
  /** Whether a phone's callout sits above the finger rather than below it,
     which is the side it grows from. */
  let above = $state(false)

  /** A phone gets a sheet from the bottom, where the thumb is, unless the
   *  menu asked to stay by the finger: then it is a callout, the way a phone
   *  puts Cut and Copy beside a selection rather than over it. */
  const sheet = $derived(viewport.touch && !menu.near)
  const callout = $derived(viewport.touch && menu.near)

  /** On a phone the destructive entries come last, in a group of their own,
   *  so a thumb finds Delete at the end and nowhere else. A desktop keeps the
   *  order it was given. */
  const entries = $derived.by((): MenuEntry[] => {
    if (!viewport.touch) return menu.items

    const danger = menu.items.filter((item) => item?.danger)
    const rest = menu.items.filter((item) => !item?.danger)
    return trim([...rest, DIVIDER, ...danger])
  })

  /** The safe-area insets, which CSS can see and JavaScript cannot: the tokens hold
   *  them as `--inset-*` on the document, from `env()` or from what an Android
   *  activity handed over, and a custom property inherits - so any element on the
   *  page can be asked and this one asks the menu it is placing.
   *
   *  Which is why the rule below says nothing about them. It used to restate all four
   *  on `.menu` "for the script": `--inset-top: var(--inset-top)` is a property
   *  defined in terms of itself, and a cycle makes a custom property invalid at
   *  computed-value time rather than resolving to what it inherited. Measured in
   *  Chromium: with the copy there, `--inset-top` reads as the empty string, all four
   *  of these are 0, and `.sheet .rows`' own padding - `max(var(--space-2),
   *  var(--inset-left))` - is not the 8px it names but 0, because a declaration built
   *  on an invalid property is invalid too and padding falls to its initial value.
   *  Without it: 24 and 16 for a notch that deep, and 16px of padding. So a phone's
   *  menu was placed clear of the notch by nought and its sheet had no side padding at
   *  all, on the one kind of screen that has either. */
  function insets(node: HTMLElement) {
    const style = getComputedStyle(node)
    const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0
    return {
      top: px('--inset-top'),
      right: px('--inset-right'),
      bottom: px('--inset-bottom'),
      left: px('--inset-left'),
    }
  }

  // Escape closes it, like everything else the app puts over a note; see
  // overlays.ts.
  $effect(() => (menu.open ? overlays.show(() => menu.hide()) : undefined))

  // A desktop menu opens at the pointer and is flipped back inside the
  // window when it would run off an edge. A phone's callout goes above the
  // finger, so what is under the finger stays in view, and below it only when
  // there is no room above; either way it is kept inside the visual viewport
  // - the part of the screen the keyboard has not covered - and clear of the
  // notch. The sheet needs no placing: it is the bottom of the screen.
  $effect(() => {
    if (!menu.open || !element || sheet) return

    const { width, height } = element.getBoundingClientRect()

    if (!callout) {
      above = false
      position = {
        x: Math.min(menu.x, window.innerWidth - width - 8),
        y: Math.min(menu.y, window.innerHeight - height - 8),
      }
      return
    }

    // The layout size, not the drawn one: the menu is still growing out of
    // its corner when this runs, and a box measured mid-transition is 4%
    // short, which is enough to leave the callout past the edge.
    const { offsetWidth: full, offsetHeight: tall } = element
    const seen = window.visualViewport
    const inset = insets(element)
    const left = (seen?.offsetLeft ?? 0) + inset.left + 8
    const right = (seen ? seen.offsetLeft + seen.width : window.innerWidth) - inset.right - 8
    const top = (seen?.offsetTop ?? 0) + inset.top + 8
    const bottom = (seen ? seen.offsetTop + seen.height : window.innerHeight) - inset.bottom - 8

    // Room for the finger itself, so the first row is not under it.
    const clear = 16
    above = menu.y - clear - tall >= top
    position = {
      x: Math.max(left, Math.min(menu.x - full / 2, right - full)),
      y: above ? menu.y - clear - tall : Math.min(menu.y + clear, bottom - tall),
    }
  })

  // The keyboard coming or going, or the page shifting under a pinch, moves
  // the ground a phone's menu was placed on; it goes rather than floats.
  $effect(() => {
    const seen = window.visualViewport
    if (!menu.open || !viewport.touch || !seen) return

    const hide = () => menu.hide()
    seen.addEventListener('resize', hide)
    seen.addEventListener('scroll', hide)

    return () => {
      seen.removeEventListener('resize', hide)
      seen.removeEventListener('scroll', hide)
    }
  })

  /** Rises from the bottom as a sheet; grows out of its corner as a popover,
   *  which is the same motion on a desktop and in a callout. */
  function arrive(node: Element) {
    if (sheet) return fly(node, { y: 40, duration: dur(220), easing: cubicOut })
    return scale(node, { duration: dur(120), start: 0.96, easing: cubicOut })
  }

  function choose(item: MenuItem) {
    // A row that says so stays: the zoom rows on a web tab are pressed two or three
    // times in a row, and a menu that closed under each of them would be a menu
    // somebody opens four times. See menu-item.ts.
    if (!item.keep) menu.hide()
    item.run()
  }

  /** What has been spelled, and when. A menu that opens is a fresh word: the letters
   *  belong to the list in front of somebody, not to the one before it. */
  let spelling: Spelling = { typed: '', typedAt: 0 }

  $effect(() => {
    if (menu.open) spelling = { typed: '', typedAt: 0 }
  })

  /** The rows a key can land on: the dividers are not rows and a greyed one is
   *  not a choice. Read off the page rather than counted in state, because what a
   *  press has to move is a real element - the row it lands on has to take the
   *  keyboard, so the ring is on it and a screen reader says it. */
  const rows = () => [...(element?.querySelectorAll<HTMLElement>('.nib-row:not(:disabled)') ?? [])]

  /** Walking the menu. The same walk every list in the app takes, wrapping, which
   *  is how a hand reaches the last row of a long one; see walk.ts.
   *
   *  Escape is not here. It closes the menu, and what closes the layer on top is
   *  overlays.ts, one place, for every layer there is. */
  function onKey(event: KeyboardEvent) {
    const list = rows()
    if (!list.length) return

    const at = list.findIndex((row) => row === document.activeElement)
    const moved = walked(event.key, at < 0 ? null : at, list.length, true)
    const landed = moved === null ? undefined : list[moved]

    if (landed) {
      event.preventDefault()
      landed.focus()
      return
    }

    // Taken either way, so a space meant for a row never scrolls what is behind
    // the menu.
    if (event.key === ' ' && at >= 0) {
      event.preventDefault()
      list[at]?.click()
      return
    }

    // A letter is the row whose name begins with it, and letters in a row spell more of
    // the name: the same rule the file list and every dropdown in the app follow, out
    // of the same module. A letter no row starts with leaves the keyboard where it was
    // rather than moving it somewhere arbitrary. See list-keys.ts.
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const names = list.map((row) => row.textContent)
      const { typed, typedAt, found } = spelled(spelling, event.key, event.timeStamp, names)
      spelling = { typed, typedAt }

      if (found >= 0) {
        event.preventDefault()
        list[found]?.focus()
      }
    }
  }
</script>

<svelte:window
  onclick={() => menu.hide()}
  onblur={() => menu.hide()}
  onresize={() => menu.hide()}
/>

{#if menu.open}
  {#if viewport.touch}
    <!-- Takes the tap that closes the menu, and the scroll that would
         otherwise reach the list under it. Dimmed under a sheet, which is a
         layer over the app; clear under a callout, which sits beside a
         selection that has to stay readable. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="nib-scrim scrim"
      class:is-clear={!sheet}
      transition:fade={{ duration: dur(130) }}
      onclick={() => menu.hide()}
    ></div>
  {/if}

  <div
    bind:this={element}
    class="nib-layer nib-host menu"
    class:touch={viewport.touch}
    class:sheet
    class:above
    style:left={sheet ? undefined : `${position.x}px`}
    style:top={sheet ? undefined : `${position.y}px`}
    style:--keyboard={sheet ? `${viewport.keyboard}px` : undefined}
    transition:arrive
    use:trap
    onkeydown={onKey}
    role="menu"
    tabindex="-1"
    aria-label={menu.title ?? t('Menu')}
  >
    {#if sheet}
      <div class="grip" aria-hidden="true"></div>
      <!-- A sheet does not point at anything the way a popover does, so it
           says what it is about. -->
      {#if menu.title}<p class="title">{menu.title}</p>{/if}
    {/if}

    <div class="rows">
      {#each entries as item, index (index)}
        {#if item === null}
          <hr />
        {:else}
          <!-- The row the keyboard lands on, where the menu names one: `data-lands` is
               what the trap looks for, the same attribute the Share sheet marks its
               address field with. See trap.ts and menu-item.ts. -->
          <button
            class="nib-row"
            role="menuitem"
            class:danger={item.danger}
            disabled={item.disabled}
            data-lands={item.stands ? '' : undefined}
            onclick={() => choose(item)}
          >
            <span class="nib-row-label">{item.label}</span>
            <!-- A row that is a switch says which way it is set. After the label
                 rather than in front of it: the app menu keeps a slot for a tick in
                 every row so its labels line up, and a row's own menu keeps none -
                 so the mark goes where a shortcut would, which a switch never has.
                 The same glyph the app menu ticks with. -->
            {#if item.checked}<span class="tick">✓</span>{/if}
            <!-- A shortcut means nothing to a thumb. -->
            {#if item.hint && !viewport.touch}<kbd>{item.hint}</kbd>{/if}
          </button>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  /* The shape is `.nib-layer` in the themes package: the corner, the hairline,
     the surface and the shadow every layer that floats over the app shares. What
     is left here is where this one is put. */
  .menu {
    position: fixed;
    z-index: 60;
    min-width: 11rem;
    padding: var(--space-1);
    transform-origin: top left;
  }

  /* The rows are `.nib-row`, the same row every list in the app is made of; a
     line of a menu is read at the same size and lit the same way as a file in
     the tree it was asked for from. What is left here is what a menu row has
     that a list row does not. */
  button {
    color: var(--text);
    white-space: nowrap;
  }

  button.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: var(--danger);
  }

  button:disabled {
    color: var(--muted);
  }

  kbd {
    flex: none;
    margin-inline-start: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  /* A switch that is on. Quiet and in the accent, because it is the state of the
     row rather than a second thing to read. */
  .tick {
    flex: none;
    margin-inline-start: var(--space-3);
    font-size: var(--text-sm);
    color: var(--accent);
  }

  hr {
    margin: var(--space-1);
    border: none;
    border-top: 1px solid var(--line);
  }

  /* ── On a phone ────────────────────────────────────────────────── */

  /* The layer behind it; see .nib-scrim in packages/themes. Clear under a
     callout, which sits beside a selection that has to stay readable, and dimmed
     under a sheet, which is a layer over the app. */
  .scrim {
    --scrim-z: 60;
    --scrim-ink: 55%;
    --scrim-blur: 2px;
    /* A finger on it neither scrolls nor pinches what is underneath. */
    touch-action: none;
  }

  .touch {
    z-index: 61;
  }

  /* The row scale gives a thumb the whole line; what a sheet adds is the danger
     in its colour all the time, since there is no hover to bring it out. */
  .touch button.danger:not(:disabled) {
    color: var(--danger);
  }

  .touch button.danger:active:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
  }

  .touch hr {
    margin: var(--space-1) var(--space-3);
  }

  /* The callout: still a popover, grown from the side the finger is on. */
  .touch:not(.sheet) {
    min-width: 12rem;
    max-width: calc(100vw - 16px);
    transform-origin: top center;
  }

  .touch.above {
    transform-origin: bottom center;
  }

  /* The sheet: the full width, anchored to the bottom - or to the top of
     the keyboard, on a phone that keeps its layout under one - and never
     the whole screen, so what it is about stays in view above it. */
  .sheet {
    top: auto;
    left: 0;
    right: 0;
    bottom: var(--keyboard, 0px);
    min-width: 0;
    display: flex;
    flex-direction: column;
    max-height: min(72dvh, calc(100dvh - var(--keyboard, 0px) - var(--space-5)));
    padding: 0 0 var(--touch-bottom);
    border: none;
    border-top: 1px solid var(--line-strong);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }

  .grip {
    flex: none;
    width: 36px;
    height: 4px;
    margin: 8px auto 2px;
    border-radius: 2px;
    background: var(--line-strong);
  }

  /* What the sheet is about. Only ever drawn in the sheet, which is only ever a
     touch screen, and it is a sheet's head like any other: `--text-head`, which
     is a step above the rows under it on either kind of screen, and the ink a
     name is written in. It used to be `--text-base` in `--muted`, which made the
     one thing saying which file all of this was about the quietest and smallest
     line on the sheet - while every other sheet in the app heads itself in
     `--text-strong`. */
  .title {
    flex: none;
    margin: 0;
    padding: var(--space-2) var(--row-pad) var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The rows scroll inside the sheet when there are more than fit, and the
     scroll stops at their end rather than reaching the page. */
  .sheet .rows {
    flex: 1;
    min-height: 0;
    padding: var(--space-1) max(var(--space-2), var(--inset-right)) var(--space-2)
      max(var(--space-2), var(--inset-left));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
