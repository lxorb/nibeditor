<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import { t } from './lib/i18n.svelte'
  import { scanHeadings } from './lib/outline'
  import { moveSection } from './lib/sections'
  import { pageHeight, scrollerOf, showField, viewport } from './lib/viewport.svelte'
  import { closeOnBack } from './lib/backstack.svelte'
  import { takesCaret } from './lib/caret'
  import { EditorView, landed, setVimCommands, showLine, topLine } from '@nib/editor'
  import { iconChoice } from './lib/icon-choice.svelte'
  import { menu, textFieldOf } from './lib/menu.svelte'
  import { overlays } from './lib/overlays'
  import PaneTree from './lib/PaneTree.svelte'
  import FirstScreen from './lib/FirstScreen.svelte'
  import Sidebar from './lib/Sidebar.svelte'
  import { present } from './lib/slides/present.svelte'
  import SizeBadge from './lib/SizeBadge.svelte'
  import StorageWarning from './lib/StorageWarning.svelte'
  import { watchTextSize } from './lib/text-size'
  import UpdateNotice from './lib/UpdateNotice.svelte'
  import { account } from './lib/account.svelte'
  import { joining } from './lib/joining.svelte'
  import { arriving } from './lib/arriving.svelte'
  import { busy } from './lib/busy.svelte'
  import FirstSync from './lib/FirstSync.svelte'
  import Progress from './lib/Progress.svelte'
  import { drawer, rightDrawer } from './lib/drawer.svelte'
  import { fullscreen } from './lib/fullscreen.svelte'
  import { chrome } from './lib/glass/chrome.svelte'
  import { paintCodePalette } from './lib/highlight'
  import { linkScroll, type ScrollEnd } from './lib/linked-scroll'
  import { recovery } from './lib/recovery.svelte'
  import { reloading } from './lib/reloading.svelte'
  import { hasStatusBar } from './lib/regions'
  import { pages } from './lib/pages/showing.svelte'
  import { rooms } from './lib/rooms.svelte'
  import { said } from './lib/said.svelte'
  import { search } from './lib/search.svelte'
  import { prompt } from './lib/prompt.svelte'
  import { settings } from './lib/settings.svelte'
  import {
    contextMenu,
    fillBar,
    formatBar as formatBarDoor,
    fullscreenWayOut,
    historySheet,
    iconPicker,
    joinSheet,
    importSheet,
    newKindChord,
    newKindDialog,
    spacePickerDialog,
    hostPickerDialog,
    paletteDoor,
    promptSheet,
    publishSheet,
    quickAddSheet,
    quickSheet,
    recordingPill,
    rewriteSheet,
    scratchpadCard,
    settingsSheet,
    shareSheet,
    signInSheet,
    slidesStage,
    spaceChooserCard,
    menuBarDoor,
    undoToastNotice,
  } from './lib/surfaces.svelte'
  import { canWriteIn, share, sharedWithYou } from './lib/sharing.svelte'
  import { start } from './lib/start'
  import { startup } from './lib/startup.svelte'
  import { sync } from './lib/sync.svelte'
  import StatusBar from './lib/StatusBar.svelte'
  import Titlebar from './lib/Titlebar.svelte'
  import { modes } from './lib/modes.svelte'
  import { links } from './lib/link-index.svelte'
  import { updates } from './lib/updates.svelte'
  import { usage } from './lib/usage.svelte'
  import { invoke, isDesktop, platform } from './lib/tauri'
  import { theme } from './lib/theme.svelte'
  import { views } from './lib/views.svelte'
  import { workspace } from './lib/workspace.svelte'
  import { saveFront } from './lib/save-place/door'
  import { shown as pad } from './lib/scratchpad/is.svelte'
  import { scale } from 'svelte/transition'
  import { LAYER } from './lib/motion'
  import { isDraft } from './lib/workspace/drafts'
  import { shortcuts } from './lib/shortcuts.svelte'
  import { toolbar } from './lib/toolbar.svelte'
  import { pull } from './lib/pull.svelte'
  import PullMark from './lib/PullMark.svelte'
  import { type AppContext, runEntry } from './lib/shortcuts/registry'
  import { writeNew } from './lib/write-new'

  /** The editor of the pane that has the focus, which is what every key, every
   *  menu and the palette act on. Each pane leaves its own here; see
   *  views.svelte.ts. */
  const view = $derived(views.of(workspace.panes.focusedId))

  // Where a right click keeps the Mac's own menu; see system-menu.ts.
  let keepsSystemMenu: typeof import('./lib/system-menu').keepsSystemMenu = () => false
  if (platform() === 'macos') {
    void import('./lib/system-menu').then((one) => (keepsSystemMenu = one.keepsSystemMenu))
  }
  /** The tab whose note is on the stage, while one is. The deck goes over the
   *  whole window, and the note stays open behind it. */
  const presenting = $derived(workspace.tabs.find((tab) => tab.id === present.tabId) ?? null)
  /** Whether the note on the stage is one this account may write in. A space
   *  somebody shared to read says the same word in the strip that the reader's
   *  own read-only switch does; see sharing.svelte.ts. */
  const canWriteHere = $derived(canWriteIn(workspace.active?.note))
  /** Whether a tab fills the window; see lib/tab-fill. */
  const filled = $derived(workspace.panes.fills !== null)
  /** Whether each side's panel is built. Once it has been open it stays built, shut
   *  or not, and the launch's last turns build it shut where it never was: opening
   *  it is then a column sliding open over rows already laid out, never a panel made
   *  in the frame it was asked for. See the column in Sidebar.svelte. A turn for each
   *  side, see startup.svelte.ts; and none for a right side every panel has left,
   *  which has nothing it could open on. Latched, so a side never goes back to
   *  unbuilt. */
  const built = { left: false, right: false }
  const keptLeft = $derived((built.left ||= workspace.panel !== null || startup.reached('left')))
  const keptRight = $derived(
    (built.right ||=
      workspace.rightPanel !== null || (startup.reached('right') && workspace.nextRight !== null)),
  )
  let palette = $state(false)
  /** The palette itself, for the one thing a flag cannot say: Ctrl+Shift+P opens it
   *  on the commands, which is a `>` in its field and a caret after it. */
  let paletteScreen = $state<{ showCommands(): void; dismiss(): void }>()
  /** The formatting bar, once it is on the page. */
  let formatBar = $state<{ follow(view: EditorView): void }>()
  /** The element holding both layers, which is what the drawer gesture
   *  listens on. */
  let middle = $state<HTMLElement>()

  /** The overlays, knocked on.
   *
   *  Every sheet the app opens over what is under it is fetched rather than imported:
   *  none of them is on screen when the window opens, and between them they were the
   *  larger half of what the shell still carried. Each is mounted the first time
   *  something opens it and kept mounted afterwards, so its own way in and out is
   *  exactly what it was - a component unmounted the moment it closed would have no
   *  way out to play, and the sheet's own `{#if}` is what plays it either way.
   *
   *  Each door remembers being asked, so what is on the page is the door's own
   *  answer rather than a second list of flags here; see surfaces.svelte.ts. Set once
   *  and kept unless the fetch failed: `{#await}` on a promise that has already
   *  resolved renders in the same pass, so the second open costs nothing and only the
   *  first ever sees an empty frame.
   *
   *  Four of the six are knocked on here, because their stores are ones this
   *  component already holds and none of them has a single way in to say it from. The
   *  publish sheet and the import sheet are not: neither store is carried here at
   *  all, and each knocks on its own door as it is shown.
   *
   *  The deck is not here either: it takes the tab it is presenting as a prop, so
   *  there is nothing for it to be while nothing is presented and its own `{#if}` is
   *  the boundary already. */
  $effect(() => {
    if (settings.open) void settingsSheet.ask()
    if (settings.historyOpen) void historySheet.ask()
    if (share.open) void shareSheet.ask()
    if (iconChoice.target) void iconPicker.ask()
    if (menu.open) void contextMenu.ask()
    if (account.open) void signInSheet.ask()
    if (joining.step) void joinSheet.ask()
    // A phone's strip over the keys is up whenever the note is being written in,
    // selection or none; see FormatBar.svelte.
    if (viewport.touch && viewport.typing) void formatBarDoor.ask()
  })

  // Everything that has to happen as the app comes up; see start.ts.
  onDestroy(start())

  // What `:w`, `:q` and `:e` mean, since all three act on the app rather than
  // on the text. The palette is this component's own state, which is why this
  // is said here rather than in start.ts; `:e` opens it on its note search,
  // which is what a reader typing `:e` is after.
  setVimCommands({
    write: saveFront,
    quit: () => void workspace.closeActive(),
    edit: () => {
      palette = true
    },
  })

  const onMac = platform() === 'macos'

  // The header shows no title, so the note's name goes to the window itself -
  // which is what the taskbar and the window switcher read. Fetched rather than
  // carried, since nothing about it has to be there for the first paint; the
  // facts are read here so the effect follows them. See window-document.ts.
  $effect(() => {
    const active = workspace.active
    const facts = active && { shown: active.shown, path: active.path, draft: isDraft(active.note) }
    void import('./lib/window-document').then(({ windowDocument }) => {
      const inWindow = windowDocument(facts, onMac)
      document.title = inWindow.title
      if (isDesktop) void invoke('show_document', { ...inWindow }).catch(() => undefined)
    })
  })

  // The account's settings come along with the account: when the session is
  // restored at start, and again on signing in. One request brings all of
  // them, so what the modes fetched is handed on rather than asked for twice.
  // A guest has no settings on any account, so there is nothing to ask for.
  $effect(() => {
    const token = account.accountToken
    if (token) {
      void modes.adopt(token).then((remote) => {
        if (!remote) return

        shortcuts.receive(remote)
        toolbar.receive(remote)
        pull.receive(remote)
        recovery.receive(remote)
      })
    }
  })

  // Each pane applies the modes and the keys to its own editor as it builds it;
  // see Pane.svelte. What is left here is the formatting bar, which follows the
  // selection of whichever pane is being written in.
  //
  // The bar is fetched rather than carried (see surfaces.svelte.ts), so a selection
  // made before it has landed asks for it and is followed as it arrives.
  async function followWhenLanded(current: EditorView) {
    await formatBarDoor.ask()
    await tick()
    formatBar?.follow(current)
  }

  $effect(() => {
    views.onSelection = (current: EditorView) => {
      if (formatBar) formatBar.follow(current)
      else if (!current.state.selection.main.empty) void followWhenLanded(current)
    }
    return () => {
      views.onSelection = null
    }
  })

  // Ctrl and the wheel over the note, which a trackpad pinch also arrives as.
  // Here rather than on the surface, because the surface is rebuilt with every
  // note; see text-size.ts.
  $effect(() => watchTextSize())

  // What pulling a list or a note down past its top runs. The surfaces it is
  // attached to have no idea what the app is showing, so the runner is left
  // here, where the context the keyboard uses is already built; see
  // pull.svelte.ts.
  $effect(() => {
    pull.runs = () => void runEntry(pull.id, appContext())
    return () => {
      pull.runs = null
    }
  })

  // A phone and a tablet show one document at a time, so an arrangement made on a
  // desktop - or on this window before it became one of those devices - comes
  // down to one pane with one document in it. See `workspace.oneDocument`.
  $effect(() => workspace.oneDocument())

  // The icons the account holds for a space's folders, how it says the space's
  // graph is drawn, and what it leaves out of its own search, taken on whenever its
  // listing changes. Neither has a file to
  // live in - a folder has no file, and a filter is not something a note says - so
  // unlike a note's icon they come down with the space; here rather than in the
  // syncing loop because both are written by a gesture in the app and this is where
  // the account's listing is already being watched. See workspace/folder-icons and
  // workspace/graph-settings.
  $effect(() => {
    const who = account.user?.id
    if (!who) return

    for (const space of workspace.spaces) {
      const id = sync.remoteIdFor(space.root)
      const remote = id === null ? undefined : account.spaces.find((one) => one.id === id)
      if (!remote) continue

      workspace.folderIcons.adopt(space.root, remote.icons, remote.tints, who)
      void workspace.arranged.adopt(space.root, remote.arranged, who)
      workspace.graphSettings.adopt(space.root, remote.graph, who)
      workspace.excluded.adopt(space.root, remote.excluded, who)
      void workspace.archive.adopt(space.root, remote.archived, who)
    }
  })

  // The keyboard takes the bottom of the window with it, and the line being
  // written can be left behind it. The height is read so this runs again at each
  // step of the keyboard's arrival rather than once, before there is room, and
  // `panned` so it runs when WebKit slid the page to show the caret instead.
  $effect(() => {
    const [height, panned] = [viewport.height, viewport.panned]
    if (!viewport.typing || !height || panned < 0) return

    // A field that is not the note has the caret - a table's cell, a name being
    // changed in the file list - and was left under the keys once the page was
    // put back. It is brought up in whatever scrolls it: the note for a cell, the
    // list for a name. A card's own editor is the plane's to show; see Canvas.svelte.
    const field = document.activeElement
    if (field instanceof HTMLElement && field !== view?.contentDOM) {
      const scroller = view?.contentDOM.contains(field) ? view.scrollDOM : scrollerOf(field)
      if (scroller) showField(field, scroller, height - viewport.covered)
      return
    }
    if (!view) return

    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.selection.main.head, {
        y: 'nearest',
        yMargin: 24,
      }),
    })
  })

  // A deck whose tab has been closed from somewhere else is no longer being
  // presented, and the window goes back to the size it was.
  $effect(() => {
    if (present.on && !presenting) present.stop()
  })

  // The colours a fenced block wears wherever the renderer drew it; see
  // highlight.ts. Here rather than in the theme, because it is the code palette
  // that decides them and that is a mode.
  $effect(() => paintCodePalette(modes.codeTheme))

  // Two panes on one note, scrolling together while the link is on; see
  // linked-scroll.ts. By document position, so a heading stays level in both.
  $effect(() => {
    const panes = workspace.panes.all.filter((pane) => pane.linked)
    const stops = pairs(panes.map((pane) => pane.id))
      .filter(([one, other]) => workspace.twins(one).includes(other))
      .flatMap(([one, other]) => {
        const first = views.of(one)
        const second = views.of(other)
        return first && second ? [linkScroll(scrollEnd(first), scrollEnd(second))] : []
      })

    return () => {
      for (const stop of stops) stop()
    }
  })

  // A drawer over the note is one more thing over the note, so Escape closes it,
  // the way it closes every drawer anybody has used. Only where it is a drawer: a
  // sidebar docked beside the note is over nothing and Escape in the file list
  // still clears the selection.
  $effect(() =>
    viewport.drawer && workspace.panel ? overlays.show(() => workspace.closePanel()) : undefined,
  )

  // The same for the other side, which is a drawer over the note wherever the
  // left one is; see the right-hand rules in the stylesheet below.
  $effect(() =>
    viewport.drawer && workspace.rightPanel
      ? overlays.show(() => workspace.closePanel('right'))
      : undefined,
  )

  // On a phone each of these is a screen of its own, so back closes it rather
  // than leaving the app - newest first, the way Android expects.
  //
  // Whether a side is covered, worked out before the effect reads it. A `!!` does
  // not narrow what an effect depends on: written inline, these two read `panel`
  // itself, so asking for another panel while the drawer stood re-ran the effect -
  // its teardown gave the history entry back and its body took a new one, in one
  // turn, with `history.back()` answered a turn later. The count drifted, and the
  // third panel in a row walked the window off the end of its own history and out
  // of the app: the drawer went, and `window.nibApp` with it, silently. A derived
  // only wakes what reads it when its own value changes, so a drawer that stays
  // open through three panels is one layer and one entry.
  const covered = $derived(!!workspace.panel)
  const coveredRight = $derived(!!workspace.rightPanel)

  $effect(() => closeOnBack(covered, () => workspace.closePanel()))
  $effect(() => closeOnBack(coveredRight, () => workspace.closePanel('right')))
  $effect(() =>
    closeOnBack(palette, () => {
      palette = false
    }),
  )
  // Asked to open before the launch's last turn has fetched it: fetched now, and it
  // opens as it lands, since it arrives already open. See surfaces.svelte.ts.
  $effect(() => {
    if (palette) void paletteDoor.ask()
  })
  // And the same for a question asked before then.
  $effect(() => {
    if (prompt.open) void promptSheet.ask()
  })
  $effect(() => closeOnBack(menu.open, () => menu.hide()))

  // Full screen is one more thing back closes: a screen with nothing on it but the
  // document has to be as easy to leave as everything else. Escape is in `onKeydown`.
  $effect(() => closeOnBack(fullscreen.on, () => void fullscreen.leave()))

  // And it belongs to the document it was entered on: closing that brings the app
  // back rather than leaving a window with nothing in it. See fullscreen.svelte.ts.
  $effect(() => fullscreen.watch(workspace.tabs.map((tab) => tab.id)))

  // Both drawers follow the finger, the way a phone app's do; see
  // drawer-follow.ts, which is one engine for the two edges. Only where the
  // panels are a drawer: a tablet on its side keeps the sidebar open beside the
  // note, and a column in the layout is not dragged. Fetched rather than carried,
  // for the same reason: a desktop never has a drawer to drag, and a phone's
  // first drag is a thumb that arrives well after the first paint.
  $effect(() => {
    const host = middle
    if (!host || !viewport.drawer) return

    let stop: (() => void) | null = null
    let live = true
    void import('./lib/drawer-follow').then((one) => {
      if (live) stop = one.followDrawers(host)
    })

    return () => {
      live = false
      stop?.()
    }
  })

  // Syncing only runs while there is an account behind it - and not before a
  // fresh sign-in has settled what happens to the notes already here.
  $effect(() => {
    if (account.syncable) {
      sync.start()
      // The bytes are an account's, and a guest is writing into somebody else's.
      if (account.user) void usage.refresh()
    } else {
      sync.stop()
      rooms.clear()
    }
  })

  // The name over a caret is whoever is at this device, and it can change while
  // the note is open: a guest a link let in renaming themselves, or an account
  // choosing a name. Every room they are in hears it at once.
  $effect(() => rooms.rename(account.name ?? undefined))

  // Every open note joins the room its other devices are in. Which notes are open
  // and what the account holds for each are both things the app already knows, so
  // this is the whole of the wiring: no call site has to remember to join or to
  // leave. See rooms.svelte.ts.
  // Last of the things a launch does, because it is the only one of them nobody is
  // looking at: a socket per open note, opened into a window that is already being
  // read and written in. See startup.svelte.ts for the order and why.
  $effect(() => {
    // A file somebody shared on its own has no file here for the mirror to know
    // about, and its room is the whole of how its words travel: it says its own
    // id, with no hash, because there is no copy on this machine to compare.
    // Under sync v2 a note's room is its document's socket, which the engine joins
    // itself; see sync2/runner.svelte.ts.
    const open =
      account.syncable && startup.reached('rooms') && sync.version === 1
        ? workspace.openNotes.map((one) => ({
            ...one,
            tracked: one.note.shared
              ? { id: one.note.shared, version: 0, hash: null }
              : sync.tracked(one.path),
          }))
        : []

    rooms.follow(
      open
        .filter((one) => one.tracked !== null)
        .map((one) => ({
          key: one.key,
          note: one.note,
          noteId: one.tracked?.id ?? '',
          hash: one.tracked?.hash ?? null,
          version: one.tracked?.version ?? 0,
        })),
    )
  })

  // A caret is drawn in the shade its colour needs on this background, so the
  // theme changing repaints every room's. Read for its own sake and nothing else:
  // the scheme is what this listens to.
  $effect(() => {
    rooms.repaint(theme.current)
  })

  // `window.nib` is the editor view; this is the surrounding app state.
  //
  // Not `import.meta.env.DEV`, which is what this used to be. Every drive in
  // test/e2e steers the app through this object, and DEV is false in a bundle, so
  // the only build anything could drive was the one nobody ships. See
  // `__DRIVEABLE__` in env.d.ts.
  if (__DRIVEABLE__) {
    Object.assign(window, {
      nibApp: {
        account,
        arriving,
        busy,
        fullscreen,
        // The picker is opened from a row's menu, which a drive cannot reach; this
        // is how a screenshot run opens it on a note, a canvas or a folder.
        iconChoice,
        overlays,
        // Whether a deck is up, and which tab is on the stage. The stage covers the
        // whole window with no chrome of its own, so a drive that pressed Present has
        // nothing in the page to read it off; see slides/present.svelte.ts.
        present,
        // The page note in front, which is the only way to reach its surface's store
        // from outside its pane: the thumbnails and the page counter already do, and a
        // drive turns pages and reads what is on them the same way. See
        // apps/desktop/test/e2e/pages.py.
        pages,
        rooms,
        share,
        // The files other people shared on their own, so a drive can watch one
        // arrive at the foot of the switcher and disappear again when it is
        // taken back; see apps/desktop/test/e2e/share.py.
        sharedWithYou,
        sync,
        // The update notice, which only a release server puts up; see
        // test/e2e/notices.py.
        updates,
        workspace,
        search,
        settings,
        modes,
        shortcuts,
        theme,
        // What the phone's format bar holds, which a drive puts together and
        // presses, and which command a pull down past the top runs; see
        // apps/desktop/test/e2e/phone-bar.py.
        toolbar,
        pull,
        viewport,
        links,
        views,
      },
    })

    // The stores the shell no longer carries, put on the same handle once they arrive.
    // Each is a sheet or a subsystem a drive reaches by name rather than by pointing -
    // the import sheet opens from a row in File and walks a file chooser, the publish
    // sheet from a space's own menu, the rewrite sheet from a right-click in the note,
    // and the AI providers are set up against a fake OpenAI-compatible server rather
    // than anybody's key - and none of them is any use to the app until somebody asks.
    // See surfaces.svelte.ts, test/e2e/import.py, test/e2e/site.py and test/e2e/ai.py.
    // Fetched here rather than imported so that a development build is the only one
    // that pays for them, and awaited by every drive the same way the space is:
    // nothing reaches any of these before the space is open. The agents' stand-in is
    // how a drive sees Settings > Agents in a browser, which has no crate to ask; see
    // agents/settings/fake.ts. And the theme gallery, which a drive cannot reach by
    // pointing either: it sits over the settings sheet. Its store brings the catalogue
    // and the reviewer every installed theme goes through, and a shell that imported it
    // for this handle carried both into every launch; see test/weight.test.ts.
    void Promise.all([
      import('./lib/importing.svelte'),
      import('./lib/publishing.svelte'),
      import('./lib/ai/store.svelte'),
      import('./lib/ai/rewriting.svelte'),
      import('./lib/sync2/fake-engine.svelte'),
      import('./lib/agents/settings/fake'),
      // The wallpaper, whose picture a drive hands over as bytes.
      import('./lib/wallpaper/wallpaper.svelte'),
      import('./lib/themes/store.svelte'),
    ]).then(
      ([
        { importing },
        { publish },
        { ai },
        { rewriting },
        sync2,
        { standIn },
        { wallpaper },
        { store },
      ]) => {
        Object.assign((window as unknown as { nibApp: object }).nibApp, {
          // The rows and the views, which a drive opens by name and reads back: fetched
          // when it asks, being the largest graph here; see test/e2e/tasks.py.
          tasks: () =>
            Promise.all([
              import('./lib/rows/rows.svelte'),
              import('./lib/views/open'),
              import('./lib/workspace/write-file'),
            ]).then(([{ rows }, views, { writeFile }]) => ({ rows, ...views, writeFile })),
          agents: { standIn },
          ai,
          importing,
          publish,
          rewriting,
          sync2,
          wallpaper,
          themeStore: store,
        })
      },
    )
  }

  /** A canvas and a page note, which have a bar of their own with a way to add. */
  const ownBar = (kind: string | undefined) => kind === 'canvas' || kind === 'pages'

  /** Every pair of panes in a list of them, each pair once. */
  function pairs(ids: string[]): [string, string][] {
    const out: [string, string][] = []
    for (const [at, one] of ids.entries()) {
      for (const other of ids.slice(at + 1)) out.push([one, other])
    }

    return out
  }

  /** An editor as one end of a scroll link: where it is in the note, and how to
   *  put it somewhere in it. */
  function scrollEnd(current: EditorView): ScrollEnd {
    return {
      top: () => topLine(current),
      show: (position: number) => showLine(current, position),
      onScroll: (run: () => void) => {
        current.scrollDOM.addEventListener('scroll', run, { passive: true })
        return () => current.scrollDOM.removeEventListener('scroll', run)
      },
    }
  }

  /** A text field's own menu, on the way down so a row holding the field does not
   *  offer its own instead; see field-menu.ts. A phone has the system's. */
  function onFieldMenu(event: MouseEvent) {
    const field = viewport.touch ? null : textFieldOf(event.target)
    if (!field) return

    event.preventDefault()
    event.stopPropagation()
    // Not in the glasses' plugin, which is a phone's and so never asks.
    if (!__EVEN_PLUGIN__) {
      void import('./lib/field-menu').then((one) => one.showFieldMenu(event, field))
    }
  }

  /** The two buttons on the side of a mouse. They are the browser's back and
   *  forward everywhere else, so they are the tab's here - and the browser's own
   *  is taken off them, or the web build would leave the app entirely. */
  function onMouse(event: MouseEvent) {
    if (event.button !== 3 && event.button !== 4) return

    event.preventDefault()
    if (event.button === 3) workspace.goBack()
    else workspace.goForward()
  }

  function goto(line: number) {
    if (!view) return

    // Going somewhere in the note means wanting to see it, and a drawer is in
    // the way. A sidebar docked beside the note is not, and stays.
    if (viewport.drawer) workspace.closePanel()

    const target = view.state.doc.line(Math.min(line + 1, view.state.doc.lines))
    view.dispatch({
      selection: { anchor: target.from },
      // The block it landed on says so for a moment: a caret is a pixel wide and
      // the eye was somewhere else. See landing.ts in @nib/editor.
      effects: [
        EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 72 }),
        landed.of(target.from),
      ],
    })
    view.focus()
  }

  /** A whole section moved, from the outline. One transaction, so it is one
   *  thing to undo, and the words it moves are the only words that change - a
   *  note open in another pane keeps every caret outside them where it was; see
   *  sections.ts and shared.ts. */
  function moveSectionTo(from: number, to: number) {
    // The pane holding the note the outline is about, which is the one being
    // worked in unless a panel is held on another; see panelTab in
    // workspace.svelte.ts. Dragging a section moves the note the rows came from.
    const view = views.of(workspace.panelTab?.paneId ?? workspace.panes.focusedId)
    if (!view || view.state.readOnly) return

    const text = view.state.doc.toString()
    const made = moveSection(text, scanHeadings(text), from, to, view.state.selection.main.head)
    if (!made) return

    view.dispatch({
      changes: made.changes,
      selection: { anchor: made.caret },
      scrollIntoView: true,
      userEvent: 'move.section',
    })
  }

  // A followed link, or a bookmarked heading, lands on a line the editor cannot
  // know: the workspace works it out from the note it just loaded and leaves it
  // here.
  //
  // Two things about the timing, both of which used to leave the note open at
  // its top instead. The view is waited for rather than checked inside `goto`,
  // because opening another note builds a new one and for a moment there is
  // none. And the jump is made on the next frame, because a fresh view is given
  // the place the note was last read at on the frame after it appears - see
  // placement.svelte.ts, whose effect is declared above this one and so takes
  // that frame first. Being asked for a heading is newer than being remembered
  // at a line, so this lands on top.
  $effect(() => {
    const asked = workspace.goto
    if (!asked || !view || workspace.active?.path !== asked.path) return

    // Taking the ask down runs this effect again, so nothing is returned to
    // undo the frame: a teardown here would cancel the very jump just asked
    // for. The frame is harmless on its own - `goto` needs a view.
    workspace.goto = null
    requestAnimationFrame(() => goto(asked.line))
  })

  /** What is showing in the pane that has the focus, as the caret rule reads it. */
  const showing = $derived(workspace.showing(workspace.panes.focusedId))

  // The caret goes into the note that is showing, whichever of the many doors it
  // was opened by; see caret.ts for the rule and why there is one. On the frame
  // after, for the reason the jump below waits too: a fresh view is given its
  // remembered place a frame after it appears, and taking the keyboard before
  // that would scroll the note to the caret instead of to where it was left.
  $effect(() => {
    const current = view
    // Read, not used: these are what this effect is watching for. Whether the
    // caret may be taken is decided on the frame, by which time whatever was
    // over the note - the palette a note was chosen in - has gone.
    // Which panel is open is not one of them. A panel opening is not a note
    // arriving, and a key that opens one asks for the keyboard to go into it - so
    // watching the panel here is how Ctrl+Shift+E opened the file list and then
    // took the keyboard straight back out of it. See revealPanel in focus.ts.
    const reasons = [showing?.id, showing?.kind, showing?.reading, workspace.naming, palette]
    if (!current || !reasons.length) return

    const frame = requestAnimationFrame(() => {
      const may = takesCaret(showing ? { kind: showing.kind, reading: showing.reading } : null, {
        overlaid: overlays.depth > 0,
        renaming: workspace.naming !== null,
        presenting: present.on,
        touch: viewport.touch,
      })

      if (may) current.focus()
    })

    return () => cancelAnimationFrame(frame)
  })

  /** Every app-level key comes from one registry, so a rebind reaches the
   *  keyboard, the menus and the palette at once. The one thing it cannot reach
   *  on its own is here: the palette is this component's own state. */
  function onKeydown(event: KeyboardEvent) {
    // Escape closes whatever is over the note, newest first: the settings, a
    // sheet, the palette, a menu, a dropdown inside one of them. Only when
    // there is one, so Escape in the file list still clears the selection and
    // Escape in the editor still steps off a picture. The press goes no further
    // than the one it closed, which is what keeps a note's find bar open under a
    // palette somebody has just dismissed. See overlays.ts.
    if (event.key === 'Escape' && overlays.escape(event)) return

    // Then full screen, which is a mode and not a layer: on the stack it hid a web
    // tab's page, the thing it is meant to fill the screen with. See overlays.ts.
    if (event.key === 'Escape' && fullscreen.on) {
      event.preventDefault()
      event.stopImmediatePropagation()
      void fullscreen.leave()
      return
    }

    // A deck covers the window, so anything the app would open under it is a
    // window nobody can see holding the keyboard nobody can get back. While a
    // note is being presented the only app key is the one that stops.
    if (present.on && !shortcuts.pressed('app.present', event)) return

    // The new-tab chooser stays up while the modifier of its own chord is held and
    // chooses when that is let go, so it is the one command that has to read the
    // keystroke rather than be dispatched from it: a repeat is not a second press. It
    // is fetched rather than carried, and a press in front of that falls through to
    // the plain command below. See new-kind-chord.ts and surfaces.svelte.ts.
    if (newKindChord(event)) return

    // Ctrl+S last, and only where no command took the chord; see `writeKey`.
    if (!shortcuts.handle(event, appContext())) shortcuts.writeKey(event)
  }

  // Shift twice, heard from the launch's last turn; see tapped.ts.
  let untap: (() => void) | undefined
  void startup
    .turn('doors')
    .then(() => import('./lib/tapped').then(({ hear }) => (untap = hear(appContext))))
  onDestroy(() => untap?.())

  /** The palette on the commands, waiting for it the once it has not arrived yet. */
  async function showCommands() {
    await paletteDoor.ask()
    await tick()
    paletteScreen?.showCommands()
  }

  /** What a command from the registry needs that only the running app has. Built
   *  here rather than twice, because the keyboard is not the only thing that
   *  presses one: the buttons on the format bar are registry commands too, and a
   *  bar that built its own context would be a second answer to what the app is
   *  showing. */
  function appContext(): AppContext {
    return {
      view,
      palette: (mode, again) => {
        // Shift Shift over the palette puts it away, as Escape does, and the keyboard
        // goes back where it was; see `tapped` in the registry.
        if (again && palette) paletteScreen?.dismiss()
        else if (mode === 'commands') void showCommands()
        else palette = true
      },
      // The document alone, with the app out of the way and the window's own
      // frame with it; see fullscreen.svelte.ts.
      fullscreen: () => void fullscreen.toggle(workspace.activeTabId),
    }
  }
  // On a Mac the app's menu is the menu bar across the top of the screen, which is
  // why Titlebar.svelte draws no button for it there. Fetched at the launch's last
  // turn, with the in-window menu's rows it is built from, since no other platform
  // has one and nothing about it is needed to show a note. See native-menu.ts. The
  // plugin build is never a Mac, and says so first so the bundler leaves the menu
  // bar and Tauri's menu API out of its package; see vite.even.config.ts.
  if (!__EVEN_PLUGIN__ && isDesktop && platform() === 'macos') {
    void startup
      .turn('doors')
      .then(menuBarDoor)
      .then(({ followMenuBar }) =>
        followMenuBar(() => ({
          view,
          onpalette: () => (palette = true),
          onhistory: () => (settings.historyOpen = true),
          app: appContext(),
        })),
      )
  }

  /** What the app tells somebody with a colour: the gear in the panel's foot is lit
   *  while a pass is running and red when the last one failed. It has no words
   *  anywhere in the page, so it reached no reader who is listening.
   *
   *  Said here rather than in the component, because the region is one region: see
   *  said.svelte.ts. */
  $effect(() => {
    const status = sync.status
    if (status === 'syncing') said.say(t('Syncing'))
    else if (status === 'error') said.say(sync.lastError ?? t('Sync failed'))
    else if (status === 'offline') said.say(t('Offline'))
  })
