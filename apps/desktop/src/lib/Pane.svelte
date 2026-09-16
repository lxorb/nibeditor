<script lang="ts">
  /** One pane: its strip of tabs and the note, or the graph, that is showing in
   *  it. A window has one of these until something is split, and up to four
   *  after that.
   *
   *  Everything a pane's editor needs to know about is asked of the tab in this
   *  pane rather than of the window: which note a pasted picture belongs beside,
   *  which note a link is being followed from. Two panes on two notes would
   *  otherwise both answer for whichever one had the focus. */

  import {
    closeFind,
    type EditorView,
    type FindAsk,
    type FindSpec,
    findTally,
    type FindTally,
    findNext as findNextMatch,
    findPrevious as findPreviousMatch,
    NO_FIND,
    NO_TALLY,
    type NoteJump,
    replaceEverywhere,
    replaceHere,
    setDeck,
    setFind,
    setReadOnlyMode,
  } from '@nib/editor'
  import { untrack } from 'svelte'
  import { isDeck } from '@nib/markdown/slides'
  import type { Tab } from './workspace.svelte'
  import type { Pane } from './workspace/pane-tree'
  import type { Landing } from './workspace/panes.svelte'
  import { dragged, draggedTab, isTabDrag, isTreeDrag } from './drag-paths'
  import Editor from './Editor.svelte'
  import { key, message, t } from './i18n.svelte'
  import { busy } from './busy.svelte'
  import { showEditorMenu } from './editor-menu'

  import { without } from './graph'
  import { links } from './link-index.svelte'
  import { modes } from './modes.svelte'
  import { pull } from './pull.svelte'
  import { notePicture } from './note-images'
  import { placement } from './placement.svelte'
  import { rooms } from './rooms.svelte'
  import { settings } from './settings.svelte'
  import {
    canvasSurface,
    emptySurface,
    findBar,
    graphSurface,
    pagesSurface,
    pdfSurface,
    readingSurface,
    webSurface,
  } from './surfaces.svelte'
  import { canWriteIn } from './sharing.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { storeImage } from './assets'
  import Tabs from './Tabs.svelte'
  import { openExternal } from './tauri'
  import { usage } from './usage.svelte'
  import { viewport } from './viewport.svelte'
  import { views } from './views.svelte'
  import { workspace } from './workspace.svelte'
  import { EDGE, inside, type Zone, zoneAt } from './workspace/zones'

  const { pane }: { pane: Pane } = $props()

  const tab = $derived(workspace.showing(pane.id))

  /** Whether the card has asked for the files the notes embed. Read into a derived of
   *  its own, because the settings are one object behind one getter: reading a key off
   *  it inside the pass below would make that pass follow every setting there is, and
   *  a filter is typed a letter at a time. A derived that answers the same boolean
   *  wakes nothing. */
  const attachments = $derived(workspace.graphSettings.here.attachments)

  /** The space as a picture, without the notes it leaves out, and with the files its
   *  notes embed where the card has asked for them. Lazy like the graph itself:
   *  nothing here is worked out until a graph tab is open. */
  const picture = $derived.by(() => without(links.pictureOf(attachments), workspace.excluded.here))
  /** Every note this pane holds. The editor keeps a state for each one it has
   *  shown, and this is what tells it which of them are still open. The tabs
   *  themselves, because a tab is what a state is kept under; see
   *  editor-states.ts. */
  const strip = $derived(workspace.tabsIn(pane.id))
  /** The strips live in the panes as soon as there is more than one of them.
   *  With one pane the window's own strip is in the titlebar, where a browser
   *  puts it and where it has been all along. */
  const stripped = $derived(workspace.panes.count > 1)
  /** Whether what is showing takes a dropped note itself; see `answers`. */
  const ownSurface = $derived(tab?.kind === 'canvas')
  /** Whether the surface in this pane is the editor, which is the one that has
   *  no find bar of its own. The same question the branch chain below asks, asked
   *  once so the bar above it and the editor under it cannot disagree. */
  const writing = $derived(
    !!tab &&
      tab.kind !== 'graph' &&
      tab.kind !== 'canvas' &&
      tab.kind !== 'pages' &&
      tab.kind !== 'pdf' &&
      tab.kind !== 'web' &&
      !tab.reading,
  )

  /** The notes this pane lays out as columns, or none where it lays out none.
   *
   *  Stacking is an arrangement of documents, so what it arranges is the notes: a plane,
   *  a website, a PDF, a set of pages and the graph are each one surface that fills a
   *  pane, and a note being read rather than written is a page with its own scroller. Any
   *  of those showing and the pane draws the way it always did, columns or no columns.
   *
   *  Off on a handheld whatever the pane says, because a handheld holds one document; see
   *  `canStack` in workspace.svelte.ts, which the rows that offer this read too. */
  const columns = $derived(
    pane.stacked && !viewport.touch
      ? workspace.tabsIn(pane.id).filter((one) => one.kind === 'note' && !one.reading)
      : [],
  )

  /** Whether this pane is drawing columns right now: it is stacked, it holds more than
   *  one note, and what is showing is one of them. */
  const stacking = $derived(columns.length > 1 && columns.some((one) => one.id === tab?.id))

  let view = $state<EditorView>()

  /** One editor per column, by the tab it is showing. The pane's bars - the find bar, the
   *  formatting bar, the menu over the words - talk to one editor, and in a stacked pane
   *  that one is the active column's; the effect below is what keeps `view` pointing at
   *  it as the column changes. */
  const columnViews = $state<Record<string, EditorView | undefined>>({})

  $effect(() => {
    if (!stacking) return

    const current = columnViews[pane.activeTabId ?? '']
    if (current && current !== view) view = current
  })

  /** The find bar over this pane's editor.
   *
   *  Held here rather than in the editor, because the bar is a row of the pane -
   *  under the strip, above the note - and because the keys that open it are the
   *  editor's: it asks through `onfind` and this is what answers. Per pane, so
   *  two panes can be looking for two different things.
   *
   *  The query itself lives in the document's own search state, which is where
   *  the library keeps it; what is here is the copy the field is drawn from and
   *  whether the second row is out. See find.ts in @nib/editor. */
  /** The three the bar's flags stand for, which are three of the query's own. */
  type FindFlags = Pick<FindSpec, 'caseSensitive' | 'regexp' | 'wholeWord'>

  let finding = $state(false)
  let replacing = $state(false)
  let spec = $state<FindSpec>(NO_FIND)
  let tally = $state<FindTally>(NO_TALLY)

  /** Whether this pane's note can be written in at all, which is what decides
   *  whether the bar offers to replace anything. A note being read, a note in a
   *  space shared to be read, a file shared to be read, and read-only mode all
   *  say no; see `canWriteIn`. */
  const canReplace = $derived(
    !!tab && !tab.reading && !modes.readOnly && canWriteIn(tab.note) && !!view,
  )

  /** The document, told what to look for, and then asked how many there are.
   *  One call, because every change to the bar is the same two steps.
   *
   *  Awaited, because the search engine is fetched rather than carried: the bar can go
   *  up in the frame before it lands, and a count read in front of it would be a count
   *  of nothing. Only the first call of a session waits, and only for a fetch from
   *  beside the page; see find.ts in @nib/editor. */
  async function look(next: FindSpec) {
    spec = next
    // Held, because the await below is a frame the pane could have been given another
    // note in: the editor this was asked about is the one to count in.
    const asked = view
    if (!asked) return

    await setFind(asked, next)
    tally = findTally(asked.state)
  }

  function openFinding(ask: FindAsk) {
    replacing = ask.replace
    // A word under the caret is what somebody pressed the key about; an empty
    // selection leaves whatever was last looked for, which is still in the
    // field and still selected.
    void look(ask.seed ? { ...spec, query: ask.seed } : spec)
    // The bar goes up now rather than when the count comes back: the key was pressed,
    // and a bar that waited on a fetch would be a key that did nothing for a frame.
    finding = true
  }

  function shutFinding() {
    finding = false
    replacing = false
    if (view) closeFind(view)
    // The caret goes back to the note, which is where it was before the key.
    view?.focus()
  }

  function stepFinding(by: number) {
    if (!view) return

    if (by < 0) findPreviousMatch(view)
    else findNextMatch(view)
    tally = findTally(view.state)
  }

  function replaceOne() {
    if (!view) return

    replaceHere(view)
    tally = findTally(view.state)
  }

  function replaceEvery() {
    if (!view) return

    replaceEverywhere(view)
    tally = findTally(view.state)
  }

  /** Which note the bar was opened over. A plain variable rather than state:
   *  the effect below writes it, and writing state it reads would be a loop. */
  let searchedIn: string | null = null

  // A pane whose note changed is a pane looking at something else, and a tally
  // counted in the note before it is a number about nothing. Only on a real
  // change, so the first run of this does not take the keyboard.
  $effect(() => {
    const here = tab?.id ?? null
    if (here === searchedIn) return

    searchedIn = here
    if (untrack(() => finding)) shutFinding()
  })

  // Pulling the note down past its first line, which on a phone runs whichever
  // command the reader chose; see pull.svelte.ts. On the editor's own scroller,
  // and rebuilt with it, because a view is built fresh for every note.
  $effect(() => {
    const current = view
    if (!current) return

    return pull.follow(current.scrollDOM)
  })

  // Every editor on the page is one the modes, the keys and the palette have to
  // reach, and a view is built fresh for every tab.
  $effect(() => {
    const current = view
    if (!current) return

    views.put(pane.id, current)
    modes.apply(current)
    shortcuts.apply(current)

    return () => {
      views.forget(pane.id)
      modes.forget(current)
      shortcuts.forget(current)
    }
  })

  // Reopening a note lands where it was left; see placement.svelte.ts. Per pane,
  // because a note open in two panes is being read in two places.
  $effect(() => {
    const current = view
    const showing = tab
    if (!current || !showing) return

    return placement.follow(current, showing)
  })

  // A note in a space somebody shared to read is read-only wherever it is shown,
  // whatever the window's own read-only switch says. The switch is left as the
  // reader set it; this is the space's answer laid over it, per pane, because a
  // pane beside this one may be showing a note of this account's own.
  $effect(() => {
    const current = view
    const note = tab?.note
    if (!current) return

    setReadOnlyMode(current, modes.readOnly || !canWriteIn(note))
  })

  // Whether this pane's note is a deck, which is what marks the rules that break
  // it into slides. Read off the words as of the last pause in the typing, like
  // the outline: `tab.doc` is only brought forward when the typing stops, so this
  // costs one scan per pause rather than one per keystroke.
  $effect(() => {
    const current = view
    const words = tab?.doc
    if (!current || words === undefined) return

    setDeck(current, isDeck(words))
  })

  /** A pasted or dropped image, stored once however often it is pasted. A large
   *  screenshot takes a moment to hash and write, and nothing appears in the
   *  note until it has, so the line at the top says so meanwhile.
   *
   *  Which note the picture belongs beside comes from the tab that was written
   *  in, not from the pane: the pane's editor outlives the note in it. */
  async function saveImage(file: File, into: Tab): Promise<string | null> {
    try {
      const src = await busy.run(t('Storing the image'), () => storeImage(file, into.path))
      void usage.refresh()
      return src
    } catch (error) {
      // The one failure worth interrupting for: nothing else the editor does
      // will work either until something is deleted.
      void usage.refresh()
      settings.error = message(error, key('That image does not fit in your storage.'))
      return null
    }
  }

  function resolveImage(src: string, from: Tab): string {
    return notePicture(src, from.path, from.doc)
  }

  /** Names a block of another note, so a `[[…#^` link can point at it. */
  function nameBlock(path: string, line: number): Promise<string | null> {
    const root = workspace.activeSpace?.root
    return root ? links.nameBlock(path, line, root) : Promise.resolve(null)
  }

  /** Which zone of this pane a drop would land in. The sides this pane cannot
   *  split into are not offered, so a zone that would do nothing never lights;
   *  see workspace/zones.ts. */
  function zoneOf(event: DragEvent & { currentTarget: HTMLElement }): Zone {
    const box = event.currentTarget.getBoundingClientRect()
    const moving = workspace.panes.dragging?.tabId ?? null

    return zoneAt(box, event.clientX, event.clientY, (side) =>
      workspace.canLand(side, pane.id, moving),
    )
  }

  /** Whether the pane answers for a drop, or leaves it to what is showing: a
   *  canvas makes a card of a note dropped on it, so the middle of the pane is
   *  the canvas's and only the four sides are the pane's. A tab is nothing the
   *  canvas knows about, so a tab is always the pane's. */
  function answers(event: DragEvent, zone: Zone): boolean {
    if (isTabDrag(event.dataTransfer)) return true

    return isTreeDrag(event.dataTransfer) && !(ownSurface && zone === 'middle')
  }

  function over(event: DragEvent & { currentTarget: HTMLElement }) {
    const where = zoneOf(event)
    if (!answers(event, where)) {
      if (workspace.panes.landing?.paneId === pane.id) workspace.panes.landing = null
      return
    }

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    workspace.panes.landing = { kind: 'pane', paneId: pane.id, zone: where }
  }

  function drop(event: DragEvent & { currentTarget: HTMLElement }) {
    const where = zoneOf(event)
    if (!answers(event, where)) return

    event.preventDefault()
    const landing: Landing = { kind: 'pane', paneId: pane.id, zone: where }
    const id = draggedTab(event.dataTransfer)
    const paths = dragged(event.dataTransfer)

    workspace.panes.landing = null
    workspace.panes.dragging = null

    if (id) workspace.dropTab(id, landing)
    else if (paths.length) void workspace.dropNotes(paths, landing)
  }

  /** The zone of this pane the drop would land in, or undefined when the drag is
   *  somewhere else: over another pane, or over a strip, which marks its own
   *  place between the tabs. */
  const landing = $derived(workspace.panes.landing)
  const zone = $derived(
    landing?.kind === 'pane' && landing.paneId === pane.id ? landing.zone : undefined,
  )
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pane"
  data-pane={pane.id}
  onpointerdowncapture={() => workspace.focusPane(pane.id)}
  ondragover={over}
  ondragleave={(event) => {
    // `dragleave` fires for a pointer moving onto the strip or the note inside
    // this pane as well as for one leaving it. Geometry tells the two apart.
    const box = event.currentTarget.getBoundingClientRect()
    if (landing?.paneId !== pane.id || inside(box, event.clientX, event.clientY)) return

    workspace.panes.landing = null
  }}
  ondrop={drop}
