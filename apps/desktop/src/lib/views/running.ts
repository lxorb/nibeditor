/** What the runner does (runner.svelte.ts): the bases worth running, a note's change
 *  looked at once it settles, and the repeating templates. Plain state, kept apart from
 *  the runes that wire it to the app. See runner.svelte.ts for the why. */

import { readBase, readAutomations, repeatDue, type Row } from '@nib/bases'
import { withProperties } from '@nib/bases/agent'
import { show } from '../reminders/platform'
import { rows } from '../rows/rows.svelte'
import { insideSpace, within } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { writeEach } from './act'
import { type HeldBase, planned } from './automate'
import { contextFor } from './context'
import { nowHere, todayHere } from './days'
import { templatesFolder, templateWords } from './templates'

/** The bases worth running, by path on this disk. */
const held = new Map<string, HeldBase>()

/** The open space's base files are these: the rest are forgotten, the new ones read. */
export function basesAre(paths: readonly string[]) {
  for (const path of [...held.keys()]) if (!paths.includes(path)) held.delete(path)
  for (const path of paths) if (!held.has(path)) void readHeld(path)
}

/** Whether any base is worth running at all. */
export const running = (): boolean => held.size > 0
/** Notes the runner just wrote, whose next change is its own. */
const ours = new Set<string>()
/** Notes waiting for their quiet moment, with the rows they had before it. */
const waiting = new Map<string, { removed: readonly Row[]; timer: ReturnType<typeof setTimeout> }>()

/** How long a note is left to settle before its bases look at it: long enough for the
 *  write that changed it to have finished recording its undo, so the runner's write can
 *  join it. */
const SETTLE = 80

const keyOf = (space: string, path: string) => `${space}\n${path}`

function clock() {
  const now = nowHere()
  return { today: now.slice(0, 10), time: now.slice(11, 16) }
}

export async function readHeld(path: string): Promise<void> {
  const space = workspace.spaces.find((one) => within(one.root, path, one.root) !== null)
  try {
    const base = readBase(await invoke<string>('read_note', { path }))
    if (space && (base.nib.id || readAutomations(base).length)) {
      held.set(path, {
        name: path.replace(/^.*[\\/]/, '').replace(/\.base$/i, ''),
        space: space.name,
        base,
      })
      return
    }
  } catch {
    // A base half written by hand runs nothing until it reads again.
  }
  held.delete(path)
}

/** The rows of one note, as the store has them now. */
function rowsOf(space: string, path: string): readonly Row[] {
  return rows.of(space).filter((row) => row.path === path)
}

async function run(space: string, path: string, removed: readonly Row[]) {
  const bases = [...held.values()].filter((one) => one.space === space)
  if (!bases.length) return
  const all = rows.of(space)
  const today = todayHere()
  const context = contextFor({ rows: all, today, now: nowHere() })
  const plan = planned(bases, removed, rowsOf(space, path), all, context, clock())

  for (const write of plan.writes) ours.add(keyOf(write.row.space, write.row.path))
  if (plan.writes.length) await writeEach(plan.writes, true)

  const root = workspace.spaces.find((one) => one.name === space)?.root
  for (const move of plan.moves) {
    if (root === undefined) continue
    const folder = joinPath(root, move.folder.replace(/^\/+|\/+$/g, ''))
    await invoke('create_folder', { path: folder }).catch(() => undefined)
    await workspace.move(insideSpace(root, move.row.path), folder).catch(() => undefined)
  }
  for (const notice of plan.notices) {
    show(
      {
        id: `automation:${notice.row.path}`,
        title: notice.base,
        body: notice.words,
        space,
        path: notice.row.path,
        hash: '',
        line: 0,
        at: Date.now(),
      },
      () => {
        if (root !== undefined) void workspace.open(insideSpace(root, notice.row.path))
      },
    )
  }
}

/** A note's rows changed: looked at once they settle, unless the change is the runner's. */
export function heard(space: string, path: string, removed: readonly Row[]) {
  const key = keyOf(space, path)
  if (ours.delete(key)) return
  const was = waiting.get(key)
  if (was) clearTimeout(was.timer)
  const before = was?.removed ?? removed
  waiting.set(key, {
    removed: before,
    timer: setTimeout(() => {
      waiting.delete(key)
      void run(space, path, before)
    }, SETTLE),
  })
}

// ---- repeating templates ------------------------------------------------------------

/** Makes the note every repeating template of the open space owes today. */
export async function repeatTemplates() {
  const space = workspace.activeSpace
  if (!space || !rows.ready) return
  const folder = joinPath(space.root, await templatesFolder(space.root))
  const today = todayHere()
  for (const row of rows.of(space.name)) {
    if (row.kind !== 'note' || typeof row.note.repeat !== 'string') continue
    const path = insideSpace(space.root, row.path)
    if (within(folder, path, space.root) === null || workspace.documentAt(path)) continue
    const due = repeatDue(row.note, today)
    if (!due) continue

    const to =
      typeof row.note.folder === 'string' && row.note.folder.trim()
        ? joinPath(space.root, row.note.folder.trim())
        : space.root
    await invoke('create_folder', { path: to }).catch(() => undefined)
    const title = `${row.file.basename} ${due.day}`
    const name = workspace.freeName(to, `${title}.md`)
    const words = await templateWords(path, name.replace(/\.md$/i, ''))
    const made = joinPath(to, name)
    await writeFile(made, due.missed.length ? withProperties(words, { missed: due.missed }) : words)
    await workspace.fileCame(made, 'file')

    // Said in the template itself, which syncs, so another device does not make it too.
    const template = await workspace.noteText(path)
    if (template !== null) await writeFile(path, withProperties(template, { made: due.day }))
  }
  await workspace.loadTree()
}
