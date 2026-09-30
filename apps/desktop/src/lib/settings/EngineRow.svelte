<!-- The engine web tabs run on: the system's own, or nib's own Chromium. The control on
     the Engine row of Settings > General > Browser.

     Chrome's shape for a setting that needs a new start: the choice is made on the spot,
     and a Relaunch chip appears beside it until the app is started again, which is what
     the relaunch does - every window asked as by Quit, every note saved, and the app back
     on the other engine with its tabs where they were. Chromium is fetched the first
     time it is chosen, with a ring in the chip's place that fills as it arrives and stops
     it when pressed; choosing the system's engine again stops it too.

     What the row can say comes from the crate (src-tauri/src/engine_switch.rs) and what
     it offers from `beside` in engine.ts. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { message, t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { settings } from '../settings.svelte'
  import { segmented } from '../slide'
  import { invoke, platform } from '../tauri'
  import { beside, systemName, type Engine, type EngineState } from './engine'

  let state = $state<EngineState | null>(null)
  let fetching = $state(false)
  /** How much of Chromium has arrived, from nought to one. */
  let arrived = $state(0)

  const system = systemName(platform())
  const next = $derived(state ? beside(state, fetching) : 'nothing')

  async function fetchChromium() {
    fetching = true
    arrived = 0
    try {
      state = await invoke<EngineState>('engine_fetch')
    } catch (error) {
      // A fetch that was stopped says nothing; one that failed says why, and the choice
      // goes back to the engine that is running.
      if (fetching && state) {
        settings.error = message(error, 'that did not work')
        state = await invoke<EngineState>('engine_choose', { engine: state.running })
      }
    } finally {
      fetching = false
    }
  }

  async function choose(engine: Engine) {
    if (!state || state.chosen === engine) return
    settings.error = null
    if (fetching) {
      fetching = false
      await invoke('engine_cancel').catch(() => undefined)
    }
    try {
      state = await invoke<EngineState>('engine_choose', { engine })
    } catch (error) {
      settings.error = message(error, 'that did not work')
      return
    }
    if (engine === 'chromium' && !state.installed) await fetchChromium()
  }

  function stop() {
    void choose(state?.running ?? 'system')
  }

  function relaunch() {
    void invoke('engine_relaunch').catch((error: unknown) => {
      settings.error = message(error, 'that did not work')
    })
  }

  onMount(() => {
    let gone = false
    let unlisten: (() => void) | null = null

    void invoke<EngineState>('engine_state')
      .then((said) => {
        state = said
        if (said.fellBack) settings.error = 'Chromium did not start'
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

{#if state?.offered && system}
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
          aria-checked={state.chosen === value}
          class:on={state.chosen === value}
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
