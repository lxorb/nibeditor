<script lang="ts">
  /** An agent waiting for the reader to do one step in this tab (docs/agent-native.md
   *  7.3): a sign-in, a captcha, a payment. Operator's takeover, said as quietly as nib
   *  says anything: the agent's mark, the one line it gave, and Done.
   *
   *  A line under the bar and not a bubble over the page, because the page is the thing
   *  the reader has to use while it is up: it takes its height from the pane like the
   *  find bar does, and nothing hides the page. Nothing is read or photographed while
   *  the tab is the reader's; Done hands it back. */
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { started } from './live.svelte'
  import Spark from './Spark.svelte'

  const { id, reason }: { id: string; reason: string } = $props()

  const activity = started()
  const approval = $derived(activity.seen.approvals.find((one) => one.id === id) ?? null)

  function done() {
    if (approval) void activity.answer(approval, true).catch(() => undefined)
  }
</script>

<div class="takeover" transition:slide={{ duration: dur(140), easing: cubicOut }}>
  {#if approval}
    <Spark colour={activity.colourOf(approval.agent)} paused />
  {/if}
  <span class="reason">{reason}</span>
  <button class="nib-button" onclick={done}>{t('Done')}</button>
</div>

<style>
  .takeover {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--line);
    background: var(--surface);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .reason {
    flex: 1;
    min-width: 0;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
