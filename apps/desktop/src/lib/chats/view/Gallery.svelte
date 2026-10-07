<script lang="ts">
  /** A message's pictures and videos (docs/chats.md 4.8): one alone as wide as the
   *  column allows and never taller than 360, two to six as a grid, more as six with a
   *  count on the last. Each is the sender's 480 px preview at the size the sender
   *  stated, so the row is already the right height before anything loads; a press opens
   *  the lightbox. A video plays in place over its first frame. */
  import type { FileRef } from '@nib/chats'
  import { amount } from '../../i18n.svelte'
  import { fitted, gallery, isVideo } from './media'
  import { fileUrl } from './urls.svelte'

  const {
    chat,
    files,
    column,
    onopen,
  }: {
    chat: string
    files: FileRef[]
    column: number
    onopen: (index: number) => void
  } = $props()

  const url = (file: FileRef) => fileUrl(chat, file.preview ?? file.hash)
  const single = $derived(files.length === 1 ? files[0] : undefined)
  const size = $derived(single ? fitted(single, column) : null)
  const grid = $derived(gallery(files))
</script>

{#if single && size}
  {#if isVideo(single)}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      class="one"
      src={fileUrl(chat, single.hash)}
      poster={single.preview ? url(single) : undefined}
      controls
      preload="none"
      style:width="{size.width}px"
      style:height="{size.height}px"
    ></video>
  {:else}
    <button
      type="button"
      class="one picture"
      style:width="{size.width}px"
      style:height="{size.height}px"
      aria-label={single.name}
      onclick={() => onopen(0)}
    >
      <img src={url(single)} alt="" draggable="false" loading="lazy" decoding="async" />
    </button>
  {/if}
{:else if files.length > 1}
  <div class="grid" style:--across={grid.across} style:width="{Math.min(column, 480)}px">
    {#each grid.shown as file, index (`${file.hash}:${index}`)}
      <button
        type="button"
        class="cell picture"
        aria-label={file.name}
        onclick={() => onopen(index)}
      >
        <img src={url(file)} alt="" draggable="false" loading="lazy" decoding="async" />
        {#if isVideo(file)}<span class="play" aria-hidden="true">▶</span>{/if}
        {#if index === grid.shown.length - 1 && grid.more > 0}
          <span class="more">+{amount(grid.more)}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .one,
  .grid {
    display: block;
    margin-top: var(--space-1);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface-2);
  }

  .picture {
    padding: 0;
    border: none;
    cursor: zoom-in;
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform var(--dur-slow) var(--ease-out);
  }

  @media (hover: hover) {
    .picture:hover img {
      transform: scale(1.02);
    }
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(var(--across), 1fr);
    gap: 2px;
  }

  .cell {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    background: var(--surface-3);
  }

  .more,
  .play {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--accent-ink);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
  }

  /* The count of the rest, and a video's mark: the ink on the accent, over the picture. */
  .more {
    background: color-mix(in srgb, var(--accent) 72%, transparent);
  }

  .play {
    inset: auto;
    top: 50%;
    left: 50%;
    translate: -50% -50%;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--accent);
    font-size: var(--text-sm);
  }
</style>
