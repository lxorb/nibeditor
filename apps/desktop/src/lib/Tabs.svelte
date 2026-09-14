<script lang="ts">
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { carryTab, dragged, draggedTab, isTabDrag, isTreeDrag } from './drag-paths'
  import { i18n, t } from './i18n.svelte'
  import { longPress } from './longpress'
  import { DIVIDER, menu, shareEntry, stackEntries, type MenuEntry } from './menu.svelte'
  import { showNewKinds } from './new-kinds'
  import { rooms } from './rooms.svelte'
  import { roving } from './roving'
  import { shortcuts } from './shortcuts.svelte'
  import { viewport } from './viewport.svelte'
  import { shownName } from './note-name'
  import { nameOf } from './space-paths'
  import SharedMark from './SharedMark.svelte'
  import TabMark from './TabMark.svelte'
  import { workspace, type Tab } from './workspace.svelte'
  import { inside } from './workspace/zones'
  import { dur } from './motion'

  const { paneId }: { paneId: string } = $props()

  const pane = $derived(workspace.panes.at(paneId))
  const tabs = $derived(workspace.tabsIn(paneId))
  /** The pane that acts on the keyboard is marked here rather than by a border
   *  around the words: quietly, and where the tabs already say what is what. */
  const focused = $derived(workspace.panes.focusedId === paneId)
  const alone = $derived(workspace.panes.count < 2)
  /** Shown only where there is another pane on this note to scroll with. */
  const twinned = $derived(workspace.twins(paneId).length > 0)

  /** The tab the arrows are about, and whether this strip has been anywhere at
   *  all. The pair is drawn once a tab in this pane has moved on from one note
   *  to another, and stays after that: two arrows appearing and disappearing as
   *  the strip is walked along would move every tab under the pointer. */
  const walking = $derived(workspace.showing(paneId))
  const walked = $derived(tabs.some((one) => one.trail.length > 1))

  /** Where this tab has been, newest first, as rows to go straight back to.
   *  What is ahead of it is left out: forward is one arrow away and a list of
   *  both directions is a list nobody can read at a glance. */
  function trailMenu(tab: Tab): MenuEntry[] {
    return tab.trail
      .slice(0, tab.at)
      .map((path, at) => ({ label: shownName(nameOf(path)), at }))
      .reverse()
      .map((row) => ({ label: row.label, run: () => void workspace.walk(row.at, tab.id) }))
  }

  /** What a double click on the tab does, for a finger that cannot double
   *  click. Only offered while the tab is still a preview: once kept, there is
   *  nothing left to keep. */
  function keepEntry(tab: Tab): MenuEntry[] {
    if (tab.id !== workspace.previewTabId) return []
    return [{ label: t('Keep open'), run: () => workspace.keep(tab.id) }]
  }

  /** Beside, and below. Left out where the pane has split as far as it may,
   *  rather than offered as a row that does nothing. */
  function splitEntries(tab: Tab): MenuEntry[] {
    const entries: MenuEntry[] = []

    if (workspace.canSplit('row', tab.id)) {
      entries.push({
        label: t('Split right'),
        hint: shortcuts.hint('pane.split-right'),
        run: () => workspace.split('row', tab.id),
      })
    }
    if (workspace.canSplit('column', tab.id)) {
      entries.push({
        label: t('Split down'),
        hint: shortcuts.hint('pane.split-down'),
        run: () => workspace.split('column', tab.id),
      })
    }

    return entries.length ? [...entries, DIVIDER] : []
  }

  /** The note's other face. Not offered for the graph, which has only one. */
  function readingEntry(tab: Tab): MenuEntry[] {
    if (tab.kind !== 'note') return []

    return [
      {
        label: tab.reading ? t('Leave reading') : t('Reading'),
        hint: shortcuts.hint('app.reading'),
        run: () => workspace.toggleReading(tab.id),
      },
      DIVIDER,
    ]
  }

  /** Left out while nothing has been closed, rather than offered as a row that
   *  does nothing. */
  function reopenEntry(): MenuEntry[] {
    if (!workspace.closed.any) return []

    return [
      {
        label: t('Reopen closed tab'),
        hint: shortcuts.hint('app.reopen'),
        run: () => void workspace.reopenClosed(),
      },
    ]
  }

  /** Only for a tab with no file: every other kind of tab is written as the typing
   *  pauses and has nothing to save. The row is here because a tab is where somebody
   *  looking at an unsaved one is pointing; the key and the menu bar say the same thing.
   *  See `save` in workspace/saving.svelte.ts. */
  function saveEntry(tab: Tab): MenuEntry[] {
    if (tab.path !== null) return []

    return [
      {
        label: t('Save'),
        hint: shortcuts.hint('app.save'),
        run: () => void workspace.save(tab),
      },
    ]
  }

  function tabMenu(tab: Tab): MenuEntry[] {
    return [
      ...saveEntry(tab),
      ...readingEntry(tab),
      {
        label: tab.pinned ? t('Unpin') : t('Pin'),
        hint: shortcuts.hint('app.pin'),
        run: () => workspace.togglePin(tab.id),
      },
      {
        label: t('Close'),
        hint: shortcuts.hint('app.close'),
        // A pinned tab stays until it is let go of, so the row says so rather
        // than doing nothing when it is pressed.
        disabled: tab.pinned,
        run: () => void workspace.closeAsking(tab.id),
      },
      {
        label: t('Close others'),
        disabled: tabs.length < 2,
        run: () => void workspace.closeOthers(tab.id),
      },
      ...reopenEntry(),
      DIVIDER,
      // Who else may have the file this tab is showing, in the same word and the
      // same sheet the tree's row and the space's own menu use.
      ...shareEntry(tab.path),
      ...stackEntries(paneId),
      ...splitEntries(tab),
      ...keepEntry(tab),
    ]
  }

  const showMenu = (event: MouseEvent, tab: Tab) =>
    menu.show(event, tabMenu(tab), { title: tab.shown })

  /** A held finger is the right click a touch screen has, and the menu key is the one
   *  a keyboard has: all three ask for the same list, and so does Ctrl+T, which presses
   *  this very button. What the list holds is new-kinds.ts - one list for the plus, the
   *  chord and the buttons an empty pane shows. */
  const showNewMenu = (event: MouseEvent) => showNewKinds(event, paneId)

  /** Whether the drag over the panes is one this strip takes: a tab out of any
   *  strip, or notes out of the file list. */
  const takes = (transfer: DataTransfer | null) => isTabDrag(transfer) || isTreeDrag(transfer)

  /** Where in the strip the pointer is: before the tab it is over, or after it
   *  once past the middle. The gap after the last tab is the end of the strip.
   *
   *  Past the middle is further along the line rather than further right: the
   *  strip is laid out the way the interface reads, so under Arabic the half
   *  nearer the left of the screen is the later one. */
  function placeIn(event: DragEvent & { currentTarget: HTMLElement }, at: number): number {
    const box = event.currentTarget.getBoundingClientRect()
    const past = (event.clientX - (box.left + box.width / 2)) * i18n.factor
    return past > 0 ? at + 1 : at
  }

  /** Marks the place between the tabs the drop would take. The pane underneath
   *  offers the whole of itself and its four sides, so the strip keeps the event
   *  to itself rather than letting the pane answer for it as well. */
  function over(event: DragEvent & { currentTarget: HTMLElement }, at: number) {
    if (!takes(event.dataTransfer)) return

    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    workspace.panes.landing = { kind: 'strip', paneId, at }
  }

  function drop(event: DragEvent & { currentTarget: HTMLElement }, at: number) {
    if (!takes(event.dataTransfer)) return

    event.preventDefault()
    event.stopPropagation()

    const landing = { kind: 'strip', paneId, at } as const
    const id = draggedTab(event.dataTransfer)
    const paths = dragged(event.dataTransfer)

    workspace.panes.landing = null
    workspace.panes.dragging = null

    if (id) workspace.dropTab(id, landing)
    else if (paths.length) void workspace.dropNotes(paths, landing)
  }

  /** Where the mark between the tabs sits, or null while the drag is elsewhere. */
  const mark = $derived.by(() => {
    const landing = workspace.panes.landing
    return landing?.kind === 'strip' && landing.paneId === paneId ? landing.at : null
  })

  /** The dot says one of three things, and says it in words to a reader who
   *  cannot see it. A note in a space wears no dot at all: nothing about it is
   *  ever waiting to be written down. */
  function saveLabel(tab: Tab): string {
    const state = workspace.savingOf(tab)
    if (state === 'saving') return t('Saving')
    if (state === 'saved') return t('Saved')
    return t('Unsaved')
  }
