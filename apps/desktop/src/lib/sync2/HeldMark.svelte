<script module lang="ts">
  import type { IconNode } from 'lucide'

  /** Two squares laid over each other, both whole: two versions of one note, neither
   *  in front. Lucide's `copy` is the nearest drawing, and it is the wrong one - its
   *  back square is hidden behind the front, which is a duplicate, and the canvas's
   *  Duplicate already wears it. Drawn on Lucide's grid at its weight, like the
   *  canvas's mark in file-mark.ts; see docs/icons.md. */
  const VERSIONS: IconNode = [
    ['rect', { x: '3', y: '3', width: '13', height: '13', rx: '2' }],
    ['rect', { x: '8', y: '8', width: '13', height: '13', rx: '2' }],
  ]
</script>

<script lang="ts">
  /** The mark a held note wears on its row and its tab until the question is answered:
   *  the note is waiting for the reader, and the question comes up once it is on
   *  screen. In the row's trailing slot, in the voice of the mark that says somebody
   *  else is in a note, because it is the same kind of fact; see SharedMark.svelte.
   *
   *  Every row asks, and draws nothing for a note that is not held: this is fetched
   *  the first time anything is, so a list that never has a held note never carries
   *  it. Called by the name of the pane's list, which is where the note is found
   *  again. */
  import { t } from '../i18n.svelte'
  import SharedMark from '../SharedMark.svelte'
  import { asking } from './asking.svelte'

  const { path }: { path: string | null } = $props()
</script>

{#if asking.isHeld(path)}
  <SharedMark label={t('Waiting for you')} icon={VERSIONS} />
{/if}
