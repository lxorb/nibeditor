<!-- The engine web tabs run on: the system's own, or nib's own Chromium. The control on
     the Engine row of Settings > General > Browser.

     Chrome's shape for a setting that needs a new start: the choice is made on the spot,
     and a Relaunch chip appears beside it until the app is started again, which is what
     the relaunch does - every window asked as by Quit, every note saved, and the app back
     on the other engine with its tabs where they were. Chromium is fetched the first
     time it is chosen, with a ring in the chip's place that fills as it arrives and stops
     it when pressed; choosing the system's engine again stops it too.

     What the row can say comes from the crate (src-tauri/src/engine_switch.rs) and what
     it offers from `beside` in engine.ts. A fetch that fails says why in a few words
     under the row's name (`onproblem`, `said` in engine.ts) and the whole of it in the
     log. On the rolling build of main the release has often moved on to the next
     version; where that version is the update already downloaded, its Chromium is
     fetched instead and Relaunch starts the update, on Chromium. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { message, t } from '../i18n.svelte'
  import { log } from '../log'
  import { dur } from '../motion'
  import { segmented } from '../slide'
  import { invoke, platform } from '../tauri'
  import { fetchEngineFor, restartToUpdate, stagedVersion } from '../updater'
  import { updates } from '../updates.svelte'
  import {
    beside,
    isRefused,
    movedTo,
    said,
    systemName,
    type Engine,
    type EngineState,
  } from './engine'

  /** Hands what went wrong last, in the row's own words, to the row's name to show;
   *  the empty string once there is nothing to say. */
  const { onproblem }: { onproblem: (problem: string) => void } = $props()

  let engines = $state<EngineState | null>(null)
  let fetching = $state(false)
  /** How much of Chromium has arrived, from nought to one. */
  let arrived = $state(0)
  /** Chromium fetched for the update waiting to be installed, not for this version. */
  let withUpdate = $state(false)

  const system = systemName(platform())
  const next = $derived(engines ? beside(engines, fetching, withUpdate) : 'nothing')

  /** Which fetch is the one running: stopping it moves this on, so its end is not
   *  taken for a failure. */
  let fetches = 0

  async function fetchChromium() {
    const mine = ++fetches
    fetching = true
    arrived = 0
    try {
      engines = await invoke<EngineState>('engine_fetch').catch(async (error: unknown) => {
        const version = movedTo(error)
        if (!version || !(await updateBrings(version))) throw error
        const fetched = (await fetchEngineFor(version)) as EngineState
        withUpdate = true
        return fetched
      })
    } catch (error) {
      // A fetch that was stopped says nothing; one that failed says why, and the choice
      // goes back to the engine that is running.
      if (mine === fetches && engines) {
        fail(error)
        engines = await invoke<EngineState>('engine_choose', { engine: engines.running })
      }
    } finally {
      if (mine === fetches) fetching = false
    }
  }

  /** Whether the update waiting to be installed is `version`, looked for first where
   *  none has been downloaded yet. */
  async function updateBrings(version: string): Promise<boolean> {
    if (stagedVersion() !== version) await updates.check()
    arrived = 0
    return stagedVersion() === version
  }

  function fail(error: unknown) {
    if (isRefused(error)) {
      log('error', `engine: ${error.reason}: ${error.detail}`)
      onproblem(said(error))
    } else {
      log('error', `engine: ${String(error)}`)
      onproblem(message(error, 'that did not work'))
    }
  }

  async function choose(engine: Engine) {
    if (!engines || engines.chosen === engine) return
    onproblem('')
    withUpdate = false
    if (fetching) {
      fetches += 1
      fetching = false
      await invoke('engine_cancel').catch(() => undefined)
    }
    try {
      engines = await invoke<EngineState>('engine_choose', { engine })
    } catch (error) {
      fail(error)
      return
    }
    if (engine === 'chromium' && !engines.installed) await fetchChromium()
  }

  function stop() {
    void choose(engines?.running ?? 'system')
  }

  function relaunch() {
    if (withUpdate) void restartToUpdate()
    else void invoke('engine_relaunch').catch(fail)
  }

  onMount(() => {
    let gone = false
    let unlisten: (() => void) | null = null

    void invoke<EngineState>('engine_state')
      .then((state) => {
        engines = state
        if (state.fellBack) onproblem('Chromium did not start')
      })
      .catch(() => undefined)

    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<{ done: number; total: number }>('nib://engine-progress', ({ payload }) => {
          if (payload.total > 0) arrived = Math.min(1, payload.done / payload.total)
        }),
      )
      .then((stop) => {
        if (gone) stop()
        else unlisten = stop
      })
      .catch(() => undefined)

    return () => {
      gone = true
      unlisten?.()
    }
  })
</script>

{#if engines?.offered && system}
  <div class="engine">
    {#if next === 'relaunch'}
      <button class="nib-chip" in:fade={{ duration: dur(120) }} onclick={relaunch}>
        {t('Relaunch')}
      </button>
    {:else if next === 'fetching'}
      <button
        class="ring"
        in:fade={{ duration: dur(120) }}
        aria-label={t('Stop')}
        title={t('Stop')}
        onclick={stop}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle class="track" cx="8" cy="8" r="6" />
          <circle
            class="fill"
            cx="8"
            cy="8"
            r="6"
            pathLength="1"
            stroke-dasharray="1"
            stroke-dashoffset={1 - arrived}
          />
        </svg>
      </button>
    {/if}
    <div class="nib-segmented" role="radiogroup" aria-label={t('Engine')} use:segmented>
      {#each [['chromium', 'Chromium'], ['system', system]] as [value, label] (value)}
        <button
          type="button"
          role="radio"
          aria-checked={engines.chosen === value}
          class:on={engines.chosen === value}
          onclick={() => void choose(value as Engine)}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .engine {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* The download's ring, in the Relaunch chip's place and a chip's round shape. */
  .ring {
    display: grid;
    flex: none;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 99px;
    background: none;
    color: var(--accent);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .ring:hover {
      background: var(--surface-hover);
    }
  }

  .ring:active {
    background: var(--accent-soft);
  }

  .ring svg {
    width: 16px;
    height: 16px;
    transform: rotate(-90deg);
    fill: none;
    stroke-width: 2;
  }

  .track {
    stroke: var(--line);
  }

  .fill {
    stroke: currentColor;
    stroke-linecap: round;
    transition: stroke-dashoffset var(--dur-fast) var(--ease-out);
  }
</style>
