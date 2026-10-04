/** The tasks' and bases' verbs: `list_tasks`, `add_task`, `update_task`, `query_base`,
 *  `add_row`, `edit_rows` and `edit_base` (docs/tasks.md 5.15).
 *
 *  What a call means is `@nib/bases/agent`, the half the account connector shares; this
 *  is the rest, on the road every note verb takes. A list reads the rows of the spaces
 *  the grant reaches, every one of them unless a space is named, because Today has to
 *  see a task wherever it was written. A change is read off the note as it is on screen
 *  and written back as the agent's own edit of that note (`notes.writeNote`), so the
 *  reader's typing wins, the agent's caret shows, the AI sidebar's review keeps or
 *  undoes it, and one undo takes a tick and its recurring task's next line back
 *  together. A space the grant does not reach does not exist, and one shared to read is
 *  refused before anything is asked. */

import type { Base, Context, Row } from '@nib/bases'
import {
  AgentError,
  clockOf,
  editedBase,
  editedTask,
  listTasks as listed,
  movedTask,
  newTask,
  quickWords,
  noteName,
  placedEdit,
  placeIn,
  queryBase as queried,
  readAt,
  readBase,
  rowPlace,
  taskBlock,
  taskChange,
  taskIn,
  withProperties,
  writeBase,
} from '@nib/bases/agent'
import { appliedEdits } from '@nib/markdown/edits'
import { taskLine } from '@nib/markdown/task-edits'
import { taskHash } from '@nib/bases'
import type { AgentAnswer } from '../../automation/caller'
import { isShared } from '../../sharing.svelte'
import { folderOf, nameOf } from '../../space-paths'
import { invoke } from '../../tauri'
import { workspace } from '../../workspace.svelte'
import { writeFile } from '../../workspace/write-file'
import { DocError, notes } from '../docs'
import { asked } from './asks'
import { type Call, done, flag, maybe, need, writerOf } from './call'
import { at, made, noteOf } from './notes'
import { Refused } from './problem'
import { judgedForWriting, onDisk, type Place, placeFor, reachable } from './spaces'