</script>

<div class="strip">
  <!-- Where this pane has been. Two arrows, at the head of the strip the way
       every browser puts them, and only in a pane that has been anywhere: a note
       opened and read is not a journey. Each says whether it can go, rather than
       going and doing nothing. The back one also holds the trail itself, which is
       the one place the whole of it can be read. -->
  {#if walked && walking}
    <div class="steps">
      <button
        class="step"
        title={t('Back')}
        aria-label={t('Back')}
        disabled={!walking.canGoBack}
        onclick={() => workspace.goBack(walking.id)}
        oncontextmenu={(event) =>
          walking.canGoBack && menu.show(event, trailMenu(walking), { title: t('Back') })}
        use:longPress={(event) =>
          walking.canGoBack && menu.show(event, trailMenu(walking), { title: t('Back') })}
      >
        <svg class="nib-mirror" viewBox="0 0 12 12"><path d="M7.5 2.5 4 6l3.5 3.5" /></svg>
      </button>
      <button
        class="step"
        title={t('Forward')}
        aria-label={t('Forward')}
        disabled={!walking.canGoForward}
        onclick={() => workspace.goForward(walking.id)}
      >
        <svg class="nib-mirror" viewBox="0 0 12 12"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
      </button>
    </div>
  {/if}

  <!-- The whole strip takes a drop, so a tab dragged into it lands where it was
       let go of; past the last tab is the end of the strip. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- The strip is one tab stop, on whichever note is open, and left and right
       move along it. Unlike the panel tabs it does not change as it is arrived at:
       every one of these is a file to be read off a disk, and the ARIA practices
       say to choose on arrival only where arriving costs nothing. So an arrow moves,
       Enter opens, and Delete closes - which is what the practices give for a strip
       whose tabs can be closed. See roving.ts. -->
  <div
    class="tabs"
    data-region="tabs"
    use:roving={{
      across: true,
      rows: '.pick',
      current: '.active > .pick',
      wrap: true,
      quiet: '.shut',
      open: (row) => row.click(),
      peek: (row) => row.click(),
      remove: (row) => void workspace.closeAsking(row.dataset.tab ?? ''),
      menu: (row, at) => row.dispatchEvent(at),
    }}
    class:quiet={!focused && !alone}
    ondragover={(event) => over(event, tabs.length)}
    ondragleave={(event) => {
      const box = event.currentTarget.getBoundingClientRect()
      if (mark === null || inside(box, event.clientX, event.clientY)) return

      workspace.panes.landing = null
    }}
    ondrop={(event) => drop(event, tabs.length)}
  >
    {#each tabs as tab, at (tab.id)}
      <!-- How many other devices are in this note, once and at most three: the
           expression below it allocated a fresh array-like per tab per render. -->
      {@const elsewhere = Math.min(rooms.present[tab.note.key] ?? 0, 3)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tab"
        class:active={tab.id === pane?.activeTabId}
        class:pinned={tab.pinned}
        class:preview={tab.id === workspace.previewTabId}
        class:before={mark === at}
        class:after={mark === tabs.length && at === tabs.length - 1}
        ondragover={(event) => over(event, placeIn(event, at))}
        ondrop={(event) => drop(event, placeIn(event, at))}
        transition:fly={{ y: -8, duration: dur(180), easing: cubicOut }}
      >
        <!-- A double click keeps a preview, the way VS Code does it. The two
             single clicks it is made of activate the tab twice, which costs
             nothing: activating the tab that is already active changes nothing.
             A long press stands in for the right click on a touch screen.
             Dragged, it goes along its own strip, into another pane's strip, or
             against a side of a pane to make one there. -->
        <!-- Named by the note, and named on the button. A pinned tab is a mark and
             no words, and the name used to be put on the `span` around the mark -
             which has no role, so nothing read it and the tab was a button with
             nothing to call it. -->
        <button
          class="pick"
          data-tab={tab.id}
          draggable={!viewport.touch}
          title={tab.shown}
          aria-label={tab.shown}
          onclick={() => workspace.activate(tab.id)}
          ondblclick={() => workspace.keep(tab.id)}
          oncontextmenu={(event) => showMenu(event, tab)}
          use:longPress={(event) => showMenu(event, tab)}
          ondragstart={(event) => {
            carryTab(event.dataTransfer, tab.id)
            workspace.panes.dragging = { tabId: tab.id }
          }}
          ondragend={() => {
            workspace.panes.dragging = null
            workspace.panes.landing = null
          }}
        >
          <!-- What this tab is looking at, on every tab: a strip of a note, a
               canvas and two websites says which is which before any of the names
               are read, and every name in it starts at the same place. Never the
               icon the file chose for its row - a tab says what kind of thing it
               holds, and a website says which site. See TabMark.svelte. -->
          <TabMark {tab} />
          {#if tab.reading}
            <!-- An open book, quietly: the tab says which face of the note is up
                 without spending a word on it. -->
            <!-- A drawing that says something, so it says what: an `svg` carrying a
                 name and no role is a graphic nothing reads. -->
            <svg
              class="reading"
              viewBox="0 0 14 12"
              role="img"
              aria-label={t('Reading')}
              transition:fade={{ duration: dur(140) }}
            >
              <path d="M7 3.2v7.3M7 3.2C5.6 2 3.9 1.6 1.5 1.6v7.3c2.4 0 4.1.4 5.5 1.6" />
              <path d="M7 3.2c1.4-1.2 3.1-1.6 5.5-1.6v7.3c-2.4 0-4.1.4-5.5 1.6" />
            </svg>
          {/if}
          <!-- The name in an element of its own: a flex box draws no ellipsis on
               the text directly inside it, so the words were being cut through
               the middle of a letter. This is also the only part of the tab that
               gives way as the strip fills. -->
          <!-- A pinned tab is its mark and nothing else: the name is what takes the
               room, and a tab kept open all day is one somebody knows by sight. The
               name is still what it says to a reader who cannot see it, and what the
               title shows. -->
          {#if !tab.pinned}
            <span class="label">{tab.shown}</span>
          {/if}
          <!-- Not yours: this document is one somebody else shared on its own, and
               the tab says so in the mark the whole app says it with. On the tab
               because there is nowhere else it could be said - a shared file has no
               row in the tree to carry it. See SharedMark.svelte. -->
          {#if tab.note.shared}
            <SharedMark label={t('Shared with you')} />
          {/if}
          <!-- Who else is in this note: one dot per other device, in the accent,
               and nothing at all while nobody is. No word, because the dots are
               already the whole sentence. -->
          {#if elsewhere}
            <span
              class="here"
              role="img"
              aria-label={t('Also open elsewhere')}
              title={t('Also open elsewhere')}
            >
              {#each { length: elsewhere } as _, at (at)}
                <span class="who" transition:fade={{ duration: dur(190) }}></span>
              {/each}
            </span>
          {/if}
          {#if tab.unsaved || workspace.savingOf(tab)}
            <!-- The dot says one of three things and says it in words too, which
                 needs a role to be read at all. What it means as it changes is said
                 once, out loud, in the app's one live region; see said.svelte.ts. -->
            <span
              class="dot"
              class:writing={workspace.savingOf(tab) === 'saving'}
              class:down={workspace.savingOf(tab) === 'saved'}
              role="img"
              aria-label={saveLabel(tab)}
              title={saveLabel(tab)}
              transition:fade={{ duration: dur(190) }}
            ></span>
          {/if}
        </button>
        {#if !tab.pinned}
          <button
            class="shut"
            title={t('Close')}
            aria-label={t('Close')}
            onclick={() => void workspace.closeAsking(tab.id)}
          >
            <svg viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" /></svg>
          </button>
        {/if}
      </div>
    {/each}

    <!-- A press opens the chooser: note, canvas, website, page note. The right
         click, the held finger and the menu key open the same list, so the plus
         answers every way of asking with the one gesture Emil asked for.
         Left out on a phone and a tablet, which hold one document at a time: a
         plus has no second tab to open, and the round button over the note is
         what makes one there. Left out rather than hidden, so no key reaches it
         and nothing reads it out. -->
    {#if !viewport.touch}
      <!-- Named for the pane it belongs to, so Ctrl+T can press the plus of the pane
           that has the keyboard rather than the first one on screen; see focus.ts. -->
      <button
        class="new"
        data-new={paneId}
        title={t('New')}
        aria-label={t('New')}
        aria-haspopup="menu"
        onclick={showNewMenu}
        oncontextmenu={showNewMenu}
        use:longPress={showNewMenu}
      >
        <svg viewBox="0 0 12 12"><path d="M6 2v8M2 6h8" /></svg>
      </button>
    {/if}
  </div>

  <!-- Two links of a chain: this pane scrolls with the other one on the same
       note. Only there while there is another one. -->
  {#if twinned}
    <button
      class="link"
      class:on={pane?.linked}
      title={pane?.linked ? t('Scroll on its own') : t('Scroll together')}
      aria-label={pane?.linked ? t('Scroll on its own') : t('Scroll together')}
      aria-pressed={!!pane?.linked}
      onclick={() => workspace.toggleLink(paneId)}
    >
      <svg viewBox="0 0 14 14">
        <path
          d="M5.6 8.4 8.4 5.6M6.6 4 8 2.6a2.8 2.8 0 0 1 4 4L10.6 8M7.4 10 6 11.4a2.8 2.8 0 0 1-4-4L3.4 6"
        />
      </svg>
    </button>
  {/if}
</div>

<style>
  /* The room the tabs get. Measured from what they need (`auto`) and not from
     nothing: with a basis of zero the strip and the empty stretch it sits
     beside in the titlebar each took half the row, so the names were cut with
     half the bar standing empty. Grows into the rest of the row, gives it all
     back before the window controls do. */
  .strip {
    display: flex;
    align-items: stretch;
    min-width: 0;
    flex: 1 1 auto;
  }

  /* Shrinks before the window controls do, and scrolls once it runs out. */
  .tabs {
    display: flex;
    align-items: stretch;
    gap: 2px;
    min-width: 0;
    flex: 1 1 auto;
    padding: 0 var(--space-1);
    overflow-x: auto;
    scrollbar-width: none;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  /* The pane that is not being worked in says so by receding. Nothing is drawn
     around the words themselves; a line there is a line to read past. */
  .tabs.quiet {
    opacity: 0.55;
  }

  /* Where the pane has been, at the head of the strip. Quiet until there is
     something to press, and never in the way: the pair is the width of two marks
     and gives none of it back as the strip fills. */
  .steps {
    display: flex;
    align-items: center;
    flex: none;
    padding-inline-start: var(--space-1);
  }

  .step {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    display: grid;
    place-items: center;
    border-radius: var(--radius-row);
    color: var(--muted);
  }

  .step:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .step:active:not(:disabled) {
    background: var(--surface-press);
  }

  .step:disabled {
    opacity: 0.35;
  }

  .step svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The one plus, and it makes a note. A handheld has no tab strip, so there it
     is at the end of the list panel's header instead; see docs/design.md. */
  .new {
    flex: none;
    align-self: center;
    width: var(--row-height);
    height: var(--row-height);
    display: grid;
    place-items: center;
    margin-inline-start: 2px;
    border-radius: var(--radius-row);
    color: var(--muted);
  }

  .new:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .new:active {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .new svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  .link {
    flex: none;
    align-self: center;
    width: var(--row-height);
    height: var(--row-height);
    display: grid;
    place-items: center;
    margin: 0 var(--space-1);
    border-radius: var(--radius-row);
    color: var(--muted);
  }

  .link:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .link:active {
    background: var(--surface-press);
  }

  .link.on {
    color: var(--accent);
    background: var(--surface-selected);
  }

  .link svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
  }

  /* Not selectable: a double click keeps the tab, and must not also paint
     its name blue the way it would any other text. */
  .tab {
    display: flex;
    align-items: center;
    position: relative;
    /* As wide as its name needs, capped at `--tab-name` by the name itself.
       Only once the strip is full do they give way, and never past
       `--tab-min`: below that the strip scrolls instead. */
    flex: 0 3 auto;
    min-width: var(--tab-min);
    border-radius: var(--radius-row) var(--radius-row) 0 0;
    user-select: none;
    transition:
      background var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      flex-shrink var(--dur-fast) var(--ease-out);
  }

  /* A tab that is only its mark is as wide as its mark. It never gives way and
     never grows: the strip shares what is left between the tabs that have names
     to show. */
  .tab.pinned {
    flex: none;
    min-width: 0;
  }

  .tab.pinned .pick {
    padding: 7px 8px;
  }

  /* The tab being read gives way a third as fast as the rest, so the name of
     the note in front of you is the last one still worth reading. Eased, so
     that in a full strip the two tabs trade their width rather than swap it. */
  .tab.active {
    flex-shrink: 1;
  }

  .tab:hover {
    background: var(--surface-hover);
  }

  /* The tab answers the click itself, before the note it holds has been laid
     out - which on a large note is the difference between prompt and slow. */
  .tab:active {
    background: var(--surface-press);
  }

  /* Where a tab being dragged would land: a line down the edge it arrives at,
     the accent line the bookmarks draw for a row on its way somewhere. Drawn
     into the tab rather than beside it, so the underline the active tab wears
     underneath is left alone. */
  .tab.before {
    box-shadow: inset 2px 0 0 0 var(--accent);
  }

  .tab.after {
    box-shadow: inset -2px 0 0 0 var(--accent);
  }

  /* The note being read is filled, the same fill its row in the file list
     wears, so "the one you have open" looks the same wherever the app says it.
     The line that slides in underneath says which pane the keys go to. */
  .tab.active {
    background: var(--surface-selected);
  }

  .tab.active::after {
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 2px;
    background: var(--accent);
    animation: underline var(--dur-base) var(--ease-out);
  }

  /* In a pane nobody is writing in, the line is still there and no longer
     shouts: which pane the keys go to is the accent's job. */
  .tabs.quiet .tab.active::after {
    background: var(--muted);
  }

  @keyframes underline {
    from {
      transform: scaleX(0);
    }
  }

  button {
    border: none;
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .pick {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 auto;
    min-width: 0;
    padding: 7px 4px 7px 10px;
    overflow: hidden;
    white-space: nowrap;
  }

  /* The name, and the whole of what a tab is as wide as. The dots and the book
     beside it keep their size; this is the part that shortens. */
  /* A note's own name, isolated: a file called `خطة.md` in a strip that reads
     left to right keeps its extension at its own end rather than throwing the
     dot across the name. See .nib-row-label in base.css. */
  .label {
    min-width: 0;
    max-width: var(--tab-name);
    overflow: hidden;
    text-overflow: ellipsis;
    unicode-bidi: isolate;
  }

  .tab.active .pick {
    color: var(--text-strong);
  }

  /* Italic says the note is only being looked at, and that the next thing
     clicked in the file list will take this tab's place. */
  .tab.preview .pick {
    font-style: italic;
  }

  /* The open book, after the mark that says what the tab holds and before the name:
     the two say different kinds of thing and should not be read as one pair, and a
     state belongs beside the name rather than in front of the mark. Smaller than the
     mark, because it is about the note rather than what the note is. */
  .reading {
    width: var(--icon-sm);
    height: var(--icon-sm);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.1;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.75;
  }

  /* The whole report on saving: unwritten, going down, down. Colour and a
     breath of movement rather than a spinner - it is ambient, not an event. */
  .dot {
    width: 5px;
    height: 5px;
    flex: none;
    border-radius: 50%;
    background: var(--accent);
    transition:
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }

  .dot.writing {
    animation: breathe 900ms var(--ease-in-out) infinite;
  }

  /* One dot per other device in the note, stacked so they read as a small group
     rather than as a row of separate marks. Three at most: past that the answer
     is "several", and counting them is not what anyone is looking for. */
  .here {
    display: flex;
    flex: none;
    align-items: center;
    /* Overlapped by a third of themselves, which is what makes a stack. */
    margin-inline-end: -2px;
  }

  .who {
    width: 5px;
    height: 5px;
    flex: none;
    margin-inline-end: -2px;
    border-radius: 50%;
    background: var(--accent);
    /* A ring in the tab's own colour, so two dots against each other still read
       as two. */
    box-shadow: 0 0 0 1.5px var(--bg);
  }

  .dot.down {
    background: var(--success);
    transform: scale(0.8);
  }

  @keyframes breathe {
    50% {
      opacity: 0.35;
    }
  }

  /* Movement is a preference, and a dot that pulses forever is exactly what
     it is about. The colour still says which state it is in. */
  @media (prefers-reduced-motion: reduce) {
    .dot.writing {
      animation: none;
      opacity: 0.55;
    }
  }

  .shut {
    display: grid;
    place-items: center;
    flex: none;
    width: var(--row-height-sm);
    height: 100%;
    padding: 0 var(--space-1) 0 0;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .tab:hover .shut,
  .shut:focus-visible {
    opacity: 1;
  }

  .shut:hover {
    color: var(--danger);
  }

  /* A press is a step stronger than the hover, and "stronger" is towards the ink
     rather than towards black: mixed with black it came out darker than the
     danger colour on a dark theme, which is a press that reads as fading. */
  .shut:active {
    color: color-mix(in srgb, var(--danger) 78%, var(--text-strong));
  }

  /* A mark inside a row that is not the row's own, which is `--icon-sm`. It was
     7px: a cross a third the size of every other cross in the app, on the one
     button a tab has. */
  .shut svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }
</style>
