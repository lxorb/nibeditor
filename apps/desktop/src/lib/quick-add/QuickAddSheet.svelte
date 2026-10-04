<script lang="ts">
  /** Quick add inside the app: the field, over whatever is open, where the palette
   *  stands, so choosing Add task in the palette reads as its field turning into this
   *  one. Opened by its key, the palette's row and a view's add button; see
   *  asked.svelte.ts. Enter keeps it up for the next task, as Todoist's does. */
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from '../backstack.svelte'
  import { i18n, t } from '../i18n.svelte'
  import { LAYER } from '../motion'
  import { overlays } from '../overlays'
  import { trap } from '../trap'
  import { workspace } from '../workspace.svelte'
  import { quickAdd } from './asked.svelte'
  import type { Entry } from './entry'
  import QuickAdd from './QuickAdd.svelte'
  import { addTask, noteNames } from './write'

  const root = $derived(workspace.activeSpace?.root ?? null)
  const notes = $derived(quickAdd.open && root ? noteNames(root) : [])

  // Escape closes it, like everything else the app puts over a note; see overlays.ts.
  // And a phone's back, which closes every layer.
  $effect(() => (quickAdd.open ? overlays.show(() => quickAdd.hide()) : undefined))
  $effect(() => closeOnBack(quickAdd.open, () => quickAdd.hide()))

  async function added(entry: Entry, open: boolean) {
    if (open) quickAdd.hide()
    await addTask(entry, { open })
  }
</script>

{#if quickAdd.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => quickAdd.hide()}
  ></div>
  <div
    class="nib-screen sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={t('Add task')}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <QuickAdd
      langs={[i18n.language]}
      {notes}
      prefill={quickAdd.prefill}
      smart={quickAdd.smart}
      onsubmit={added}
      onclose={() => quickAdd.hide()}
    />
  </div>
{/if}

<style>
  .scrim {
    --scrim-z: var(--z-screen);
  }

  .sheet {
    --screen-width: var(--screen-list);

    z-index: var(--z-screen);
  }
</style>
