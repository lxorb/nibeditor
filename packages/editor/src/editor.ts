import { history } from '@codemirror/commands'
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { EditorState, Prec, type Text } from '@codemirror/state'
import {
  crosshairCursor,
  dropCursor,
  EditorView,
  highlightActiveLine,
  keymap,
  rectangularSelection,
} from '@codemirror/view'
import { remoteCarets } from './carets'
import { completionExtensions } from './completion'
import { external } from './external'
import { blockHandles } from './block/handle'
import { landing } from './landing'
import { folding, foldsChanged, type FoldLines, withFolds } from './fold'
import { imageHandling, imageResolver, type ImageSink } from './images'
import { propertyChoices } from './live-preview/properties'
import { linkClicks, type LinkPress, linkOpener } from './links'
import { trustedMarkup } from './markup'
import { wikilinks } from './wikilink'
import { blockNamer } from './wikilink/complete'
import { type PreviewMount, previewEditor } from './wikilink/hover'
import {
  type LinkWrite,
  linkWriter,
  type NoteIndex,
  noteIndexExtension,
  type NoteJump,
  noteOpener,
} from './wikilink/notes'
import { codeThemeExtension } from './code-theme'
import { type FindAsk, findExtensions } from './find'
import { closeFence, leaveQuote } from './commands'
import { nibBindings, standardBindings, unclaimedKeymap } from './keymap'
import { richCopy } from './copy'
import { richPaste } from './paste'
import { nibSelection } from './selection/layer'
import { openTail, openTailDown } from './tail'
import { modeExtensions } from './modes'
import { documentOf, type SharedDoc, sharing } from './shared'
import { boundKeymap, type KeyOverrides, shortcutExtensions } from './shortcuts'
import { tableBindings } from './table/keymap'
import { nibHighlightStyle, nibTheme } from './theme'

/** Everything a state needs to be a Nib editor's state. Not the element it
 *  draws into: a pane builds one of these for every note it has open and swaps
 *  them into its one view, so the state and the view are separate things. See
 *  held.ts. */
export interface StateOptions {
  doc?: string
  /** Where the caret goes. A note reopening lands where it was left, and that
   *  belongs in the state rather than in a dispatch after it: a selection put in
   *  afterwards is a frame the note spends at the top of itself. */
  selection?: { anchor: number; head?: number }
  /** The document this view is a window onto, when it shares one with the other
   *  views of the same note; see shared.ts. A view given one starts on its text
   *  and reports its changes through it rather than through `onChange`. */
  shared?: SharedDoc
  /** Called with the editor's own text - CodeMirror's rope, not a string, so
   *  turning it into one is the caller's decision and can wait. Only for a view
   *  that owns its text: a shared document reports its own changes. */
  onChange?: (doc: Text) => void
  /** Called when an image is pasted or dropped; returns the path to insert. */
  onImage?: ImageSink
  /** Maps a document-relative image path to a URL the view can load. */
  resolveImage?: (src: string) => string
  /** The keys the app has a fixed set of answers for, so a property row offers a
   *  menu rather than a field: the accent names under `icon-color`, the paper sizes.
   *  Which answers are fixed is the app's business; see live-preview/properties.ts. */
  propertyChoices?: Record<string, readonly string[]>
  /** Fires when the selection moves, so a toolbar can follow it. */
  onSelection?: (view: EditorView) => void
  /** Which palette colours code fences. Defaults to following the app theme. */
  codeTheme?: string
  /** Follows a link the reader pressed, with the press that asked for it, so a host
   *  with tabs of its own can put the page where that press meant. Defaults to a
   *  browser tab, which is all a bare editor has. */
  openLink?: (href: string, press: LinkPress) => void
  /** Keys the reader chose, as differences from the defaults. Changed later
   *  through `setShortcutKeys`; this is only what the editor opens with. */
  shortcuts?: KeyOverrides
  /** The space around this note: which notes exist and what they say, so
   *  `[[wikilinks]]` can be drawn, completed, followed and previewed. Set later
   *  through `setNoteIndex`; this is only what the editor opens with. */
  notes?: NoteIndex
  /** Follows a link between notes: opens it, or makes it when there is none. */
  openNote?: (jump: NoteJump) => void
  /** Names a block of another note, so a link can point at the block. */
  nameBlock?: (path: string, line: number) => Promise<string | null>
  /** Spells a link to another note, so what the `[[` popup writes is what the
   *  Links setting asks for. The app's one writer; without it the editor writes a
   *  wikilink, which is that setting's default. */
  writeLink?: (target: LinkWrite) => string
  /** What was folded when this note was last read on this device, as lines; see
   *  fold.ts. In the state rather than dispatched afterwards, so the note is
   *  already folded on the frame it appears. */
  folds?: readonly FoldLines[]
  /** Ctrl+F, Ctrl+H and a step with no query yet, asking for the find bar; null
   *  when something closed it. The bar is the app's, so the keys can only ask;
   *  see find.ts. */
  onFind?: (ask: FindAsk | null) => void
  /** Whether the raw HTML in this document is markup rather than the characters it
   *  is made of, which is the app's answer and nobody else's; see markup.ts. False
   *  without one, and an interactive block then stays the markup it is. */
  trustedMarkup?: boolean
  /** Mounts an editor on another note's words inside the card that previews it, so a
   *  word of the linked note can be fixed without opening it. The app's, because the
   *  modes and the one path a note is saved by are both the app's; see
   *  wikilink/hover.ts. Without it the card is a reading of the note. */
  editPreview?: PreviewMount
}

