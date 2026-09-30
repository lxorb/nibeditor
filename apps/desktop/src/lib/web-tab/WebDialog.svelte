<script lang="ts">
  /** A page's own dialog: what it says with `alert`, asks with `confirm` and `prompt`,
   *  and asks as it is left.
   *
   *  Chrome's shape, in nib's clothes, because everybody has answered these a thousand
   *  times: a card at the top of the page, naming the site, with the page's own words and
   *  the answers a browser gives - OK alone for an alert, Cancel and OK for the others,
   *  Cancel and Leave for a page that would rather not be left. The page's script waits
   *  on it; see dialogs.svelte.ts and src-tauri/src/web_dialogs.rs.
   *
   *  It is the app's own HTML, so the page steps out of sight while it is up, the way it
   *  does for the site's permission bubble: it goes on the overlay stack, and Escape -
   *  the stack's own key - is Cancel. */

  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from '../i18n.svelte'
  import { keyboardHere } from '../keyboard-here'
  import { dur } from '../motion'
  import { overlays } from '../overlays'
  import { isDesktop } from '../tauri'
  import type { Dialog } from './dialogs.svelte'
  import { dialogs } from './dialogs.svelte'

  const { dialog, icon }: { dialog: Dialog; icon: string | null } = $props()

  let marked = $state(true)
  let answering = $state<HTMLButtonElement>()
  let field = $state<HTMLInputElement>()
  let text = $state('')

  $effect(() => overlays.show(() => dialogs.answer(dialog, false)))

  // The keyboard is the card's while it is up, on the answer a browser puts it on - OK,
  // or the prompt's field - so Enter answers the way it does in Chrome. The page opened
  // it, so the keyboard is almost always in the page, which keeps it while it is out of
  // sight: the app's own webview takes it back first, as the permission bubble does.
  onMount(() => {
    text = dialog.text
    if (field) {
      field.focus({ preventScroll: true })
      field.select()
    } else {
      answering?.focus({ preventScroll: true })
    }
    if (isDesktop && !document.hasFocus()) void keyboardHere()
  })
</script>

<div
  class="dialog nib-bubble is-pressable"
  role="alertdialog"
  aria-label={dialog.site}
  transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
>
  <p class="who">
    {#if icon && marked}
      <img class="mark" src={icon} alt="" draggable="false" onerror={() => (marked = false)} />
    {/if}
    <strong
      >{dialog.kind === 'leave' ? t('Leave {name}?', { name: dialog.site }) : dialog.site}</strong
    >
  </p>
  {#if dialog.kind !== 'leave' && dialog.message}
    <p class="said">{dialog.message}</p>
  {/if}

  {#if dialog.kind === 'prompt'}
    <form
      onsubmit={(event) => {
        event.preventDefault()
        dialogs.answer(dialog, true, text)
      }}
    >
      <input class="nib-field" bind:this={field} bind:value={text} spellcheck="false" />
    </form>
  {/if}

  <div class="rows">
    {#if dialog.kind !== 'alert'}
      <button class="nib-button is-quiet" onclick={() => dialogs.answer(dialog, false)}>
        {t('Cancel')}
      </button>
    {/if}
    <button
      class="nib-button"
      bind:this={answering}
      onclick={() => dialogs.answer(dialog, true, text)}
    >
      {dialog.kind === 'leave' ? t('Leave') : t('OK')}
    </button>
  </div>
</div>

<style>
  /* At the top of the page, in the middle, where a browser puts a page's own dialog:
     it is the page speaking, not the address, so it sits over the page rather than
     under the address field the way the permission bubble does. */
  .dialog {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: var(--z-float);
    margin-inline: auto;
    width: min(26rem, calc(100% - var(--space-4)));
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .who {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .mark {
    width: var(--icon-md);
    height: var(--icon-md);
    border-radius: var(--radius-sm);
  }

  /* The page's own words, which may be several lines of them: kept as it wrote them,
     and scrolled rather than let past the pane. */
  .said {
    margin: 0;
    max-height: 40vh;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  form {
    margin: var(--space-1) 0 0;
  }

  form .nib-field {
    width: 100%;
  }

  .rows {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
