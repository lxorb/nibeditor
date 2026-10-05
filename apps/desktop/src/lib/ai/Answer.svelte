<script lang="ts">
  /** A model's answer, drawn: the words of ai/drawn.ts at the size a panel reads, with
   *  the citation chips the Ask panel numbers its passages with. Every press on a link
   *  inside it is the caller's, through `onfollow`. The Ask panel's and the quick
   *  question's, so the two read as one thing.
   *
   *  A code block's copy button (drawn.ts puts it there) is answered here, and while
   *  the words are still arriving a dot breathes at their end, ChatGPT's cursor. */
  import { copyText } from '../clipboard'

  const {
    html,
    live = false,
    onfollow,
  }: { html: string; live?: boolean; onfollow?: (event: MouseEvent) => void } = $props()

  /** A press on a code block's copy button: its block's words, and a tick for a moment. */
  function copied(event: MouseEvent): boolean {
    const button = (event.target as Element | null)?.closest<HTMLElement>('[data-copy]')
    const code = button?.closest('.code')?.querySelector('pre')?.textContent
    if (!button || code === undefined) return false
    void copyText(code)
    button.dataset.copied = ''
    setTimeout(() => delete button.dataset.copied, 1600)
    return true
  }

  function press(event: MouseEvent) {
    if (!copied(event)) onfollow?.(event)
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="words" class:live onclick={press} onauxclick={(event) => onfollow?.(event)}>
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

  /* A code block with its bar: the language and the copy button over it, one box. */
  .words :global(.code) {
    margin: 0 0 var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    overflow: hidden;
  }

  .words :global(.code:last-child) {
    margin-bottom: 0;
  }

  .words :global(.code pre) {
    margin: 0;
    border-radius: 0;
    background: none;
  }

  .words :global(.code-bar) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--row-height-sm);
    padding-inline: var(--space-2) 2px;
    border-bottom: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }

  .words :global(.code-copy) {
    display: grid;
    place-items: center;
    width: var(--row-height-sm);
    height: calc(var(--row-height-sm) - 4px);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .words :global(.code-copy svg) {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .words :global(.code-copy[data-copied]) {
    color: var(--success);
  }

  @media (hover: hover) {
    .words :global(.code-copy:hover) {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  /* Words still arriving: a dot breathing where the next one will be. */
  .live > :global(:last-child)::after {
    content: '';
    display: inline-block;
    width: 0.55em;
    height: 0.55em;
    margin-inline-start: 0.25em;
    border-radius: 50%;
    background: var(--text-strong);
    vertical-align: 0.05em;
    animation: breathe calc(var(--dur-slow) * 3) var(--ease-in-out) infinite;
  }

  @keyframes breathe {
    50% {
      opacity: 0.3;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .live > :global(:last-child)::after {
      animation: none;
    }
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
