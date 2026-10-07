<script lang="ts">
  /** What points at this note, what it points at, and where its name is written
   *  without a link - as three lists, or as a picture.
   *
   *  Three lists in one column, each headed by one word and a count, and one row for
   *  all three: the file list's row for the note, with the line it says it on under
   *  its name; see HitList.svelte. Nothing is computed until the panel is open - the
   *  two derived lists are lazy, and the mentions are only looked for while it shows.
   *
   *  The picture is the same thing said the other way round: the note in the
   *  middle, what it is linked to around it, and nothing else. It comes from the
   *  same index the lists do, so the two cannot disagree about the space. */

  import { type NoteGraph, without } from './graph'
  import { neighbourhood } from './graph-walk'
  import { graphSurface } from './surfaces.svelte'
  import { t } from './i18n.svelte'
  import { links, type Outgoing, type Reference } from './link-index.svelte'
  import { insideSpace } from './space-paths'
  import { workspace } from './workspace.svelte'
  import { howFor, type OpenHow, tabAsk } from './new-tab'
  import HitList from './HitList.svelte'

  const {
    ongoto,
    graph = false,
    depth = 1,
    onlist,
  }: {
    ongoto?: ((line: number) => void) | undefined
    /** Whether the panel is showing the picture rather than the lists. Held by
     *  the sidebar, whose tab row the switch between them sits in. */
    graph?: boolean
    /** How many links out from the open note the picture reaches, 1 to 3. Held by
     *  the sidebar too, since the stepper for it stands beside the switch. */
    depth?: number
    onlist?: (() => void) | undefined
  } = $props()

  /** A graph with nothing in it, as one object rather than a fresh one each
   *  reading: the view lays a graph out again whenever it is handed another. */
  const NOTHING: NoteGraph = { nodes: [], edges: [] }

  // The note the panel is about, which is the one it was held on when it is
  // held and the one being worked in otherwise; see panelTab in workspace.svelte.ts.
  const path = $derived(workspace.panelTab?.path ?? null)
  const root = $derived(workspace.activeSpace?.root ?? null)

  const backlinks = $derived.by(() => (path ? links.backlinks(path) : []))
  const outgoing = $derived.by(() => (path ? links.outgoing(path) : []))

  /** Whether the card has asked for the files the notes embed.
   *
   *  Read into a derived of its own rather than inside the walk below: the settings
   *  are one object behind one getter, so reading a key off it in there would make
   *  that walk follow every setting there is - and a space of five thousand notes
   *  would be walked again for every letter typed into the card's filter. A derived
   *  that answers the same boolean wakes nothing. */
  const attachments = $derived(workspace.graphSettings.here.attachments)

  /** The open note and everything within `depth` links of it. Lazy like the lists
   *  above, so the space is only walked while the picture is the thing showing. */
  const around = $derived.by(() => {
    const centre = workspace.panelNote
    if (centre === null) return NOTHING

    // Without the notes the space leaves out, and with the files its notes embed
    // where the card has asked for them: the same picture the tab shows, since a note
    // in an archive is not part of what the space says about itself and a picture a
    // note holds either is part of it or is not, on both surfaces.
    // Except the note itself: an archived note opened anyway still has neighbours.
    const left = workspace.leftOut.filter((one) => centre !== one && !centre.startsWith(`${one}/`))
    return neighbourhood(without(links.pictureOf(attachments), left), centre, depth)
  })

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  let mentions = $state<Reference[]>([])

  // Looked for while the panel is open, and again whenever the note or the index
  // changes. A search of the space is a round trip, so it is never on the way to
  // showing the two lists above it.
  $effect(() => {
    const note = path
    const space = root
    // Read for its own sake, so this runs again when a note is saved anywhere
    // in the space and a mention may have become a link.
    follows(links.version)

    if (!note || !space) {
      mentions = []
      return
    }

    let current = true
    void links.unlinked(note, space).then((found) => {
      if (current) mentions = found
    })

    return () => {
      current = false
    }
  })

  /** A line pressed: its note opens at that line - in a tab of its own, beside this
   *  one, when the press asked for one. A note left behind is not scrolled to. */
  async function openAt(reference: Reference, press: MouseEvent) {
    if (!root) return
    const ask = tabAsk(press)
    await workspace.open(insideSpace(root, reference.path), howFor(ask))
    if (ask !== 'behind') ongoto?.(reference.line)
  }

  /** A link out pressed: the note it goes to. One to a note the space has not got goes
   *  to the line in this note instead, since the link is what is wrong - and only on a
   *  plain press, because a tab of its own for a line already on screen is nothing. */
  async function openTarget(link: Reference | Outgoing, press: MouseEvent) {
    if (!('to' in link) || !root) return
    if (link.to) await workspace.openEntry(insideSpace(root, link.to), howFor(tabAsk(press)))
    else if (tabAsk(press) === 'plain') ongoto?.(link.line)
  }
</script>

{#if !path}
  <p class="empty-text">{t('No note is open')}</p>
{:else if graph}
  <!-- The picture itself, with its layout and its painter, is fetched the first time
       somebody asks for one - here or in a tab of its own, whichever comes first; see
       surfaces.svelte.ts. The list below is what the panel opens on. -->
  {#await graphSurface() then Graph}
    <Graph
      graph={around}
      current={workspace.panelNote}
      onopen={(target: string, how: OpenHow) => workspace.openRelative(target, how)}
      onescape={() => onlist?.()}
    />
  {/await}
{:else}
  <!-- Backlinks first: what points here is what the panel is opened for. -->
  {@render heading(t('Backlinks'), backlinks.length)}
  {#if backlinks.length}
    {@render hits(backlinks)}
  {:else}
    <p class="empty-text">{t('Nothing links here yet')}</p>
  {/if}

  {@render heading(t('Links out'), outgoing.length)}
  {#if outgoing.length}
    <HitList rows={outgoing} onpick={openTarget} />
  {:else}
    <p class="empty-text">{t('This note links nowhere yet')}</p>
  {/if}

  {#if mentions.length}
    {@render heading(t('Mentions'), mentions.length)}
    {@render hits(mentions)}
  {/if}

  {#if links.scanning}
    <p class="empty-text">{t('Reading the space…')}</p>
  {/if}
{/if}

<!-- One word and a count over each of the three lists. -->
{#snippet heading(word: string, count: number)}
  <p class="nib-section">{word}<span>{count}</span></p>
{/snippet}

<!-- A list of lines: which note, and what it says on the line the name is written
     on. What the backlinks and the mentions both are, character for character, and
     the links out with the note each goes to. A component rather than a snippet
     because it holds a window of its own, and there are three of them in one
     scroller: see HitList.svelte. -->
{#snippet hits(rows: readonly Reference[])}
  <HitList {rows} onpick={openAt} />
{/snippet}

<style>
  .empty-text {
    margin: var(--space-1) var(--row-pad) 0;
    font-size: var(--text-row);
    color: var(--muted);
  }

  :global([data-touch]) .empty-text {
    font-size: var(--text-base);
  }
</style>
