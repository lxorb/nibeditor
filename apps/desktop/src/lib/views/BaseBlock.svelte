<script lang="ts">
  /** A base inside a note: a ` ```base ` fence, or `![[Bugs.base]]` and
   *  `![[Bugs.base#Board]]` (docs/tasks.md 5.11). Drawn where it stands, in the editor
   *  and in the reading view, with a smaller head and rows that edit like anywhere
   *  else. `this` is the note it stands in, Bases' rule, so one base embedded in many
   *  notes shows each its own. */
  import { untrack } from 'svelte'
  import { kitFor } from './kit'
  import { LiveView } from './live.svelte'
  import { fenceSource, fileSource, rowAt } from './source'
  import ViewFrame from './ViewFrame.svelte'

  const {
    code = null,
    file = null,
    view,
    from,
    title,
  }: {
    /** A fence's own words. */
    code?: string | null
    /** An embedded base file, on this disk. */
    file?: string | null
    /** Which of its views, by name. */
    view?: string | undefined
    /** The note it stands in, on this disk, or null for one with no file yet. */
    from: string | null
    title: string
  } = $props()

  const made = untrack(() => {
    const source =
      file !== null ? fileSource(file, view, () => rowAt(from)) : fenceSource(code ?? '', from)
    const live = new LiveView(source)
    return { live, kit: kitFor(live, view === undefined ? {} : { view }, file, true) }
  })

  $effect(() => untrack(() => made.live.start()))
</script>

<div class="base-block">
  <ViewFrame kit={made.kit} {title} />
</div>

<style>
  .base-block {
    margin: var(--space-2) 0;
    font-size: var(--text-row);
    white-space: normal;
  }
</style>
