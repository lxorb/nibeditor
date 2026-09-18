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
import { frontMatterBlock } from '@nib/markdown/front-matter'
import { pickedLink } from './composer'
import { links } from './link-index.svelte'
import { modes } from './modes.svelte'
import { notePicture } from './note-images'
import { PROPERTY_CHOICES } from './property-choices'
import { trustsHtmlAt } from './sharing.svelte'
import { shortcuts } from './shortcuts.svelte'
import { insideSpace } from './space-paths'
import { followHref } from './open-link'
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
    // heading rather than at the top of the note - and never inside the front
    // matter; see `caretFor`.
    selection: { anchor: caretFor(note) },
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
    openLink: followHref,
    // Where the pictures in the card's note actually are. Resolved from that note
    // and from its own words - `![[shot.png]]` is looked for anywhere in the space
    // and a path is read beside the note that wrote it, and a note may say where its
    // own root is in its front matter. Without it the editor falls back to the
    // resolver it has standing on its own, which hands the name back unchanged: the
    // card asked the page for `/shot.png` and got a 404, and every picture in every
    // glance was a broken one. The pane a card is opened from resolves its pictures
    // the same way and against its own note; see Pane.svelte and note-images.ts.
    resolveImage: (src: string) => notePicture(src, path, said),
    // The keys the app has fixed answers for, so the note's own metadata reads in
    // the card as it reads in the pane rather than as a row of free text.
    propertyChoices: PROPERTY_CHOICES,
    // And deliberately no `editPreview` of its own: a link inside the card still
    // shows the note behind it, as the reading it always was. One card deep is a
    // glance at what a link points at; a card inside a card inside a card is a
    // reader lost in their own note.
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

/** Where the caret stands when the card opens: where the link pointed, but never
 *  inside the note's own front matter.
 *
 *  The card is an editor, and an editor shows the block the caret is in as the
 *  markdown it is - that is what live preview means, and in a pane it is exactly
 *  right, because the caret is there because somebody put it there. In a card
 *  nobody put it anywhere: a link that names the whole note opens at character
 *  nought, which is inside the front matter, so a glance at any note with metadata
 *  opened on three lines of raw YAML and the rows it draws for everybody else were
 *  nowhere to be seen. Everything below the front matter drew perfectly, which is
 *  what made it look like a renderer that had lost half its extensions rather than a
 *  caret standing in the wrong place.
 *
 *  Only the caret moves. Where the card is scrolled to is still where the link
 *  pointed, so a card over `[[Note]]` opens at the top of the note with its
 *  metadata as rows, which is what the note itself shows. */
export function caretFor(note: PreviewNote): number {
  const at = Math.min(Math.max(0, note.at), note.text.length)
  const matter = frontMatterBlock(note.text)

  return matter && at < matter.to ? Math.min(matter.to, note.text.length) : at
}

/** The part the link named, at the top of the card. A card is a dozen lines, so
 *  where in it the heading sits is most of what the card says. */
function scrollTo(view: EditorView, at: number) {
  if (at <= 0) return
  view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'start' }) })
}
