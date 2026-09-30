<script lang="ts">
  /** One question an agent's call raised (docs/agent-native.md 9.3): the site it is
   *  about, the one line the crate wrote from the page itself, and the reader's answer.
   *
   *  A site's permission bubble in the panel's width: the same words for the same two
   *  answers (see web-tab/WebAsk.svelte), and a third, "Always on this site", where the
   *  question is about a site. A takeover is not asked the same way, because it is not
   *  a yes or a no: the agent is waiting for the reader to do one step in a tab, so the
   *  answers are to go there and to say it is done. */
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import FileMark from '../../FileMark.svelte'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { pages, siteMark } from '../../web-tab/pages.svelte'
  import { workspace } from '../../workspace.svelte'
  import type { Approval } from '../verbs'
  import type { Activity } from './activity.svelte'
  import { hostOf } from './session'

  const { activity, approval }: { activity: Activity; approval: Approval } = $props()

  /** The site, as its name: a question may carry a whole address. */
  const site = $derived(approval.site === undefined ? null : hostOf(approval.site))

  /** The site's own mark, where one of the reader's tabs has found it or this device has
   *  seen it before. Nothing is fetched for a question: a globe stands in. */
  const icon = $derived.by(() => {
    const tab = approval.tab
    const web =
      tab !== undefined && workspace.tabs.some((one) => one.id === tab && one.kind === 'web')
    return siteMark(web ? pages.of(tab).icon : null, approval.site)
  })
  let marked = $state(true)

  /** Whether a press is on its way, so a second press on the same answer is not a
   *  second call. */
  let answering = $state(false)

  async function answer(allow: boolean, always = false) {
    if (answering) return
    answering = true
    try {
      await activity.answer(approval, allow, always)
    } finally {
      answering = false
    }
  }

  /** Where the step is to be done: the reader's tab, or the agent's own made one. */
  function goThere() {
    const tab = approval.tab
    if (tab === undefined) return
    if (tab in activity.seen.tabs) void activity.show(tab)
    else activity.goTo(tab)
  }
</script>

<div class="question" transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}>
  <p class="what">
    {#if icon && marked}
      <img class="mark" src={icon} alt="" draggable="false" onerror={() => (marked = false)} />
    {:else}
      <FileMark mark="web" />
    {/if}
    <span class="site">{site ?? activity.nameOf(approval.agent)}</span>
  </p>
  <p class="summary">{approval.summary}</p>

  <div class="rows">
    {#if approval.category === 'takeover'}
      {#if approval.tab !== undefined}
        <button class="nib-button is-quiet" onclick={goThere}>{t('Open')}</button>
      {/if}
      <button class="nib-button" disabled={answering} onclick={() => void answer(true)}>
        {t('Done')}
      </button>
    {:else}
      <button class="nib-button is-quiet" disabled={answering} onclick={() => void answer(false)}>
        {t('Don’t allow')}
      </button>
      <button class="nib-button" disabled={answering} onclick={() => void answer(true)}>
        {t('Allow')}
      </button>
    {/if}
  </div>
  {#if site !== null && approval.category !== 'takeover' && approval.category !== 'showing'}
    <!-- The third answer, under the two: a promise about every question to come on the
         site rather than an answer to this one, so it is the quietest of them. -->
    <button class="always" disabled={answering} onclick={() => void answer(true, true)}>
      {t('Always on this site')}
    </button>
  {/if}
</div>

<style>
  /* The bubble's own card, in the panel rather than floating: the same border, the
     same ground, the same padding. */
  .question {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    font-family: var(--font-ui);
  }

  .what {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    color: var(--text-strong);
    font-size: var(--text-row);
    font-weight: var(--weight-strong);
  }

  .site {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    unicode-bidi: isolate;
  }

  .mark {
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    border-radius: var(--radius-sm);
  }

  .summary {
    margin: 0;
    color: var(--muted-strong);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  /* The answers at the end of the row, as every sheet puts them, wrapping in a narrow
     panel rather than cutting a word. */
  .rows {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .always {
    align-self: flex-end;
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .always:hover:not(:disabled) {
      background: var(--surface-hover);
    }
  }

  .always:active:not(:disabled) {
    background: var(--surface-press);
  }
</style>
