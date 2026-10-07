<script lang="ts">
  /** A poll in a message (docs/chats.md 4.8): the question, each answer a bar as long
   *  as its share with its count, the reader's own ticked, and who chose it on the
   *  bubble. A press votes, or takes the vote back; one answer or several, as the poll
   *  says, until it ends. */
  import type { Message, Who } from '@nib/chats'
  import { amount, i18n } from '../../i18n.svelte'
  import type { ChatPage } from './chat.svelte'
  import Glyph from './Glyph.svelte'
  import { nameOf } from './people'
  import { tip } from './tips.svelte'

  const {
    message,
    page,
    space,
    canVote,
  }: { message: Message; page: ChatPage; space: string | null; canVote: boolean } = $props()

  const poll = $derived(message.poll)
  const ended = $derived(poll?.ends !== undefined && poll.ends < Date.now())
  const voters = $derived(Object.entries(poll?.votes ?? {}) as [Who, number[]][])
  const mine = $derived(page.me ? (poll?.votes[page.me] ?? []) : [])
  const counts = $derived(
    (poll?.answers ?? []).map((_, index) => voters.filter(([, chose]) => chose.includes(index))),
  )
  const most = $derived(Math.max(1, ...counts.map((one) => one.length)))

  function choose(index: number) {
    if (!poll || ended || !canVote) return
    const has = mine.includes(index)
    const next = poll.several
      ? has
        ? mine.filter((one) => one !== index)
        : [...mine, index].sort((a, b) => a - b)
      : has
        ? []
        : [index]
    page.vote(message, next)
  }
</script>

{#if poll}
  <div class="poll">
    <p class="question"><Glyph name="poll" /> {poll.question}</p>
    {#each poll.answers as answer, index (index)}
      {@const who = counts[index] ?? []}
      <button
        type="button"
        class="answer"
        class:mine={mine.includes(index)}
        disabled={ended || !canVote}
        aria-pressed={mine.includes(index)}
        use:tip={() => who.map(([one]) => nameOf(one, page.members, space)).join(', ')}
        onclick={() => choose(index)}
      >
        <span class="fill" style:width="{(who.length / most) * 100}%"></span>
        <span class="words">{answer}</span>
        <span class="count">{amount(who.length)}</span>
      </button>
    {/each}
    {#if poll.ends !== undefined}
      <p class="ends" class:ended>
        <Glyph name="clock" />
        {i18n.when(poll.ends, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
      </p>
    {/if}
  </div>
{/if}

<style>
  .poll {
    width: min(380px, 100%);
    margin-top: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .question {
    --glyph-size: 14px;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .answer {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: 32px;
    margin-top: 6px;
    padding: 0 var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    overflow: hidden;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: default;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .answer:hover:not(:disabled) {
      border-color: var(--accent-line);
    }
  }

  .answer.mine {
    border-color: var(--accent);
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent-soft);
    transition: width var(--dur-slow) var(--ease-out);
  }

  .words,
  .count {
    position: relative;
  }

  .words {
    flex: 1;
    min-width: 0;
  }

  .count {
    color: var(--muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .ends {
    --glyph-size: 12px;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: var(--space-2) 0 0;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .ends.ended {
    text-decoration: line-through;
  }
</style>
