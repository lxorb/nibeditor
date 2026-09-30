<!-- Whether nib is the default browser, and the press that asks the system to make it
     one: the control on the Default browser row. Chrome's and Edge's shape - a button
     while it is not, the tick the app's menus mark a choice with once it is - and
     nothing at all until the system has answered, so a button never turns into a tick
     in front of somebody.

     How each system asks is src-tauri/src/default_browser.rs. None of them answers
     the press itself: Windows opens its own page and a Mac puts up its own question.
     So the row asks again whenever the window gets the keyboard back, which is the
     moment somebody returns from either, and once more as the press answers, which is
     all Linux needs. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { message, t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { settings } from '../settings.svelte'
  import { invoke } from '../tauri'

  /** What the system said last: yes, no, or nothing yet. */
  let is = $state<boolean | null>(null)

  async function check() {
    is = await invoke<boolean>('default_browser').catch(() => false)
  }

  async function make() {
    settings.error = null
    try {
      await invoke('make_default_browser')
    } catch (error) {
      settings.error = message(error, 'that did not work')
    }
    await check()
  }

  onMount(() => {
    void check()

    let stop: (() => void) | null = null
    let gone = false
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) void check()
        }),
      )
      .then((unlisten) => {
        if (gone) unlisten()
        else stop = unlisten
      })
      // Without the window's own events the row still says what was true when it
      // opened, and reopening the settings asks again.
      .catch(() => undefined)

    return () => {
      gone = true
      stop?.()
    }
  })
</script>

{#if is === true}
  <svg
    class="tick"
    viewBox="0 0 16 16"
    role="img"
    aria-label={t('Default')}
    in:fade={{ duration: dur(120) }}
  >
    <path d="M3 8.5l3.2 3.2L13 5" />
  </svg>
{:else if is === false}
  <button class="nib-chip" in:fade={{ duration: dur(120) }} onclick={() => void make()}>
    {t('Make default')}
  </button>
{/if}

<style>
  /* The tick Select.svelte marks the chosen row with, at the size of a chip's words. */
  .tick {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
