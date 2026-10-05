<script lang="ts">
  /** A call that waits for the reader (docs/ai-sidebar.md 4.4): in Approve every change,
   *  in any mode paying. Drawn as a card in the call's own step, Codex's - what it would
   *  change, then Approve, Always and Deny in Codex's order (once, from now on, no) -
   *  and answered there or in the Activity panel, whichever comes first. Always says
   *  yes to this tool for the rest of the thread. */
  import { t } from '../../i18n.svelte'
  import { crateAnswers, sayAlways } from '../chat/approvals'
  import type { Part, Thread } from '../chat/types'
  import Asked from './Asked.svelte'

  const { part, thread }: { part: Extract<Part, { kind: 'tool' }>; thread: Thread | null } =
    $props()

  let answering = $state(false)

  async function answer(allow: boolean, always = false) {
    const approval = part.result?.approval
    if (!approval || answering) return
    answering = true
    if (always && thread) sayAlways(thread, part.verb)
    await crateAnswers.answer(approval, allow)
  }
</script>

<div class="approval">
  {#if part.result?.text}<p>{part.result.text}</p>{/if}
  <Asked {part} />
  <div class="answers">
    <button class="nib-button" disabled={answering} onclick={() => void answer(true)}
      >{t('Approve')}</button
    >
    {#if thread}
      <button
        class="nib-button is-quiet"
        disabled={answering}
        title={t('Always in this thread')}
        onclick={() => void answer(true, true)}>{t('Always')}</button
      >
    {/if}
    <button class="nib-button is-quiet" disabled={answering} onclick={() => void answer(false)}
      >{t('Deny')}</button
    >
  </div>
</div>

<style>
  /* Codex's question: a card in the step that asks, on the accent's hairline, so the
     one thing waiting for the reader is the thing that stands out. */
  .approval {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 4px 0 2px 13px;
    padding: var(--space-2);
    border: 1px solid var(--accent-line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  p {
    margin: 0;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .answers {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
