/** The reader typed an address into a web tab's bar, which is the one thing that
 *  changes where a website points.
 *
 *  Following a link inside the page does not: the file says where the document points
 *  and the session remembers where the reading got to, so a file that moved under every
 *  click would be a file no link could point at. See `webWalked` in
 *  workspace.svelte.ts. Fetched with the first address typed. */

import { shownName } from '../note-name'
import { nameOf } from '../space-paths'
import type { Tab } from '../workspace/documents.svelte'
import { writeFile } from '../workspace/write-file'
import { readWebFile, writeShortcut } from './shortcut'

export async function aimed(
  ws: { keep(id: string): void; persist(): void },
  tab: Tab,
  url: string,
): Promise<void> {
  // An address typed is the reader using the tab, in either build, so a website that
  // was only being previewed stays; see used.ts.
  ws.keep(tab.id)
  if (tab.kind !== 'web' || tab.path === null) return

  const was = readWebFile(tab.path, tab.doc)
  if (was?.url === url) return

  const title = was?.title ?? shownName(nameOf(tab.path))
  const content = writeShortcut(url, title, new Date())
  tab.note.replace(content, false)

  await writeFile(tab.path, content).catch(() => undefined)
  ws.persist()
}
