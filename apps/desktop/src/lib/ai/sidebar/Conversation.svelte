<script lang="ts">
  /** The open thread, scrolling over the composer, as ChatGPT draws one: the reader's
   *  messages in bubbles at the end of the line, each answer across the whole width
   *  under it with no bubble at all, a message pressed a moment ago drawn at once, and a
   *  dot breathing until the first words of an answer arrive. Under a bubble, while it
   *  is pointed at: copy, edit and rewind, and the arrows between its branches once it
   *  has been edited.
   *
   *  The end stays in view while an answer streams, as long as the reader has not
   *  scrolled up to read something else; then a round arrow over the composer goes back
   *  down. An empty thread is the greeting, over the composer in the middle. */
  import { tick } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fade, fly } from 'svelte/transition'
  import Thinking from '../Thinking.svelte'
  import { copyText } from '../../clipboard'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { scrollbar } from '../../scrollbar'
  import { settings } from '../../settings.svelte'
  import { chat } from './chat.svelte'
  import { sourcesFor } from './citations'
  import Branches from '../review/Branches.svelte'
  import Reply from './Reply.svelte'

  const { ongoto, ready }: { ongoto?: ((line: number) => void) | undefined; ready: boolean } =
    $props()

  let talk = $state<HTMLElement>()
  let atEnd = $state(true)

  const turns = $derived(chat.turns)
  /** The open thread itself, the live one, for the review's arrows under a message. */
  const thread = $derived(chat.head ? chat.thread : null)
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
  const hello = $derived(ready && !turns.length && pending === undefined && !running)

  /** What went with a message besides its passages, by name, so a message says what
   *  it was sent with. */
  function attachedOf(index: number): string[] {
    const draft = turns[index]?.draft
    return (draft?.attachments ?? [])
      .filter((one) => !('cite' in one) && one.label !== 'selection')
      .map((one) => one.label.replace(/\.(?:md|markdown)$/i, ''))
  }

  /** Which message's words were copied a moment ago, for the tick that says so. */
  let copied = $state<string | null>(null)
  let copying: ReturnType<typeof setTimeout> | undefined
  async function copy(turn: string, text: string) {
    await copyText(text)
    copied = turn
    clearTimeout(copying)
    copying = setTimeout(() => (copied = null), 1600)
  }

  function onScroll() {
    const box = talk
    if (box) atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 24
  }

  function down() {
    talk?.scrollTo({ top: talk.scrollHeight, behavior: 'smooth' })
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

<div class="room">
  <div class="talk" bind:this={talk} use:scrollbar onscroll={onScroll}>
    {#if !ready}
      <!-- The one thing to say before a provider is set up, and where to do it. -->
      <p class="empty-text">
        {t('Add an AI provider in Settings first.')}
        <button class="link" onclick={() => settings.show('ai')}>{t('Settings › AI')}</button>
      </p>
    {/if}

    {#if hello}
      <h2 class="hello" in:fade={{ duration: dur(150) }}>{t('What can I help with?')}</h2>
    {/if}

    {#each turns as turn, index (turn.id)}
      {#if turn.role === 'you'}
        {@const words = turn.draft?.text ?? ''}
        <div
          class="said"
          class:steered={turn.steered}
          in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}
        >
          {#if attachedOf(index).length}
            <div class="went">
              {#each attachedOf(index) as label (label)}
                <span>{label}</span>
              {/each}
            </div>
          {/if}
          <p class="bubble">{words}</p>
          {#if thread && !turn.steered}
            <div class="under">
              <span class="tools">
                <button
                  class="nib-glyph tool"
                  title={t('Copy')}
                  aria-label={t('Copy')}
                  onclick={() => void copy(turn.id, words)}
                >
                  <svg viewBox="0 0 13 13">
                    {#if copied === turn.id}
                      <path d="M2.8 6.8l2.4 2.4 5-5.4" />
                    {:else}
                      <path
                        d="M4.5 4.5V3a1 1 0 0 1 1-1H10a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H8.5M3 4.5h4.5a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z"
                      />
                    {/if}
                  </svg>
                </button>
                {#if !running}
                  <!-- Change it and send again, or go back to before it: ChatGPT's
                       pencil and Claude Code's checkpoint. -->
                  <button
                    class="nib-glyph tool"
                    title={t('Edit')}
                    aria-label={t('Edit')}
                    onclick={() => chat.startEdit(turn.id)}
                  >
                    <svg viewBox="0 0 13 13"><path d="M8.7 2.3l2 2-6 6-2.6.6.6-2.6z" /></svg>
                  </button>
                  <button
                    class="nib-glyph tool"
                    title={t('Rewind')}
                    aria-label={t('Rewind')}
                    onclick={() => chat.rewind(turn.id)}
                  >
                    <svg viewBox="0 0 13 13"
                      ><path
                        d="M2.4 6.5a4.1 4.1 0 1 0 1.2-2.9M2.4 2v2.6H5M6.5 4.4v2.3l1.6 1"
                      /></svg
                    >
                  </button>
                {/if}
              </span>
              <Branches {thread} turn={turn.id} panel={chat} />
            </div>
          {/if}
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
      <div class="said is-pending"><p class="bubble">{pending}</p></div>
    {/if}

    {#each steering as words, at (at)}
      <div class="said steered is-pending"><p class="bubble">{words}</p></div>
    {/each}

    {#if waiting}
      <Thinking />
    {/if}

    {#if chat.trouble}
      <p class="wrong">{chat.trouble}</p>
    {/if}
  </div>

  {#if !atEnd && turns.length}
    <button
      class="down nib-layer"
      title={t('Scroll to the end')}
      aria-label={t('Scroll to the end')}
      onclick={down}
      transition:fly={{ y: 6, duration: dur(130), easing: cubicOut }}
    >
      <svg viewBox="0 0 13 13" aria-hidden="true"
        ><path d="M6.5 2.4v8M3.2 7.1l3.3 3.3 3.3-3.3" /></svg
      >
    </button>
  {/if}
</div>

<style>
  .room {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* The thread in a column: the panel's gutter at a side's width, and ChatGPT's measure
     down the middle of a tab (`--column`, set by the panel). */
  .talk {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-block: var(--space-2) var(--space-4);
    padding-inline: max(
      calc(var(--space-1) + var(--row-pad)),
      calc((100% - var(--column, 100%)) / 2 + var(--space-4))
    );
  }

  /* An empty thread: the greeting sits on the composer, which sits in the middle. */
  :global(.ask.is-empty) .talk {
    justify-content: flex-end;
    padding-bottom: var(--space-5);
  }

  .hello {
    margin: 0;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: calc(var(--text-base) * 1.45);
    font-weight: var(--weight-strong);
    letter-spacing: -0.01em;
    text-align: center;
  }

  /* The reader's message: a bubble at the end of the line, ChatGPT's, with what went
     with it over it and its tools under it. */
  .said {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    min-width: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .bubble {
    max-width: min(85%, 36rem);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Sent into a running turn: the same bubble, edged in the accent, as the arrow a steer
     is in every app that has one. */
  .said.steered .bubble {
    box-shadow: inset 0 0 0 1px var(--accent-line);
  }

  .said.is-pending {
    opacity: 0.6;
  }

  .went {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
    max-width: 85%;
  }

  .went span {
    max-width: 100%;
    padding: 1px var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .under {
    display: flex;
    align-items: center;
    min-height: var(--row-height-sm);
    margin-top: -2px;
  }

  /* The tools under a bubble while it is pointed at, in place, so nothing moves. */
  .tools {
    display: flex;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .said:hover .tools,
  .tools:focus-within,
  :global([data-touch]) .tools {
    opacity: 1;
  }

  .tool {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
  }

  .tool svg {
    stroke-width: 1.3;
  }

  /* Back to the end: a round arrow floating over the composer, centred, ChatGPT's. */
  .down {
    position: absolute;
    bottom: var(--space-2);
    left: 50%;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-left: -14px;
    padding: 0;
    border-radius: 50%;
    box-shadow: var(--shadow-md);
    color: var(--text);
    cursor: default;
  }

  .down svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (hover: hover) {
    .down:hover {
      color: var(--text-strong);
    }
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

  :global([data-touch]) .bubble,
  :global([data-touch]) .empty-text,
  :global([data-touch]) .wrong {
    font-size: var(--text-base);
  }
</style>
