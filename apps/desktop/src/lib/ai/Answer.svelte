<script lang="ts">
  /** A model's answer, drawn: the words of ai/drawn.ts at the size a panel reads, with
   *  the citation chips the Ask panel numbers its passages with. Every press on a link
   *  inside it is the caller's, through `onfollow`. The Ask panel's and the quick
   *  question's, so the two read as one thing. */
  const { html, onfollow }: { html: string; onfollow?: (event: MouseEvent) => void } = $props()
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="words" onclick={(event) => onfollow?.(event)} onauxclick={(event) => onfollow?.(event)}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- the renderer escapes every tag the model wrote; see ai/drawn.ts -->
  {@html html}
</div>

<style>
  .words {
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .words :global(:is(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4, h5, h6)) {
    margin: 0 0 var(--space-2);
  }

  .words :global(:is(p, ul, ol, pre, blockquote, table):last-child) {
    margin-bottom: 0;
  }

  .words :global(:is(h1, h2, h3, h4, h5, h6)) {
    font-size: inherit;
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .words :global(:is(ul, ol)) {
    padding-inline-start: 1.3em;
  }

  .words :global(code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  .words :global(pre) {
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface);
    overflow-x: auto;
    white-space: pre;
  }

  .words :global(a) {
    color: var(--accent);
    text-decoration: none;
    cursor: default;
  }

  @media (hover: hover) {
    .words :global(a:hover) {
      text-decoration: underline;
    }
  }

  /* A citation: the passage's number, small and raised, the accent's own chip. */
  .words :global(a[href^='#cite-']) {
    display: inline-block;
    min-width: 1.35em;
    margin-inline: 1px;
    padding: 0 0.3em;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    font-size: 0.72em;
    font-weight: var(--weight-strong);
    line-height: 1.5;
    text-align: center;
    vertical-align: 0.35em;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .words :global(a[href^='#cite-']:hover) {
      text-decoration: none;
      background: var(--surface-press);
    }
  }

  :global([data-touch]) .words {
    font-size: var(--text-base);
  }
</style>
