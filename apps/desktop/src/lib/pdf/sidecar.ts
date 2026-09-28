/** The one place a PDF's highlights are read from and written to.
 *
 *  The commands take the PDF's own path and never the sidecar's: where the marks
 *  are kept is settled in `highlights.rs`, so nothing here can point a write at a
 *  file of its own choosing. */

import { log } from '../log'
import { invoke } from '../tauri'
import { frozen, leftAlone, readSheet, type Sheet, writeSheet } from './highlights'

/** What has been marked on a PDF. A PDF nobody has marked, and one whose sidecar
 *  cannot be read, both come back as no marks: a viewer that will not open
 *  because of a file beside the PDF would be worse than one with no highlights.
 *
 *  The crate answers an empty sidecar for a PDF with none, so a read that fails is
 *  a sidecar that is there - too large, or held by another program. Its marks are
 *  not shown and not written over; see `leftAlone`. */
export async function loadHighlights(path: string): Promise<Sheet> {
  const text = await invoke<string>('read_highlights', { path }).catch((error: unknown) => {
    log('warn', `highlights: ${path} - ${String(error)}`)
    return null
  })
  return text === null ? leftAlone() : readSheet(text)
}

/** Writes the marks down. Answers whether they were: a sheet from a later version
 *  of Nib holds fields this one knows nothing about, and writing back what was
 *  understood would throw the rest away. */
export async function saveHighlights(path: string, sheet: Sheet): Promise<boolean> {
  if (frozen(sheet)) return false

  await invoke('write_highlights', { path, content: writeSheet(sheet) })
  return true
}
