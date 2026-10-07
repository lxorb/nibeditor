<script lang="ts">
  /** A person's face, everywhere one is drawn: the picture they chose, or their initial
   *  on their accent. Round, where a space's mark is a rounded square, so a person and a
   *  place are told apart by shape before anything is read (Discord's rule).
   *
   *  Five sizes, the ones a face is drawn at (docs/chats.md 4.9): 16 beside a caret's
   *  name, 20 in a tab, 24 in a row, 32 in a list of people, 80 on a card. The 96 px
   *  picture serves every size but the card's, which takes the 512. A dot in the
   *  corner says whether they are here: filled while active, a ring while away, a moon
   *  while they asked for quiet; nothing at all while offline, which is what most
   *  people are most of the time. `mark` is a second thing in the other corner: the
   *  mark of an agent writing for them. */
  import type { Snippet } from 'svelte'
  import { accentColour, accentFor } from '../accents'
  import { initial } from '../icons'
  import { theme } from '../theme.svelte'
  import { faceUrl, type Face, type Presence } from './face'

  const {
    face,
    size = 24,
    presence = null,
    quiet = false,
    mark,
    onpress,
    label,
  }: {
    face: Face
    size?: 16 | 20 | 24 | 32 | 80
    presence?: Presence | null
    /** Do not disturb: the dot is a moon. */
    quiet?: boolean
    mark?: Snippet
    /** A press opens something about them, which makes the face a button. */
    onpress?: ((event: MouseEvent) => void) | undefined
    /** What a screen reader says for a face that is a button. */
    label?: string
  } = $props()

  const url = $derived(faceUrl(size > 32 ? face.avatar?.l : face.avatar?.s))
  /** The picture said it could not be drawn: the initial stands in rather than a
   *  broken image. Forgotten when the picture changes. */
  let failed = $state<string | null>(null)
  let loaded = $state<string | null>(null)

  const fill = $derived(
    face.accent
      ? accentColour(face.accent, theme.current)
      : accentFor(face.key ?? face.name, theme.current),
  )
</script>

<svelte:element
  this={onpress ? 'button' : 'span'}
  class="avatar"
  class:pressable={!!onpress}
  style:--size="{size}px"
  style:--fill={fill}
  {...onpress
    ? { type: 'button', 'aria-label': label ?? face.name, onclick: onpress }
    : { 'aria-hidden': 'true' }}
>
  <span class="face">
    {#if url && failed !== url}
      <img
        src={url}
        alt=""
        draggable="false"
        class:shown={loaded === url}
        onload={() => (loaded = url)}
        onerror={() => (failed = url)}
      />
    {/if}
    {#if !url || failed === url || loaded !== url}
      <span class="initial">{initial(face.name)}</span>
    {/if}
  </span>
  {#if presence && presence !== 'offline'}
    <span class="dot" class:away={presence === 'away' && !quiet} class:quiet></span>
  {/if}
  {#if mark}
    <span class="mark">{@render mark()}</span>
  {/if}
</svelte:element>

<style>
  .avatar {
    position: relative;
    flex: none;
    display: inline-grid;
    width: var(--size);
    height: var(--size);
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    font: inherit;
    line-height: 1;
  }

  .face {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 50%;
    background: var(--fill);
    color: var(--accent-ink);
  }

  /* The picture over the initial, faded in once it has arrived so a slow one is the
     initial and then the face, never a blank. */
  .face > * {
    grid-area: 1 / 1;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
    user-select: none;
    -webkit-user-select: none;
  }

  img.shown {
    opacity: 1;
  }

  .initial {
    font-family: var(--font-ui);
    font-size: calc(var(--size) * 0.46);
    font-weight: var(--weight-strong);
    user-select: none;
    -webkit-user-select: none;
  }

  /* A third of the face across at most, ringed in the ground it sits on so it reads
     as on the face rather than in it. */
  .dot {
    position: absolute;
    inset-inline-end: -1px;
    bottom: -1px;
    width: max(6px, calc(var(--size) * 0.3));
    height: max(6px, calc(var(--size) * 0.3));
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 0 2px var(--avatar-ring, var(--surface));
  }

  .dot.away {
    background: var(--avatar-ring, var(--surface));
    box-shadow:
      0 0 0 2px var(--avatar-ring, var(--surface)),
      inset 0 0 0 1.5px var(--muted);
  }

  /* A moon: the dot with a bite out of its upper corner. */
  .dot.quiet {
    background: radial-gradient(
      circle at 30% 30%,
      var(--avatar-ring, var(--surface)) 34%,
      var(--callout-warning) 36%
    );
  }

  .mark {
    position: absolute;
    inset-inline-start: -2px;
    bottom: -2px;
    display: grid;
    place-items: center;
    width: max(10px, calc(var(--size) * 0.45));
    height: max(10px, calc(var(--size) * 0.45));
    border-radius: 50%;
    background: var(--avatar-ring, var(--surface));
  }

  .pressable {
    cursor: default;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .pressable:active {
    transform: scale(0.94);
  }

  .pressable:focus-visible {
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    img,
    .pressable {
      transition: none;
    }
  }
</style>
