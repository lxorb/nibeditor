/** The tree of a space, as an agent reads and tidies it: `list_notes`, `move_file`,
 *  `trash_file` and `create_folder` (docs/agent-native.md 5.3, 5.4).
 *
 *  In the space that is open each is the file list's own act, so it is the same move
 *  a drag makes (every link rewritten, one step to undo, the row where it went) and the
 *  same delete the row's menu makes (to Recently deleted, a version kept first). In a
 *  space the reader is not in, the same acts are done where the space is, with nothing
 *  in the window moved: the move is the crate's rename with the links rewritten through
 *  that space's own index, and every store that keeps a file by its path is told of the
 *  space it is in. See `movedAway`.
 *
 *  Nothing here deletes for good: there is no verb for it. Archived files are hidden
 *  from the list unless asked for, and are never trashed. */

import { isCanvasTarget, isPagesTarget, isPdfTarget, isWebTarget } from '@nib/markdown/links'
import type { AgentAnswer } from '../../automation/caller'
import { movedIn, movedPath } from '../../automation/acts'
import { canWriteAt } from '../../sharing.svelte'
import { isMarkdownPath, nameOf, relativeTo } from '../../space-paths'
import { invoke } from '../../tauri'
import { entryAt } from '../../tree-edits'
import { coveredBy } from '../../workspace/archive.svelte'
import { type Entry, workspace } from '../../workspace.svelte'
import { revOf } from '../docs/rev'
import { asked } from './asks'
import { type Call, count, done, flag, maybe, need, needScope, sourceOf } from './call'
import { indexOf } from './links'
import { Refused } from './problem'
import { judged, judgedForWriting, onDisk, type Place, placeFor, sharedSource } from './spaces'

/** What a file is, as `list_notes` says it and filters by. */
const KINDS = ['note', 'canvas', 'page', 'pdf', 'web', 'file'] as const
type Kind = (typeof KINDS)[number]

function kindOf(path: string): Kind {
  if (isCanvasTarget(path)) return 'canvas'
  if (isPagesTarget(path)) return 'page'
  if (isPdfTarget(path)) return 'pdf'
  if (isWebTarget(path)) return 'web'
  return isMarkdownPath(path) ? 'note' : 'file'
}

/** As many rows as the account's connector answers at once, and as many as may be
 *  asked for. */
const ROWS = 1000
const MOST_ROWS = 5000

/** The tree of a place: the window's own for the space it shows, which is what the
 *  file list draws, and the disk's for any other, read the way a space is read when
 *  it opens, hidden files left out. */
export async function treeOf(place: Place): Promise<Entry | null> {
  if (place.open) return workspace.tree

  return invoke<Entry>('read_tree', {
    root: place.space.root,
    options: { showHidden: false },
  }).catch(() => null)
}

/** The row at a path of a place, or null. */
export async function entryIn(place: Place, relative: string): Promise<Entry | null> {
  return entryAt(await treeOf(place), onDisk(place, relative))
}

/** The row an agent named: the path as it said it, or the note of that name when it
 *  left `.md` off, the way a link names one. */
async function named(place: Place, asked: string): Promise<{ relative: string; entry: Entry }> {
  const relative = judgedForWriting(asked)
  const entry = await entryIn(place, relative)
  if (entry) return { relative, entry }

  const note = nameOf(relative).includes('.') ? null : `${relative}.md`
  const found = note === null ? null : await entryIn(place, note)
  if (note !== null && found) return { relative: note, entry: found }

  throw new Refused('no_such_file', `there is nothing at ${asked} in ${place.space.name}`)
}

/** Refuses a write in a space shared with this account to read. */
function writable(place: Place, path: string): void {
  if (!canWriteAt(path)) {
    throw new Refused('read_only', `${place.space.name} is shared with you to read`)
  }
}

