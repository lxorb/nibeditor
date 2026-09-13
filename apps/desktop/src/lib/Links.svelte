<script lang="ts">
  /** What points at this note, what it points at, and where its name is written
   *  without a link - as three lists, or as a picture.
   *
   *  Three lists in one column, each headed by one word and a count. The rows are
   *  the search panel's rows, because they say the same thing: which note, and the
   *  line it says it on. Nothing is computed until the panel is open - the two
   *  derived lists are lazy, and the mentions are only looked for while it shows.
   *
   *  The picture is the same thing said the other way round: the note in the
   *  middle, what it is linked to around it, and nothing else. It comes from the
   *  same index the lists do, so the two cannot disagree about the space. */

  import { neighbourhood, type NoteGraph, without } from './graph'
  import { graphSurface } from './surfaces.svelte'
  import { shownName } from './note-name'
  import { t } from './i18n.svelte'
  import { links, type Outgoing, type Reference } from './link-index.svelte'
  import { insideSpace } from './space-paths'
  import { workspace } from './workspace.svelte'
  import { roving } from './roving'
  import HitList, { HIT_WALK } from './HitList.svelte'

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

  /** The open note and everything within `depth` links of it. Lazy like the lists
   *  above, so the space is only walked while the picture is the thing showing. */
  const around = $derived.by(() => {
    const centre = workspace.panelNote
    if (centre === null) return NOTHING

    // Without the notes the space leaves out, which is the same picture the tab
    // shows: a note in an archive is not part of what the space says about itself,
    // so it is not part of the neighbourhood either.
    return neighbourhood(without(links.graph, workspace.excluded.here), centre, depth)
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

  async function openAt(reference: Reference) {
    if (!root) return
    await workspace.open(insideSpace(root, reference.path))
    ongoto?.(reference.line)
  }

  async function openTarget(link: Outgoing) {
    if (!root || !link.to) return
    await workspace.openEntry(insideSpace(root, link.to))
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
      onopen={(target: string, keep: boolean) => workspace.openRelative(target, keep)}
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
    <!-- Its own block, and the one that is not the others: a link out is the only
         row that can point at a note the space has not got, and that row goes to the
         line in this note instead. The link is what is wrong, so the link is what it
         shows you. -->
    <ul use:roving={HIT_WALK}>
      {#each outgoing as link, index (`${link.target}:${link.line}:${index}`)}
        <li>
          <button
            class="nib-row hit"
            class:missing={!link.to}
            onclick={() => (link.to ? openTarget(link) : ongoto?.(link.line))}
          >
            <span class="hit-note">{shownName(link.name)}</span>
            <span class="hit-line">{link.text}</span>
          </button>
        </li>
      {/each}
    </ul>
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
     on. What the backlinks and the mentions both are, character for character.
     A component rather than a snippet because it holds a window of its own now, and
     there are two of them in one scroller: see HitList.svelte. -->
{#snippet hits(rows: readonly Reference[])}
  <HitList {rows} onpick={openAt} />
{/snippet}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* Two lines rather than one, so the row is `.nib-row` stood on its end: the
     line the link is on, and the note it is in under it. */
  .hit {
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 1px;
    padding-top: var(--space-1);
    padding-bottom: var(--space-1);
  }

  .hit-note {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--accent);
  }

  /* A link with nowhere to go wears the same muted, dotted mark the link in the
     text does, so the two read as the same fact. */
  .missing .hit-note {
    color: var(--muted);
    text-decoration: underline dotted;
    text-underline-offset: 0.16em;
  }

  .hit-line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-text {
    margin: var(--space-1) var(--row-pad) 0;
    font-size: var(--text-row);
    color: var(--muted);
  }

  :global([data-touch]) .hit-note,
  :global([data-touch]) .empty-text {
    font-size: var(--text-base);
  }
</style>
