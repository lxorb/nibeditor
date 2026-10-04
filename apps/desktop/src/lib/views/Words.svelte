<script lang="ts">
  /** A line's words with their inline marks drawn rather than shown; see inline.ts. */
  import { pieces } from './inline'

  const { words }: { words: string } = $props()
  const shown = $derived(pieces(words))
</script>

{#each shown as piece, at (at)}{#if piece.code}<code>{piece.text}</code
    >{:else if piece.link !== undefined}<span class="link">{piece.text}</span
    >{:else if piece.strong}<strong>{piece.text}</strong>{:else if piece.em}<em>{piece.text}</em
    >{:else if piece.struck}<s>{piece.text}</s>{:else}{piece.text}{/if}{/each}

<style>
  code {
    padding: 0 0.25em;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  .link {
    color: var(--accent);
  }

  strong {
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }
</style>
