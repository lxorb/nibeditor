/** Which mark a file wears in the lists that show it.
 *
 *  A row says what it opens into with a shape rather than with a word, and the
 *  shape has to be the same shape everywhere: the file tree draws one, and the
 *  search results, the bookmarks and the tab strip are all a list of files
 *  waiting for the same mark. One reading of a name, so two lists cannot
 *  disagree about what a file is.
 *
 *  The name alone decides, which is why this is a pure function and not a method
 *  on an entry: a hit in a search and a tab in a strip both know a name and
 *  little else. `FileMark.svelte` draws what it answers. */

import {
  isCanvasTarget,
  isImageTarget,
  isPagesTarget,
  isPdfTarget,
  isWebTarget,
} from '@nib/markdown/links'
import type { IconNode } from 'lucide'
// One file per shape rather than seven names off the library's index, because the
// index re-exports every icon there is: a static import from it puts the whole set
// - four hundred kilobytes, and the picker's own lazy chunk with it - in front of
// the first paint. Every row of the file list wears one of these, so this module is
// in the first chunk by definition. See canvas/lucide.d.ts, which is where the
// types for these paths are declared, and icons.ts, which loads the index lazily.
import BookText from 'lucide/dist/esm/icons/book-text.mjs'
import File from 'lucide/dist/esm/icons/file.mjs'
import FileText from 'lucide/dist/esm/icons/file-text.mjs'
import Globe from 'lucide/dist/esm/icons/globe.mjs'
import Image from 'lucide/dist/esm/icons/image.mjs'
import NotebookPen from 'lucide/dist/esm/icons/notebook-pen.mjs'
import { isMarkdownPath } from './space-paths'
import type { TabKind } from './workspace/documents.svelte'

/** The canvas: Lucide's `workflow`, on the grid the rest of the set is drawn on.
 *
 *  Every other mark here fills twenty of the twenty-four units - a page is 2 to 22
 *  down, so is the globe, so is the pad - and `workflow` fills eighteen, because
 *  Lucide builds it out of its own eight unit cards. At the size a row draws a mark
 *  that is a tenth of a pixel and nobody can see it. At the size the buttons in an
 *  empty pane draw one, which is twice that, it reads as the canvas being smaller
 *  than the three beside it and sitting oddly in its card - which is what Emil saw,
 *  2026-09-17: *"the icons in these buttons are not properly aligned"*. It shows
 *  worst of all on a pinned tab, which is its mark and nothing else.
 *
 *  So: the same drawing, scaled to the same extent. Two cards of nine with the two
 *  units of air between them the original leaves, the corner and the elbow a quarter
 *  of a card as Lucide drew them, the line still leaving the first card at its
 *  middle and arriving at the middle of the second. Nothing here is a shape this app
 *  invented - it is Lucide's, on the family's grid, so a strip of marks is one size
 *  wherever it is drawn.
 *
 *  Lucide's `image` is the other mark drawn to eighteen, and it is left alone: it is
 *  one full card, and a square that fills a box as far as a circle does reads bigger
 *  than the circle. Two small cards on a diagonal have no such weight to hold back. */
const Workflow: IconNode = [
  ['rect', { width: '9', height: '9', x: '2', y: '2', rx: '2.25' }],
  ['path', { d: 'M6.5 11v4.25a2.25 2.25 0 0 0 2.25 2.25H13' }],
  ['rect', { width: '9', height: '9', x: '13', y: '13', rx: '2.25' }],
]

/** The marks there are, and there is no folder among them, because no row is a
 *  folder: a note that holds notes is drawn as the note, and a folder out of
 *  somebody's vault that has no note of its own is drawn as `file` - a page with
 *  nothing written on it, which is exactly what such a row is until somebody
 *  writes in it. See folder-notes.ts and docs/tree.md.
 *
 *  `file` is also the mark for a name this build has no shape for, so a list can
 *  always draw a row.
 *
 *  `picture` and `file` are drawn ahead of anything that would show them: a file
 *  tree holds a note, a PDF and a canvas and nothing else, which is decided in
 *  `src-tauri/src/tree.rs` and, for the browser, in `web/commands.ts`. They are
 *  here so the first list that does show another kind has its mark already.
 *
 *  `web` is a website: a shortcut file, `Svelte docs.url`, which is the Windows
 *  Internet Shortcut format that Explorer and every browser already write. It used
 *  to be the one mark a name could not earn - a website was a note with `url:` in
 *  its front matter, and the row had to ask the link index what the file said - and
 *  now it is a name like every other kind here. See web-tab/shortcut.ts. */
export type FileMark = 'note' | 'canvas' | 'pages' | 'pdf' | 'picture' | 'file' | 'web'

/** The mark a file's name earns it.
 *
 *  Asked in the order the kinds are told apart by: the three a tab can hold
 *  first, since those are the ones the app acts on differently, then a picture,
 *  then a note. A name with no extension is not a note; `Notes.md.bak` is not
 *  one either. Both are files, and the plain sheet says so.
 */
export function fileMark(name: string): FileMark {
  if (isWebTarget(name)) return 'web'
  if (isCanvasTarget(name)) return 'canvas'
  if (isPagesTarget(name)) return 'pages'
  if (isPdfTarget(name)) return 'pdf'
  if (isImageTarget(name)) return 'picture'
  if (isMarkdownPath(name)) return 'note'
  return 'file'
}

/** The mark the document open in a tab wears, where a bar says which document is
 *  showing rather than listing several: the phone and tablet title bar.
 *
 *  Asked of the kind rather than of the name, because a tab knows outright what
 *  it holds while a list has only a name to read - and because an unnamed note is
 *  still a note. The graph wears none: it is a picture drawn from the space, not
 *  a file in it. */
export function markOf(kind: TabKind): FileMark | null {
  return kind === 'graph' ? null : kind
}

/** The drawing each mark is.
 *
 *  Lucide, so the tree wears an icon set somebody drew rather than five shapes
 *  this app drew for itself, and one set: every mark comes off the same 24 unit
 *  grid at the same weight, and fills the same twenty of it, which is what makes a
 *  list of files read as a list rather than as a row of unrelated pictures. The one
 *  mark that did not fill it is the canvas, and what it is instead is above. The
 *  same library the space icons come from; see icons.ts.
 *
 *  Three of them are the obvious thing: a page with writing on it, a plain page,
 *  a picture in its frame. The other two are choices. A canvas is two cards with
 *  a line from one to the other, which is what a canvas in this app actually is.
 *  A PDF is a book rather than a fourth page: what tells it from a note at 13px
 *  has to be its outline and not something written inside it, and a PDF is the
 *  half of the pair that is read rather than written.
 *
 *  The pair that matters most is the first two, because one row turns into the
 *  other: a folder somebody has not written yet is the plain page, and the words
 *  arriving in it make it the page with writing on. */
export const MARKS: Record<FileMark, IconNode> = {
  note: FileText,
  canvas: Workflow,
  // A pad with a pen on it, which is the one shape in the set that says "paper you
  // write on by hand" rather than "a file with words in it". The nib is what tells
  // it from the book a PDF wears at 13px.
  pages: NotebookPen,
  pdf: BookText,
  picture: Image,
  file: File,
  // A globe, because that is what every browser has meant by the web for thirty
  // years, and because it reads at 16px as a shape rather than as a drawing.
  web: Globe,
}
