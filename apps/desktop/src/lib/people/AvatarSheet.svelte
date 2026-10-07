<script lang="ts">
  /** The picture somebody chose, dropped, pasted or took, under a round window: dragged
   *  to move, the wheel, a pinch or the slider to zoom, the turn button for a quarter,
   *  Enter or Keep to wear it. Nothing else on it (docs/chats.md 4.15).
   *
   *  The window is the face: what is inside the circle is what everybody sees, at 96 and
   *  512 pixels, made on this device with nothing but pixels in it; see encode.ts. A
   *  camera, where the device has one, is the same window showing the camera until the
   *  shutter is pressed. The arithmetic is crop.ts's. */
  import { onMount } from 'svelte'
  import { message, t } from '../i18n.svelte'
  import Sheet from '../Sheet.svelte'
  import { clampOffset, clampZoom, type Crop, MOST_ZOOM, type Point, scaleAt, zoomed } from './crop'
  import { decode, prepared } from './encode'
  import { wearFace } from './mine'

  const {
    source,
    onclose,
  }: {
    /** A picture to start from, or the camera. */
    source: { file: Blob } | { camera: true }
    onclose: () => void
  } = $props()

  /** The window's side, in pixels: the size the card's face is drawn at, three times. */
  const VIEW = 240

  let bitmap = $state<ImageBitmap | null>(null)
  let turns = $state(0)
  let picture = $state<HTMLCanvasElement | null>(null)
  let crop = $state<Crop>({ zoom: 1, offset: { x: 0, y: 0 } })
  let busy = $state(false)
  let wrong = $state<string | null>(null)
  let stream = $state<MediaStream | null>(null)
  let video = $state<HTMLVideoElement>()

  const scale = $derived(picture ? scaleAt(picture.width, picture.height, VIEW, crop.zoom) : 1)

  async function take(file: Blob) {
    wrong = null
    try {
      const decoded = await decode(file)
      stopCamera()
      bitmap?.close()
      bitmap = decoded
      turns = 0
      picture = prepared(decoded, 0)
      crop = { zoom: 1, offset: { x: 0, y: 0 } }
    } catch (error) {
      wrong = message(error, 'that picture could not be opened')
    }
  }

  function turn() {
    if (!bitmap) return
    turns = (turns + 1) % 4
    picture = prepared(bitmap, turns)
    crop = {
      zoom: crop.zoom,
      offset: clampOffset({ x: 0, y: 0 }, picture.width, picture.height, VIEW, crop.zoom),
    }
  }

  function moveTo(offset: Point) {
    if (!picture) return
    crop = {
      zoom: crop.zoom,
      offset: clampOffset(offset, picture.width, picture.height, VIEW, crop.zoom),
    }
  }

  function zoomTo(zoom: number, at: Point = { x: 0, y: 0 }) {
    if (!picture) return
    crop = zoomed(crop, zoom, at, picture.width, picture.height, VIEW)
  }

  async function keep() {
    if (!picture || busy) return
    busy = true
    wrong = null
    try {
      await wearFace(picture, crop, VIEW)
      onclose()
    } catch (error) {
      wrong = message(error, 'that did not work')
    } finally {
      busy = false
    }
  }

  /* ── The camera ─────────────────────────────────────────────────────── */

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 } },
        audio: false,
      })
    } catch (error) {
      wrong = message(error, 'the camera could not be opened')
    }
  }

  function stopCamera() {
    for (const track of stream?.getTracks() ?? []) track.stop()
    stream = null
  }

  /** The frame on screen, as the picture: mirrored the way the preview was, which is
   *  how a person expects to see their own face. */
  async function shutter() {
    if (!video?.videoWidth) return
    const frame = document.createElement('canvas')
    frame.width = video.videoWidth
    frame.height = video.videoHeight
    const context = frame.getContext('2d')
    if (!context) return
    context.translate(frame.width, 0)
    context.scale(-1, 1)
    context.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>((done) => {
      frame.toBlob(done, 'image/png')
    })
    if (blob) await take(blob)
  }

  $effect(() => {
    if (video && stream) video.srcObject = stream
  })

  onMount(() => {
    if ('file' in source) void take(source.file)
    else void startCamera()
    return () => {
      stopCamera()
      bitmap?.close()
    }
  })

  /* ── The hand ───────────────────────────────────────────────────────── */

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- the pointers down now; nothing renders from them
  const down = new Map<number, Point>()
  let pinch: { distance: number; zoom: number } | null = null

  /** A point of the window, from its middle. */
  function fromMiddle(event: PointerEvent | WheelEvent, box: Element): Point {
    const rect = box.getBoundingClientRect()
    return {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    }
  }

  function pressed(event: PointerEvent) {
    if (!picture) return
    ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
    down.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (down.size === 2) {
      const [a, b] = [...down.values()]
      if (a && b) pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: crop.zoom }
    }
  }

  function moved(event: PointerEvent) {
    const was = down.get(event.pointerId)
    if (!was) return
    const now = { x: event.clientX, y: event.clientY }
    down.set(event.pointerId, now)

    if (down.size === 2 && pinch) {
      const [a, b] = [...down.values()]
      if (a && b) zoomTo(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance))
      return
    }
    moveTo({ x: crop.offset.x + now.x - was.x, y: crop.offset.y + now.y - was.y })
  }

  function lifted(event: PointerEvent) {
    down.delete(event.pointerId)
    if (down.size < 2) pinch = null
  }

  function wheeled(event: WheelEvent) {
    event.preventDefault()
    zoomTo(
      crop.zoom * Math.exp(-event.deltaY / 400),
      fromMiddle(event, event.currentTarget as Element),
    )
  }

  /** A picture pasted or dropped onto the sheet takes the place of the one there. */
  function given(files: FileList | null | undefined) {
    const file = [...(files ?? [])].find((one) => one.type.startsWith('image/'))
    if (file) void take(file)
  }

  /** Puts the prepared picture in the window: it is a canvas already, so it is shown as
   *  itself rather than encoded again to be looked at. */
  function shows(host: HTMLElement, canvas: HTMLCanvasElement) {
    host.replaceChildren(canvas)
    return {
      update(next: HTMLCanvasElement) {
        host.replaceChildren(next)
      },
    }
  }
