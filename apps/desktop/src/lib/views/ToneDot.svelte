<script lang="ts">
  /** A tone as a dot to press: the option's or the rule's colour, and, pressed, the
   *  theme's six beside it to pick from (CanvasColours, the one row of colours the app
   *  has), with no colour at all as the seventh. A base's tones are the theme's own,
   *  so nothing here mixes a colour of its own (docs/tasks.md 5.19). */
  import CanvasColours from '../CanvasColours.svelte'
  import { t } from '../i18n.svelte'
  import { toneColour } from './chips'

  const { tone, ontone }: { tone: string | undefined; ontone: (tone: string | null) => void } =
    $props()

  let open = $state(false)
  const colour = $derived(toneColour(tone))
</script>

<span class="tone">
  <button
    type="button"
    class="dot"
    class:none={colour === null}
    style:--dot={colour}
    title={t('Colour')}
    aria-label={t('Colour')}
    aria-expanded={open}
    onclick={() => (open = !open)}
  ></button>
  {#if open}
    <span class="pick nib-layer">
      <CanvasColours
        colour={tone ?? null}
        wheel={false}
        oncolour={(next) => {
          open = false
          ontone(next)
        }}
      />
    </span>
  {/if}
</span>

<style>
  .tone {
    position: relative;
    display: inline-grid;
    place-items: center;
  }

  .dot {
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
    transition: scale var(--dur-fast) var(--ease-spring);
  }

  .dot.none {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--muted);
  }

  .dot:hover {
    scale: 1.12;
  }

  .pick {
    position: absolute;
    top: calc(100% + 4px);
    inset-inline-start: 0;
    z-index: var(--z-popover);
    padding: var(--space-1);
  }
</style>
