/** The connector's to-dos and bases: `list_tasks`, `add_task`, `update_task`,
 *  `query_base` and `add_row`, under the names and arguments `nib mcp` gives them, so
 *  a prompt written against one works against the other (docs/tasks.md 5.15).
 *
 *  What a call means is `@nib/bases/agent`, the same module the app's own verbs use,
 *  over rows read off the account's notes with nib closed: each note's words through
 *  `rowsOfText`, the one reader of a task line there is. A change is the note written
 *  whole through `putNote`, the connector's `write_note`, so it is a version like any
 *  other and a room merges it with whoever is typing. The answers are the same JSON
 *  the app answers with, because a model reads both. Writing needs a token that may
 *  write and a space that was not shared to read. */

import type { Context, Row } from '@nib/bases'
import {
  AgentError,
  clockOf,
  editedTask,
  listTasks,
  newTask,
  noteName,
  placeLines,
  queryBase,
  readAt,
  readBase,
  rowPlace,
  taskBlock,
  taskChange,
  taskIn,
  withProperties,
} from '@nib/bases/agent'
import { rowsOfText } from '@nib/bases/rows'
import { taskHash } from '@nib/bases'
import { appliedEdits } from '@nib/markdown/edits'
import { taskLine } from '@nib/markdown/task-edits'
import { cleanPath } from '../notes'
import { blobKey } from '../sync2/files'
import type { Env } from '../types'
import { askedSpace, noteBody, putNote, type Space, spacesFor } from './tools'
import type { TokenRow } from './tokens'

/** How many notes one call reads the words of, across every space it looks in. A list
 *  past this says it stopped looking (`partial`), the way a search does. */
const MOST_READ = 2000
/** How many bodies are asked of storage at once. */
const AT_ONCE = 32

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

const string = { type: 'string' }

export const TASK_TOOLS = [
  {
    name: 'list_tasks',
    description:
      "To-dos in every space, or `space`: a `view` (inbox, today, upcoming, logbook, or a .base path), Todoist's `filter` language (`today & #work | overdue`, `p1`, `7 days`), or both. Each row's `at` is what update_task takes.",
    inputSchema: {
      type: 'object',
      properties: { space: string, view: string, filter: string, limit: { type: 'integer' } },
    },
  },
  {
    name: 'add_task',
    description:
      "Add a to-do line to the space's Inbox.md, or to `note` under the heading `under`. `text` may carry Tasks plugin marks (📅 2026-10-06 ⏫ 🔁 every week); `fields` takes what update_task does. Answers its `at`.",
    inputSchema: {
      type: 'object',
      properties: {
        space: string,
        text: string,
        fields: { type: 'object' },
        note: string,
        under: string,
      },
      required: ['space', 'text'],
    },
  },
  {
    name: 'update_task',
    description:
      'Change one to-do by its `at`. `done` ticks it, and a recurring one writes its next line (`next`). Dates are YYYY-MM-DD, `""` takes a field off, priority is 1 (p1) to 4, `move_to` {note?, under?} moves it with its sub-tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        space: string,
        at: string,
        done: { type: 'boolean' },
        status: string,
        text: string,
        due: string,
        time: string,
        scheduled: string,
        start: string,
        deadline: string,
        priority: { type: 'integer' },
        recurrence: string,
        remind: string,
        duration: string,
        assignee: string,
        tags: { type: 'array', items: string },
        move_to: { type: 'object', properties: { note: string, under: string } },
      },
      required: ['space', 'at'],
    },
  },
  {
    name: 'query_base',
    description:
      'A view of a base as rows: its groups, the columns it shows and its summaries. `path` of a .base file, or the base as `yaml`.',
    inputSchema: {
      type: 'object',
      properties: { space: string, path: string, yaml: string, view: string },
      required: ['space'],
    },
  },
  {
    name: 'add_row',
    description:
      'Make a note as a row of a base: in the folder its filters look in, with the tags and values they ask for, from its template, then `properties`.',
    inputSchema: {
      type: 'object',
      properties: {
        space: string,
        base: string,
        view: string,
        title: string,
        properties: { type: 'object' },
      },
      required: ['space', 'base'],
    },
  },
]

type Args = Record<string, unknown>

/** The engine's sentence, or the connector's, as what the model reads. */
class Said extends Error {}

