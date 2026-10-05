<script lang="ts">
  /** The question before something running stops; see ask.ts. The prompt's sheet in
   *  shape and motion (PromptSheet.svelte), with the rows that would stop between the
   *  line and the buttons: each wears its tab's mark and name, and a press goes to it. */

  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import Spark from '../agents/ui/Spark.svelte'
  import { closeOnBack } from '../backstack.svelte'
  import { key, t } from '../i18n.svelte'
  import { LAYER } from '../motion'
  import { overlays } from '../overlays'
  import TerminalMark from '../terminal/TerminalMark.svelte'
  import { trap } from '../trap'
  import { quitAsk } from './state.svelte'

  const NAME = 'nibeditor'

  const title = $derived(
    quitAsk.why === 'quit'
      ? t('Quit {name}?', { name: NAME })
      : quitAsk.why === 'restart'
        ? t('Restart {name}?', { name: NAME })
        : t('Close window?'),
  )
  const going = $derived(
    quitAsk.why === 'quit'
      ? key('Quit anyway')
      : quitAsk.why === 'restart'
        ? key('Restart anyway')
        : key('Close anyway'),
  )

  const stay = () => quitAsk.answer('stay')

  $effect(() => closeOnBack(quitAsk.open, stay))
  // Escape stays, like every layer's; see overlays.ts.
  $effect(() => (quitAsk.open ? overlays.show(stay) : undefined))
</script>

{#if quitAsk.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="nib-scrim scrim" transition:fade={{ duration: LAYER.fade }} onclick={stay}></div>

  <div
    class="nib-screen sheet"
    use:trap
    role="alertdialog"
    aria-modal="true"
    aria-label={title}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <p class="title">{title}</p>
    <p class="detail">{t('Running processes will stop.')}</p>

    <ul class="rows">
      {#each quitAsk.rows as row (`${row.window}:${row.id}`)}
        <li>
          <button
            type="button"
            class="nib-row is-short"
            class:is-idle={!row.busy}
            onclick={() => quitAsk.answer(row)}
          >
            {#if row.running}
              <TerminalMark tab={{ doc: row.doc ?? '', running: row.running }} />
            {:else}
              <Spark colour="currentColor" turning />
            {/if}
            <span class="name">{row.name}</span>
          </button>
        </li>
      {/each}
    </ul>

    <div class="row">
      <label class="never">
        <input type="checkbox" class="nib-checkbox" bind:checked={quitAsk.never} />
        {t("Don't ask again")}
      </label>
      <!-- Cancel takes the keyboard, so Enter keeps everything running. -->
      <button type="button" class="nib-button is-quiet" data-lands onclick={stay}
        >{t('Cancel')}</button
      >
      <button type="button" class="nib-button is-danger" onclick={() => quitAsk.answer('go')}
        >{t(going)}</button
      >
    </div>
  </div>
{/if}

<style>
  /* `.nib-screen` in the themes package; the prompt's width and padding. */
  .sheet {
    --screen-width: var(--screen-ask);

    z-index: var(--z-sheet);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
  }

  .title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .detail {
    margin: calc(var(--space-4) * -1 + var(--space-1)) 0 0;
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--muted-strong);
  }

  /* As many as there are, and a scroll past a screenful rather than a sheet taller
     than the window. */
  .rows {
    list-style: none;
    margin: 0 calc(var(--row-pad) * -1);
    padding: 0;
    max-height: 40vh;
    overflow-y: auto;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A shell at its prompt, listed because Settings asks about every terminal. */
  .is-idle {
    color: var(--muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .never {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-inline-end: auto;
    font-size: var(--text-sm);
    color: var(--muted-strong);
  }
</style>
