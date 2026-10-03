<script lang="ts">
  /** The open thread, scrolling over the field: each message as a ruled line in the
   *  reader's weight (a panel in a text editor, not a messenger's bubbles), each answer
   *  under it, a message pressed a moment ago drawn at once, and three dots until the
   *  first words of an answer arrive. The end stays in view while an answer streams, as
   *  long as the reader has not scrolled up to read something else. */
  import { tick } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import Thinking from '../Thinking.svelte'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { scrollbar } from '../../scrollbar'
  import { settings } from '../../settings.svelte'
  import { chat } from './chat.svelte'
  import { sourcesFor } from './citations'
  import Reply from './Reply.svelte'

  const { ongoto, ready }: { ongoto?: ((line: number) => void) | undefined; ready: boolean } =
    $props()

  let talk = $state<HTMLElement>()
  let atEnd = true

  const turns = $derived(chat.turns)
  const id = $derived(chat.head?.id ?? '')
  const running = $derived(chat.running.includes(id))
  const pending = $derived(chat.pending[id])
  const steering = $derived(chat.steering[id] ?? [])
  const lastModel = $derived.by(() => {
    for (let at = turns.length - 1; at >= 0; at--) if (turns[at]?.role === 'model') return at
    return -1
  })
  /** Waiting for the first words: a message on its way, or an answer with nothing in it yet. */
  const waiting = $derived(
    running &&
      (pending !== undefined || !turns.at(-1)?.parts.length || turns.at(-1)?.role === 'you'),
  )

  /** What went with a message besides its passages, by name, so a message says what
   *  it was sent with. */
  function attachedOf(index: number): string[] {
    const draft = turns[index]?.draft
    return (draft?.attachments ?? [])
      .filter((one) => !('cite' in one) && one.label !== 'selection')
      .map((one) => one.label.replace(/\.(?:md|markdown)$/i, ''))
  }

  function onScroll() {
    const box = talk
    if (box) atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 24
  }

  const follows = (..._values: unknown[]) => undefined

  $effect(() => {
    follows(turns, waiting, chat.trouble, pending)
    const box = talk
    if (box && atEnd) void tick().then(() => (box.scrollTop = box.scrollHeight))
  })

  // A thread opened is read from its end.
  $effect(() => {
    follows(id)
    atEnd = true
  })
</script>

<div class="talk" bind:this={talk} use:scrollbar onscroll={onScroll}>
  {#if !ready}
    <!-- The one thing to say before a provider is set up, and where to do it. -->
    <p class="empty-text">
      {t('Add an AI provider in Settings first.')}
      <button class="link" onclick={() => settings.show('ai')}>{t('Settings › AI')}</button>
    </p>
  {/if}

  {#each turns as turn, index (turn.id)}
    {#if turn.role === 'you'}
      <div
        class="said"
        class:steered={turn.steered}
        in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}
      >
        <p>{turn.draft?.text ?? ''}</p>
        {#each attachedOf(index) as label (label)}
          <span class="went">{label}</span>
        {/each}
      </div>
    {:else}
      <Reply
        {turn}
        sources={sourcesFor(turns, index)}
        last={index === lastModel}
        live={running && index === turns.length - 1}
        {ongoto}
      />
    {/if}
  {/each}

  {#if pending !== undefined}
    <div class="said is-pending"><p>{pending}</p></div>
  {/if}

  {#each steering as words, at (at)}
    <div class="said steered is-pending"><p>{words}</p></div>
  {/each}

  {#if waiting}
    <Thinking />
  {/if}

  {#if chat.trouble}
    <p class="wrong">{chat.trouble}</p>
  {/if}
</div>

<style>
  .talk {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-1) calc(var(--space-1) + var(--row-pad)) var(--space-3);
  }

  /* The message: set off by its weight and a rule down its starting edge rather than
     by a bubble. */
  .said {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding-inline-start: var(--space-2);
    border-inline-start: 2px solid var(--line-strong);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .said p {
    flex-basis: 100%;
    margin: 0;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    font-weight: var(--weight-strong);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Sent into a running turn: the same message, its rule in the accent, as the arrow
     a steer is in every app that has one. */
  .said.steered {
    border-inline-start-color: var(--accent-line);
  }

  .said.is-pending {
    opacity: 0.6;
  }

  .went {
    max-width: 100%;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: default;
  }

  @media (hover: hover) {
    .link:hover {
      text-decoration: underline;
    }
  }

  .empty-text,
  .wrong {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-row);
    color: var(--muted);
  }

  .wrong {
    color: var(--danger);
  }

  :global([data-touch]) .said p,
  :global([data-touch]) .empty-text,
  :global([data-touch]) .wrong {
    font-size: var(--text-base);
  }
</style>
