<script lang="ts">
  /** What a column is called in this base: Bases' `properties.<key>.displayName`, which
   *  Obsidian shows too. The property in the notes keeps its own name; emptied, the
   *  column is called by that again. */
  import { t } from '../i18n.svelte'
  import { displayName } from './columns'
  import { setDisplayName } from './edit'
  import type { Kit } from './kit'
  import { propertyName } from './words'

  const { kit, column }: { kit: Kit; column: string } = $props()

  const base = $derived(kit.live.base)
</script>

<!-- svelte-ignore a11y_autofocus -->
<input
  class="nib-field"
  value={base ? (displayName(base, column) ?? '') : ''}
  placeholder={propertyName(column)}
  aria-label={t('Rename')}
  autofocus
  onchange={(event) => {
    const words = event.currentTarget.value
    kit.change((one) => setDisplayName(one, column, words))
  }}
  onkeydown={(event) => {
    if (event.key === 'Enter') event.currentTarget.blur()
  }}
/>
