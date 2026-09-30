<script lang="ts">
  /** The activity panel, on the right side where the outline and the links are
   *  (docs/agent-native.md 9.5): each connected agent, what it is doing now, its tabs
   *  as pictures, its questions and its session.
   *
   *  The pictures and the log cost something, so they are only asked for while the
   *  panel is showing: the engine's screencast is started for the agents' tabs as it
   *  opens and stopped as it closes, and the log is read again while an agent is at
   *  work - on each of its calls, at most once a second - rather than on a clock. */
  import { onMount, untrack } from 'svelte'
  import { t } from '../../i18n.svelte'
  import AgentCard from './AgentCard.svelte'
  import { started } from './live.svelte'
  import { ASK_MARK } from '../../panel-marks'

  const activity = started()

  /** How often the log is read again at most, while calls keep coming. */
  const LOG_EVERY = 1000

  /** The agents' own tabs that have a page to take pictures of. */
  const watched = $derived(
    Object.values(activity.seen.tabs)
      .filter((one) => !one.parked)
      .map((one) => one.id)
      .sort()
      .join('\n'),
  )

  $effect(() => {
    const tabs = watched === '' ? [] : watched.split('\n')
    untrack(() => void activity.source.watch(tabs).catch(() => undefined))
  })

  /** When the last call anybody made was, which is when the log has a line more. */
  const latest = $derived(
    Object.values(activity.seen.doing).reduce((most, one) => Math.max(most, one.at), 0),
  )

  // Read again after the last call of a burst.
  let reading: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    if (latest === 0) return
    clearTimeout(reading)
    reading = setTimeout(() => void activity.readLog().catch(() => undefined), LOG_EVERY)
  })

  onMount(() => {
    void activity.readLog().catch(() => undefined)
    const hearing = activity.source.frames(({ tab, jpeg }) => {
      activity.frames[tab] = `data:image/jpeg;base64,${jpeg}`
    })

    return () => {
      clearTimeout(reading)
      void activity.source.watch([]).catch(() => undefined)
      void hearing.then((stop) => stop())
    }
  })
</script>

<div class="panel">
  {#each activity.listed as agent (agent)}
    <AgentCard {activity} {agent} />
  {:else}
    <!-- Nobody connected: the mark the tab wears, and nothing to read. -->
    <div class="none" role="img" aria-label={t('Agents')}>
      <svg viewBox="0 0 13 13"><path d={ASK_MARK} /></svg>
    </div>
  {/each}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    padding-bottom: var(--space-4);
  }

  .none {
    display: grid;
    place-items: center;
    padding: var(--space-6) 0;
    color: var(--faint);
  }

  .none svg {
    width: calc(var(--icon-lg) * 2);
    height: calc(var(--icon-lg) * 2);
    fill: none;
    stroke: currentColor;
    stroke-width: 0.8;
    stroke-linejoin: round;
  }
</style>
