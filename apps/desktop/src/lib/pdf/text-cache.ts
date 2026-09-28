/** A paper's words, kept where they can be found again after a restart.
 *
 *  A PDF's words are not on disk as text. Getting at them is pdf.js, a worker and
 *  a page at a time, which is why nib used to search only the papers somebody had
 *  opened in this sitting: a search that read a thirty megabyte paper to answer a
 *  word would not be a search. So a page's words are written down the first time
 *  anything reads them, and from then on the paper answers whether it has been
 *  opened again or not.
 *
 *  What a record is keyed by, and when it is dropped:
 *
 *  - The paper's path, because that is what a search has in hand. One `get`, no
 *    listing walked.
 *  - The hash of the file's bytes, the same `SHA-256` the mirror takes of a paper,
 *    which is what says the words belong to this file rather than to whatever used
 *    to be at this path. A record whose hash no longer matches is thrown away and
 *    taken down again.
 *  - When the file was last written, from the same listing the file tree is drawn
 *    from, as the cheap gate in front of the hash. Hashing is reading, and reading
 *    every paper in a space to find out whether its words are still its words
 *    would cost exactly what this file exists to avoid. So a paper nobody has
 *    written since it was read is trusted, and the hash is checked whenever the
 *    bytes are in hand anyway - which is every time a paper is opened or read.
 *    The mirror makes the same bargain for the same reason; see `pushFiles`.
 *
 *  Bounded twice over, because a library of papers is bigger than the notes beside
 *  it: `A_PAPER` is as much of one paper as is worth keeping, and `ALL_PAPERS` is
 *  as much as the store may hold, the largest paper going first when it is
 *  crossed.
 *
 *  Where a record lives is the platform's business: the app data folder through
 *  `papers.rs` on a desktop, a row beside the notes in the browser. Both answer
 *  the same three commands, so nothing above this line knows which it is. */

import { isNumber, isRecord, isString } from '../stored'
import { invoke } from '../tauri'

/** How much of one paper's words are kept: about a thousand pages of a dense
 *  book. Past that the pages that were read first are the ones kept, because a
 *  paper is read from the front. */
const A_PAPER = 2_000_000

/** And how much of every paper's, across a device. Sixteen million characters is
 *  a shelf of papers and a few tens of megabytes of store; past it the largest
 *  paper goes, since one book costs what twenty papers cost. */
const ALL_PAPERS = 16_000_000

/** What they are actually held to: the two above everywhere but in
 *  text-cache.test.ts, which would otherwise have to build a shelf of two million
 *  character papers to cross either. */
let aPaper = A_PAPER
let allPapers = ALL_PAPERS

/** For the tests: bounds small enough to cross. */
export function keepAtMost(perPaper: number, inAll: number): void {
  aPaper = perPaper
  allPapers = inAll
}

/** One paper's words, as they were taken down. */
export interface PaperText {
  /** The PDF, as the app spells its path. */
  path: string
  /** `SHA-256` of the file's bytes, in hex. */
  hash: string
  /** When the file was last written, as the listing says. */
  modified: number
  /** Each page that has been read, as its page number and its words. Sparse and
   *  in page order: a reader who opened three pages of a book has three of these,
   *  and the pass that reads a paper nobody has opened has all of them. */
  pages: [number, string][]
  /** How many characters of words that comes to, so a bound can be held without
   *  reading a record to measure it. */
  characters: number
}

/** What the store holds, as the listing says: which papers and how big. */
export interface PaperFile {
  path: string
  size: number
}

/** Papers read off the store, and papers written to it. Counted rather than
 *  timed, the way the note cache counts its rows: what a test asserts is that a
 *  paper is read once and taken down once. */
const work = { read: 0, wrote: 0 }

/** What has been read and written since this was last asked, and zero from
 *  here. */
export function textWork(): { read: number; wrote: number } {
  const done = { ...work }
  work.read = 0
  work.wrote = 0
  return done
}

function isPages(value: unknown): value is [number, string][] {
  return (
    Array.isArray(value) &&
    value.every(
      (one) => Array.isArray(one) && one.length === 2 && isNumber(one[0]) && isString(one[1]),
    )
  )
}

/** Whether what came back out of the store is a record. Anything else is a
 *  paper that has not been read, which is not a failure: it is read again. */
function isPaperText(value: unknown): value is PaperText {
  if (!isRecord(value)) return false

  return (
    isString(value.path) &&
    isString(value.hash) &&
    isNumber(value.modified) &&
    isNumber(value.characters) &&
    isPages(value.pages)
  )
}

function isPaperFile(value: unknown): value is PaperFile {
  return isRecord(value) && isString(value.path) && isNumber(value.size)
}

/** A record as it goes into the store: the pages in page order, cut to what one
 *  paper may hold.
 *
 *  The first pages rather than the largest or the last, because a paper is read
 *  from the front and because the pages a reader has seen are the ones they are
 *  likely to search for. */
export function paperTextOf(
  path: string,
  hash: string,
  modified: number,
  pages: Iterable<[number, string]>,
): PaperText {
  const kept: [number, string][] = []
  let characters = 0

  for (const [page, text] of [...pages].sort((one, other) => one[0] - other[0])) {
    if (characters + text.length > aPaper) break

    kept.push([page, text])
    characters += text.length
  }

  return { path, hash, modified, pages: kept, characters }
}

/** What the store holds, largest last. */
export async function paperFiles(): Promise<PaperFile[]> {
  const found = await invoke<unknown>('list_paper_texts').catch(() => null)
  if (!Array.isArray(found)) return []

  return found.filter(isPaperFile).sort((one, other) => one.size - other.size)
}

/** One paper's words, or null where the store has none for it.
 *
 *  `modified` is what the listing says about the file now: a record taken down
 *  from a file that has been written since is not this file's words, so it is
 *  dropped rather than answered with. A caller that has the bytes in hand passes
 *  `hash` as well, which is the same question asked of the words themselves. */
export async function paperText(
  path: string,
  modified?: number,
  hash?: string,
): Promise<PaperText | null> {
  work.read += 1
  const text = await invoke<unknown>('read_paper_text', { path }).catch(() => '')
  if (!isString(text) || !text) return null

  let found: unknown
  try {
    found = JSON.parse(text)
  } catch {
    // A record that will not parse is a record that was half written or written
    // by something else. Nothing to report: the paper is read again.
    return null
  }

  if (!isPaperText(found)) return null
  if (modified !== undefined && found.modified !== modified) return null
  if (hash !== undefined && found.hash !== hash) return null

  return found
}

/** Writes one paper's words down, and holds the store to its bound.
 *
 *  The paper being written is never the one dropped: it is the one somebody is
 *  reading. */
export async function keepPaperText(record: PaperText): Promise<void> {
  work.wrote += 1
  await invoke('write_paper_text', {
    path: record.path,
    content: JSON.stringify(record),
  }).catch(() => undefined)

  await holdPapers(record.path, record.characters)
}

/** Forgets a paper: one that has gone, been renamed, or been written since its
 *  words were taken down. */
export async function forgetPaperText(path: string): Promise<void> {
  await invoke('write_paper_text', { path, content: '' }).catch(() => undefined)
}

/** The store held to what every paper may come to, the largest paper first and
 *  never the one just written. */
async function holdPapers(keep: string, size: number): Promise<void> {
  if (size >= allPapers) return

  const files = await paperFiles()
  let held = files.reduce((sum, one) => sum + one.size, 0)

  for (const file of [...files].reverse()) {
    if (held <= allPapers) break
    if (file.path === keep) continue

    await forgetPaperText(file.path)
    held -= file.size
  }
}
