/** The rows of every space, as the app has them: the store (store.ts) put on the app's
 *  own scan, its saves and its file operations, and the one write path.
 *
 *  Fetched at the end of the launch order (see start.ts), never in the first paint, and
 *  whoever asks for rows before then fetches it a moment sooner: importing this is
 *  starting it. The open space's rows are the link index's scan; every other space is
 *  read after it, one at a time. See docs/tasks.md 5.3 and 7.1:
 *
 *    rows.of(space?)            every row, of one space (by name or root) or of all
 *    rows.watch(listener)       each file's rows as they change; answers the way to stop
 *    rows.write(row, change)    a property or a task field, one edit, one undo
 *    rows.inbox(root?)          the space's inbox note, made the first time it is asked */

import type { Row } from '@nib/bases'
import { untrack } from 'svelte'
import { breathe } from '../breathe'
import { links } from '../link-index.svelte'
import type { SpaceLinks } from '../scan-note'
import { insideSpace } from '../space-paths'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { keeping } from '../workspace/file-ops'
import { inboxes, inboxOf } from './inbox'
import { inboxNote } from './inbox-note'
import { type RowsListener, RowsStore } from './store'
import { type RowChange, writeRow } from './write'

const store = new RowsStore({
  scan: (root) => invoke<SpaceLinks>('scan_links', { root }).catch(() => null),
  read: (path) => invoke<string>('read_note', { path }).catch(() => null),
  open: () => ({
    root: links.rootOf(),
    scanned: () => links.scanned(),
    notes: () => links.held(),
  }),
  breathe,
  now: () => Date.now(),
})

// Every write in any space says itself to the link index, and every file operation
// to everything kept by path; the rows hear both, and nothing that writes names them.
links.hearSaves((path, content) => store.saved(path, content))
workspace.fileOps.follow((op) => store.follow(op))
workspace.fileOps.follow(keeping(inboxes))

// The spaces as the window has them: a new one read, one gone forgotten, one renamed
// renamed. Handed over untracked, so the store's own reads are never this effect's.
$effect.root(() => {
  $effect(() => {
    const spaces = workspace.spaces.map(({ root, name }) => ({ root, name }))
    untrack(() => store.spacesAre(spaces))
  })
})

// A space's bases at work while nib runs (automations, ids, repeating templates) start
// with the rows they read, and never in the glasses' plugin, which has no rows; see
// views/runner.svelte.ts.
if (!__EVEN_PLUGIN__) void import('../views/runner.svelte')

export const rows = {
  of: (space?: string): readonly Row[] => store.of(space),
  at: (path: string): readonly Row[] => store.at(path),
  watch: (listener: RowsListener): (() => void) => store.watch(listener),
  get ready(): boolean {
    return store.ready
  },

  /** The one write path; see write.ts. Answers whether anything was written. */
  async write(row: Row, change: RowChange): Promise<boolean> {
    const root = store.rootOf(row)
    if (root === null) return false
    return writeRow(workspace, insideSpace(root, row.path), row, change)
  },

  /** The inbox of a space (the open one where none is named) as a path on this disk,
   *  made the first time it is needed; null where no space is open. */
  async inbox(root = workspace.activeSpace?.root): Promise<string | null> {
    if (root === undefined) return null
    return inboxNote(root)
  },

  /** Every space's inbox, relative to it: what the Inbox view filters on. */
  inboxes(): { space: string; path: string }[] {
    return workspace.spaces.map((one) => ({ space: one.name, path: inboxOf(one.root) }))
  },
}
