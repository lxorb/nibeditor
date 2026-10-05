<script lang="ts">
  /** The AI panel (docs/ai-sidebar.md): a conversation with any model the reader has,
   *  about what is on screen, in the right side's last tab, on Ctrl+Shift+A. It replaced
   *  the Ask panel, and Ask is its first mode: answers from the notes, each passage cited
   *  by a number that opens it.
   *
   *  Laid out as ChatGPT is (docs/ai-sidebar.md 4.1): a thin header with the thread's
   *  title and its menu (and in a tab the threads' and New chat's buttons, which a side
   *  has in its own row of tabs); the conversation, the reader's words
   *  in bubbles and the answers across the width; the composer at the foot. A thread with
   *  nothing in it yet is a greeting with the composer in the middle, which settles to
   *  the foot as the first message goes.
   *
   *  Two places draw it: the right side (`wide` false), where the threads take the
   *  conversation's place as ChatGPT's narrow drawer does, and a tab of its own ("Open in
   *  new tab", `wide`), where they are the rail down the left and the conversation is a
   *  centred column. Both show the one open thread; see host.ts.
   *
   *  Fetched the first time the panel is shown, and the engine with it; none of it is in
   *  the first paint or in the glasses' plugin. See surfaces.svelte.ts and
   *  test/weight.test.ts. */
  import { onMount, untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { t } from '../../i18n.svelte'
  import { menu } from '../../menu.svelte'
  import { dur } from '../../motion'
  import { hearAgain } from '../../shortcuts/registry'
  import { shortcuts } from '../../shortcuts.svelte'
  import { workspace } from '../../workspace.svelte'
  import { ai } from '../store.svelte'
  import { following, toggleFollow } from '../review'
  import { chat } from './chat.svelte'
  import Composer from './Composer.svelte'
  import Conversation from './Conversation.svelte'
  import { setHost } from './host'
  import { railOpen, rememberRail } from './prefs'
  import { chatToTab } from './reveal'
  import Threads from './Threads.svelte'

  const {
    ongoto,
    wide = false,
  }: { ongoto?: ((line: number) => void) | undefined; wide?: boolean } = $props()

  const host = untrack(() => (wide ? 'tab' : 'side'))
  setHost(host)

  let root = $state<HTMLElement>()
  let railed = $state(railOpen())

  /** Whether anything can be asked: a provider set up for Ask, or any at all. */
  const ready = $derived(ai.providerFor('ask') !== null)
  const head = $derived(chat.head)
  /** The threads in the conversation's place: the side's drawer, never a tab's. */
  const listing = $derived(chat.listing && !wide)
  const empty = $derived(!chat.turns.length && !chat.busy && !chat.pending[head?.id ?? ''])

  // The space in front is the panel's space: its threads, its open one.
  // Untracked, so what the store reads while it changes threads is not something this
  // effect waits on: only the space is.
  $effect(() => {
    const space = workspace.activeSpaceId ?? ''
    untrack(() => chat.enter(space))
  })

  // A thread not yet sent asks whichever provider Ask is set to now.
  $effect(() => {
    const provider = ai.providerFor('ask')
    untrack(() => chat.follow(provider))
  })

  /** A tab's rail shown or put away, ChatGPT's sidebar button. */
  function toggleRail() {
    railed = !railed
    rememberRail(railed)
  }

  function titleMenu(event: MouseEvent) {
    const thread = chat.thread
    menu.show(event, [
      { label: t('Rename'), asks: true, run: () => void chat.rename() },
      // Follow (Zed's word): the notes the thread edits come to the front as it edits.
      ...(thread
        ? [{ label: t('Follow'), checked: following(thread), run: () => toggleFollow(thread) }]
        : []),
      { label: t('Branch'), run: () => chat.branch() },
      { label: t('Save as a note'), run: () => void chat.exportThread() },
      // The same thread in a pane of its own, for a long session beside two notes.
      ...(wide ? [] : [{ label: t('Open in new tab'), run: chatToTab }]),
      { label: t('Archive'), run: () => chat.archive() },
      { label: t('Delete'), danger: true, run: () => void chat.remove() },
    ])
  }

  /** This place is the one being used: the keyboard and the popovers come here. */
  function claim() {
    if (chat.host !== host) {
      chat.popover = null
      chat.host = host
    }
  }

  onMount(() => {
    chat.host = host
    // Ctrl+Shift+A pressed again with the field in hand is the thread list: the side's
    // drawer, or a tab's rail with the keyboard in its search.
    hearAgain(() => {
      const at = document.activeElement
      const box = root
      if (!box?.contains(at) || chat.listing || at?.tagName !== 'TEXTAREA') return false
      if (!wide) chat.showThreads()
      else {
        railed = true
        requestAnimationFrame(() => box.querySelector<HTMLElement>('.shelf input')?.focus())
      }
      return true
    })
    // A key that opened this panel put the keyboard in its body while the panel was on
    // its way; the field, or the way to Settings, takes it from there. See
    // `revealPanel` in focus.ts.
    const body = root?.closest('[data-panel]')
    if (body && body === document.activeElement) {
      root?.querySelector<HTMLElement>(ready ? 'textarea' : '.empty-text .link')?.focus()
    }
    return () => {
      hearAgain(null)
      if (chat.host === host) chat.host = host === 'tab' ? 'side' : 'tab'
    }
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="ask"
  class:wide
  class:is-empty={empty && !listing}
  bind:this={root}
  onfocusin={claim}
  onpointerdown={claim}
>
  {#if wide && railed}
    <aside class="shelf" transition:fly={{ x: -12, duration: dur(150), easing: cubicOut }}>
      <Threads rail />
    </aside>
  {/if}

  <div class="main">
    <!-- The header: at a side, the thread's title and its menu, the side's own row
         over it holding Chats and New chat; in a tab, ChatGPT's whole bar - the rail's
         button, the title, and New chat while the rail that has it is put away. -->
    {#if wide || (head?.kept && !listing)}
      <header class="top">
        {#if wide}
          <button
            class="nib-glyph"
            title={t('Chats')}
            aria-label={t('Chats')}
            aria-pressed={railed}
            onclick={toggleRail}
          >
            <svg viewBox="0 0 13 13" aria-hidden="true"
              ><path
                d="M2.6 2.2h7.8a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1zM5 2.2v8.6"
              /></svg
            >
          </button>
        {/if}
        {#if head?.kept && !listing}
          <button class="title" onclick={titleMenu} aria-haspopup="menu">
            <span>{head.title || t('Untitled')}</span>
            <svg viewBox="0 0 13 13"><path d="M3.8 5.2l2.7 2.7 2.7-2.7" /></svg>
          </button>
        {/if}
        <span class="gap"></span>
        {#if wide && !railed}
          <button
            class="nib-glyph"
            title={shortcuts.tooltip(t('New chat'), 'ai.new')}
            aria-label={t('New chat')}
            onclick={() => chat.newThread()}
          >
            <svg viewBox="0 0 13 13" aria-hidden="true"
              ><path
                d="M10.9 6.9v3.1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.1a1 1 0 0 1 1-1h3.1M9.3 1.8l1.9 1.9-4.6 4.6-2.5.6.6-2.5z"
              /></svg
            >
          </button>
        {/if}
      </header>
    {/if}

    {#if listing}
      <Threads />
    {:else}
      <Conversation {ongoto} {ready} />
      {#if ready}
        <Composer />
      {/if}
      <!-- Below the composer while the thread is empty, as much room as above it: the
           composer in the middle. It gives the room up as the first message goes, and
           the composer settles to the foot. -->
      <div class="under"></div>
    {/if}
  </div>
</div>

<style>
  /* A column with one thing that scrolls in it: the conversation grows and the field
     at the foot stays put. The body this sits in gives up its own scrolling and
     padding for it; see Sidebar.svelte. */
  .ask {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
  }

  /* A tab of its own: the page's ground, and the conversation and the composer in a
     column ChatGPT's width down the middle. */
  .ask.wide {
    --column: 48rem;

    height: 100%;
    background: var(--bg);
  }

  .main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .shelf {
    flex: none;
    display: flex;
    width: 16rem;
    padding-top: var(--space-2);
    border-inline-end: 1px solid var(--line);
    background: var(--surface);
  }

  .top {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    padding: 0 var(--space-1) var(--space-1);
  }

  .ask.wide .top {
    padding: var(--space-2) var(--space-2) var(--space-1);
  }

  .top svg {
    stroke-width: 1.3;
  }

  .gap {
    flex: 1;
  }

  .title {
    flex: 0 1 auto;
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    padding: 2px var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    text-align: start;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
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
    stroke: var(--muted);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (hover: hover) {
    .title:hover {
      background: var(--surface-hover);
    }
  }

  /* The room under the composer: all of the lower half while the thread is empty,
     none once it is not, and the change of the two is the composer moving down. */
  .under {
    flex: 0 0 0;
    transition: flex-grow var(--dur-base) var(--ease-out);
  }

  .ask.is-empty .under {
    flex-grow: 1;
  }
</style>
