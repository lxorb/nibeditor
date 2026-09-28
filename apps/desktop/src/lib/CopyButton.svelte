<script lang="ts">
  /** The button that copies something and says so for a moment.
   *
   *  The whole of that behaviour, in one place: two panels had a copy of it and
   *  the two disagreed about how long the word stays, which is one design with
   *  two answers. Everything in the app that copies a value presses this. */
  import { copyText } from './clipboard'
  import { t } from './i18n.svelte'

  /** How long the button says it copied. Long enough to notice out of the corner
   *  of an eye, short enough to be gone before the next thing is copied. */
  const SAID_FOR = 1600

  const {
    value,
    wide = false,
    word = '',
    disabled = false,
  }: {
    /** What lands on the clipboard. */
    value: string
    /** Room for the longer of the two words in either language, for a button
     *  that stands on its own under a block rather than beside a field. */
    wide?: boolean
    /** What the button says before it has copied, where `Copy` on its own is not
     *  specific enough: `Copy link` beside a share link. Already translated by
     *  whoever passes it. */
    word?: string
    /** Nothing to copy yet: a share link that has not been made. The button stays
     *  where it is rather than appearing as the thing beside it is turned on. */
    disabled?: boolean
  } = $props()

  let said = $state(false)
  let saying: ReturnType<typeof setTimeout> | undefined

  async function copy() {
    await copyText(value)

    said = true
    clearTimeout(saying)
    saying = setTimeout(() => (said = false), SAID_FOR)
  }

  $effect(() => () => clearTimeout(saying))
</script>

<button class="copy" class:wide class:done={said} {disabled} onclick={() => void copy()}>
  {said ? t('Copied') : word || t('Copy')}
</button>

<style>
  .copy {
    flex: none;
    min-width: 4.4rem;
    padding: 6px 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  /* On its own under a block of its own, rather than beside a field. */
  .copy.wide {
    align-self: flex-start;
    min-width: 6rem;
  }

  .copy.done {
    border-color: var(--success);
    color: var(--success);
  }

  @media (hover: hover) {
    .copy:hover:not(.done):not(:disabled) {
      border-color: var(--accent);
      color: var(--accent);
    }
  }

  .copy:active:not(:disabled) {
    background: var(--press);
  }

  .copy:focus-visible {
    outline-offset: 2px;
  }
</style>
