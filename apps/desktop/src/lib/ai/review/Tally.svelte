<script lang="ts">
  /** How many lines a change adds and takes away, in the version history's colours:
   *  `+3 −1`. A side with nothing to count is left out. */
  const { added, removed }: { added: number; removed: number } = $props()
</script>

<span class="nib-row-meta tally">
  {#if added || !removed}<ins>+{added}</ins>{/if}
  {#if removed}<del>−{removed}</del>{/if}
</span>

<style>
  .tally {
    display: inline-flex;
    gap: var(--space-1);
  }

  ins,
  del {
    text-decoration: none;
  }

  ins {
    color: var(--success);
  }

  del {
    color: var(--danger);
  }
</style>
