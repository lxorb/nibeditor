/** Reading the papers nobody has opened, in idle time.
 *
 *  A paper answers a search once its words have been taken down, and the viewer
 *  takes them down for the pages somebody has looked at. This is the other half:
 *  the papers in a space that have never been opened get read once, in the
 *  background, and are answerable from then on and after every restart.
 *
 *  Every rule here is about staying out of the way:
 *
 *  - Never on the critical path. It starts at the search stage of the launch,
 *    which is after the file list is painted, after the link index's turn and after
 *    the notes have been read; see startup.svelte.ts.
 *  - One paper at a time, and a breath between pages, so a three hundred page book
 *    is three hundred short tasks rather than one long one.
 *  - Nothing at all where the device has asked to be left alone: a browser that
 *    says the connection is metered is a browser saying this is not the moment to
 *    spend anything, and the papers will still be there next time.
 *  - Bounded by what the store holds; see text-cache.ts. A paper already taken
 *    down is skipped by its stamp, so this costs nothing on the second launch.
 *
 *  The pages go through papers.ts, which is what a search reads and what writes
 *  them down. */

import { isPdfTarget } from '@nib/markdown/links'
import { breathe } from '../breathe'
import { startup } from '../startup.svelte'
import { mark } from '../trace'
import type { Entry } from '../workspace.svelte'
import { openDocument, textOf } from './document'
import { paperOpened, paperRead, papersFor, papersListed, writePapers } from './papers'
import { paperText } from './text-cache'

/** How many pages of one paper are worth taking down. A book is a book; past this
 *  the search answers about the front of it, which is where a reader is. */
const PAGES = 400

/** Which space is being read, so that opening another one stops this one. */
let reading: string | null = null

/** Whether the device has asked not to be spent. `saveData` is the one thing a
 *  browser says plainly about that, and a phone that sets it is a phone asking for
 *  its battery back as much as for its bytes. */
function sparing(): boolean {
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection
  return connection?.saveData === true
}

/** What a space's papers answer, made ready: what was taken down before comes
 *  back, and what has never been read is read.
 *
 *  Called where the file list lands, beside the note cache's own warming, and
 *  never awaited by anything on screen. */
export async function readPapers(root: string, files: readonly Entry[]): Promise<void> {
  reading = root
  const papers = files.filter((one) => isPdfTarget(one.name))
  const stamps = new Map(papers.map((one) => [one.path, one.modified]))

  // Said before the turn is waited for, not after it. This is the one thing in the
  // app that knows when each of these files was last written, and a search asked
  // before this pass gets its turn - a query fence in the note the app opens is
  // exactly that - has to be held to it too. See `papersListed`.
  papersListed(root, stamps)

  await startup.turn('search')
  if (reading !== root) return

  // What earlier sittings took down, first: it is a read of a row rather than of a
  // PDF, and it is what makes the first search of a space answer about papers.
  mark(`papers: ${papers.length} in the space`)
  await papersFor(root)
  if (reading !== root || sparing()) return

  for (const paper of papers) {
    if (reading !== root) return

    // A paper the store already holds for this file is nothing to read again. The
    // stamp is the cheap half of the question; the hash below is the honest one.
    if (await paperText(paper.path, paper.modified)) continue

    await readOne(paper)
    await writePapers()
    await breathe()
  }

  mark('papers read')
}

/** One paper, page by page. Its words are held in memory as they arrive, the way
 *  the viewer's are, so a search running while this is going on sees the pages
 *  that have been read so far. */
async function readOne(paper: Entry): Promise<void> {
  // A paper that cannot be opened is not a failure to report: it is a file the
  // search will not answer about, and the viewer will say so if anybody opens it.
  const held = await openDocument(paper.path).catch(() => null)
  if (!held) return

  try {
    paperOpened(paper.path, held.hash, paper.modified)

    const pages = Math.min(held.doc.numPages, PAGES)
    for (let number = 1; number <= pages; number++) {
      if (reading === null) return

      const page = await held.doc.getPage(number)
      paperRead(paper.path, number, await textOf(page))
      // Read for its words and not to be looked at, so what pdf.js kept for the
      // page goes straight back.
      page.cleanup()
      await breathe()
    }
  } catch {
    // A paper that falls apart half way through has the pages it gave up until
    // then, which is more than it had before.
  } finally {
    await held.close()
  }
}