export interface EditorOptions extends StateOptions {
  parent: HTMLElement
}

export function editorState(options: StateOptions): EditorState {
  const { doc = '', onChange, onImage, resolveImage, onSelection } = options
  const { openLink, openNote, nameBlock, writeLink, shared, selection, folds } = options
  const { editPreview } = options
  const text = shared ? shared.text : doc

  const state = EditorState.create({
    // The document's own rope, so joining it finds the text already there and
    // has nothing to put in.
    doc: text,
    ...(selection
      ? { selection: { anchor: Math.min(Math.max(0, selection.anchor), text.length) } }
      : {}),
    extensions: [
      history(),
      sharing(),
      // Before the modes, so the folds are a field the live preview's own
      // fields can already ask about while they build.
      folding(),
      blockHandles(),
      landing(),
      // The other people in this note, when it is one several devices are
      // writing in; nothing at all until the app says there is somebody.
      remoteCarets(),
      // The selection, as one block with its corners smoothed; see
      // selection/layer.ts. Carries the view's own caret with it.
      nibSelection(),
      // Several cursors, and a rectangle of them.
      //
      // Alt is the one modifier for both, which is where every other editor puts
      // it: Alt and a click puts another cursor down, Alt and a drag adds a whole
      // range to what is already selected, and Alt+Shift and a drag takes a
      // column of them. The crosshair is the hint that Alt is doing something
      // other than moving the caret.
      //
      // Nothing else had to change for this. The selection is drawn per range
      // already (selection/layer.ts) and the live preview asks whether *any*
      // range touches a construct (live-preview/reveal.ts), so every cursor
      // reveals its own syntax and each selection gets its own smoothed block.
      EditorState.allowMultipleSelections.of(true),
      EditorView.clickAddsSelectionRange.of((event) => event.altKey && !event.shiftKey),
      rectangularSelection({ eventFilter: (event) => event.altKey && event.shiftKey }),
      crosshairCursor(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      // Finding words, with the app drawing the bar: the library's engine and
      // nib's surface. See find.ts.
      findExtensions(options.onFind),
      EditorView.lineWrapping,
      // The writing surface carries Typora's `#write` id, so Typora themes
      // that target `#write` style our editor directly.
      EditorView.contentAttributes.of({ id: 'write' }),
      syntaxHighlighting(nibHighlightStyle),
      codeThemeExtension(options.codeTheme),
      // Told how long the document is, because a note too long to parse is built
      // without the language rather than having it taken away a transaction later;
      // see `modeExtensions`.
      modeExtensions(text.length),
      completionExtensions(),
      // Images are checked first, so a screenshot beats the HTML around it.
      ...(onImage ? [imageHandling(onImage)] : []),
      richPaste(),
      richCopy(),
      // A click in the space under whatever block ends the note.
      openTail(),
      ...(resolveImage ? [imageResolver.of(resolveImage)] : []),
      ...(options.propertyChoices ? [propertyChoices.of(options.propertyChoices)] : []),
      linkClicks,
      ...(openLink ? [linkOpener.of(openLink)] : []),
      // Links between notes: drawn, followed, completed and previewed. What
      // notes there are comes from the app; see wikilink/index.ts.
      wikilinks(),
      noteIndexExtension(options.notes),
      trustedMarkup(options.trustedMarkup),
      ...(openNote ? [noteOpener.of(openNote)] : []),
      ...(nameBlock ? [blockNamer.of(nameBlock)] : []),
      ...(writeLink ? [linkWriter.of(writeLink)] : []),
      ...(editPreview ? [previewEditor.of(editPreview)] : []),
      nibTheme,
      // Above the markdown keys below, which continue a list or a quote and
      // would otherwise take the key on a fence inside one.
      Prec.highest(keymap.of([{ key: 'Enter', run: closeFence }])),
      // The two keys `markdown()` would bind for itself, bound here because
      // this is where a keymap of plain bindings belongs, and because Enter
      // has to be told how a list ends. See `addKeymap` in modes.ts.
      //
      // A writer says a list is over by pressing Enter on the empty item, and
      // that press ends it in Typora, in Obsidian and in GitHub's own editor.
      // The library spends that press turning a tight list into a loose one - a
      // blank line pushed in above the marker - and ends the list only on the
      // press after that, leaving a stray line and a bullet to delete by hand.
      // `nonTightLists: false` is what says otherwise. `leaveQuote` does the
      // same for a quote, which the library ends only after a second empty
      // quoted line; it gives the key back unless the line is quote marks and
      // nothing else.
      //
      // At `Prec.high`, which is exactly where `markdown()` puts them, so
      // nothing else changes about which key reaches what.
      Prec.high(
        keymap.of([
          { key: 'Enter', run: leaveQuote },
          { key: 'Enter', run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
          { key: 'Backspace', run: deleteMarkupBackward },
        ]),
      ),
      // Which key runs what, in one place and changeable while the editor
      // is open: see shortcuts.ts.
      shortcutExtensions(options.shortcuts),
      boundKeymap([
        // Arrow keys beside a table walk into it; the defaults would step
        // over it. These give way whenever no table is in the way.
        ...tableBindings,
        // Markdown bindings come first so they win over the defaults.
        ...nibBindings,
        ...standardBindings,
      ]),
      // Down from the last line of a note that ends in a table, a fence, a formula
      // or a picture makes the paragraph there is nowhere to stand in otherwise;
      // see tail.ts. Under the named bindings, so a table still gets the arrow
      // first, and over the library's own, whose Down at the last line goes
      // nowhere. Not in the settings, like the other arrow keys.
      keymap.of([{ key: 'ArrowDown', run: openTailDown }]),
      // What the library binds that nothing here has a name for, underneath
      // everything that does.
      keymap.of(unclaimedKeymap),
      EditorView.updateListener.of((update) => {
        // Text this view was handed is not news to whoever handed it over.
        const pushed = update.transactions.some((one) => one.annotation(external))
        if (update.docChanged && !pushed) {
          // A shared note is one document in several views: the change goes to
          // it, and it is the document that says the note changed.
          //
          // The document this view is *on*, never the one its state names. A
          // state carries the claim it was last given and a view outlives the
          // note in it, so the two can differ for as long as a swap takes -
          // and a keystroke reported to the wrong document is this note's
          // words written down under another note's name. See shared.ts.
          const document = documentOf(update.view)
          if (document) document.local(update.changes, update.state.selection, update.view)
          else onChange?.(update.state.doc)
        }
        // A fold moved nothing and changed no text, and it is still news to
        // whoever is following the view: it is written down per note like the
        // caret and the scroll, and it is what a toolbar reading the line under
        // the caret is looking at. See placement.svelte.ts in the app.
        if (
          update.selectionSet ||
          update.docChanged ||
          update.focusChanged ||
          foldsChanged(update)
        ) {
          onSelection?.(update.view)
        }
      }),
    ],
  })

  // Always, not only when something was written down: a callout the note itself
  // says is shut opens shut whether or not this device has read it before.
  return withFolds(state, folds ?? [])
}

export function createEditor(options: EditorOptions): EditorView {
  const view = new EditorView({ parent: options.parent, state: editorState(options) })

  options.shared?.join(view)
  return view
}
