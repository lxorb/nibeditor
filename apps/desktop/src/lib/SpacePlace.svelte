<script lang="ts">
  /** A space's number at the start of its row: its place in the list, which a digit
   *  typed into the list switches to. Plain muted figures in a slot of their own, never
   *  a raised badge - that is what a tab's Alt number is, at the corner of its mark - so
   *  the two kinds of number can never be read as one another. The figures typed so far
   *  are drawn as the palette draws a hit, since no field holds them; see space-pick.ts.
   *
   *  Empty, it is the same slot in a row that has no number - New space, a file
   *  somebody shared - so every badge in the list stands in one column. As wide as the
   *  longest number in the list. */
  import { isNumber } from './space-pick'
  import { workspace } from './workspace.svelte'

  const {
    place = null,
    typed = '',
    count = null,
  }: {
    place?: number | null
    typed?: string
    /** How many rows the list numbers, where it is not the spaces: Remote's hosts. */
    count?: number | null
  } = $props()

  const number = $derived(place === null ? '' : String(place + 1))
  /** How many of the figures were typed: where this number starts. */
  const hit = $derived(isNumber(typed) && number.startsWith(typed) ? typed.length : 0)
</script>

<span
  class="place"
  style:min-width="{String(count ?? workspace.spaces.length).length}ch"
  aria-hidden="true"
  >{#if hit}<b>{number.slice(0, hit)}</b>{/if}{number.slice(hit)}</span
>

<style>
  /* Closer to the badge than the badge is to the name: the number belongs to the
     row's start, not to the words. */
  .place {
    flex: none;
    margin-inline-end: calc(var(--space-1) - var(--row-gap));
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  b {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }
</style>