</script>

<!-- Nothing in the app ever shows the browser's own menu. -->
<svelte:window
  onkeydown={onKeydown}
  oncontextmenucapture={(event: MouseEvent) => {
    // A Mac's text field keeps the system's own menu, which has Look Up and the
    // spelling in it as well as the four; see system-menu.ts. Every other field gets
    // nib's.
    if (!keepsSystemMenu(event.target, platform())) onFieldMenu(event)
  }}
  oncontextmenu={(event: MouseEvent) => {
    if (!keepsSystemMenu(event.target, platform())) event.preventDefault()
  }}
  onmousedown={onMouse}
  onpointermove={() => fullscreen.stir()}
  onpointerdown={() => fullscreen.stir()}
/>

<!-- The page's one heading, which is the note in front of it. There was none at
     all on a desktop: the phone's title bar draws the name as an `h1` and a desktop
     draws it on a tab, so anything reading the page down found a window with no
     top to it. Said and not shown, because the name is already on screen twice. -->
<h1 class="nib-said">{workspace.active?.shown ?? 'nibeditor'}</h1>

<!-- What just happened, for whoever is listening rather than looking. On the page
     before there is anything in it and outside everything that can be made inert,
     which is the whole of what makes a live region work; see said.svelte.ts. -->
<p class="nib-said" role="status" aria-live="polite">{said.words}</p>

