<script lang="ts">
  /** The mark on another sync tool's copy: a cloud struck through, in the voice of the
   *  marks beside it, and the row it is on drawn faint the way a row left out of the
   *  space is. The file is the person's and stays; nib only says it does not carry it.
   *  Which tool made it is in the tooltip, because that is who to ask about it. See
   *  @nib/sync-core/foreign and docs/sync.md "Other sync tools". */
  import { foreignCopy } from '@nib/sync-core/foreign'
  import CloudOff from 'lucide/dist/esm/icons/cloud-off.mjs'
  import { t } from '../i18n.svelte'
  import SharedMark from '../SharedMark.svelte'
  import { nameOf } from '../space-paths'

  const { path }: { path: string | null } = $props()

  const copy = $derived(path === null ? null : foreignCopy(nameOf(path)))
</script>

{#if copy}
  <span class="foreign">
    <SharedMark
      label={t('{tool} conflict copy · not synced', { tool: copy.tool })}
      icon={CloudOff}
    />
  </span>
{/if}

<style>
  /* Nothing of its own to draw: the mark sits in the row's slot as if it were bare. */
  .foreign {
    display: contents;
  }

  /* The name and its mark in front of it, faint as `.row.is-left-out` in Tree.svelte
     and for the same reason: there to open, and quietly not part of what the space
     says about itself. The row itself is the themes package's, hover and all. */
  :global(:is(.nib-row-label, :has(+ .nib-row-label)):has(~ .foreign)) {
    opacity: 0.5;
  }
</style>
