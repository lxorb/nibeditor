<script lang="ts">
  /** The first page of a PDF file card on a canvas. The shared paper cache draws it
   *  once per PDF and lets the thumbnail go when nobody has it mounted. */
  import { paperOf } from './pages/paper'
  import FileMark from './FileMark.svelte'

  const { file, note, root }: { file: string; note: string | null; root: string | null } = $props()

  let sheet = $state<HTMLCanvasElement>()
  let paper = $state.raw<ImageBitmap | null>(null)

  $effect(() => {
    let alive = true
    void paperOf({ file, note, root }, 1).then((drawn) => {
      if (alive) paper = drawn?.image ?? null
    })
    return () => {
      alive = false
      paper = null
    }
  })

  $effect(() => {
    const target = sheet
    const image = paper
    if (!target || !image) return

    target.width = image.width
    target.height = image.height
    target.getContext('2d')?.drawImage(image, 0, 0)
  })

  const name = $derived(file.split(/[\\/]/).pop() ?? file)
</script>

<div class="pdf" aria-label={name}>
  <canvas bind:this={sheet}></canvas>
  <span class="name"><FileMark mark="pdf" /><span>{name}</span></span>
</div>

<style>
  .pdf {
    position: relative;
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: var(--surface);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: white;
  }

  .name {
    position: absolute;
    right: 4px;
    bottom: 4px;
    left: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    color: var(--text-strong);
    font: var(--text-sm) / 1.2 var(--font-ui);
  }

  .name span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
