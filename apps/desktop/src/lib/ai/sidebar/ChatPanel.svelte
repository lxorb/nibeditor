<script lang="ts">
  /** The AI panel (docs/ai-sidebar.md): a conversation with any model the reader has,
   *  about what is on screen, in the right side's last tab, on Ctrl+Shift+A. It replaced
   *  the Ask panel, and Ask is its first mode: answers from the notes, each passage cited
   *  by a number that opens it.
   *
   *  The thread's title over the conversation (its menu renames, branches, saves and
   *  archives it), the conversation or the thread list in the middle, and the field at
   *  the foot with everything that shapes the next message under it.
   *
   *  Fetched the first time the panel is shown, and the engine with it; none of it is in
   *  the first paint or in the glasses' plugin. See surfaces.svelte.ts and
   *  test/weight.test.ts. */
  import { onMount } from 'svelte'
  import { t } from '../../i18n.svelte'
  import { menu } from '../../menu.svelte'
  import { workspace } from '../../workspace.svelte'
  import { ai } from '../store.svelte'
  import { chat } from './chat.svelte'
  import Composer from './Composer.svelte'
  import Conversation from './Conversation.svelte'
  import { hearAgain } from './door'
  import Threads from './Threads.svelte'

  const { ongoto }: { ongoto?: ((line: number) => void) | undefined } = $props()

  let root = $state<HTMLElement>()

  /** Whether anything can be asked: a provider set up for Ask, or any at all. */
  const ready = $derived(ai.providerFor('ask') !== null)
  const head = $derived(chat.head)

  // The space in front is the panel's space: its threads, its open one.
  $effect(() => {
    chat.enter(workspace.activeSpaceId ?? '')
  })

  // A thread not yet sent asks whichever provider Ask is set to now.
  $effect(() => {
    chat.adopt(ai.providerFor('ask'))
  })

  function titleMenu(event: MouseEvent) {
    menu.show(event, [
      { label: t('Rename'), asks: true, run: () => void chat.rename() },
      { label: t('Branch'), run: () => chat.branch() },
      { label: t('Save as a note'), run: () => void chat.exportThread() },
      { label: t('Archive'), run: () => chat.archive() },
      { label: t('Delete'), danger: true, run: () => void chat.remove() },
    ])
  }

  onMount(() => {
    // Ctrl+Shift+A pressed again with the field in hand is the thread list.
    hearAgain(() => {
      const at = document.activeElement
      if (!root?.contains(at) || chat.listing || at?.tagName !== 'TEXTAREA') return false
      chat.showThreads()
      return true
    })
    // A key that opened this panel put the keyboard in its body while the panel was on
    // its way; the field, or the way to Settings, takes it from there. See
    // `revealPanel` in focus.ts.
    const body = root?.closest('[data-panel]')
    if (body && body === document.activeElement) {
      root?.querySelector<HTMLElement>(ready ? 'textarea' : '.empty-text .link')?.focus()
    }
    return () => hearAgain(null)
  })
</script>

<div class="ask" class:is-empty={!chat.turns.length && !chat.busy} bind:this={root}>
  {#if head?.kept && !chat.listing}
    <button class="title" onclick={titleMenu} aria-haspopup="menu">
      <span>{head.title || t('Untitled')}</span>
      <svg viewBox="0 0 13 13"><path d="M3.8 5.2l2.7 2.7 2.7-2.7" /></svg>
    </button>
  {/if}

  {#if chat.listing}
    <Threads />
  {:else}
    <Conversation {ongoto} {ready} />
  {/if}

  {#if ready}
    <Composer />
  {/if}
</div>

<style>
  /* A column with one thing that scrolls in it: the conversation grows and the field
     at the foot stays put. The body this sits in gives up its own scrolling and
     padding for it; see Sidebar.svelte. */
  .ask {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .title {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    max-width: 100%;
    margin: 0 var(--space-1) 2px;
    padding: 2px var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .title span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title svg {
    flex: none;
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (hover: hover) {
    .title:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }
</style>
