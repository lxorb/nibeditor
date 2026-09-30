<script lang="ts">
  /** The accent colours as a row of dots, the way GNOME and a Mac offer them: in
   *  Settings under the theme, and at the foot of the theme picker. One row in both,
   *  so the dots are the same size, the same ring and the same order wherever a
   *  colour is chosen.
   *
   *  Each dot is drawn in the shade the scheme on screen needs, which is the shade
   *  the app will wear. `onpoint` is the picker's: a dot under the pointer is tried
   *  on the whole app, and null gives the kept one back. */
  import { t } from './i18n.svelte'
  import { theme } from './theme.svelte'

  const {
    chosen,
    onchoose,
    onpoint,
  }: {
    chosen: string
    onchoose: (id: string) => void
    onpoint?: ((id: string | null) => void) | undefined
  } = $props()
</script>

<div class="accents" role="group" aria-label={t('Accent')} onpointerleave={() => onpoint?.(null)}>
  {#each theme.accents as swatch (swatch.id)}
    <button
      type="button"
      class="swatch"
      class:active={chosen === swatch.id}
      title={t(swatch.name)}
      aria-label={t(swatch.name)}
      aria-pressed={chosen === swatch.id}
      style:--swatch={swatch[theme.current]}
      onpointermove={() => onpoint?.(swatch.id)}
      onclick={() => onchoose(swatch.id)}
    ></button>
  {/each}
</div>

<style>
  .accents {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .swatch {
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--swatch);
    cursor: default;
    /* Only the swatch under the pointer moves, and it moves plainly. The ring
       marking the chosen one is a state rather than a movement, so it is left
       out of the transition: it should appear, not grow. */
    transition: transform var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .swatch:hover {
      transform: scale(1.12);
    }
  }

  /* A ring rather than a tick: the colour is the whole point of the control. */
  .swatch.active {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--swatch);
  }

  /* A thumb's worth each, on a touch screen. */
  :global([data-touch]) .accents {
    gap: 12px;
  }

  :global([data-touch]) .swatch {
    width: var(--touch-target);
    height: var(--touch-target);
  }
</style>
