/** The less common halves of a tab with no file: a web tab kept as a web note, and
 *  the words of a closed draft kept in Recently deleted. Fetched with the first of
 *  them, because neither is needed before somebody saves or closes something; the
 *  draft's own save is saving.svelte.ts's `place`. See drafts.ts. */

import { nameFromTitle, shownName } from '../note-name'
import { nameOf } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { pages } from '../web-tab/pages.svelte'
import { sameSite, settleShortcuts } from '../web-tab/settle'
import { readWebFile, writeShortcut } from '../web-tab/shortcut'
import type { Entry, Space } from '../workspace.svelte'
import type { ClosedTabs } from './closed.svelte'
import { type NoteDoc, type Tab, UNTITLED } from './documents.svelte'
import { draftFile } from './drafts'
import { writeFile } from './write-file'

/** What keeping a page and trashing words need of the store. */
export interface Places {
  readonly spaces: readonly Space[]
  readonly activeSpace: Space | null
  readonly closed: ClosedTabs
  freeName(dir: string, wanted: string): string
  showEntry(entry: Entry): void
  freshEntry(path: string, isFolder: boolean): Entry
  loadTree(): Promise<void>
  remember(path: string): void
  persist(): void
  spaceOf(note: NoteDoc): string | null
  /** The document a file is open as, or null; see `documentAt` in workspace.svelte.ts. */
  documentAt(path: string): NoteDoc | null
}

/** One open of one path at a time; see `opening` in open.ts. */
type Claim = (path: string, run: () => Promise<NoteDoc | null>) => Promise<NoteDoc | null>

/** A website kept as a web note in `dir`: the shortcut for a tab that has none, with
 *  the address the tab is on, the name given or the page's title, and the mark the
 *  page reported. Browsing writes nothing, and keeping a page is something somebody
 *  does, the way a bookmark is. Answers the path, or null where it was not kept.
 *
 *  The one gesture that gives a file to a document that exists and is not a draft,
 *  and so the one that could put a second document on a file: two tabs kept in the
 *  same instant were once handed the same name. The name is asked for against what is
 *  open as well as what is listed and claimed before the write begins, which is
 *  `claim`; see open.ts.
 *
 *  Kept into a space whose web data is kept apart, the page is built again in that
 *  space's; see `rehome` in web-tab/rehome.ts. */
export async function keepWeb(
  ws: Places,
  claim: Claim,
  tab: Tab,
  dir: string,
  file?: string,
): Promise<string | null> {
  const was = ws.spaceOf(tab.note)
  const title = file ? shownName(file) : (pages.of(tab.id).title || tab.name || UNTITLED).trim()
  const named = file ?? `${nameFromTitle(title) ?? UNTITLED}.url`
  const page = pages.of(tab.id)
  const url = page.url ?? tab.address ?? ''
  const over = await sameNoteAt(ws, joinPath(dir, named), url)
  const target = over?.path ?? joinPath(dir, ws.freeName(dir, named))

  const kept = await claim(target, async () => {
    const fresh = writeShortcut(url, title, new Date(), undefined, page.kept ?? undefined)
    const text = over ? settleShortcuts(target, over.text, fresh, true) : fresh

    if (!over) ws.showEntry(ws.freshEntry(target, false))
    await writeFile(target, text)
    await ws.loadTree()

    tab.note.path = target
    tab.note.name = nameOf(target)
    tab.note.replace(text, false)
    ws.remember(target)
    return tab.note
  })
  if (kept !== tab.note) return null

  const now = ws.spaceOf(tab.note)
  if (now !== was) {
    const { rehome } = await import('../web-tab/rehome')
    void rehome(tab.id, now, ws.spaces.find((one) => one.id === now)?.name ?? '')
  }
  return target
}

/** The web note already at the name a tab is being kept under, where it is the same
 *  note: a site the tab is on, and no tab showing it. Saving it again is the newer
 *  copy of that note, so it is written over, its fields carried across - not a
 *  `Docs 2.url` beside it, which is a clash file by another name (Emil, 2026-10-03).
 *  A note at that name on another site is a different note and keeps the stepped
 *  name. Null for both, and for a name nothing has. */
async function sameNoteAt(
  ws: Places,
  path: string,
  url: string,
): Promise<{ path: string; text: string } | null> {
  if (ws.documentAt(path)) return null

  const text = await invoke<string>('read_note', { path }).catch(() => null)
  const said = text === null ? null : readWebFile(path, text)
  if (text === null || !said || !sameSite(said.home ?? said.url, url)) return null

  return { path, text }
}

/** A draft's words, closed with something in them, into this device's Recently
 *  deleted: a note under the name it offers, as though deleted from the root of its
 *  space, which is where Restore puts it. The entry goes on the tab's own place on the
 *  closed stack, so reopening the tab takes it back out; see `untrash`. See
 *  `trash_words` in trash.rs. */
export async function trashWords(ws: Places, note: NoteDoc): Promise<void> {
  const root = (ws.spaces.find((one) => one.id === note.home) ?? ws.activeSpace)?.root
  if (root === undefined) return

  const path = joinPath(root, draftFile(note))
  const entry = await invoke<{ id: string }>('trash_words', { path, content: note.text })
  ws.closed.stack = ws.closed.stack.map((one) =>
    one.draft.share === note.key && one.trashed === undefined ? { ...one, trashed: entry.id } : one,
  )
  ws.persist()
}

/** A draft's words taken back out of Recently deleted as its tab reopens. Answers
 *  whether they were still there: gone means somebody restored them as a note or
 *  deleted them for good, and the tab is not theirs to bring back. A trash that
 *  cannot be read is no reason to keep a tab from coming back. */
export async function untrash(id: string): Promise<boolean> {
  const held = await invoke<unknown>('list_trash').catch(() => null)
  if (!Array.isArray(held)) return true
  if (!held.some((one: { id?: unknown }) => one.id === id)) return false

  await invoke('purge_trash', { id }).catch(() => undefined)
  return true
}
