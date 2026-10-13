/** Where a PDF another program opened with nib goes.
 *
 *  One already in a space opens where it is, in that space; one from anywhere else is
 *  brought into the space that is open, the way Apple Books takes a PDF opened with
 *  it, so the viewer only ever reads a file of a space. The crate does the bringing;
 *  see src-tauri/src/handed_pdfs.rs.
 *
 *  Pure, so every case is a line of arrival.test.ts; handed.ts acts on the answer. */

import { insideSpace, withinSpace } from '../space-paths'

interface Space {
  id: string
  root: string
}

/** Opened in place, in the space it is in; or brought into a space first. */
export type Arrival =
  { kind: 'open'; spaceId: string; path: string } | { kind: 'bring'; spaceId: string; root: string }

/** Where the PDF at `path` goes, or null where there is no space to put it in. */
export function arrivalOf(
  path: string,
  spaces: readonly Space[],
  activeId: string | null,
): Arrival | null {
  for (const space of spaces) {
    const inside = withinSpace(space.root, path)
    if (inside) return { kind: 'open', spaceId: space.id, path: insideSpace(space.root, inside) }
  }

  const into = spaces.find((one) => one.id === activeId) ?? spaces[0]
  return into ? { kind: 'bring', spaceId: into.id, root: into.root } : null
}
