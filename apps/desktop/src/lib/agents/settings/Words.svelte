<script lang="ts">
  /** A short list somebody keeps by hand: the sites scripts may run on, the programs
   *  the terminal starts without asking. The dictionary's shape in the Spelling pane -
   *  the words, each of which is the button that takes it away, and a field for one
   *  more under them - because it is the same thing: a list read and taken back here,
   *  added to by typing.
   *
   *  What was typed is read by `parse` first, which answers the word to keep or
   *  nothing; nothing leaves the field as it was, marked, so the reader can see what
   *  was not taken and put it right. */
  import Cross from '../../Cross.svelte'
  import { t } from '../../i18n.svelte'

  const {
    words,
    placeholder,
    parse,
    onadd,
    onremove,
  }: {
    words: readonly string[]
    placeholder: string
    parse: (typed: string) => Promise<string | null>
    onadd: (word: string) => void
    onremove: (word: string) => void
  } = $props()

  let refused = $state(false)

  async function add(field: HTMLInputElement) {
    const typed = field.value
    if (!typed.trim()) return

    const word = await parse(typed)
    refused = word === null
    if (word === null) return

    onadd(word)
    field.value = ''
  }
</script>

<div class="nib-setting words">
  {#if words.length}
    <div class="list">
      {#each words as word (word)}
        <button class="word" title={t('Remove')} onclick={() => onremove(word)}>
          {word}<Cross small />
        </button>
      {/each}
    </div>
  {/if}
  <input
    class="add"
    class:refused
    type="text"
    {placeholder}
    aria-label={placeholder}
    aria-invalid={refused}
    spellcheck="false"
    autocapitalize="off"
    autocomplete="off"
    oninput={() => (refused = false)}
    onchange={(event) => void add(event.currentTarget)}
  />
</div>

<style>
  /* A list runs down the card rather than across it, and the field for another one
     sits under the last of them: the Spelling pane's dictionary. */
  .words {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    padding-block: var(--space-1);
  }

  .list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  /* One word, and the way to take it back: the whole of it is the button. */
  .word {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.1em 0.55em;
    border: none;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .word :global(svg) {
    width: 8px;
    height: 8px;
    color: var(--muted);
    stroke-width: 1.4;
  }

  @media (hover: hover) {
    .word:hover {
      background: var(--danger-soft);
      color: var(--danger);
    }

    .word:hover :global(svg) {
      color: inherit;
    }
  }

  .add {
    width: 100%;
    padding: 6px 9px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .add::placeholder {
    color: var(--muted);
  }

  .add:focus {
    background: var(--bg);
  }

  /* What was typed and not taken, said in the colour of a refusal. */
  .add.refused {
    border-color: var(--danger);
  }
</style>