<!-- The sidebar runs the full height, so the window's one header row sits beside
     it rather than above everything, and the panel and the document start on
     the same line. -->
<!-- Nothing in the app is reachable while the account's writing is still on
     its way: a note half arrived is not one to type into. See FirstSync.svelte. -->
<!-- As tall as what can be seen, on a touch screen: an iPhone's keyboard covers the
     window rather than shortening it, so a frame the height of the window ended under
     the keys, and WebKit scrolled the whole page up to show the line being typed -
     the bar with it, off the top, and the format bar out of sight. See pageHeight. -->
<main
  class:focus={modes.focus}
  class:full={fullscreen.on}
  inert={workspace.nothingToShow}
  style:height={pageHeight()}
>
  <div class="middle" bind:this={middle}>
    <!-- Side by side on a desktop; a drawer over the document on a phone,
         where there is no room for three columns at once. While a finger is on
         it the transform comes from the drag instead, so it tracks the thumb. -->
    <!-- Wherever the panels are a drawer, a shut drawer is off screen: at the
         narrow end it is behind the note, and above that it is slid off to the
         side. Either way nothing in it can be reached, so nothing in it is
         announced or reachable by a key either - which is what keeps the
         drawer's own sidebar button from being read out on a phone held
         sideways, where the only thing a thumb can reach is the bar's. -->
    <!-- Full screen leaves the document and nothing else: no file list, no
         bars. Left out rather than slid away, so nothing in them can be reached
         by a key while they are gone; see fullscreen.svelte.ts. A tab filling the
         window leaves the same, and its bar at the top edge; see lib/tab-fill. -->
    {#if !fullscreen.on && !filled}
      <div
        class="panels"
        data-chrome="start"
        data-theme={chrome.theme}
        inert={viewport.drawer && !workspace.panel}
        class:open={!!workspace.panel}
        class:held={drawer.held}
        class:dragging={drawer.at !== null}
        class:settling={drawer.settle !== null}
        style:transform={drawer.at === null || viewport.narrow
          ? undefined
          : `translateX(calc(var(--dir) * ${drawer.at - drawer.width}px))`}
        style:--settle={drawer.settle === null ? undefined : `${drawer.settle}ms`}
        ontransitionend={(event) => drawer.arrived(event)}
      >
        {#if keptLeft}
          <Sidebar ongoto={goto} onmovesection={moveSectionTo} />
        {/if}
      </div>
    {/if}

    <!-- On a phone too narrow for the drawer to leave any of the note showing,
         the layers swap: the list is the floor and the note is what moves,
         sliding off to the right to uncover it and back over it. The same
         drag drives both; only which layer it moves differs. -->
    <!-- Off to the side, the note is out of reach as a shut drawer is. WebKit
         scrolls even this page to show what takes the focus: the note taking it
         as Nib started slid it across, over the list the phone had open. -->
    <div
      class="document"
      inert={viewport.narrow && viewport.drawer && !!workspace.panel}
      class:open={!!workspace.panel}
      class:held={drawer.held}
      class:dragging={drawer.at !== null}
      class:settling={drawer.settle !== null}
      style:transform={drawer.at === null || !viewport.narrow
        ? undefined
        : `translateX(calc(var(--dir) * ${drawer.at}px))`}
      style:--settle={drawer.settle === null ? undefined : `${drawer.settle}ms`}
      style:--shade={drawer.progress === null ? undefined : 1 - drawer.progress}
      ontransitionend={(event) => drawer.arrived(event)}
    >
      {#if (workspace.panel ?? workspace.rightPanel) !== null && !fullscreen.on}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <!-- One scrim for both drawers, which is why it fades with whichever of
             them a finger is on. Only one can be moving: a gesture belongs to one
             edge. Inside the document, because the right drawer is too: at the
             narrow end the document is a layer of its own, and a scrim outside it
             was drawn over the drawer it was meant to be under. -->
        <div
          class="scrim"
          class:over={!!workspace.rightPanel}
          class:held={drawer.held || rightDrawer.held}
          class:dragging={drawer.at !== null || rightDrawer.at !== null}
          style:opacity={drawer.progress ?? rightDrawer.progress ?? undefined}
          onclick={() => {
            workspace.closePanel()
            workspace.closePanel('right')
          }}
        ></div>
      {/if}

      <!-- The three dots at the right end of it open the whole of the app on a
           phone and a tablet, which is why the bar is handed what the menu needs;
           see AppMenu.svelte. -->
      {#if !fullscreen.on}
        {#if filled}
          {#await fillBar() then FillBar}
            <FillBar>{@render bar()}</FillBar>
          {/await}
        {:else}
          {@render bar()}
        {/if}
      {/if}

      <!-- The note and, beside it, the other side of the window - which is empty
           for everybody until a panel is moved over to it: nothing is drawn at all
           until then, so the left side, the foot row and the tab strip are exactly
           where they always were. Its own toggle is in the bar and appears with
           it; see Titlebar.svelte.

           Under the bar rather than beside it, which is where the left sidebar
           sits: the bar carries the window's own buttons at its right end, and a
           column to the right of it would push them out of the corner every
           window on every platform keeps them in.

           Wherever the panels are drawers - a phone, a tablet held upright - this
           one comes in from the right over the note, the way a members panel
           does, and the same scrim dismisses it. A thumb drags it out and back,
           with the same claim, the same clamp and the same settle the left one
           has: one engine serves both edges and each drawer carries the sign that
           says which edge is its own. See drawer.svelte.ts. -->
      <div class="body">
        <!-- One pane, or up to four of them; see PaneTree.svelte. Anything slow
             enough to be waited for draws a line along the top of them. -->
        <div class="panes" data-panes>
          <Progress />
          <PaneTree frame={workspace.panes.frame} />
          <!-- The note the window was left on, as it was left, until its editor is up;
               see first-screen.svelte.ts. Not on a pair of glasses. -->
          {#if !__EVEN_PLUGIN__}
            <FirstScreen />
          {/if}
        </div>

        <!-- Docked, so a web page narrows rather than covers it; see scratchpad/pad.ts. -->
        {#if pad.on && !fullscreen.on && !filled && !__EVEN_PLUGIN__}
          <div
            class="pad"
            data-scratchpad
            style:width="{pad.width}px"
            transition:scale={{ duration: LAYER.rise, start: LAYER.start }}
          >
            {#await scratchpadCard() then Card}<Card />{/await}
          </div>
        {/if}

        {#if workspace.right.length && !fullscreen.on && !filled}
          <div
            class="panels right"
            data-chrome="end"
            data-theme={chrome.theme}
            inert={viewport.drawer && !workspace.rightPanel}
            class:open={!!workspace.rightPanel}
            class:held={rightDrawer.held}
            class:dragging={rightDrawer.at !== null}
            class:settling={rightDrawer.settle !== null}
            style:transform={rightDrawer.at === null
              ? undefined
              : `translateX(calc(var(--dir) * ${rightDrawer.width - rightDrawer.at}px))`}
            style:--settle={rightDrawer.settle === null ? undefined : `${rightDrawer.settle}ms`}
            ontransitionend={(event) => rightDrawer.arrived(event)}
          >
            {#if keptRight}
              <Sidebar side="right" ongoto={goto} onmovesection={moveSectionTo} />
            {/if}
          </div>
        {/if}
      </div>

      <!-- What the app says about itself, in a row under the panes rather than over
           them: a web page is a native webview that draws above all of this, so a
           card over it blanked the page and a pill over it was hidden. Empty, the
           row has no height. See docs/web-tabs.md. Where the panels are a drawer
           it is under both instead; see below. -->
      {#if !viewport.drawer}
        {@render notices()}
      {/if}

      <!-- Over a note and nowhere else: the graph, a canvas and a page note have no
           words for it to count, so it is left out rather than drawn empty and F6
           steps straight past it. One rule, in regions.ts, which is also what the
           keyboard's own table describes. -->
      {#if hasStatusBar(workspace.active?.kind) && !fullscreen.on && !filled}
        <StatusBar
          doc={workspace.active?.doc ?? ''}
          reading={modes.readOnly || !canWriteHere}
          vimMode={modes.vimModeOf(view)}
        />
      {/if}

      <!-- A thumb cannot reach the plus beside the tabs, and on a phone the
           thing you came to do is write a note. Out of the way while the
           keyboard is up, because then you are already writing one, and over a
           canvas or a page note, where it read as adding to the page. -->
      {#if viewport.touch && !workspace.panel && !viewport.typing && !ownBar(workspace.active?.kind) && !fullscreen.on}
        <button class="fab" aria-label={t('New note')} onclick={writeNew}>
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      {/if}

      <!-- The way back out of full screen; see FullscreenLeave.svelte. -->
      {#if fullscreen.on}
        {#await fullscreenWayOut() then WayOut}
          <WayOut />
        {/await}
      {/if}
    </div>
  </div>

  <!-- Under the drawer as well as the note, and over it: in the note the row slid off
       the screen with it whenever the list was out, and a file deleted from the list
       was gone with its Undo somewhere nobody could see or press. -->
  {#if viewport.drawer}
    {@render notices()}
  {/if}
</main>

{#snippet notices()}
  <div class="notices" class:over={viewport.drawer}>
    <StorageWarning />
    {#if undoToastNotice.asked}
      {#await undoToastNotice.asked then UndoToast}
        <UndoToast />
      {/await}
    {/if}
    {#if recordingPill.asked}
      {#await recordingPill.asked then RecordingPill}
        <RecordingPill />
      {/await}
    {/if}
    {#if updates.ready}
      <UpdateNotice version={updates.ready} ondismiss={() => updates.dismiss()} />
    {/if}
    {#if reloading.offered}
      <!-- A chunk the network lost; see reloading.svelte.ts. -->
      <div class="reload" role="alert">
        <button class="nib-button" onclick={() => location.reload()}>{t('Reload')}</button>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet bar()}
  <Titlebar
    {view}
    onpalette={() => {
      palette = true
    }}
    onhistory={() => {
      settings.historyOpen = true
    }}
  />
{/snippet}

<!-- Over everything, with no chrome of its own: while a note is being presented
     the window is the deck. Fetched when a deck is first asked for, and the promise
     kept, so the second presentation opens in the same pass as the `{#if}`; see
     surfaces.svelte.ts. -->
{#if presenting}
  {#await slidesStage() then Slides}
    <Slides tab={presenting} />
  {/await}
{/if}

<!-- What a pull has come to, while a thumb is on it. -->
<PullMark />

<!-- What the text size has just become, after a pinch or a key. -->
<SizeBadge />

{#if paletteDoor.asked}
  {#await paletteDoor.asked then Palette}
    <Palette bind:this={paletteScreen} bind:open={palette} {view} ongoto={goto} />
  {/await}
{/if}
<!-- What a fresh install opens on, until there is a space. Fetched only then; the card
     decides the rest itself, and the plugin never shows it, so its build does not
     carry it. See SpaceChooser.svelte and space-choice.ts. -->
{#if !__EVEN_PLUGIN__ && workspace.restored && !workspace.spaces.length}
  {#await spaceChooserCard() then SpaceChooser}
    <SpaceChooser />
  {/await}
{/if}
{#if quickAddSheet.asked}
  {#await quickAddSheet.asked then QuickAddSheet}
    <QuickAddSheet />
  {/await}
{/if}
{#if signInSheet.asked}
  {#await signInSheet.asked then SignIn}
    <SignIn />
  {/await}
{/if}
<!-- The one word a link owes whoever followed it, when it owes one. -->
{#if joinSheet.asked}
  {#await joinSheet.asked then JoinSheet}
    <JoinSheet />
  {/await}
{/if}
<!-- The sheets, each fetched the first time something opens it and kept mounted
     afterwards; the effect above says why, and surfaces.svelte.ts holds the doors.
     The largest of them is the settings sheet - the pane per section, the theme
     store, the sync pane, the AI pane, the security pane - and none of them is on
     screen when the window opens. -->
{#if settingsSheet.asked}
  {#await settingsSheet.asked then SettingsPanel}
    <SettingsPanel {view} />
  {/await}
{/if}
{#if formatBarDoor.asked}
  {#await formatBarDoor.asked then FormatBar}
    <FormatBar bind:this={formatBar} {view} context={appContext} />
  {/await}
{/if}
{#if historySheet.asked}
  {#await historySheet.asked then History}
    <History bind:open={settings.historyOpen} />
  {/await}
{/if}
{#if shareSheet.asked}
  {#await shareSheet.asked then ShareSheet}
    <ShareSheet />
  {/await}
{/if}
{#if publishSheet.asked}
  {#await publishSheet.asked then PublishSheet}
    <PublishSheet />
  {/await}
{/if}
{#if importSheet.asked}
  {#await importSheet.asked then ImportSheet}
    <ImportSheet />
  {/await}
{/if}
{#if rewriteSheet.asked}
  {#await rewriteSheet.asked then RewriteSheet}
    <RewriteSheet />
  {/await}
{/if}
{#if quickSheet.asked}
  {#await quickSheet.asked then QuickQuestion}
    <QuickQuestion />
  {/await}
{/if}
{#if promptSheet.asked}
  {#await promptSheet.asked then PromptSheet}
    <PromptSheet />
  {/await}
{/if}
<!-- What a new tab should be, from Ctrl+T: mounted at the launch's last turn, so the
     first press already has it; see surfaces.svelte.ts. -->
{#if newKindDialog.asked}
  {#await newKindDialog.asked then NewKindSheet}
    <NewKindSheet />
  {/await}
{/if}
<!-- Another space, from Ctrl+Space: mounted at the launch's last turn too. -->
{#if spacePickerDialog.asked}
  {#await spacePickerDialog.asked then SpacePicker}
    <SpacePicker />
  {/await}
{/if}
{#if hostPickerDialog.asked}
  {#await hostPickerDialog.asked then HostPicker}
    <HostPicker />
  {/await}
{/if}
{#if contextMenu.asked}
  {#await contextMenu.asked then ContextMenu}
    <ContextMenu />
  {/await}
{/if}
<!-- Over everything, because everything that wears an icon asks the same sheet
     for one: a space in the switcher, a note in the file list. -->
{#if iconPicker.asked}
  {#await iconPicker.asked then IconPicker}
    <IconPicker />
  {/await}
{/if}
<FirstSync />

<style>
  main {
    /* The way out of full screen, which a web tab's bar makes room for; see `.head`
       in lib/web-tab/WebTab.svelte. */
    --leave-size: 30px;
    display: flex;
    flex-direction: column;
    /* Dynamic units: a phone's address bar eats into the viewport as it
       scrolls, and `vh` would leave the editor taller than the screen. */
    height: 100vh;
    height: 100dvh;
    /* What the shell stands on rather than a colour: under the glass theme the
       platform's material with a wash of the theme's own over it. See base.css. */
    background: var(--shell-ground);
    transition: background var(--dur-slow) var(--ease-out);
  }

  .middle {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .panels {
    display: flex;
    min-height: 0;
  }

  .scrim {
    display: none;
  }

  .document {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* The note and the other side of the window, side by side under the bar. One
     row, because the bar above it spans both: see the note in the markup. */
  .body {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  .pad {
    transform-origin: top right;
  }

  :global([dir='rtl']) .pad {
    transform-origin: top left;
  }

  /* Positioned, so the line that says the app is busy draws along the top of
     the panes rather than over the window's own bar. */
  .panes {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  /* Start, middle and end, whichever of them is up; each card names its track. */
  .notices {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: end;
    gap: var(--space-2);
  }

  /* One column on a phone, where the cards stack. */
  :global([data-touch]) .notices {
    grid-template-columns: 1fr;
  }

  .reload {
    grid-column: 2;
    justify-self: center;
  }

  :global([data-touch]) .reload {
    grid-column: 1;
  }

  /* Above the drawer, which is fixed over the whole height of the window. */
  .notices.over {
    position: relative;
    z-index: var(--z-notice);
  }

  /* Room only around something. `:global`, or the compiler drops a rule about
     another component's element. */
  .notices:has(> :global(*)) {
    padding: var(--space-2) max(var(--space-4), var(--inset-end))
      calc(var(--space-3) + var(--inset-bottom)) max(var(--space-4), var(--inset-start));
  }

  /* Full screen: the panes are the whole window, so what the system keeps for
     its clock, its cutout and its gesture bar is kept clear here instead of by
     the bars that have gone. */
  main.full .panes {
    padding: var(--inset-top) var(--inset-right) var(--inset-bottom) var(--inset-left);
  }

  /* A thumb's target rather than a pointer's; see FullscreenLeave.svelte. */
  :global([data-touch]) main {
    --leave-size: var(--touch-target);
  }

  /* Sits above the document, clear of the gesture bar. */
  .fab {
    position: absolute;
    inset-inline-end: max(var(--space-4), var(--inset-end));
    bottom: calc(var(--space-4) + var(--inset-bottom));
    z-index: var(--z-float);
    width: var(--touch-row);
    height: var(--touch-row);
    display: grid;
    place-items: center;
    border: none;
    border-radius: calc(var(--touch-row) * var(--radius-third));
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: var(--shadow-lg);
    cursor: default;
    transition: transform var(--dur-fast) var(--ease-spring);
  }

  .fab:active {
    transform: scale(0.92);
  }

  .fab svg {
    width: var(--touch-icon);
    height: var(--touch-icon);
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  /* Clear of a notch or a rounded corner, whether the panels are a drawer over
     the note or a column beside it. */
  :global([data-touch]) .panels {
    padding-inline-start: var(--inset-start);
  }

  /* ── Where the sidebar is a drawer over the note ─────────────────── */

  /* Down to the keys rather than the foot of the window: an iPhone's keyboard
     covers the window instead of shortening it, and a name being changed low in
     the list was left under the keys, in a list that could not scroll it up. */
  :global([data-drawer]) .panels {
    position: fixed;
    inset-block: 0 var(--keyboard, 0px);
    inset-inline: 0 auto;
    z-index: var(--z-drawer);
    transform: translateX(calc(var(--dir) * -100%));
    transition: transform var(--dur-base) var(--ease-out);
    box-shadow: var(--shadow-lg);
  }

  :global([data-drawer]) .panels.open {
    transform: none;
  }

  /* A finger is down on something that is about to move. Promoting the layer
     now rather than on the first move means the drag starts on the frame it
     was asked for, and the hint goes again the moment the finger lifts: a
     layer nothing is moving is a layer paid for and not used. */
  :global([data-drawer]) .panels.held,
  :global([data-drawer]) .document.held {
    will-change: transform;
  }

  :global([data-drawer]) .scrim.held {
    will-change: opacity;
  }

  /* The finger is the animation while it is down; CSS takes over on release
     and eases the drawer the rest of the way. */
  :global([data-drawer]) .panels.dragging,
  :global([data-drawer]) .scrim.dragging {
    transition: none;
    animation: none;
  }

  /* After a drag: as long as the distance left asks for, on a curve that
     starts at the finger's pace and eases to a stop rather than snapping. */
  :global([data-drawer]) .panels.settling {
    transition: transform var(--settle) cubic-bezier(0.32, 0.72, 0, 1);
  }

  /* Colour and nothing else. A blur here is a filter the compositor has to
     redraw over the whole screen on every frame of the drag, which is most of
     what a drawer swipe used to cost. */
  :global([data-drawer]) .scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-drawer) - 1);
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    animation: scrim-in var(--dur-fast) var(--ease-out);
  }

  @keyframes scrim-in {
    from {
      opacity: 0;
    }
  }

  /* The other side's drawer comes in from the right and stays a drawer at every
     width: it is a panel over the note, the way a members panel is, rather than
     a floor the note slides off. */
  :global([data-drawer]) .panels.right {
    inset-block: 0;
    inset-inline: auto 0;
    transform: translateX(calc(var(--dir) * 100%));
  }

  :global([data-drawer]) .panels.right.open {
    transform: none;
  }

  /* Not the whole screen, even at the narrowest: a panel that covered
     everything would be a panel with nothing beside it to press to get out, and
     the strip of note left showing is what the scrim is. The left drawer can
     cover the lot because the note slides off to uncover it - this one is over
     the note rather than beside it. */
  :global([data-drawer][data-narrow]) .panels.right {
    width: min(86%, 20rem);
    z-index: var(--z-drawer);
    box-shadow: var(--shadow-lg);
    transition: transform var(--dur-base) var(--ease-out);
    transform: translateX(calc(var(--dir) * 100%));
  }

  :global([data-drawer][data-narrow]) .panels.right.open {
    transform: none;
  }

  /* While a thumb is on it, and the ease that finishes the drag. The same two
     rules the left drawer has, said again for this one because the narrow rule
     above declares a transition of its own and would otherwise animate against
     the finger. After it, so this is the one that stands. */
  :global([data-drawer]) .panels.right.dragging {
    transition: none;
    animation: none;
  }

  :global([data-drawer]) .panels.right.settling {
    transition: transform var(--settle) cubic-bezier(0.32, 0.72, 0, 1);
  }

  /* Full width rather than leaving a sliver of the document showing - and once
     it covers everything it is no longer a drawer over the note but the layer
     beneath it. Only where the panels are a drawer at all: `data-narrow` is the
     width and nothing else, and a desktop window dragged this narrow still has
     its columns. So here the note is what slides: off to the right to uncover
     the list, back over it when a note is chosen. */
  :global([data-drawer][data-narrow]) .panels {
    width: 100%;
    z-index: var(--z-raised);
    transform: none;
    box-shadow: none;
    transition: none;
  }

  /* The note's shadow on the list fades as the note goes, following the finger
     in a drag: at rest off the screen it was a grey band over the list's end. */
  :global([data-drawer][data-narrow]) .document {
    position: relative;
    z-index: var(--z-lifted);
    background: var(--bg);
    box-shadow: calc(var(--dir) * -16px) 0 40px rgb(0 0 0 / calc(0.3 * var(--shade)));
    transition:
      transform var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
    --shade: 1;
  }

  :global([data-drawer][data-narrow]) .document.open {
    transform: translateX(calc(var(--dir) * 100%));
    --shade: 0;
  }

  :global([data-drawer][data-narrow]) .document.dragging {
    transition: none;
  }

  :global([data-drawer][data-narrow]) .document.settling {
    transition:
      transform var(--settle) cubic-bezier(0.32, 0.72, 0, 1),
      box-shadow var(--settle) cubic-bezier(0.32, 0.72, 0, 1);
  }

  /* Nothing to dim: the note is either over the list or off the screen - unless
     what is open is the other side's drawer, which is over the note at every
     width and is dismissed by pressing the note it is over. */
  :global([data-drawer][data-narrow]) .scrim:not(.over) {
    display: none;
  }
</style>
