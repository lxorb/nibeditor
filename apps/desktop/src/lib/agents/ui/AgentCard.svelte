<script lang="ts">
  /** One agent in the activity panel (docs/agent-native.md 9.5): who it is and what it
   *  is doing now, its questions, its tabs as pictures, and the session as a list of
   *  what it did, with the three things to do about it - Stop, Add to note, Undo.
   *
   *  No headings: the mark and the name say whose it is, the pictures say they are
   *  pages, and the list reads as a list of what happened because every row is a time,
   *  a word and a name. */
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { i18n, t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { workspace } from '../../workspace.svelte'
  import type { Activity } from './activity.svelte'
  import { ACTIVE_FOR } from './marks'
  import Question from './Question.svelte'
  import { aboutOf } from './session'
  import Spark from './Spark.svelte'
  import Thumb from './Thumb.svelte'
  import { wordFor } from './words'

  const { activity, agent }: { activity: Activity; agent: string } = $props()

  /** How many calls of the session are drawn until the reader asks for the rest. */
  const FIRST = 12

  const name = $derived(activity.nameOf(agent))
  const colour = $derived(activity.colourOf(agent))
  const stopped = $derived(activity.stopped(agent))
  const questions = $derived(activity.questions.filter((one) => one.agent === agent))
  const tabs = $derived(Object.values(activity.seen.tabs).filter((one) => one.agent === agent))
  const calls = $derived(activity.callsOf(agent))
  const undoable = $derived(activity.undoable(agent) !== null)
  /** The note in front, by its name, which is where Add to puts the session. */
  const front = $derived(workspace.active?.kind === 'note' ? workspace.active.shown : null)
  let all = $state(false)

  /** What it is doing now: its last call in a word, and what the call was about. Only
   *  while it is at it; an agent that has gone quiet is just its name. */
  const doing = $derived.by(() => {
    const last = activity.seen.doing[agent]
    if (!last || activity.now - last.at >= ACTIVE_FOR) return null

    const word = wordFor(last.verb)
    if (word === null) return null

    const about = last.tab === null ? null : titleOf(last.tab)
    return about ? `${word} · ${about}` : word
  })

  /** A tab's name, whichever kind: an agent's own, or one of the reader's. */
  function titleOf(tab: string): string | null {
    const own = activity.seen.tabs[tab]
    if (own) return own.title || own.url
    return workspace.tabs.find((one) => one.id === tab)?.shown ?? null
  }

  function timeOf(at: number): string {
    return i18n.when(at, { hour: '2-digit', minute: '2-digit' })
  }
</script>

<section class="agent" aria-label={name}>
  <header class="head">
    <Spark {colour} turning={doing !== null} paused={stopped} />
    <div class="who">
      <span class="name">{name}</span>
      {#if doing}
        <span class="doing" transition:slide={{ duration: dur(140), easing: cubicOut }}>
          {doing}
        </span>
      {/if}
    </div>
    <button
      class="nib-glyph"
      title={stopped ? t('Continue') : t('Stop')}
      aria-label={stopped ? t('Continue') : t('Stop')}
      onclick={() => void (stopped ? activity.resume(agent) : activity.stop(agent))}
    >
      {#if stopped}
        <svg viewBox="0 0 13 13"><path d="M4.2 2.8v7.4l6-3.7z" /></svg>
      {:else}
        <svg viewBox="0 0 13 13"><rect x="3.2" y="3.2" width="6.6" height="6.6" rx="1.2" /></svg>
      {/if}
    </button>
  </header>

  {#each questions as approval (approval.id)}
    <Question {activity} {approval} />
  {/each}

  {#if tabs.length}
    <div class="tabs">
      {#each tabs as tab (tab.id)}
        <Thumb {activity} {tab} />
      {/each}
    </div>
  {/if}

  {#if calls.length}
    <ol class="calls">
      {#each all ? calls : calls.slice(0, FIRST) as call (call.seq)}
        <li class="call" class:failed={call.status === 'error'}>
          <span class="word">{wordFor(call.verb)}</span>
          <span class="about">{aboutOf(call, titleOf) ?? ''}</span>
          <span class="nib-row-meta">{timeOf(call.at)}</span>
        </li>
      {/each}
    </ol>
    {#if !all && calls.length > FIRST}
      <button class="nib-row is-short more" onclick={() => (all = true)}>
        <span class="nib-row-label">{t('Show all')}</span>
      </button>
    {/if}
  {/if}

  <div class="acts">
    {#if calls.length}
      <button class="nib-chip" onclick={() => void activity.addToNote(agent)}>
        {front === null ? t('Save as a note') : t('Add to {name}', { name: front })}
      </button>
    {/if}
    {#if undoable}
      <button class="nib-chip" onclick={() => void activity.undo(agent)}>
        {t('Undo edits by {name}', { name })}
      </button>
    {/if}
  </div>
</section>

<style>
  .agent {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) 0 var(--space-3);
    font-family: var(--font-ui);
  }

  .agent + :global(.agent) {
    border-top: 1px solid var(--line);
    padding-top: var(--space-3);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    padding-inline-start: var(--row-pad);
  }

  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .name {
    color: var(--text-strong);
    font-size: var(--text-row);
    font-weight: var(--weight-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    unicode-bidi: isolate;
  }

  .doing {
    color: var(--muted);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nib-glyph svg path,
  .nib-glyph svg rect {
    fill: currentColor;
    stroke: none;
  }

  /* Two pictures a row, as a browser's tab overview lays them out at this width. */
  .tabs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
    gap: var(--space-2);
    padding: 0 var(--row-pad);
  }

  .calls {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* A row of the log: the word, what it was about, and when, at the far end where the
     times make a column. */
  .call {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-height: var(--row-height-sm);
    padding: 0 var(--row-pad);
    color: var(--muted-strong);
    font-size: var(--text-sm);
    line-height: var(--row-height-sm);
  }

  .word {
    flex: none;
    color: var(--text);
  }

  .about {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    unicode-bidi: isolate;
  }

  .failed .word {
    color: var(--danger);
  }

  .more {
    color: var(--muted);
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: 0 var(--row-pad);
  }

  .acts:empty {
    display: none;
  }
</style>