</script>

<svelte:window
  onpaste={(event: ClipboardEvent) => {
    given(event.clipboardData?.files)
  }}
/>

<Sheet open title={t('Profile picture')} {onclose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="stage"
    ondragover={(event) => event.preventDefault()}
    ondrop={(event) => {
      event.preventDefault()
      given(event.dataTransfer?.files)
    }}
    onkeydown={(event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      void keep()
    }}
  >
    <div
      class="window"
      style:--view="{VIEW}px"
      role="img"
      aria-label={t('Profile picture')}
      onpointerdown={pressed}
      onpointermove={moved}
      onpointerup={lifted}
      onpointercancel={lifted}
      onwheel={wheeled}
    >
      {#if stream}
        <video class="live" bind:this={video} autoplay playsinline muted></video>
      {:else if picture}
        <div
          class="picture"
          style:width="{picture.width * scale}px"
          style:height="{picture.height * scale}px"
          style:transform="translate(calc(-50% + {crop.offset.x}px), calc(-50% + {crop.offset
            .y}px))"
          use:shows={picture}
        ></div>
      {/if}
      <span class="ring" aria-hidden="true"></span>
    </div>

    {#if stream}
      <button class="nib-button shutter" onclick={() => void shutter()}>{t('Take photo')}</button>
    {:else}
      <div class="controls">
        <input
          class="nib-slider zoom"
          type="range"
          min="1"
          max={MOST_ZOOM}
          step="0.01"
          value={crop.zoom}
          aria-label={t('Zoom')}
          style:--fill="{((crop.zoom - 1) / (MOST_ZOOM - 1)) * 100}%"
          disabled={!picture}
          oninput={(event) => zoomTo(clampZoom(Number(event.currentTarget.value)))}
        />
        <button
          class="nib-glyph"
          title={t('Rotate')}
          aria-label={t('Rotate')}
          disabled={!picture}
          onclick={turn}
        >
          <svg viewBox="0 0 16 16"
            ><path d="M13 8a5 5 0 1 1-1.6-3.7" /><path d="M13 2.5v3h-3" /></svg
          >
        </button>
      </div>
    {/if}

    {#if wrong}<p class="wrong">{wrong}</p>{/if}
  </div>

  {#snippet foot()}
    <button class="nib-button" disabled={!picture || busy || !!stream} onclick={() => void keep()}
      >{t('Keep')}</button
    >
  {/snippet}
</Sheet>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0 var(--space-3);
  }

  /* The square the face is cut from, with the circle over it: what is outside the
     circle is dimmed rather than hidden, so where the picture goes on is still seen. */
  .window {
    position: relative;
    width: var(--view);
    height: var(--view);
    overflow: hidden;
    border-radius: var(--radius-md);
    background: var(--surface-3);
    touch-action: none;
    cursor: grab;
  }

  .window:active {
    cursor: grabbing;
  }

  .picture {
    position: absolute;
    top: 50%;
    left: 50%;
  }

  .picture :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .live {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }

  .ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    box-shadow: 0 0 0 calc(var(--view) / 2) rgb(0 0 0 / 0.45);
    outline: 2px solid rgb(255 255 255 / 0.85);
    outline-offset: -2px;
    pointer-events: none;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: var(--view);
  }

  .zoom {
    flex: 1;
  }

  .wrong {
    margin: 0;
    color: var(--danger);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }
</style>
