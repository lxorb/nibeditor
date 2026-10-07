<script lang="ts">
  /** A message's pictures, one at a time, over everything (docs/chats.md 4.8): the
   *  original as it arrives over the preview already drawn, ← and → (or a swipe) between
   *  them, a press to see it at its own size and again to fit it, Save, and Escape, back
   *  or the scrim to leave. */
  import type { FileRef } from '@nib/chats'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from '../../backstack.svelte'
  import { t } from '../../i18n.svelte'
  import { LAYER } from '../../motion'
  import { overlays } from '../../overlays'
  import Glyph from './Glyph.svelte'
  import { isVideo } from './media'
  import { fileUrl } from './urls.svelte'

  const {
    chat,
    files,
    start,
    onclose,
  }: { chat: string; files: FileRef[]; start: number; onclose: () => void } = $props()

  // svelte-ignore state_referenced_locally
  let index = $state(start)
  let zoomed = $state(false)
  let swipeFrom: number | null = null

  const file = $derived(files[index])

  function go(by: number) {
    const next = index + by
    if (next < 0 || next >= files.length) return
    index = next
    zoomed = false
  }

  $effect(() => overlays.show(onclose))
  $effect(() => closeOnBack(true, onclose))

  /** A swipe of more than a thumb's width is the next picture, or the one before. */
  function swiped(event: PointerEvent) {
    if (swipeFrom === null) return
    const moved = event.clientX - swipeFrom
    swipeFrom = null
    if (Math.abs(moved) > 60) go(moved < 0 ? 1 : -1)
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') go(1)
    else if (event.key === 'ArrowLeft') go(-1)
    else return
    event.preventDefault()
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="lightbox" role="dialog" aria-modal="true" aria-label={file?.name ?? ''}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" transition:fade={{ duration: LAYER.fade }} onclick={onclose}></div>
  {#if file}
    {#key file.hash}
      <div
        class="stage"
        role="group"
        class:zoomed
        transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
        onpointerdown={(event) => (swipeFrom = event.clientX)}
        onpointerup={swiped}
      >
        {#if isVideo(file)}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={fileUrl(chat, file.hash)} controls autoplay></video>
        {:else}
          <button
            type="button"
            class="picture"
            aria-label={file.name}
            onclick={() => (zoomed = !zoomed)}
          >
            <img
              src={fileUrl(chat, file.hash)}
              alt=""
              draggable="false"
              style:background-image={file.preview
                ? `url("${fileUrl(chat, file.preview)}")`
                : undefined}
            />
          </button>
        {/if}
      </div>
    {/key}
  {/if}

  <div class="bar" transition:fade={{ duration: LAYER.fade }}>
    {#if files.length > 1}
      <span class="count">{index + 1} / {files.length}</span>
    {/if}
    {#if file}
      <a
        class="nib-glyph"
        href={fileUrl(chat, file.hash)}
        download={file.name}
        aria-label={t('Save')}
        title={t('Save')}><Glyph name="save" /></a
      >
    {/if}
    <button type="button" class="nib-glyph" aria-label={t('Close')} onclick={onclose}
      ><Glyph name="close" /></button
    >
  </div>
  {#if index > 0}
    <button
      type="button"
      class="nib-glyph side left"
      aria-label={t('Previous')}
      onclick={() => go(-1)}><Glyph name="left" /></button
    >
  {/if}
  {#if index < files.length - 1}
    <button type="button" class="nib-glyph side right" aria-label={t('Next')} onclick={() => go(1)}
      ><Glyph name="right" /></button
    >
  {/if}
</div>

<style>
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: var(--z-lightbox);
    display: grid;
    place-items: center;
  }

  .scrim {
    position: absolute;
    inset: 0;
    background: rgb(0 0 0 / 82%);
  }

  .stage {
    position: relative;
    max-width: 92vw;
    max-height: 86vh;
    display: grid;
    place-items: center;
    touch-action: pan-y;
  }

  .stage.zoomed {
    max-width: 100vw;
    max-height: 100vh;
    overflow: auto;
  }

  .picture {
    padding: 0;
    border: none;
    background: none;
    cursor: zoom-in;
  }

  .zoomed .picture {
    cursor: zoom-out;
  }

  img,
  video {
    display: block;
    max-width: 92vw;
    max-height: 86vh;
    border-radius: var(--radius-md);
    background-size: cover;
    box-shadow: var(--shadow-lg);
  }

  .zoomed img {
    max-width: none;
    max-height: none;
  }

  .bar {
    position: absolute;
    top: calc(var(--space-3) + var(--inset-top));
    right: var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  .count {
    margin-inline: var(--space-2);
    color: var(--muted-strong);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .side {
    position: absolute;
    top: 50%;
    translate: 0 -50%;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  .side.left {
    left: var(--space-4);
  }

  .side.right {
    right: var(--space-4);
  }
</style>
