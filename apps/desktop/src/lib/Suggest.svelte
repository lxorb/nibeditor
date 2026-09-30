<script lang="ts">
  /** The values an operator can take, offered under the field.
   *
   *  The same shape the editor puts under `[[`: one surface, one row per
   *  value, the letters that were typed marked where they landed. Chosen on
   *  pointerdown rather than on click, because clicking takes the focus off
   *  the field first and a popup that has lost its field has nothing to
   *  finish.
   *
   *  A value is shown as itself unless the field says otherwise: the address bar
   *  keeps an address as the value and shows it the way a browser does, with the
   *  page's own name after it, and each row wearing the site's mark in front, as
   *  Chrome's omnibox rows do. See web-tab/AddressField.svelte. */

  import type { Snippet } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { dur } from './motion'

  const {
    values,
    typed,
    active,
    id,
    label,
    onchoose,
    shown = (value: string) => value,
    aside,
    lead,
  }: {
    values: string[]
    typed: string
    active: number
    /** The list's own id, so the field above can point at it and at the row the
     *  arrows are on; see the combobox in Palette.svelte, which is the same shape. */
    id: string
    label: string
    onchoose: (value: string) => void
    /** What a row reads as, where that is not the value itself. */
    shown?: (value: string) => string
    /** A quieter second half after it, or the empty string for none. */
    aside?: (value: string) => string
    /** What stands in front of a row, where the rows wear a mark. */
    lead?: Snippet<[string]>
  } = $props()

  /** The value in three parts, so the letters that were typed can be marked
   *  where they actually sit. */
  function split(value: string) {
    const at = typed ? value.toLowerCase().indexOf(typed.trim().toLowerCase()) : -1
    if (at === -1) return { before: value, hit: '', after: '' }

    return {
      before: value.slice(0, at),
      hit: value.slice(at, at + typed.trim().length),
      after: value.slice(at + typed.trim().length),
    }
  }
</script>

<!-- A box with a list under it is one control and not two, which is what the
     palette is as well: the keyboard never leaves the field, the arrows move which
     row the field is pointing at, and the rows are out of the tab sequence. This
     was a plain list of buttons - nothing said it was a list of choices, nothing
     said which one the arrows were on, and Tab walked into it one value at a
     time. -->
<ul
  {id}
  class="nib-layer suggest"
  role="listbox"
  aria-label={label}
  transition:fly={{ y: -4, duration: dur(130), easing: cubicOut }}
>
  {#each values as value, index (value)}
    {@const parts = split(shown(value))}
    {@const after = aside?.(value) ?? ''}
    <li role="none">
      <button
        id="{id}-{index}"
        role="option"
        tabindex="-1"
        aria-selected={index === active}
        class:on={index === active}
        onpointerdown={(event) => {
          event.preventDefault()
          onchoose(value)
        }}
      >
        {@render lead?.(value)}
        <span class="words"
          >{parts.before}<span class="matched">{parts.hit}</span>{parts.after}
          {#if after}<span class="aside">{after}</span>{/if}</span
        >
      </button>
    </li>
  {/each}
</ul>

<style>
  /* A floating list of choices, so its shape is `.nib-layer` in the themes
     package - the same corner, hairline, surface and shadow the menus have. It
     spent `--shadow-md` where they spend `--shadow-lg`, which made the same kind
     of thing sit at two heights. What is left here is where it hangs. */
  .suggest {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    right: 0;
    z-index: var(--z-popover);
    max-height: 15em;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 5px 10px;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.5;
    text-align: start;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  button:hover,
  button.on {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  /* The words take what the mark leaves, and are cut with an ellipsis rather than
     pushed out of the row. */
  .words {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The second half, in the grey a row's quieter half is everywhere, a word's
     space after the first. */
  .aside {
    margin-inline-start: var(--space-2);
    color: var(--muted);
  }

  /* And steps up on a lit row, which is not the page `--muted` is measured
     against; see `.nib-row.is-on kbd` in the themes package. */
  button:hover .aside,
  button.on .aside {
    color: var(--muted-strong);
  }

  /* The letters that were typed, marked where they landed in the value. */
  .matched {
    color: var(--accent);
    font-weight: var(--weight-strong);
  }

  :global([data-touch]) button {
    min-height: var(--touch-target);
    font-size: var(--text-base);
  }
</style>
