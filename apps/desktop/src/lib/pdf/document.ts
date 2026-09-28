/** pdf.js, and one PDF read through it.
 *
 *  The only file that touches the library, and the only one that knows where the
 *  bytes come from: the desktop hands them over from disk, the browser out of its
 *  own store. Everything above this works in pages, boxes and quads.
 *
 *  The library is imported when the first PDF is opened and not before. It is
 *  larger than the whole app around it, so a window that never opens a PDF never
 *  pays for one: the import below is what puts it in a chunk of its own. */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
// The worker is shipped as an asset of the build, so the URL is settled at build
// time and is the same one under Vite and inside the app bundle. Asking for the
// URL rather than importing the module keeps the worker out of the page.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import legacyWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { fileBytes, sha256 } from '../bytes'

type Library = typeof import('pdfjs-dist')

let loading: Promise<Library> | null = null

/** Whether this engine runs the current pdf.js, which calls `Promise.try`,
 *  `Uint8Array.fromBase64` and `Math.sumPrecise` without asking whether they are
 *  there. A Mac's WebKit is as old as its macOS and has all three only from Safari
 *  18.2, so an older Mac reads PDFs through the legacy build pdf.js ships for
 *  exactly this, the way Firefox's own viewer is shipped to older browsers. Asked
 *  of the engine rather than of the platform, so a Linux WebKit that lags behind is
 *  covered by the same question. Both builds are chunks of their own and a window
 *  only ever fetches one. */
export function current(scope: object = globalThis): boolean {
  const has = (name: string, member: string) => {
    const owner: unknown = Reflect.get(scope, name)
    return (
      (typeof owner === 'object' || typeof owner === 'function') &&
      owner !== null &&
      typeof Reflect.get(owner, member) === 'function'
    )
  }

  return has('Promise', 'try') && has('Uint8Array', 'fromBase64') && has('Math', 'sumPrecise')
}

/** The library, loaded once per window. */
export function pdfjs(): Promise<Library> {
  loading ??= (
    current()
      ? import('pdfjs-dist').then((library) => ({ library, worker: workerUrl }))
      : import('pdfjs-dist/legacy/build/pdf.mjs').then((library) => ({
          library,
          worker: legacyWorkerUrl,
        }))
  ).then(({ library, worker }) => {
    library.GlobalWorkerOptions.workerSrc = worker
    return library
  })

  return loading
}

/** A PDF that is open, and the one way to close it. */
export interface OpenPdf {
  doc: PDFDocumentProxy
  /** What the file's bytes hash to, which is what says a paper's words belong to
   *  this file and not to whatever used to be at this path; see pdf/text-cache.ts.
   *  Taken here because this is the one moment the bytes are in hand: the worker
   *  takes them below, and hashing a thirty megabyte paper a second time to find
   *  out what it is would cost what the whole cache saves. */
  hash: string
  /** Gives the worker and the bytes back. The loading task rather than the
   *  document is what owns them, which is why closing lives here. */
  close: () => Promise<void>
}

/** Opens a PDF in a space. The library and the bytes are fetched at the same
 *  time, because the first page cannot be drawn until both are here. */
export async function openDocument(path: string): Promise<OpenPdf> {
  const [library, data] = await Promise.all([pdfjs(), fileBytes(path)])
  // Before the bytes are handed over, and off the main thread: the digest of a
  // paper is a few milliseconds where the read that just finished was hundreds.
  // The same digest, over the same bytes, that the mirror addresses a paper by.
  const hash = await sha256(data)

  // The bytes are handed to the worker, which takes ownership of them: after
  // this the copy on this side is empty, and one document costs one copy.
  const task = library.getDocument({ data })

  return { doc: await task.promise, hash, close: () => task.destroy() }
}

/** The words of a page, as the strings pdf.js lays one span out for: the same
 *  list, in the same order, that a rendered text layer holds in
 *  `textContentItemsStr`. That is what lets a match found in a page nobody is
 *  looking at be painted over the very nodes once it is on screen.
 *
 *  Reading them costs no drawing at all, which is what lets the find bar count
 *  through a document of three hundred pages. */
export async function textOf(page: PDFPageProxy): Promise<string[]> {
  const content = await page.getTextContent()
  return content.items.flatMap((item) => ('str' in item ? [item.str] : []))
}
