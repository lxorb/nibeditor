<script lang="ts">
  /** What sync has to say about a row or a tab, in its trailing slot: a note held for
   *  the question (sync2/HeldMark.svelte), or a copy another sync tool made, which
   *  nib never carries (foreign/ForeignMark.svelte). One door for both, fetched by
   *  whichever is first needed, so a list that never has either carries neither. */
  import ForeignMark from './foreign/ForeignMark.svelte'
  import HeldMark from './sync2/HeldMark.svelte'

  const { path }: { path: string | null } = $props()
</script>

<HeldMark {path} />
<ForeignMark {path} />
