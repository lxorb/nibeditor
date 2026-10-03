<script lang="ts">
  /** Chrome's own mark for a private page, the hat and the glasses, on a private tab and
   *  at the left of its bar: what tells it from every other tab at a glance. See
   *  private.ts. */
  import { fade } from 'svelte/transition'
  import HatGlasses from 'lucide/dist/esm/icons/hat-glasses.mjs'
  import { t } from '../i18n.svelte'
  import { dur } from '../motion'

  const { large = false }: { large?: boolean } = $props()
</script>

<svg
  class="private"
  class:large
  viewBox="0 0 24 24"
  role="img"
  aria-label={t('Private')}
  transition:fade={{ duration: dur(140) }}
>
  <title>{t('Private')}</title>
  {#each HatGlasses as [tag, attrs], at (at)}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>

<style>
  .private {
    width: var(--icon-sm);
    height: var(--icon-sm);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.8;
  }

  .large {
    width: var(--icon-md);
    height: var(--icon-md);
    stroke-width: 1.6;
  }
</style>
