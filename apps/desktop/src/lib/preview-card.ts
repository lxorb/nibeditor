/** The editor inside a hover card.
 *
 *  Holding the modifier over a `[[link]]` shows the note behind it; this is what is
 *  in the card. A small editor on that note's own words, with the reader's own modes,
 *  so a typo you can see is a typo you can fix - and fixing it does not cost you the
 *  sentence you were in the middle of writing. Obsidian's hover is editable for the
 *  same reason.
 *
 *  Here rather than in @nib/editor because both halves of it are the app's. The modes
 *  live in the app, and so does the one path a note nobody has open is written by: a
 *  snapshot kept, the words that changed handed to any pane showing that same note so
 *  no caret moves, and one thing to undo. The card itself - when it opens, what keeps
 *  it up, what puts it away - is wikilink/hover.ts, which asks for this through a
 *  facet and gets a reading of the note when nothing answers.
 *
 *  The editor is built when a card opens and destroyed when it closes, the way a
 *  canvas card's is: five hundred links must not be five hundred editors, and the one
 *  that exists is the size of the card it is in. */

import { createEditor, EditorView, modeEffects, type PreviewNote } from '@nib/editor'
import { pickedLink } from './composer'
import { links } from './link-index.svelte'
import { modes } from './modes.svelte'
import { trustsHtmlAt } from './sharing.svelte'
import { shortcuts } from './shortcuts.svelte'
import { insideSpace } from './space-paths'
import { openExternal } from './tauri'
import { workspace } from './workspace.svelte'

/** How long the typing rests before the note is written.
 *
 *  Longer than a pane's own saving, because this writes a file nobody has open and
 *  every write of one is a snapshot and a thing to undo. Whatever is still unsaved
 *  when the card closes goes then, so nothing waits on this to be finished with.
 *  Matches the shape of the app's own saving; see workspace/saving.svelte.ts. */
const SETTLES_AFTER = 900

/** Mounts the editor, or answers null where there is nothing to write back to: a
 *  note outside any open space has no path the app can save. */
export function mountPreview(host: HTMLElement, note: PreviewNote): (() => void) | null {
  const root = workspace.activeSpace?.root
  if (root === undefined) return null

  const path = insideSpace(root, note.path)

  /** What the card says now, and the timer that will write it. */
  let said = note.text
  let settling: ReturnType<typeof setTimeout> | undefined

  /** The words in the card, into the file. Read again first rather than remembered
   *  from when the card opened: the version being replaced has to be the version that
   *  is there, and something else may have written it while the card was up. */
  const write = async () => {
    settling = undefined
    const after = said
    const before = await workspace.noteText(path)
    if (before === null || before === after) return

    await workspace.writeNoteText(path, before, after)
  }

  const view = createEditor({
    parent: host,
    doc: note.text,
    // Where the link pointed, so a card over `[[Note#Heading]]` opens on that
    // heading rather than at the top of the note.
    selection: { anchor: Math.min(Math.max(0, note.at), note.text.length) },
    onChange: (doc) => {
      said = doc.toString()
      clearTimeout(settling)
      settling = setTimeout(() => void write(), SETTLES_AFTER)
    },
    // The space around the note in the card, so a `[[link]]` in it is drawn,
    // completed and followed like any other - resolved from where that note sits and
    // not from where the link to it was written.
    notes: links.index(path),
    writeLink: pickedLink,
    shortcuts: shortcuts.forEditor,
    trustedMarkup: trustsHtmlAt(path),
    openLink: (href: string) => void openExternal(href),
  })

  // The reader's own modes, which is what makes this the same surface as the pane
  // behind it rather than a second editor with its own defaults.
  view.dispatch({ effects: modeEffects(modes.settings) })
  scrollTo(view, note.at)

  return () => {
    clearTimeout(settling)
    void write()
    view.destroy()
  }
}

/** The part the link named, at the top of the card. A card is a dozen lines, so
 *  where in it the heading sits is most of what the card says. */
function scrollTo(view: EditorView, at: number) {
  if (at <= 0) return
  view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'start' }) })
}