>
  {#if stripped}
    <div class="head"><Tabs paneId={pane.id} /></div>
  {/if}

  <!-- Under the strip, which is where every editor puts its find bar, and above
       the note rather than over it: a bar that covered the first line would be a
       bar hiding the first match. The reading view and a PDF draw the same
       component themselves, because each holds its own idea of where the words
       are; see FindBar.svelte.

       Fetched the first time a key asks for it, like every other part of the app
       nothing is showing yet, and preloaded once the launch is over so the first
       Control+F is not a wait; see `warmDoors` in surfaces.svelte.ts. -->
  {#if finding && writing}
    {#await findBar() then FindBar}
      <FindBar
        query={spec.query}
        count={tally.count}
        current={tally.current}
        capped={tally.capped}
        flags={spec}
        onflags={(flags: FindFlags) => void look({ ...spec, ...flags })}
        {replacing}
        replacement={spec.replace}
        onreplacing={(open: boolean) => {
          replacing = open
        }}
        onreplacement={(typed: string) => void look({ ...spec, replace: typed })}
        onreplace={canReplace ? replaceOne : undefined}
        onreplaceall={canReplace ? replaceEvery : undefined}
        onstep={stepFinding}
        onclose={shutFinding}
        onquery={(typed: string) => void look({ ...spec, query: typed })}
      />
    {/await}
  {/if}

  <!-- Every surface below the editor is fetched the first time a tab of its kind is
       opened rather than before the window is on screen; see surfaces.svelte.ts. The awaited
       promise is kept, so only the first canvas, PDF, deck of pages, graph or website
       of a session waits, and switching back to one does not. Nothing is drawn while
       one is on its way: the pane keeps its own ground for a frame, which is what it
       looked like before the surface was asked for. -->
  {#if tab?.kind === 'graph'}
    <!-- The graph of the space is a tab like a note is, so it takes the note's
         place in the pane rather than a surface of its own. -->
    {#await graphSurface() then Graph}
      <Graph
        graph={picture}
        whole
        current={workspace.relativeNote}
        onopen={(path: string, keep: boolean) => workspace.openRelative(path, keep)}
        onescape={() => void workspace.closeAsking(tab.id)}
      />
    {/await}
  {:else if tab?.kind === 'canvas'}
    <!-- A plane of cards, in the note's place. Keyed like the reading view and a
         PDF: a canvas is a document of its own and nothing about it is swapped
         into an editor. -->
    {#key tab.id}
      {#await canvasSurface() then Canvas}
        <Canvas {tab} focused={workspace.panes.focusedId === pane.id} />
      {/await}
    {/key}
  {:else if tab?.kind === 'pages'}
    <!-- Pages of paper, in the note's place. Keyed like the canvas beside it: a page
         note is a document of its own and nothing about it is swapped into an
         editor. -->
    {#key tab.id}
      {#await pagesSurface() then Pages}
        <Pages {tab} focused={workspace.panes.focusedId === pane.id} />
      {/await}
    {/key}
  {:else if tab?.kind === 'pdf'}
    <!-- A paper being read, beside the notes about it. Keyed like the reading
         view: a PDF is a document of its own and nothing about it is swapped
         into an editor. -->
    {#key tab.id}
      {#await pdfSurface() then Pdf}
        <Pdf {tab} focused={workspace.panes.focusedId === pane.id} />
      {/await}
    {/key}
  {:else if tab?.kind === 'web'}
    <!-- A website, in the note's place. Keyed like the others: the page is a webview
         of its own placed over this pane, and nothing about it is swapped into an
         editor. See docs/web-tabs.md. -->
    {#key tab.id}
      {#await webSurface() then WebTab}
        <WebTab {tab} focused={workspace.panes.focusedId === pane.id} />
      {/await}
    {/key}
  {:else if tab?.coming}
    <!-- A note whose row the account's first pass listed and whose words have not
         come down yet. One line, in the middle of the space the note will fill: an
         empty editor here would be something to type into, and typing into it would
         be writing over the copy that is on its way. It fills itself in without
         anybody asking again; see `arrived` in workspace.svelte.ts. -->
    <div class="coming" role="status">{t('Loading…')}</div>
  {:else if tab?.reading}
    <!-- The note through the renderer. A tab keeps its own face, so the same note
         can be read here and written in next door. Fetched like the surfaces above
         it: a reader who writes and never reads never carries the renderer's own
         side of the app. -->
    {#key tab.id}
      {#await readingSurface() then Reading}
        <Reading {tab} focused={workspace.panes.focusedId === pane.id} />
      {/await}
    {/key}
  {:else if stacking}
    <!-- Stacked: the pane's notes as columns side by side, each its own editor, scrolling
         sideways. The active one is widest, because it is the one being written in; the
         rest are a spine of the note's name and as much of the words as there is room
         for. Pressing a spine makes that column the active one, which is the same press
         a tab in the strip is.

         An editor per column and not one editor showing several notes: two notes side by
         side have two carets, two scroll positions and two sets of folds, and a state
         swapped between them would have one of each. The editors were already several -
         a split has one per pane - so what is new here is the layout and not the
         machinery; see Editor.svelte. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="stack" data-region="editor">
      {#each columns as one (one.id)}
        <section class="column" class:is-active={one.id === pane.activeTabId}>
          <button
            class="spine"
            title={one.shown}
            aria-label={one.shown}
            aria-pressed={one.id === pane.activeTabId}
            onclick={() => workspace.activate(one.id)}
          >
            <span class="nib-row-label">{one.shown}</span>
          </button>
          <div
            class="sheet"
            oncontextmenu={(event: MouseEvent) =>
              showEditorMenu(event, columnViews[one.id], one.path)}
          >
            <Editor
              bind:view={columnViews[one.id]}
              tab={one}
              kept={strip}
              onimage={saveImage}
              resolveimage={resolveImage}
              openlink={(href: string) => void openExternal(href)}
              notes={(which: Tab) => links.index(which.path)}
              opennote={(jump: NoteJump) => void workspace.followLink(jump)}
              nameblock={(path: string, line: number) => nameBlock(path, line)}
              onfind={(ask: FindAsk | null) => (ask ? openFinding(ask) : shutFinding())}
              onselection={(current: EditorView) => {
                views.moved(current)
                placement.remember(current)
                rooms.moved(current)
              }}
            />
          </div>
        </section>
      {/each}
    </div>
  {:else if tab}
    <!-- One editor for the pane, whichever note is in it: switching swaps the
         note's state into it rather than building another editor, which is what
         makes a switch land in one frame. See Editor.svelte. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- The note is a region of the window, which is what F6 walks to and what
         every list hands the keyboard back to; see focus.ts. -->
    <div
      class="editor"
      data-region="editor"
      oncontextmenu={(event: MouseEvent) => showEditorMenu(event, view, tab.path)}
    >
      <Editor
        bind:view
        {tab}
        kept={strip}
        onimage={saveImage}
        resolveimage={resolveImage}
        openlink={(href: string) => void openExternal(href)}
        notes={(one: Tab) => links.index(one.path)}
        opennote={(jump: NoteJump) => void workspace.followLink(jump)}
        nameblock={(path: string, line: number) => nameBlock(path, line)}
        onfind={(ask: FindAsk | null) => (ask ? openFinding(ask) : shutFinding())}
        onselection={(current: EditorView) => {
          views.moved(current)
          placement.remember(current)
          // Where the caret is, on its way to the other devices in this note.
          rooms.moved(current)
        }}
      />
    </div>
  {:else}
    <!-- Nothing open. The kinds a new tab can be, as buttons, rather than a note nobody
         asked for; see NewHere.svelte. Fetched like every other surface here: a window
         that opens on a note never asks for it. -->
    {#await emptySurface() then NewHere}
      <NewHere paneId={pane.id} />
    {/await}
  {/if}

  <!-- Five places a drop can land: the pane itself, and each of its four sides,
       where a pane of its own would go. Lit as the drag nears one. -->
  {#if workspace.panes.dragging}
    <!-- The bands are drawn as deep as the geometry reads them, from the one
         number that says how deep that is. -->
    <div class="zones" class:sides={ownSurface} style:--band="{EDGE * 100}%">
      <div class="zone whole" class:lit={zone === 'middle'}></div>
      <div class="zone left" class:lit={zone === 'left'}></div>
      <div class="zone right" class:lit={zone === 'right'}></div>
      <div class="zone up" class:lit={zone === 'top'}></div>
      <div class="zone down" class:lit={zone === 'bottom'}></div>
    </div>
  {/if}
</div>

<style>
  .pane {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* A pane beside another one carries its own strip. The window's single pane
     has none: its tabs are in the titlebar, where a browser puts them.

     Above the drop zones, so a tab dragged onto the strip reaches the strip and
     lands between the tabs rather than being taken by the pane underneath. */
  .head {
    position: relative;
    z-index: 6;
    display: flex;
    align-items: stretch;
    flex: none;
    height: var(--titlebar-height);
    border-bottom: 1px solid var(--line);
  }

  .editor {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }

  /* Stacked tabs: the pane's notes as columns, scrolling sideways.

     `overscroll-behavior-x: contain` so reaching the end of the row does not hand the
     gesture to whatever is behind the app, which on a trackpad is a page going back. */
  .stack {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .stack::-webkit-scrollbar {
    display: none;
  }

  /* A column: the spine with the note's name, and the words beside it. The active one
     takes three times the room, which is what says which one is being written in without
     anything else having to say it - and it moves there rather than jumping, on the same
     duration every other surface of the app moves on. */
  .column {
    position: relative;
    flex: 1 0 var(--stack-column);
    min-width: 0;
    display: flex;
    border-inline-start: 1px solid var(--line);
    transition: flex-basis var(--dur-base) var(--ease-out);
  }

  .column:first-child {
    border-inline-start: 0;
  }

  .column.is-active {
    flex-basis: var(--stack-column-wide);
  }

  /* The name, written down the side and staying where it is as the column scrolls: the
     one thing a column always shows, so a row of them reads as a row of names. */
  .spine {
    position: sticky;
    inset-inline-start: 0;
    z-index: 1;
    flex: none;
    width: var(--titlebar-height);
    border: 0;
    padding: var(--space-3) 0;
    background: var(--surface);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: pointer;
    text-align: start;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  /* The name itself is what turns, not the button around it: `inset-inline-start` on the
     sticky spine is resolved against the element's own writing mode, so a spine written
     vertically would have been sticking to its top rather than to the edge of the row. */
  .spine .nib-row-label {
    display: block;
    max-height: 100%;
    overflow: hidden;
    writing-mode: vertical-rl;
    text-orientation: mixed;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (hover: hover) {
    .spine:hover {
      color: var(--text);
    }
  }

  .column.is-active .spine {
    background: var(--bg);
    color: var(--text-strong);
  }

  .sheet {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  /* A note still on its way: the quietest thing the app can put in a pane, in the
     muted colour everything that is not the writing is drawn in. Centred, because
     there is nothing here to read from the top. */
  .coming {
    flex: 1;
    display: grid;
    place-items: center;
    min-height: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    user-select: none;
  }

  /* Over the note while a tab is being dragged, so the drop lands here rather
     than in the text. */
  .zones {
    position: absolute;
    inset: 0;
    z-index: 5;
    /* The zones themselves take the drag, not the gaps between them: a canvas
       has to keep the middle of the pane, which is a card's place to land. */
    pointer-events: none;
  }

  /* A surface that takes a note dropped on it keeps the middle of the pane. */
  .zones.sides .zone.whole {
    pointer-events: none;
  }

  .zone {
    position: absolute;
    pointer-events: auto;
    background: var(--accent-soft);
    border: 1px solid transparent;
    opacity: 0;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      inset var(--dur-base) var(--ease-out);
  }

  .zone.lit {
    opacity: 1;
    border-color: var(--accent-line);
  }

  .zone.whole {
    inset: 0;
  }

  .zone.left {
    inset: 0 auto 0 0;
    width: var(--band);
  }

  .zone.right {
    inset: 0 0 0 auto;
    width: var(--band);
  }

  .zone.up {
    inset: 0 0 auto 0;
    height: var(--band);
  }

  .zone.down {
    inset: auto 0 0 0;
    height: var(--band);
  }
</style>
