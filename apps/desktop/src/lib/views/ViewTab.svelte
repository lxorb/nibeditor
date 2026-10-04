<script lang="ts">
  /** A view in a tab of its own (docs/tasks.md 5.5): Today, a project, a label, or a
   *  `.base` file's views, full width, splittable beside a note and put back with the
   *  session. Which view it is lives in the tab's words (spec.ts); a base file's own
   *  changes are written into the file, a built-in view's into the tab.
   *
   *  The surface Pane.svelte fetches the first time a view tab is shown; nothing of
   *  this is in the first paint (surfaces.svelte.ts). */
  import { untrack } from 'svelte'
  import type { Tab } from '../workspace/documents.svelte'
  import { kitFor } from './kit'
  import { LiveView } from './live.svelte'
  import { fileSource, tabSource } from './source'
  import { readSpec } from './spec'
  import ViewFrame from './ViewFrame.svelte'

  const { tab }: { tab: Tab } = $props()

  /** Made once per tab: the pane keys this surface by the tab's id. */
  const made = untrack(() => {
    const spec = readSpec(tab.doc) ?? {}
    const path = tab.path
    const live = new LiveView(path === null ? tabSource(tab) : fileSource(path, spec.view))
    return { live, kit: kitFor(live, spec, path, false) }
  })

  // Untracked: starting reads the base, and what it reads on the way is not something
  // this view should start again for.
  $effect(() => untrack(() => made.live.start()))

  /** Words changed from outside the view (Open as board on a project already open):
   *  the view reads them again. Its own writes say what it already shows. */
  let seen = untrack(() => tab.doc)
  $effect(() => {
    const words = tab.doc
    if (words === seen) return
    seen = words
    if (tab.path === null) untrack(() => void made.live.reload())
  })
</script>

<div class="view-tab" data-region="editor">
  <ViewFrame kit={made.kit} title={tab.shown} />
</div>

<style>
  .view-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
</style>
