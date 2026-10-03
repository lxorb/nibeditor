/** PDFs: `read_pdf` and `pdf_highlights` (docs/agent-native.md 8.7).
 *
 *  A PDF's words are what the search already takes down of it (pdf/text-cache.ts,
 *  `papers.rs` in the crate), read from there when the pages asked for are there and
 *  from the PDF itself, through pdf.js, when they are not. A PDF came from somewhere
 *  else, so its words come back marked as the PDF's (9.6).
 *
 *  A highlight is the viewer's own mark in the sidecar beside the PDF
 *  (pdf/highlights.ts), anchored the way a person's is: by the words it covers. The
 *  agent names the words, and the boxes are worked out from where pdf.js lays those
 *  words out on the page, in PDF user space, so the mark lands on them at any zoom and
 *  in any other reader of the sidecar. An open viewer reads the sheet again at once;
 *  see pdf/sheets.svelte.ts. */

import { isPdfTarget } from '@nib/markdown/links'
import type { AgentAnswer } from '../../automation/caller'
import { COLOURS, type Highlight, type Quad } from '../../pdf/highlights'
import { marksWritten } from '../../pdf/sheets.svelte'
import { loadHighlights, saveHighlights } from '../../pdf/sidecar'
import { canWriteAt } from '../../sharing.svelte'
import { asked } from './asks'
import { type Call, done, maybe, need, needScope } from './call'
import { pagesAsked, quadsOver, quoteIn, runsOf } from './pdf-text'
import { Refused } from './problem'
import { judged, onDisk, type Place, placeFor } from './spaces'
import { namedTab } from './tab-target'

/** How much of a PDF one read hands over. */
const MOST_CHARACTERS = 200_000

function pdfOf(call: Call): { place: Place; relative: string; path: string } {
  // A PDF's tab is its file, as though the path had been said.
  if (maybe(call, 'tab') !== null) {
    const { relative } = namedTab(call, ['pdf'], 'a PDF')
    if (relative === null) throw new Refused('by_hand', 'that PDF is outside every space')
    return pdfOf({ ...call, args: { ...call.args, tab: null, path: relative } })
  }

  const place = placeFor(call, maybe(call, 'space'))
  const relative = judged(need(call, 'path'))
  if (!isPdfTarget(relative)) throw new Refused('bad_arguments', `${relative} is not a PDF`)

  return { place, relative, path: onDisk(place, relative) }
}

/** A PDF open for reading, and the one way to let it go. */
async function opened(path: string) {
  const { openDocument } = await import('../../pdf/document')
  return openDocument(path).catch(() => {
    throw new Refused('failed', 'that PDF could not be read')
  })
}

export async function readPdf(call: Call): Promise<AgentAnswer> {
  const { relative, path } = pdfOf(call)
  const held = await opened(path)

  try {
    const count = held.doc.numPages
    const pages: { page: number; text: string }[] = []
    let characters = 0
    let truncated = false

    // What the search took down of this very file first, and the PDF for the rest.
    const { paperText } = await import('../../pdf/text-cache')
    const kept = new Map((await paperText(path, undefined, held.hash))?.pages ?? [])

    for (const page of pagesAsked(maybe(call, 'pages'), count)) {
      let text = kept.get(page)
      if (text === undefined) {
        const read = await held.doc.getPage(page)
        text = runsOf((await read.getTextContent()).items)
          .map((run) => run.str)
          .join('')
        read.cleanup()
      }

      if (characters + text.length > MOST_CHARACTERS) {
        truncated = true
        break
      }
      characters += text.length
      pages.push({ page, text })
    }

    return done(
      { path: relative, count, pages, ...(truncated ? { truncated: true } : {}) },
      relative,
    )
  } finally {
    await held.close()
  }
}

export async function pdfHighlights(call: Call): Promise<AgentAnswer> {
  const { relative, path } = pdfOf(call)
  const sheet = await loadHighlights(path)

  switch (need(call, 'op')) {
    case 'list':
      return done(
        sheet.highlights.map(({ id, page, text, colour, created }) => ({
          id,
          page,
          text,
          colour,
          created: new Date(created).toISOString(),
        })),
        relative,
      )

    case 'add': {
      needScope(call, 'notes.write', 'a highlight')
      if (!canWriteAt(path)) throw new Refused('read_only', 'that PDF is shared with you to read')

      const mark = await markOf(call, path)
      const question = await asked(
        call,
        null,
        `Highlight "${mark.text.slice(0, 80)}" in ${relative}`,
      )
      if (question) return question

      if (!(await saveHighlights(path, { ...sheet, highlights: [...sheet.highlights, mark] }))) {
        throw new Refused('failed', 'the highlights beside that PDF were written by a newer nib')
      }
      marksWritten(path)
      // The sidecar has no place for a comment, and saying nothing would say it was kept.
      const comment = maybe(call, 'comment') === null ? {} : { comment: 'not kept' }
      return done({ id: mark.id, page: mark.page, text: mark.text, ...comment })
    }

    default:
      throw new Refused('bad_arguments', 'op is one of list, add')
  }
}

/** Which of the viewer's colours a highlight wears (`COLOURS`): the accent, green or
 *  yellow, by name or by its place in the list; the accent for anything else. */
function colourOf(said: unknown): number {
  const named = ['accent', 'green', 'yellow'].indexOf(String(said).trim().toLowerCase())
  if (named !== -1) return named

  const at = Math.floor(Number(said))
  return Number.isInteger(at) && at >= 0 && at < COLOURS.length ? at : 0
}

/** The highlight a call asks for: its words found on the page it names, or on the one
 *  page of the PDF that holds them. */
async function markOf(call: Call, path: string): Promise<Highlight> {
  const quote = need(call, 'quote')
  const asked = Number(call.args.page)
  const colour = colourOf(call.args.colour)
  const held = await opened(path)

  try {
    const pages =
      Number.isInteger(asked) && asked >= 1 ? [asked] : pagesAsked(null, held.doc.numPages)
    const found: { page: number; quads: Quad[] }[] = []

    for (const page of pages) {
      if (page > held.doc.numPages)
        throw new Refused('not_found', `the PDF has ${held.doc.numPages} pages`)

      const read = await held.doc.getPage(page)
      const runs = runsOf((await read.getTextContent()).items)
      read.cleanup()
      for (const place of quoteIn(runs, quote)) {
        found.push({ page, quads: quadsOver(runs, place.from, place.to) })
      }
    }

    const [only] = found
    if (!only)
      throw new Refused(
        'not_found',
        `"${quote}" is not in the PDF${pages.length === 1 ? ` on page ${pages[0]}` : ''}`,
      )
    if (found.length > 1) {
      const where = [...new Set(found.map((one) => one.page))].join(', ')
      throw new Refused(
        'bad_arguments',
        `"${quote}" is there ${found.length} times (pages ${where}): quote more of it`,
      )
    }

    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      page: only.page,
      text: quote,
      quads: only.quads,
      colour,
      created: Date.now(),
    }
  } finally {
    await held.close()
  }
}
