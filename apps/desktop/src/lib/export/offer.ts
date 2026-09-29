/** What the thing on screen goes out as.
 *
 *  A note, a deck, a drawing and a paper somebody is only reading are four
 *  different documents, and offering all of them the same ten formats says that a
 *  canvas can be a Word file. So the offer is a function of what is open, written
 *  down once: the Export menu, the command palette and the shortcut settings all
 *  read it, and none of them can offer a row the others do not.
 *
 *  The rows only. What each one does when it is pressed is commands.ts, where
 *  every other command lives too, and the writing itself is run.ts, the slides
 *  code and the canvas's own picture code. */

import { isDeck } from '@nib/markdown/slides'
import { key, t } from '../i18n.svelte'
import type { TabKind } from '../workspace/documents.svelte'
import { type Exportable, EXPORT_FORMATS, EXPORT_VARIANTS } from './formats'

/** The kinds of document that go out differently. Narrower than a tab's kind: a
 *  deck is a note with slide breaks in it, and a file the app is only showing is
 *  worth a row for exactly as long as its bytes can be reached. */
export type ExportKind = 'note' | 'deck' | 'canvas' | 'pages' | 'file' | 'none'

/** The rows the ten markdown formats do not cover: a canvas as one drawing, a
 *  deck as slides, and a file the app never wrote handed over as it stands.
 *
 *  Each says the whole row rather than a format name, because "Export as a copy"
 *  is not what handing a paper over is. */
export const EXPORT_EXTRAS = [
  { id: 'svg', label: key('Export as SVG') },
  { id: 'slides-html', label: key('Export slides as HTML') },
  { id: 'slides-pdf', label: key('Export slides as PDF') },
  { id: 'copy', label: key('Save a copy') },
] as const

/** Anything an export row can ask for. */
export type ExportId = Exportable | (typeof EXPORT_EXTRAS)[number]['id']

/** The ten, and the two variants of two of them, in the order formats.ts keeps. */
const FORMATS = EXPORT_FORMATS.map((format) => format.id)
const VARIANTS = EXPORT_VARIANTS.map((variant) => variant.id)

/** What each kind goes out as, in its own fixed order.
 *
 *  A note gets the ten and the two variants. A deck is a note as well, so it
 *  keeps every one of them and adds the two the slides code writes: one file that
 *  turns its own pages, and one sheet of paper per slide. A canvas is a drawing
 *  and goes out as one, in the three formats its picture code makes and in the
 *  order its own menu lists them. A paper or a picture the app is only showing
 *  has nothing to convert, so the one honest row is its own bytes. The graph of a
 *  space is drawn from the notes and is nothing to export at all. */
const OFFERS: Record<ExportKind, readonly ExportId[]> = {
  note: [...FORMATS, ...VARIANTS],
  deck: [...FORMATS, 'slides-html', 'slides-pdf', ...VARIANTS],
  canvas: ['png', 'svg', 'pdf'],
  // A page note is pages, so its three rows mean a page each rather than one
  // picture: a PDF of the whole note, and a PNG or an SVG per page in a zip. The
  // same three words, because they are the same three formats; what differs is that
  // paper has pages and a plane does not.
  pages: ['pdf', 'png', 'svg'],
  file: ['copy'],
  none: [],
}

/** The rows a kind offers, in that kind's fixed order. */
export function offeredBy(kind: ExportKind): readonly ExportId[] {
  return OFFERS[kind]
}

/** Every row a key can be put on, in one fixed order.
 *
 *  The shortcut settings show all of them whatever is open, because a key is
 *  bound once and pressed with anything in front of it. What a key does when this
 *  document does not go out that way is nothing; see `runExport` in the registry.
 *  The variants have no keys, and never had: a row of the settings for markdown
 *  with the pictures beside it is a row for the person who exports it daily, and
 *  that person exports plain markdown. */
export const EXPORT_KEYS: readonly ExportId[] = [
  ...FORMATS,
  ...EXPORT_EXTRAS.map((extra) => extra.id),
]

/** What is open, as far as an export is concerned. The shape rather than the Tab
 *  class, so the question is answered the same way in a test as in the app. */
export interface Open {
  kind: TabKind
  path: string | null
  text: string
}

/** Which of the five kinds the tab in front of somebody is. */
export function exportKindOf(open: Open | null): ExportKind {
  if (!open) return 'none'

  switch (open.kind) {
    case 'note':
      return isDeck(open.text) ? 'deck' : 'note'

    case 'canvas':
      return 'canvas'

    case 'pages':
      return 'pages'

    // A copy is bytes read off a path, so a paper with no path behind it is a
    // paper the app cannot hand over.
    case 'pdf':
      return open.path === null ? 'none' : 'file'

    // Nothing to hand over: the graph is drawn from the space rather than held in a
    // file, and a website is a window on somebody else's page. What there is of a
    // page worth keeping is kept by clipping it, which writes a note; see
    // web-tab/clip.ts. A terminal is a session, and holds nothing a file would.
    case 'graph':
    case 'web':
    case 'terminal':
      return 'none'
  }
}

/** Whether a row is one of the note's own, which is what run.ts writes. The rest
 *  belong to the slides code, the canvas or the file itself. */
export function isNoteFormat(id: ExportId): id is Exportable {
  return EXPORT_FORMATS.some((one) => one.id === id) || EXPORT_VARIANTS.some((one) => one.id === id)
}

/** What a row says. */
export function labelOf(id: ExportId): string {
  const extra = EXPORT_EXTRAS.find((one) => one.id === id)
  if (extra) return t(extra.label)

  const format = [...EXPORT_FORMATS, ...EXPORT_VARIANTS].find((one) => one.id === id)
  return format ? t('Export as {format}', { format: t(format.label) }) : id
}
