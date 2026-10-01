<script lang="ts">
  /** Chrome's speaker: a page playing sound, struck through where it is muted. On a web
   *  tab, and on the row of a space whose tabs out of sight are playing; see
   *  workspace/SpaceSound.svelte. */
  import { fade } from 'svelte/transition'
  import { t } from './i18n.svelte'
  import { dur } from './motion'

  const { muted = false }: { muted?: boolean } = $props()
</script>

<svg
  class="sound"
  viewBox="0 0 14 14"
  role="img"
  aria-label={muted ? t('Muted') : t('Playing audio')}
  transition:fade={{ duration: dur(140) }}
>
  <path d="M2.5 5.2h2L7.6 2.8v8.4L4.5 8.8h-2z" />
  <path
    d={muted ? 'M9.6 5.4l3 3m0-3-3 3' : 'M9.8 5a2.9 2.9 0 0 1 0 4M11.6 3.4a5.2 5.2 0 0 1 0 7.2'}
  />
</svg>

<style>
  .sound {
    width: var(--icon-sm);
    height: var(--icon-sm);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.1;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.75;
  }
</style>