export async function listNotes(call: Call): Promise<AgentAnswer> {
  const place = placeFor(call, maybe(call, 'space'))
  const asked = maybe(call, 'folder')
  const folder = asked === null ? null : judged(asked)
  const kind = maybe(call, 'kind')
  if (kind !== null && !KINDS.some((one) => one === kind)) {
    throw new Refused('bad_arguments', `kind is one of ${KINDS.join(', ')}`)
  }

  const root = place.space.root
  const archived = workspace.archive.keysOf(root)
  const showArchived = flag(call, 'archived')
  const rows: { path: string; kind: Kind; modified: number; archived?: true }[] = []

  const walk = (entry: Entry) => {
    for (const child of entry.children) {
      if (child.is_dir) {
        walk(child)
        continue
      }

      const path = relativeTo(root, child.path)
      if (folder !== null && !path.startsWith(`${folder}/`)) continue

      const what = kindOf(path)
      if (kind !== null && what !== kind) continue

      const put = coveredBy(archived, path) !== null
      if (put && !showArchived) continue

      rows.push({ path, kind: what, modified: child.modified, ...(put ? { archived: true } : {}) })
    }
  }

  const tree = await treeOf(place)
  if (tree) walk(tree)

  // In the order a person reads a list of names in: case aside, numbers as numbers.
  rows.sort((one, other) =>
    one.path.localeCompare(other.path, undefined, { sensitivity: 'base', numeric: true }),
  )
  return done(rows.slice(0, count(call, 'limit', ROWS, MOST_ROWS)), sharedSource(place))
}

export async function moveFile(call: Call): Promise<AgentAnswer> {
  const place = placeFor(call, maybe(call, 'space'))
  const { relative: from, entry } = await named(place, need(call, 'path'))
  const to = movedPath(from, judgedForWriting(need(call, 'to')), entry.is_dir)

  if (to === from) return done({ from, to })
  if (entry.is_dir && to.startsWith(`${from}/`)) {
    throw new Refused('bad_arguments', `${from} cannot go inside itself`)
  }
  if (await entryIn(place, to)) {
    throw new Refused('exists', `${to} is already there, and nothing is written over`)
  }

  const source = onDisk(place, from)
  writable(place, source)

  const question = await asked(call, null, `Move ${from} to ${to} in ${place.space.name}`)
  if (question) return question

  if (place.open) await movedIn(place.space.root, from, to)
  else await movedAway(place, source, onDisk(place, to), entry.is_dir)

  return done({ from, to })
}

/** A move in a space the reader is not in: the same obligations the tree's own rename
 *  owes, met where that space is. The links are rewritten against that space's index as
 *  it was before the move, which is the only way to find what pointed at the old name;
 *  see `renameFile` in workspace.svelte.ts, which this follows step for step. Then the
 *  move is said the way every file operation is, and everything kept by path hears it
 *  of the space the path is in - that space's index among them; see
 *  workspace/file-ops.ts.
 *
 *  Not on the reader's own undo, which is about the space in front of them. */
async function movedAway(place: Place, from: string, to: string, folder: boolean): Promise<void> {
  const index = await indexOf(place)

  await invoke('rename_note', { from, to })
  await index.retarget(from, to, place.space.root)
  await workspace.fileMoved(from, to, folder ? 'folder' : 'file')
}

export async function trashFile(call: Call): Promise<AgentAnswer> {
  const place = placeFor(call, maybe(call, 'space'))
  const { relative, entry } = await named(place, need(call, 'path'))
  const path = onDisk(place, relative)

  if (workspace.keepsArchived(path)) {
    throw new Refused('archived', `${relative} is archived, and archived files are kept`)
  }
  writable(place, path)

  // What the agent read is what it meant to throw away: a note the reader has written
  // in since is not that note any more.
  const rev = maybe(call, 'if_rev')
  if (rev !== null && !entry.is_dir) {
    const words = await workspace.noteText(path)
    if (words === null || revOf(words.replace(/\r\n?/g, '\n')) !== rev) {
      throw new Refused('rev_changed', `${relative} has changed since it was read`)
    }
  }

  // A file in a tab goes with its tab, and a tab closing in front of the reader is their
  // screen changing; one behind it only leaves the strip.
  const shown = workspace.tabs.some(
    (tab) =>
      tab.path !== null &&
      workspace.showing(tab.paneId)?.id === tab.id &&
      (tab.path === path || tab.path.startsWith(`${path}/`)),
  )
  if (shown) needScope(call, 'workspace.focus', 'a file open in front of the reader')

  const question = await asked(call, null, `Move ${relative} to Recently deleted`)
  if (question) return question

  await workspace.remove(path, entry.is_dir, sourceOf(call))

  return done({ path: relative, trashed: true })
}

export async function createFolder(call: Call): Promise<AgentAnswer> {
  const place = placeFor(call, maybe(call, 'space'))
  const relative = judgedForWriting(need(call, 'path'))
  if (await entryIn(place, relative)) return done({ path: relative, made: false })

  const path = onDisk(place, relative)
  writable(place, path)

  const question = await asked(call, null, `Make the folder ${relative} in ${place.space.name}`)
  if (question) return question

  await invoke('create_folder', { path })
  if (place.open) await workspace.loadTree()

  return done({ path: relative, made: true })
}