const words = (args: Args, name: string): string | undefined => {
  const value = args[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** A note of a space as the connector has it: its row in the table and its words. */
interface Held {
  id: string
  path: string
}

/** The notes of a space, by path. */
async function notesOf(env: Env, space: Space): Promise<Held[]> {
  const { results } = await env.DB.prepare(
    `select id, path from notes where space_id = ? and deleted = 0 and kind != 'file'
      order by path limit ?`,
  )
    .bind(space.id, MOST_READ)
    .all<Held>()
  return results
}

/** The rows of the spaces, read a few notes at a time; `partial` where the cap was met. */
async function rowsOf(
  env: Env,
  spaces: readonly Space[],
): Promise<{ rows: Row[]; partial: boolean }> {
  const rows: Row[] = []
  let left = MOST_READ
  let partial = false
  for (const space of spaces) {
    const held = (await notesOf(env, space)).filter((one) => MARKDOWN.test(one.path))
    if (held.length > left) partial = true
    const reading = held.slice(0, Math.max(0, left))
    left -= reading.length
    for (let at = 0; at < reading.length; at += AT_ONCE) {
      const batch = reading.slice(at, at + AT_ONCE)
      const bodies = await Promise.all(batch.map((one) => noteBody(env, space.id, one.id)))
      batch.forEach((one, index) =>
        rows.push(...rowsOfText(space.name, one.path, bodies[index] ?? '')),
      )
    }
  }
  return { rows, partial }
}

/** One note's words, or null where there is no note at that path. */
async function wordsAt(env: Env, space: Space, path: string): Promise<string | null> {
  const note = await env.DB.prepare(
    "select id from notes where space_id = ? and path = ? and deleted = 0 and kind != 'file'",
  )
    .bind(space.id, path)
    .first<{ id: string }>()
  return note ? noteBody(env, space.id, note.id) : null
}

/** A note path an argument names, `.md` added where it has no ending. */
function notePath(asked: string): string {
  const named = asked.trim()
  const path = cleanPath(MARKDOWN.test(named) ? named : `${named}.md`)
  if (!path) throw new Said(`${asked} is not a note path.`)
  return path
}

async function written(env: Env, space: Space, path: string, words: string): Promise<void> {
  const refused = await putNote(env, space, path, words)
  if (refused !== null) throw new Said(refused)
}

/** What the engine is asked against. The account keeps no zone, so the day is UTC's;
 *  `nib mcp`, on the reader's machine, answers in theirs. */
function contextNow(): Context {
  return clockOf(new Date(), 'UTC')
}

/** A `.base` file's words. A base is no note to the account: it syncs as a file, its
 *  bytes kept by their hash (sync2/files.ts). */
async function baseText(env: Env, space: Space, path: string): Promise<string | null> {
  const file = await env.DB.prepare(
    "select hash from notes where space_id = ? and path = ? and deleted = 0 and kind = 'file'",
  )
    .bind(space.id, path)
    .first<{ hash: string }>()
  if (!file) return null
  const object = await env.NOTES.get(blobKey(file.hash))
  return object ? object.text() : null
}

async function readBaseAt(env: Env, space: Space, asked: string) {
  const path = asked.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!/\.base$/i.test(path) || path.split('/').some((part) => !part || part === '..')) {
    throw new Said(`${asked} is not a .base file.`)
  }
  const text = await baseText(env, space, path)
  if (text === null) throw new Said(`No base at ${path}.`)
  try {
    return { path, base: readBase(text) }
  } catch (error) {
    throw new Said(`${path} does not read: ${String(error)}`)
  }
}

async function list(env: Env, token: TokenRow, args: Args): Promise<unknown> {
  const spaces =
    args.space === undefined || args.space === null
      ? await spacesFor(env, token.user_id)
      : [await spaceOf(env, token, args)]
  const view = words(args, 'view')
  const filter = words(args, 'filter')
  const { rows, partial } = await rowsOf(env, spaces)
  const base =
    view && /\.base$/i.test(view)
      ? await readBaseAt(env, await spaceOf(env, token, args), view)
      : null
  const names = new Set(
    rows.filter((row) => row.kind === 'note').map((row) => row.file.basename.toLowerCase()),
  )
  const answer = listTasks(
    rows,
    {
      ...(base ? { base: { base: base.base } } : view ? { view } : {}),
      ...(filter ? { filter } : {}),
      ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
      inboxes: spaces.map((space) => ({ space: space.name, path: 'Inbox.md' })),
      isNote: (name) => names.has(name.toLowerCase()),
    },
    contextNow(),
  )
  return partial ? { ...answer, partial } : answer
}

/** The space a call names, refused in a sentence where it names none it reaches. */
async function spaceOf(env: Env, token: TokenRow, args: Args): Promise<Space> {
  const space = await askedSpace(env, token.user_id, args)
  if (typeof space === 'string') throw new Said(space)
  return space
}

/** The space a write names, refused where the token or the share may not write. */
async function writableSpace(env: Env, token: TokenRow, args: Args): Promise<Space> {
  if (token.read_only)
    throw new Said('This token may only read. Allow writing in nibeditor’s settings first.')
  const space = await spaceOf(env, token, args)
  if (space.role === 'read')
    throw new Said(`${space.name} was shared with you to read, not to write.`)
  return space
}

async function add(env: Env, token: TokenRow, args: Args): Promise<unknown> {
  const space = await writableSpace(env, token, args)
  const fields = newTask(args)
  const path = notePath(words(args, 'note') ?? 'Inbox.md')
  const before = (await wordsAt(env, space, path)) ?? ''
  const placed = placeLines(before, [taskLine(fields)], words(args, 'under'))
  await written(env, space, path, appliedEdits(before, [placed.edit]))
  return { at: `${path}#${placed.line}:${taskHash(fields.text)}`, space: space.name }
}

async function update(env: Env, token: TokenRow, args: Args): Promise<unknown> {
  const space = await writableSpace(env, token, args)
  const anchor = readAt(args.at)
  const path = notePath(anchor.path)
  const text = await wordsAt(env, space, path)
  if (text === null) throw new Said(`No note at ${path}.`)

  const done = typeof args.done === 'boolean' ? args.done : undefined
  const edited = editedTask(
    text,
    space.name,
    path,
    anchor,
    taskChange(args),
    done,
    contextNow().today,
  )
  const said = { at: edited.at, ...(edited.next ? { next: edited.next } : {}), space: space.name }
  const moveTo = args.move_to
  if (moveTo === undefined || moveTo === null) {
    if (edited.text !== text) await written(env, space, path, edited.text)
    return said
  }

  // Moved: the new note written first, so the task is never in neither.
  const target = typeof moveTo === 'object' ? (moveTo as Args) : { note: moveTo }
  const into = typeof target.note === 'string' && target.note.trim() ? notePath(target.note) : path
  const under = words(target, 'under')
  const block = taskBlock(
    edited.text,
    taskIn(edited.text, space.name, path, readAt(edited.at)).anchor?.line ?? 0,
  )
  const source = edited.text.slice(0, block.from) + edited.text.slice(block.to)
  const before = into === path ? source : ((await wordsAt(env, space, into)) ?? '')
  const placed = placeLines(before, block.lines, under)
  await written(env, space, into, appliedEdits(before, [placed.edit]))
  if (into !== path) await written(env, space, path, source)
  return { ...said, at: `${into}#${placed.line}:${readAt(edited.at).hash}` }
}

async function query(env: Env, token: TokenRow, args: Args): Promise<unknown> {
  const space = await spaceOf(env, token, args)
  const yaml = typeof args.yaml === 'string' ? args.yaml : undefined
  const path = words(args, 'path')
  let base
  if (yaml !== undefined) {
    try {
      base = readBase(yaml)
    } catch (error) {
      throw new Said(`The yaml does not read: ${String(error)}`)
    }
  } else if (path) {
    base = (await readBaseAt(env, space, path)).base
  } else {
    throw new Said('Say the path of a .base file, or the base as yaml.')
  }
  const { rows, partial } = await rowsOf(env, [space])
  const answer = queryBase(base, words(args, 'view'), rows, contextNow())
  return partial ? { ...answer, partial } : answer
}

async function addRow(env: Env, token: TokenRow, args: Args): Promise<unknown> {
  const space = await writableSpace(env, token, args)
  const { path: basePath, base } = await readBaseAt(env, space, words(args, 'base') ?? '')
  const properties = args.properties ?? {}
  if (typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Said('properties is an object of property names and values.')
  }
  const where = rowPlace(base, words(args, 'view'))
  const folder = where.folder ?? basePath.slice(0, Math.max(0, basePath.lastIndexOf('/')))

  const link = base.nib.template
    ?.replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    ?.trim()
  const template = link ? ((await wordsAt(env, space, notePath(link))) ?? '') : ''
  const name = noteName(words(args, 'title') ?? 'Untitled')
  for (let counter = 1; counter < 100; counter++) {
    const file = counter === 1 ? `${name}.md` : `${name} ${counter}.md`
    const path = folder ? `${folder}/${file}` : file
    if ((await wordsAt(env, space, path)) !== null) continue
    await written(
      env,
      space,
      path,
      withProperties(template, { ...where.properties, ...(properties as Args) }),
    )
    return { path, created: true, space: space.name }
  }
  throw new Said(`${name} is taken a hundred times over.`)
}

const RUNS: Record<string, (env: Env, token: TokenRow, args: Args) => Promise<unknown>> = {
  list_tasks: list,
  add_task: add,
  update_task: update,
  query_base: query,
  add_row: addRow,
}

/** Runs one of the five, answering JSON, or a sentence where it cannot. */
export async function callTaskTool(
  env: Env,
  token: TokenRow,
  name: string,
  args: Args,
): Promise<string> {
  const run = RUNS[name]
  if (!run) return `No tool called ${name}.`
  try {
    return JSON.stringify(await run(env, token, args))
  } catch (error) {
    if (error instanceof Said || error instanceof AgentError) return error.message
    throw error
  }
}
