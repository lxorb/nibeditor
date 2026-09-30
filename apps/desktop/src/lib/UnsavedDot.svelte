<script lang="ts">
  /** The dot of a document with no file yet; `.nib-unsaved` in the themes package. */
  import { fade } from 'svelte/transition'
  import { t } from './i18n.svelte'
  import { dur } from './motion'

  const { corner = false, pressable = false }: { corner?: boolean; pressable?: boolean } = $props()
</script>

<span
  class="nib-unsaved"
  class:is-corner={corner}
  class:is-pressable={pressable}
  role="img"
  aria-label={t('Unsaved')}
  title={t('Unsaved')}
  transition:fade={{ duration: dur(140) }}
></span>
