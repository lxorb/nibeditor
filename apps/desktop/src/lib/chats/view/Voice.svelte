<script lang="ts">
  /** A voice message, or any sound a message carries (docs/chats.md 4.8): play, the 64
   *  bars the sender made filling as it plays, a press or a drag on them to seek, and
   *  1×, 1.5×, 2×. The bars are drawn before the sound loads, which it does on the
   *  first press. Transcribe turns it into words on this device's road (the provider
   *  the reader set up, or the account's, as a recording in a note is), shown under it
   *  and never sent. */
  import type { FileRef } from '@nib/chats'
  import { WAVE_BARS } from '@nib/chats/limits'
  import { message as errorWords, t } from '../../i18n.svelte'
  import { clock, seekAt } from './media'
  import Glyph from './Glyph.svelte'
  import { fileUrl } from './urls.svelte'

  const { chat, file }: { chat: string; file: FileRef } = $props()

  const RATES = [1, 1.5, 2] as const

  let audio = $state<HTMLAudioElement>()
  let playing = $state(false)
  let at = $state(0)
  let length = $state(0)
  let rate = $state<(typeof RATES)[number]>(1)
  let words = $state<string | null>(null)
  let hearing = $state(false)
  let bars = $state<HTMLElement>()

  const seconds = $derived(length > 0 ? length : (file.seconds ?? 0))
  const wave = $derived(file.wave?.length ? file.wave : Array.from({ length: WAVE_BARS }, () => 40))
  const done = $derived(seconds > 0 ? at / seconds : 0)

  function toggle() {
    if (!audio) return
    if (playing) audio.pause()
    else void audio.play()
  }

  function seek(event: PointerEvent) {
    if (!audio || !bars) return
    const box = bars.getBoundingClientRect()
    const to = seekAt(event.clientX, box.left, box.width) * seconds
    if (Number.isFinite(to)) audio.currentTime = to
    at = to
  }

  function drag(event: PointerEvent) {
    const node = bars
    if (event.button !== 0 || !node) return
    node.setPointerCapture(event.pointerId)
    seek(event)
    const move = (one: PointerEvent) => seek(one)
    node.addEventListener('pointermove', move)
    node.addEventListener(
      'lostpointercapture',
      () => node.removeEventListener('pointermove', move),
      {
        once: true,
      },
    )
  }

  function step() {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1
    if (audio) audio.playbackRate = rate
  }

  async function transcribe() {
    if (hearing) return
    hearing = true
    try {
      const url = fileUrl(chat, file.hash)
      if (!url) return
      const bytes = await (await fetch(url)).arrayBuffer()
      const { wordsInFile } = await import('../../recorder/transcribe')
      words = (await wordsInFile(bytes)).text
    } catch (error) {
      words = errorWords(error, t('Transcribe'))
    } finally {
      hearing = false
    }
  }
</script>

<div class="voice">
  <button type="button" class="play" aria-label={playing ? t('Pause') : t('Play')} onclick={toggle}>
    <Glyph name={playing ? 'pause' : 'play'} filled />
  </button>
  <div
    class="bars"
    bind:this={bars}
    role="slider"
    tabindex="0"
    aria-label={file.name}
    aria-valuemin={0}
    aria-valuemax={Math.round(seconds)}
    aria-valuenow={Math.round(at)}
    onpointerdown={drag}
    onkeydown={(event) => {
      if (!audio) return
      if (event.key === 'ArrowRight') audio.currentTime = Math.min(seconds, at + 5)
      else if (event.key === 'ArrowLeft') audio.currentTime = Math.max(0, at - 5)
    }}
  >
    {#each wave as bar, index (index)}
      <span
        class="bar"
        class:heard={index / wave.length < done}
        style:height="{Math.max(12, (bar / 255) * 100)}%"
      ></span>
    {/each}
  </div>
  <span class="time">{clock(playing || at > 0 ? at : seconds)}</span>
  <button type="button" class="rate" aria-label={`${rate}×`} onclick={step}>{rate}×</button>
  <button
    type="button"
    class="words"
    class:busy={hearing}
    aria-label={t('Transcribe')}
    onclick={() => void transcribe()}><Glyph name="words" /></button
  >
  <audio
    bind:this={audio}
    src={fileUrl(chat, file.hash)}
    preload="none"
    onplay={() => (playing = true)}
    onpause={() => (playing = false)}
    onended={() => {
      playing = false
      at = 0
    }}
    ontimeupdate={() => (at = audio?.currentTime ?? 0)}
    onloadedmetadata={() => {
      const known = audio?.duration ?? 0
      if (Number.isFinite(known)) length = known
    }}
  ></audio>
</div>
{#if words !== null}
  <p class="heard-words">{words}</p>
{/if}

<style>
  .voice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: min(360px, 100%);
    height: 40px;
    margin-top: var(--space-1);
    padding: 0 var(--space-2) 0 4px;
    border: 1px solid var(--line);
    border-radius: 99px;
    background: var(--surface-2);
  }

  .play {
    --glyph-size: 13px;
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    transition: transform var(--dur-fast) var(--ease-spring);
  }

  .play:active {
    transform: scale(0.92);
  }

  .bars {
    flex: 1;
    min-width: 0;
    height: 24px;
    display: flex;
    align-items: center;
    gap: 1px;
    touch-action: none;
    cursor: pointer;
  }

  .bar {
    flex: 1;
    min-width: 1px;
    border-radius: 1px;
    background: var(--line-strong);
    transition: background var(--dur-fast) var(--ease-out);
  }

  .bar.heard {
    background: var(--accent);
  }

  .time {
    flex: none;
    min-width: 3.2em;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .rate,
  .words {
    --glyph-size: 14px;
    display: grid;
    place-items: center;
    flex: none;
    height: 22px;
    padding: 0 6px;
    border: none;
    border-radius: 99px;
    background: var(--surface-3);
    color: var(--muted-strong);
    font: inherit;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .words.busy {
    opacity: 0.5;
  }

  .heard-words {
    max-width: 360px;
    margin: var(--space-1) 0 0;
    color: var(--muted-strong);
    font-size: var(--text-sm);
    font-style: italic;
  }
</style>
