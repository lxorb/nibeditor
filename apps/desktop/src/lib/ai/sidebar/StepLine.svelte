<script lang="ts">
  /** One line of an answer's work (docs/ai-sidebar.md 4.3), Codex's: a caret, a verb and
   *  its object, "Read Herons", "Ran pnpm test", "Edited Birds +3 −2", "Worked for 12s".
   *  Muted, a size under the words, so the work reads as the way to the answer and the
   *  answer as what was asked for. A step still going breathes rather than spins. */
  import Tally from '../review/Tally.svelte'

  const {
    verb,
    object = '',
    open,
    going = false,
    failed = false,
    code = false,
    change,
    onpress,
  }: {
    verb: string
    object?: string
    open: boolean
    going?: boolean
    failed?: boolean
    /** The object is a command, in the code face. */
    code?: boolean
    change?: { added: number; removed: number } | undefined
    onpress: () => void
  } = $props()
</script>

<button class="line" class:going class:failed aria-expanded={open} onclick={onpress}>
  <svg class="caret" class:open viewBox="0 0 13 13"><path d="M4.8 3.2l3.3 3.3-3.3 3.3" /></svg>
  <span class="verb">{verb}</span>
  {#if object}<span class="object" class:code>{object}</span>{/if}
  {#if change}<Tally added={change.added} removed={change.removed} />{/if}
</button>

<style>
  .line {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 100%;
    margin-inline-start: -3px;
    padding: 1px 4px 1px 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .line:hover {
      color: var(--text);
    }
  }

  .caret {
    flex: none;
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .caret.open {
    transform: rotate(calc(var(--dir) * 90deg));
  }

  .verb {
    flex: none;
  }

  .object {
    min-width: 0;
    overflow: hidden;
    color: var(--muted-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .object.code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .line :global(.tally) {
    flex: none;
    font-size: inherit;
    font-variant-numeric: tabular-nums;
  }

  .going .verb {
    animation: breathe calc(var(--dur-slow) * 4) var(--ease-in-out) infinite;
  }

  @keyframes breathe {
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .going .verb {
      animation: none;
    }
  }

  .failed .verb {
    color: var(--danger);
  }
</style>