/** The rows store, fetched with the first of these verbs: importing it starts it. */
async function rowsStore() {
  const { rows } = await import('../../rows/rows.svelte')
  // A launch an agent called into before every space was read: wait for the read, a
  // few seconds at the most, rather than answer from half the spaces.
  for (let waited = 0; !rows.ready && waited < 8000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return rows
}

/** The engine's sentence as a refusal an agent can act on. */
function refused(error: unknown): never {
  if (error instanceof AgentError) throw new Refused(error.code, error.message)
  throw error
}

/** What the engine is asked against: the reader's clock, who "me" is. */
async function contextOf(): Promise<Context> {
  const { account } = await import('../../account.svelte')
  return { ...clockOf(new Date()), ...(account.name ? { me: account.name } : {}) }
}

/** The spaces a call is about: the one it names, or every one the grant reaches. */
function spacesOf(call: Call): Place[] {
  const named = maybe(call, 'space')
  if (named !== null) return [placeFor(call, named)]
  const open = workspace.activeSpace?.id
  return reachable(call).map((space) => ({ space, open: space.id === open }))
}

/** Where a call's words come from when somebody else can write them too. */
function sourceOf(places: readonly Place[]): string | null {
  const shared = places.filter((place) => isShared(place.space.root))
  return shared.length ? `shared space ${shared.map((one) => one.space.name).join(', ')}` : null
}

/** A `.base` file a call names, read, in the space it names. */
async function baseAt(
  call: Call,
  name = 'path',
): Promise<{ place: Place; relative: string; text: string; base: Base }> {
  const place = placeFor(call, maybe(call, 'space'))
  const relative = judgedForWriting(need(call, name))
  if (!/\.base$/i.test(relative))
    throw new Refused('bad_arguments', `${relative} is not a .base file`)
  const text = await invoke<string>('read_note', { path: onDisk(place, relative) }).catch(
    () => null,
  )
  if (text === null)
    throw new Refused('no_such_file', `there is no ${relative} in ${place.space.name}`)
  try {
    return { place, relative, text, base: readBase(text) }
  } catch (error) {
    throw new Refused('bad_arguments', `${relative} does not read: ${String(error)}`)
  }
}

export async function listTasks(call: Call): Promise<AgentAnswer> {
  const places = spacesOf(call)
  const rows = await rowsStore()
  const all = places.flatMap((place) => rows.of(place.space.name))
  const view = maybe(call, 'view')
  const base = view && /\.base$/i.test(view) ? await baseAt(call, 'view') : null
  const names = new Set(
    all.filter((row) => row.kind === 'note').map((row) => row.file.basename.toLowerCase()),
  )
  const reached = new Set(places.map((place) => place.space.name))

  try {
    const answer = listed(
      all,
      {
        ...(base ? { base: { base: base.base } } : view ? { view } : {}),
        ...(maybe(call, 'filter') ? { filter: need(call, 'filter') } : {}),
        ...(typeof call.args.limit === 'number' ? { limit: call.args.limit } : {}),
        inboxes: rows.inboxes().filter((one) => reached.has(one.space)),
        isNote: (name) => names.has(name.toLowerCase()),
      },
      await contextOf(),
    )
    return done(answer, sourceOf(places))
  } catch (error) {
    refused(error)
  }
}

/** Reads a note, works out its new words and writes them as the agent's edit, reading
 *  again where the reader typed in it meanwhile. */
async function rewritten<T>(
  call: Call,
  note: ReturnType<typeof noteOf>,
  work: (text: string) => { text: string; said: T },
): Promise<T> {
  for (let tries = 0; ; tries++) {
    const read = await notes.readNote(at(note), ['text'])
    const { text, said } = work(read.text ?? '')
    if (text === read.text) return said
    try {
      await notes.writeNote(writerOf(call), at(note), text, read.rev)
      return said
    } catch (error) {
      if (!(error instanceof DocError && error.code === 'rev_changed') || tries > 2) throw error
    }
  }
}

/** The note a call names under `name`, for writing, with `.md` where it has no ending. */
function writableNote(call: Call, path: string) {
  return noteOf({ ...call, args: { ...call.args, tab: null, path } }, true)
}

export async function addTask(call: Call): Promise<AgentAnswer> {
  const place = placeFor(call, maybe(call, 'space'))
  const { rows } = await import('../../rows/rows.svelte')
  // Quick add's grammar over the words, in the reader's language and English, knowing
  // the space's notes for `>Note`, as the quick add field reads them.
  const { i18n } = await import('../../i18n.svelte')
  const names = rows
    .of(place.space.name)
    .filter((row) => row.kind === 'note')
    .map((row) => row.path.replace(/.md$/i, ''))
  const read = (() => {
    try {
      return newTask(call.args, quickWords([i18n.language], new Date(), names))
    } catch (error) {
      refused(error)
    }
  })()
  const { fields } = read
  // The space's inbox where no note is named, made by the write below if it is not there.
  const inbox = rows.inboxes().find((one) => one.space === place.space.name)?.path ?? 'Inbox.md'
  const path = maybe(call, 'note') ?? read.note ?? inbox
  const note = writableNote({ ...call, args: { ...call.args, space: place.space.id } }, path)
  const under = maybe(call, 'under') ?? read.heading
  const line = taskLine(fields)

  const question = await asked(call, null, `Add a task to ${note.relative}`)
  if (question) return question

  const hash = taskHash(fields.text)
  if ((await workspace.noteText(onDisk(note.place, note.relative))) === null) {
    const placed = placeIn('', [line], under)
    await made(note.place, note.relative, appliedEdits('', [placedEdit(placed)]), false)
    return done({ at: `${note.relative}#${placed.line}:${hash}`, space: place.space.name })
  }

  const placedAt = await rewritten(call, note, (text) => {
    const placed = placeIn(text, [line], under)
    return { text: appliedEdits(text, [placedEdit(placed)]), said: placed.line }
  })
  return done({ at: `${note.relative}#${placedAt}:${hash}`, space: place.space.name })
}

export async function updateTask(call: Call): Promise<AgentAnswer> {
  const place = placeFor(call, maybe(call, 'space'))
  const anchor = (() => {
    try {
      return readAt(call.args.at)
    } catch (error) {
      refused(error)
    }
  })()
  const note = writableNote({ ...call, args: { ...call.args, space: place.space.id } }, anchor.path)
  const moveTo = call.args.move_to
  const ticking = 'done' in call.args ? flag(call, 'done') : undefined
  const change = (() => {
    try {
      return taskChange(call.args)
    } catch (error) {
      refused(error)
    }
  })()

  const question = await asked(call, null, `Change a task in ${note.relative}`)
  if (question) return question

  const { today } = clockOf(new Date())
  try {
    let said = await rewritten(call, note, (text) => {
      const edited = editedTask(
        text,
        place.space.name,
        note.relative,
        anchor,
        change,
        ticking,
        today,
      )
      return {
        text: edited.text,
        said: { at: edited.at, ...(edited.next ? { next: edited.next } : {}) },
      }
    })
    if (moveTo !== undefined && moveTo !== null) {
      said = { ...said, ...(await moved(call, place, note, readAt(said.at), moveTo)) }
    }
    return done({ ...said, space: place.space.name })
  } catch (error) {
    refused(error)
  }
}

/** `move_to`: the task and everything under it into another note, or under another
 *  heading of its own. Two notes are two edits, the new one written first, so a task
 *  is never in neither. */
async function moved(
  call: Call,
  place: Place,
  from: ReturnType<typeof noteOf>,
  anchor: { line: number; hash: string },
  moveTo: unknown,
): Promise<{ at: string }> {
  const target = typeof moveTo === 'string' ? { note: moveTo } : moveTo
  if (typeof target !== 'object' || target === null) {
    throw new Refused('bad_arguments', 'move_to is {note?, under?}')
  }
  const { note: wanted, under } = target as { note?: unknown; under?: unknown }
  const heading = typeof under === 'string' && under.trim() ? under.trim() : undefined
  const into =
    typeof wanted === 'string' && wanted.trim() ? writableNote(call, wanted.trim()) : from

  if (into.relative === from.relative) {
    const line = await rewritten(call, from, (text) => {
      const result = movedTask(
        { text, space: place.space.name, path: from.relative, anchor },
        null,
        heading,
      )
      return { text: result.source, said: result.line }
    })
    return { at: `${from.relative}#${line}:${anchor.hash}` }
  }

  const source = await notes.readNote(at(from), ['text'])
  const words = source.text ?? ''
  const block = taskBlock(
    words,
    taskIn(words, place.space.name, from.relative, anchor).anchor?.line ?? 0,
  )
  let line: number
  if ((await workspace.noteText(onDisk(into.place, into.relative))) === null) {
    const placed = placeIn('', block.lines, heading)
    await made(into.place, into.relative, appliedEdits('', [placedEdit(placed)]), false)
    line = placed.line
  } else {
    line = await rewritten(call, into, (text) => {
      const placed = placeIn(text, block.lines, heading)
      return { text: appliedEdits(text, [placedEdit(placed)]), said: placed.line }
    })
  }
  await notes.writeNote(
    writerOf(call),
    at(from),
    words.slice(0, block.from) + words.slice(block.to),
    source.rev,
  )
  return { at: `${into.relative}#${line}:${anchor.hash}` }
}

export async function queryBase(call: Call): Promise<AgentAnswer> {
  const yaml = maybe(call, 'yaml')
  const { place, base } =
    yaml === null
      ? await baseAt(call)
      : (() => {
          try {
            return { place: placeFor(call, maybe(call, 'space')), base: readBase(yaml) }
          } catch (error) {
            throw new Refused('bad_arguments', `the yaml does not read: ${String(error)}`)
          }
        })()
  const rows = await rowsStore()
  try {
    const answer = queried(
      base,
      maybe(call, 'view') ?? undefined,
      rows.of(place.space.name),
      await contextOf(),
    )
    return done(answer, sourceOf([place]))
  } catch (error) {
    refused(error)
  }
}

/** A path that is free: the name, else the name with the first number after it that is. */
async function freePath(place: Place, folder: string, name: string): Promise<string> {
  for (let counter = 1; counter < 100; counter++) {
    const file = counter === 1 ? `${name}.md` : `${name} ${counter}.md`
    const relative = folder ? `${folder}/${file}` : file
    if ((await workspace.noteText(onDisk(place, relative))) === null) return relative
  }
  throw new Refused('exists', `${name} is taken a hundred times over in ${folder || 'the space'}`)
}

/** The words of a base's template note, `[[Templates/Bug]]`, or nothing. */
async function templateOf(place: Place, base: Base, rows: readonly Row[]): Promise<string> {
  const link = base.nib.template
    ?.replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    ?.trim()
  if (!link) return ''
  const wanted = link.toLowerCase().replace(/\.md$/i, '')
  const found = rows.find(
    (row) =>
      row.kind === 'note' &&
      (row.path.toLowerCase().replace(/\.md$/i, '') === wanted ||
        row.file.basename.toLowerCase() === wanted),
  )
  if (!found) return ''
  return (await workspace.noteText(onDisk(place, found.path))) ?? ''
}

export async function addRow(call: Call): Promise<AgentAnswer> {
  const { place, relative, base } = await baseAt(call, 'base')
  const properties = call.args.properties ?? {}
  if (typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Refused('bad_arguments', 'properties is an object of property names and values')
  }
  const where = rowPlace(base, maybe(call, 'view') ?? undefined)
  const folder = judgedForWriting(where.folder ?? folderOf(relative)).replace(/^\.$/, '')
  const rows = await rowsStore()
  const template = await templateOf(place, base, rows.of(place.space.name))
  const name = noteName(maybe(call, 'title') ?? 'Untitled')
  const path = await freePath(place, folder === '.' ? '' : folder, name)

  const question = await asked(call, null, `Make ${path} in ${place.space.name}`)
  if (question) return question

  try {
    const words = withProperties(template, {
      ...where.properties,
      ...(properties as Record<string, unknown>),
    })
    return done(await made(place, path, words, false))
  } catch (error) {
    refused(error)
  }
}

export async function editRows(call: Call): Promise<AgentAnswer> {
  const paths = call.args.paths
  const properties = call.args.properties
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.length > 200 ||
    !paths.every((one) => typeof one === 'string')
  ) {
    throw new Refused('bad_arguments', 'paths is a list of up to 200 note paths')
  }
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new Refused('bad_arguments', 'properties is an object of property names and values')
  }
  const named = paths.map((path) => writableNote(call, path))

  const question = await asked(call, null, `Set properties on ${named.length} notes`)
  if (question) return question

  const changed: string[] = []
  for (const note of named) {
    try {
      const wrote = await rewritten(call, note, (text) => {
        const after = withProperties(text, properties as Record<string, unknown>)
        return { text: after, said: after !== text }
      })
      if (wrote) changed.push(note.relative)
    } catch (error) {
      refused(error)
    }
  }
  return done({ changed })
}

export async function editBase(call: Call): Promise<AgentAnswer> {
  const { place, relative, text, base } = await baseAt(call)
  const next = (() => {
    try {
      return editedBase(base, call.args.ops)
    } catch (error) {
      refused(error)
    }
  })()

  const question = await asked(call, null, `Edit ${nameOf(relative)} in ${place.space.name}`)
  if (question) return question

  const written = writeBase(next, text)
  if (written === text) return done({ path: relative, changed: false })
  await writeFile(onDisk(place, relative), written)
  const { sync } = await import('../../sync.svelte')
  sync.nudge()
  return done({ path: relative, changed: true, views: next.views.map((view) => view.name) })
}
