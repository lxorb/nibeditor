/** Which PDFs' marks were written by something other than the viewer showing them: an
 *  agent's highlight (docs/agent-native.md 8.7). A viewer reads a PDF's marks once and
 *  writes its whole sheet back on every change, so a mark written behind it would be
 *  written over by the next one the reader makes; reading this, the viewer reads the
 *  sheet again the moment somebody else has written it. See Pdf.svelte. */

import { SvelteMap } from 'svelte/reactivity'

const written = new SvelteMap<string, number>()

/** Says that the marks of the PDF at `path` were written from outside its viewer. */
export function marksWritten(path: string): void {
  written.set(path, (written.get(path) ?? 0) + 1)
}

/** How many times that has happened this session: what a viewer's read depends on. */
export function marksFromOutside(path: string): number {
  return written.get(path) ?? 0
}
