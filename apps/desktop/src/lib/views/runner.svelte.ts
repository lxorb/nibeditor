/** A space's bases at work while nib runs (docs/tasks.md 5.13): their automations and
 *  their ids on every change to a note, and the repeating templates on their days.
 *
 *  Fetched at the launch order's last turn, after the rows, never in the first paint
 *  (start.ts); importing this is starting it. It reads the open space's `.base` files
 *  once and again when one is written, keeps only the ones that automate something or
 *  number their rows, and listens to the rows (`rows.watch`), one note at a time.
 *
 *  What a change brings about is written as one edit joined to the undo of the edit
 *  that caused it (`writeEach(…, true)`), so one Ctrl+Z takes both back; and the change
 *  that write makes is the runner's own and is not run again, so automations never set
 *  each other off. A move is a file operation and is undone as one. */

import { readBase, readAutomations, repeatDue, type Row } from '@nib/bases'
import { withProperties } from '@nib/bases/agent'
import { untrack } from 'svelte'
import { links } from '../link-index.svelte'
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
let held = new Map<string, HeldBase>()
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

async function readHeld(path: string): Promise<void> {
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
function heard(space: string, path: string, removed: readonly Row[]) {
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
async function repeatTemplates() {
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

// ---- wiring --------------------------------------------------------------------------

$effect.root(() => {
  // The open space's base files, read again whenever the list of them changes.
  $effect(() => {
    const paths = workspace.files.filter((one) => /\.base$/i.test(one.name)).map((one) => one.path)
    untrack(() => {
      held = new Map([...held].filter(([path]) => paths.includes(path)))
      for (const path of paths) if (!held.has(path)) void readHeld(path)
    })
  })
})

links.hearSaves((path) => {
  if (/\.base$/i.test(path)) void readHeld(path)
})

rows.watch((change) => {
  if (change.path === null || !held.size) return
  if (!change.added.some((row) => row.kind === 'note')) return
  heard(change.space, change.path, change.removed)
})

// Once the rows are all read, and then every half hour, which also catches the day
// turning over.
const repeat = () => void repeatTemplates().catch(() => undefined)
if (rows.ready) repeat()
else {
  const ready = rows.watch(() => {
    if (!rows.ready) return
    ready()
    repeat()
  })
}
setInterval(repeat, 30 * 60_000)
