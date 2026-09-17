<script lang="ts" module>
  /** The writing surface rises into place when the app opens. Once only: the
   *  pane's editor outlives every note it shows, so replaying the entrance would
   *  mean the second pane arriving as if the app had just started. */
  let opened = false

  /** True the first time it is asked, and false ever after. */
  function firstOfTheSession(): boolean {
    const first = !opened
    opened = true
    return first
  }
</script>

<script lang="ts">
  /** One pane's editor: the view, and the note that is in it.
   *
   *  The view is built once and kept. Every note the pane shows is a state
   *  swapped into it - the caret, the scroll and the modes all in the frame the
   *  switch happens in - rather than an editor built and thrown away per tab.
   *  See editor-states.ts, and held.ts in the editor package. */

  import { untrack } from 'svelte'
  import {
    createEditor,
    editorState,
    EditorView,
    type FindAsk,
    HeldState,
    modeEffects,
    type NoteIndex,
    type NoteJump,
    noteIndexEffect,
    type StateEffect,
    type StateOptions,
    shortcutEffect,
    trustedMarkupEffect,
  } from '@nib/editor'
  import { pickedLink } from './composer'
  import { mountPreview } from './preview-card'
  import { EditorStates } from './editor-states'
  import { t } from './i18n.svelte'
  import { modes } from './modes.svelte'
  import { PROPERTY_CHOICES } from './property-choices'
  import { type OverlayScrollbar, overlayScrollbar } from './scrollbar'
  import { shortcuts } from './shortcuts.svelte'
  import { trustsHtmlIn } from './sharing.svelte'
  import { pastesMarkup } from './trust'
  import type { Tab } from './workspace.svelte'

  /* eslint-disable prefer-const -- `view` is bindable, and a $props() pattern cannot be split */
  let {
    tab,
    kept,
    onimage,
    resolveimage,
    openlink,
    onselection,
    notes,
    opennote,
    nameblock,
    onfind,
    view = $bindable(),
  }: {
    /** The note showing in this pane. Anything that depends on which note it is
     *  is asked of the tab rather than captured once, because the pane's editor
     *  outlives the note in it. */
    tab: Tab
    /** Which tabs the pane still holds, as the tabs themselves. A note it no
     *  longer holds lets its document go; see `keepOnly`. */
    kept: Tab[]
    onimage?: (file: File, tab: Tab) => Promise<string | null>
    resolveimage?: (src: string, tab: Tab) => string
    openlink?: (href: string) => void
    onselection?: (view: EditorView) => void
    /** The space around a note, so `[[links]]` can be drawn and completed. */
    notes?: (tab: Tab) => NoteIndex
    opennote?: (jump: NoteJump) => void
    nameblock?: (path: string, line: number) => Promise<string | null>
    /** Ctrl+F and Ctrl+H, which are keys in the editor and a bar in the pane;
     *  null when something in the editor closed it. See find.ts. */
    onfind?: (ask: FindAsk | null) => void
    /** Bound back out: undefined until the view has been made. */
    view?: EditorView | undefined
  } = $props()
  /* eslint-enable prefer-const */

  let host: HTMLDivElement
  const rise = firstOfTheSession()
  const states = new EditorStates()
  /** The pane's own scrollbar, over the editor's scroller. */
  let bar: OverlayScrollbar | undefined
  /** Everything a state needs to be this note's state, all of it read from the
   *  tab so a state built for one note says nothing about another. */
  function optionsFor(one: Tab): StateOptions {
    return {
      shared: one.note.live,
      // The caret belongs in the state: put in afterwards it is a frame the note
      // spends at its own top.
      selection: { anchor: one.cursor ?? 0 },
      // Each handed over only when there is one. The editor has defaults of its
      // own for several of these - `openLink` opens a browser tab - and passing
      // undefined would take the default away rather than leave it in place.
      ...(onimage ? { onImage: (file: File) => onimage(file, one) } : {}),
      ...(resolveimage ? { resolveImage: (src: string) => resolveimage(src, one) } : {}),
      ...(openlink ? { openLink: openlink } : {}),
      ...(onselection ? { onSelection: onselection } : {}),
      ...(notes ? { notes: notes(one) } : {}),
      ...(opennote ? { openNote: opennote } : {}),
      ...(nameblock ? { nameBlock: nameblock } : {}),
      // How a link the `[[` popup writes is spelled: the app's one writer, so the
      // Links setting reaches the popup the way it reaches the grip's Copy link.
      // See composer.ts.
      writeLink: pickedLink,
      ...(onfind ? { onFind: onfind } : {}),
      // The keys the app has a fixed set of answers for, so a property row offers a
      // menu rather than a field somebody has to spell a colour into.
      propertyChoices: PROPERTY_CHOICES,
      // The keys the reader chose, so the first keystroke in a note that has
      // just opened is already theirs.
      shortcuts: shortcuts.forEditor,
      // Whether this note's own HTML is markup, which is what decides whether an
      // interactive block draws its card; see trust.ts.
      trustedMarkup: trustsHtmlIn(one.note),
      // What goes in the card over a `[[link]]`: an editor on the linked note, so a
      // word of it can be fixed from here. See preview-card.ts.
      editPreview: mountPreview,
      // What was folded here last time, in the state for the same reason the
      // caret is: folded a frame later is a frame spent looking at the note
      // unfolded. See fold.ts in the editor package.
      ...(one.folds?.length ? { folds: one.folds } : {}),
    }
  }

  /** Where the note was last being read, as the effect that puts it back. A
   *  position rather than a pixel count: line heights are estimates until they
   *  are measured and change with the width of the window, so the same offset
   *  lands on a different line from one opening to the next. */
  function placeOf(one: Tab): StateEffect<unknown> | null {
    return one.anchor === undefined ? null : EditorView.scrollIntoView(one.anchor, { y: 'start' })
  }

  /** The modes and the keys as one string, which changes whenever any of them
   *  does. Read off what the app holds rather than counted, so a mode nobody
   *  thought to count cannot go missing. */
  function dressing(): string {
    return JSON.stringify([modes.settings, shortcuts.forEditor])
  }

  /** What the app has to say about a note that is not already in its state, in
   *  the transaction that shows the note - so the note appears already dressed
   *  rather than settling over the frames after it.
   *
   *  The space's links go on every time, because the index is a new object
   *  whenever anything in the space changed and putting one in is a field update.
   *  The modes and the keys go on only when they are not what the state was built
   *  or last shown for: each of those is a reconfiguration, and reconfiguring
   *  throws away the parse and every decoration on screen. */
  function fitting(
    one: Tab,
    index: NoteIndex | undefined,
    trusted: boolean,
  ): StateEffect<unknown>[] {
    const stamp = dressing()
    const dressed = states.fitted(one) === stamp
    states.fit(one, stamp)

    return [
      ...(index ? [noteIndexEffect(index)] : []),
      // Every time, like the index: a page pasted into the note or somebody else
      // arriving in it takes an interactive block's card away again, and neither
      // touches anything else in this state.
      trustedMarkupEffect(trusted),
      ...(dressed ? [] : modeEffects(modes.settings)),
      ...(dressed ? [] : [shortcutEffect(shortcuts.forEditor)]),
    ]
  }

  // Built once, on the note the pane opens with, and never again while the pane
  // is up. Nothing here may be read reactively: this effect running a second time
  // is the whole editor torn down and built afresh, every other tab's state in
  // this pane thrown away with it, and the reader dropped back at the place the
  // session remembered. Reading how many notes the tab's document had held - which
  // the key the pane kept its states under used to be spelled out of - did exactly
  // that on every click in the file list.
  $effect(() => {
    const first = untrack(() => tab)
    const created = createEditor({ parent: host, ...untrack(() => optionsFor(first)) })

    states.started(
      first,
      created,
      untrack(() => placeOf(first)),
    )
    view = created
    // Our own scrollbar over the editor's scroller: the platform's cannot be
    // animated and takes a gutter of the writing column. See scrollbar.ts.
    bar = overlayScrollbar(created.scrollDOM, created.dom)
    // The view a drive reaches for; see `__DRIVEABLE__` in env.d.ts for why this
    // is not `import.meta.env.DEV`.
    if (__DRIVEABLE__) Object.assign(window, { nib: created })

    return () => {
      // Every document the pane was holding lets go first: one that carried its
      // changes into a state or a view that no longer exists would be carrying
      // them nowhere.
      states.releaseAll(created)
      bar?.stop()
      bar = undefined
      created.destroy()
      view = undefined
    }
  })

  // The writing surface is a text box as far as anything reading the page is
  // concerned - CodeMirror says so itself, with `role="textbox"` - and a text box
  // has to be called something. It was the one thing on every single surface of
  // the app that axe-core called serious: an unnamed field the size of the window.
  // The name is the app's to give rather than the library's, because what is in it
  // is a note.
  //
  // Set on the element and not through `contentAttributes`, which is where the
  // `#write` id comes from: the pane's view outlives every note in it and each
  // note is a whole state swapped in, so a facet appended to the state that built
  // the view goes with the first swap. An attribute the library never set is one it
  // never takes off again; see updateAttrs in @codemirror/view.
  //
  // In an effect of its own because the name is the one thing about this editor
  // that is in the reader's language: read where the view is built, a window
  // switched to another language would rebuild every editor in it.
  $effect(() => {
    view?.contentDOM.setAttribute('aria-label', t('The note'))
  })

  // The note, and the space around it. Swapped in whole, in the same frame as
  // the click that asked for it: see editor-states.ts.
  //
  // Two things are read for their own sake, and nothing else is. Which note the
  // pane is on, which is the switch. And the space's links, because a note saved
  // somewhere else gains a heading and every `[[link]]` to it has to be drawn
  // again - that one arrives on its own, without the note being disturbed.
  // Everything the fitting reads is untracked: the modes reach every open editor
  // by themselves, and hearing about them here as well would dress a view twice.
  $effect(() => {
    const current = view
    const showing = tab
    if (!current) return

    // Whether the pane is already on this note, read outside the untrack below and
    // for its own sake. It is the one thing about the note this effect follows: the
    // one tab that previews a note moves on to another without becoming another
    // tab, and the note it moves to is a switch like any other.
    const switching = !states.shows(showing)
    const index = notes?.(showing)
    // Read for its own sake, like the index: whether this note's HTML is markup
    // changes while it is open - a paste, a peer - and the cards in it have to be
    // drawn again when it does.
    const trusted = trustsHtmlIn(showing.note)

    untrack(() => {
      states.show(current, showing, () => build(showing), fitting(showing, index, trusted))

      // Another note is another length and another place in it, so the bar
      // shapes itself into its new size rather than appearing in it.
      if (switching) bar?.settle()

      // A session written by a build that remembered pixels rather than a line
      // has no line to put back. The offset is the best it can do, and it goes
      // on here rather than a frame later.
      if (switching && showing.anchor === undefined && showing.scroll) {
        current.scrollDOM.scrollTop = showing.scroll
      }
    })
  })

  function build(one: Tab): HeldState {
    return HeldState.waiting(one.note.live, editorState(optionsFor(one)), placeOf(one))
  }

  // Notes the pane no longer holds - closed, or dragged into another pane - let
  // their documents go.
  $effect(() => {
    states.keepOnly(kept)
  })
</script>

<!-- What is pasted, noticed on its way down before the editor takes the event.
     Markup that arrived from outside the app is not this person's own writing, so
     the note stops running its HTML and shows it as the characters it is made of;
     see trust.ts. -->
<div
  class="surface"
  class:rise
  bind:this={host}
  onpastecapture={(event: ClipboardEvent) => {
    const carried = event.clipboardData
    if (carried && pastesMarkup([...carried.types], carried.getData('text/plain'))) {
      tab.note.pasted = true
    }
  }}
></div>

<style>
  /* A flex column, so the editor inside it takes its height from the line rather
     than as a percentage of a box whose own height is a stretch. See the `&` rule
     in packages/editor/src/theme.ts for what depended on that percentage and what
     it cost. The same shape the reading view has always had. */
  .surface {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .rise {
    animation: rise var(--dur-slow) var(--ease-out);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
  }
</style>
