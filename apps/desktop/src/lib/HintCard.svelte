<script lang="ts">
  /** One hint, in a card beside the control it is about: what the control does, in
   *  one line, and a cross that puts it away for good. Pressing the line does what
   *  the control does, which also puts it away. Google Docs' and Notion's callout.
   *
   *  Whether it is on screen at all is hints.svelte.ts: one a session at most, never
   *  in Silent mode, never again once dismissed. The caller says when it would
   *  make sense (`when`) and where the card sits against its own box (`side`).
   *
   *  Callers draw it through a door, `{#await import('./HintCard.svelte')}`, and only
   *  once `startup.settled`, so no launch fetches or draws it; see hints.svelte.ts. */
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Cross from './Cross.svelte'
  import { type Hint, hints } from './hints.svelte'
  import { t } from './i18n.svelte'
  import { dur } from './motion'

  const {
    hint,
    text,
    when = true,
    side = 'above',
    onpress,
  }: {
    hint: Hint
    text: string
    when?: boolean
    side?: 'above' | 'below'
    onpress?: () => void
  } = $props()

  $effect(() => {
    hints.want(hint, when)
    return () => hints.want(hint, false)
  })

  function press() {
    hints.dismiss(hint)
    onpress?.()
  }
</script>

{#if hints.current === hint}
  <div
    class="nib-bubble is-pressable hint {side}"
    role="status"
    transition:fly={{ y: side === 'above' ? 4 : -4, duration: dur(180), easing: cubicOut }}
  >
    <button class="say" onclick={press}>{text}</button>
    <button class="nib-glyph shut" aria-label={t('Dismiss')} onclick={() => hints.dismiss(hint)}>
      <Cross small />
    </button>
  </div>
{/if}

<style>
  .hint {
    position: absolute;
    inset-inline-start: var(--space-2);
    z-index: var(--z-popover);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .above {
    bottom: calc(100% + var(--space-1));
  }

  .below {
    top: calc(100% + var(--space-1));
  }

  .say {
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
  }

  .shut {
    flex: none;
    width: 20px;
    height: 20px;
  }
</style>
