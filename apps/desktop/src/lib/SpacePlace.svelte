<script lang="ts">
  /** A row's number, at the corner of its mark: its place in the list, which a digit
   *  typed into the list switches to. Only while it can be used - once a digit is typed,
   *  or while Alt is held - and never by default: Emil, 2026-10-04, *"there's currently a
   *  number next to every space, and it's very annoying"*. The tab's Alt number is the
   *  shape and the look (`.nib-keytip`), over the corner of the mark, so it moves nothing
   *  in the row as it comes and goes. The tabs' own stay hidden while a list of spaces is
   *  open, so the two kinds of number are never on screen together.
   *
   *  The figures typed so far are drawn as the palette draws a hit, since no field holds
   *  them; see space-pick.ts. */
  import type { Snippet } from 'svelte'
  import { keytipIn, keytipOut } from './keytip'
  import { isNumber } from './space-pick'

  const {
    place,
    typed = '',
    held = false,
    children,
  }: {
    place: number
    typed?: string
    /** Alt is down. */
    held?: boolean
    /** The mark the number stands at the corner of. */
    children: Snippet
  } = $props()

  const number = $derived(String(place + 1))
  const typing = $derived(isNumber(typed))
  /** How many of the figures were typed: where this number starts. */
  const hit = $derived(typing && number.startsWith(typed) ? typed.length : 0)
</script>

<span class="at">
  {@render children()}
  {#if typing || held}
    <span class="nib-keytip place" aria-hidden="true" in:keytipIn out:keytipOut
      >{#if hit}<b>{number.slice(0, hit)}</b>{/if}{number.slice(hit)}</span
    >
  {/if}
</span>

<style>
  /* The mark's own box, so the number can stand at its corner. */
  .at {
    position: relative;
    flex: none;
    display: flex;
  }

  /* Its middle just inside the trailing bottom corner, as a tab's is. */
  .place {
    position: absolute;
    inset-inline-end: 0;
    bottom: 0;
    transform: translate(40%, 40%);
  }

  :global(:root[dir='rtl']) .place {
    transform: translate(-40%, 40%);
  }

  b {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }
</style>
