<script lang="ts" module>
  /** How every list in the Links panel walks: the arrows move, Enter goes to the
   *  line and hands the note the keyboard, Space goes to it and leaves the keyboard
   *  here. Stated once and imported by the panel for its third list, whose rows are
   *  the same rows with one more thing true of them. See roving.ts. */
  export const HIT_WALK = {
    rows: '.hit',
    open: (row: HTMLElement) => row.click(),
    peek: (row: HTMLElement) => {
      row.click()
      row.focus()
    },
  }
</script>

<script lang="ts">
  /** A list of lines from other notes, of which only the ones in view are in the
   *  page.
   *
   *  The same window the file list has had since a space of three thousand notes
   *  was three thousand buttons, over the same arithmetic (row-window.ts) and the
   *  same three measurements (row-window.svelte.ts). It is here because the Links
   *  panel had none: a note a thousand others point at was a thousand buttons and
   *  three thousand spans built and laid out for the eighteen a panel can show -
   *  two hundred and fifteen milliseconds after a button press, of which the index
   *  itself was two.
   *
   *  Two differences from the file list, and only two. A row here is two lines -
   *  the note's name over the line the link is written on - so its height is
   *  measured off a row rather than read off `--row-height`, which describes the
   *  one-line kind. And there are two of these lists in one scroller, one under the
   *  other, so each holds its own three numbers; `ListView` reads a list's top
   *  against its scroller's rather than off a scroll offset, which is what makes
   *  that work without either list knowing the other is there.
   *
   *  The keyboard walks the whole list and not the window: `reach` puts a row in
   *  the page and says when it is there, which is the protocol roving.ts already
   *  had for the file list. So an arrow at the edge of the window moves to a row
   *  that does not exist yet, and the row it lands on is pinned - a focus inside a
   *  row that is taken out of the page is a focus on nothing. */

  import { tick } from 'svelte'
  import type { Reference } from './link-index.svelte'
  import { roving } from './roving'
  import { offsetOf, type Rows, windowFor } from './row-window'
  import { ListView, measuredRow } from './row-window.svelte'

  const {
    rows: all,
    onpick,
  }: {
    rows: readonly Reference[]
    onpick: (reference: Reference) => void
  } = $props()

  /** How many rows are kept beyond either edge of the view, so a wheel click
   *  arrives at rows that are already drawn rather than at an empty box. The file
   *  list's own number, for the same reason. */
  const OVERSCAN = 6

  /** What a row is taken to be before there is one to measure: two lines and the
   *  padding round them, near enough to keep the first window off nought. */
  const LEAST = 40

  let list = $state<HTMLUListElement>()

  const where = new ListView()

  /** The row the keyboard is on, held so the window keeps it wherever the scroll
   *  goes. One row, because one row at a time has the keyboard. */
  let standing = $state<number | null>(null)
  /** And the row a key has just asked for, which is pinned until it is stood on. */
  let reaching = $state<number | null>(null)

  const pinned = $derived(
    [standing, reaching].filter((one): one is number => one !== null && one < all.length),
  )

  const rows = $derived<Rows>({
    count: all.length,
    height: where.row || LEAST,
    top: where.top,
    room: where.room,
    overscan: OVERSCAN,
    pinned,
  })

  const view = $derived(windowFor(rows))

  /** The rows to draw: the window's own, and the one or two the list is holding on
   *  to wherever the scroll has gone. One list and in the list's own order, for the
   *  reason the file list gives: a row held at its own offset becomes a row of the
   *  window the moment the scroll arrives, and two lists would make that one
   *  element ending and another beginning - which takes the keyboard with it. */
  const drawn = $derived.by(() => {
    const out: { at: number; row: Reference; away: boolean }[] = []

    for (let at = 0; at < all.length; at++) {
      const row = all[at]
      if (!row) continue

      const inside = at >= view.first && at <= view.last
      const away = !inside && view.pinned.includes(at)
      if (inside || away) out.push({ at, row, away })
    }

    return out
  })

  $effect(() => {
    const ul = list
    if (!ul) return

    return where.follow(ul, (one) => measuredRow(one, LEAST))
  })

  /** Puts row n in the page and answers its button once it is there. The protocol
   *  roving.ts walks a long list by; see `LongList` there. */
  async function reach(index: number): Promise<HTMLElement | null> {
    if (index < 0 || index >= all.length) return null

    reaching = index
    await tick()

    const line = list?.querySelector(`li[data-row="${index}"]`)
    if (!(line instanceof HTMLElement)) return null

    line.scrollIntoView({ block: 'nearest' })
    where.refresh()

    const found = line.querySelector('.hit')
    return found instanceof HTMLElement ? found : null
  }

  function indexOf(row: HTMLElement): number {
    const said = row.closest('li')?.dataset.row
    return said === undefined ? -1 : Number(said)
  }

  function onFocus(event: FocusEvent) {
    const from = event.target
    if (!(from instanceof HTMLElement)) return

    const at = indexOf(from)
    standing = at < 0 ? null : at
  }

  function onBlur() {
    standing = null
  }
</script>

<!-- One list, with the rows above and below the window standing in as two boxes.
     The rows themselves are what they always were: the same button, the same two
     spans, the same classes. What changed is how many of them exist. -->
<ul
  bind:this={list}
  onfocusin={onFocus}
  onfocusout={onBlur}
  use:roving={{
    ...HIT_WALK,
    long: {
      count: () => all.length,
      indexOf,
      labels: () => all.map((one) => `${one.name} ${one.text}`),
      reach,
    },
  }}
>
  <li class="gap" style:height="{view.above}px" aria-hidden="true"></li>

  {#each drawn as one (`${one.row.path}:${one.row.line}:${one.at}`)}
    <li
      data-row={one.at}
      class:away={one.away}
      style:top={one.away ? `${offsetOf(one.at, rows)}px` : undefined}
    >
      <button class="nib-row hit" onclick={() => onpick(one.row)}>
        <span class="hit-note">{one.row.name}</span>
        <span class="hit-line">{one.row.text}</span>
      </button>
    </li>
  {/each}

  <li class="gap" style:height="{view.below}px" aria-hidden="true"></li>
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    /* The rows held out of the window are placed against this, which is what lets
       one list hold both them and the flow between the two boxes. */
    position: relative;
  }

  /* A box standing in for the rows that are not in the page. It holds height and
     nothing else. */
  .gap {
    pointer-events: none;
  }

  /* A row kept for the keyboard while the window is somewhere else. Out of the
     flow, so it adds no height between the two boxes and the rows in view sit
     exactly where they would without it. */
  .away {
    position: absolute;
    left: 0;
    right: 0;
  }
</style>
