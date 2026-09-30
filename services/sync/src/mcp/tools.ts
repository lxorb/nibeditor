/** What the connector can actually do, and the words it answers with.
 *
 *  Every tool answers in prose, because prose is what the model reads: a space
 *  it cannot find, an argument it left out and a token that may not write all
 *  come back as a sentence rather than as an error. Nothing here trusts an
 *  argument's type - a model sends what it likes - so each is checked before
 *  it reaches a query. */

import { findLinks } from '@nib/markdown'
import { byteLength } from '../crypto'
import { addNote, cleanPath, MAX_NOTE_BYTES, noteKey, saveNote } from '../notes'
import { fits } from '../storage'
import type { Env, Note } from '../types'
import type { TokenRow } from './tokens'

/** Enough that an account's notes are all reachable, small enough that one
 *  call cannot walk an unbounded amount of storage. */
const MOST_SPACES = 500
const MOST_NOTES = 1000
const MOST_MATCHES = 50
/** How many notes a search reads the body of. A match is usually near the
 *  front of an account; past this the answer says it stopped looking. */
const MOST_SEARCHED = 300

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** Which line an offset falls on, counting from zero. */
function lineAt(body: string, at: number): number {
  return body.slice(0, at).split('\n').length - 1
}

export const TOOLS = [
  {
    name: 'list_spaces',
    description: 'List the spaces in this account.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_notes',
    description: 'List the notes in a space.',
    inputSchema: {
      type: 'object',
      properties: { space: { type: 'string', description: 'Space name or id.' } },
      required: ['space'],
    },
  },
  {
    name: 'read_note',
    description: 'Read one note.',
    inputSchema: {
      type: 'object',
      properties: {
        space: { type: 'string' },
        path: { type: 'string', description: 'Path inside the space, such as ideas/plan.md' },
      },
      required: ['space', 'path'],
    },
  },
  {
    name: 'search_notes',
    description: 'Find notes containing some text.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, space: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'list_backlinks',
    description: 'List the notes that link to one note.',
    inputSchema: {
      type: 'object',
      properties: {
        space: { type: 'string' },
        path: { type: 'string', description: 'Path inside the space, such as ideas/plan.md' },
      },
      required: ['space', 'path'],
    },
  },
  {
    name: 'write_note',
    description:
      'Create or replace a note. Refused while the token is read-only, and in a space that was shared to read.',
    inputSchema: {
      type: 'object',
      properties: {
        space: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['space', 'path', 'content'],
    },
  },
]

/** One space the caller can reach. Exported because the glasses' own two tools
 *  reach the same spaces through the same query; see ask/notes.ts. */
export interface Space {
  id: string
  name: string
  /** What the account may do here. A space somebody shared read-only is listed,
   *  read and searched like any other; writing into it is refused. */
  role: 'owner' | 'write' | 'read'
  /** Whose storage a note written here lands in, which is whose quota it has
   *  to fit inside. */
  user_id: string
}

/** An argument the model was asked to send as text. Undefined when it is
 *  missing; null when it is there and is something else, which is a different
 *  thing to say back. */
function text(args: Record<string, unknown>, name: string): string | undefined | null {
  const value = args[name]
  if (value === undefined || value === null) return undefined
  return typeof value === 'string' ? value : null
}

/** Every space the account can reach: its own, and the ones somebody shared
 *  with it. The membership is joined on the address, which is how it is joined
 *  everywhere else; see spaces/space.ts.
 *
 *  Spaces, and not one file of somebody else's space: `item = ''` is the same
 *  condition every space route holds to. Somebody handed one note is not somebody
 *  who may be told what else is in the drawer, and a connector that listed the
 *  space would hand a model the lot. */
export async function spacesFor(env: Env, userId: string): Promise<Space[]> {
  const { results } = await env.DB.prepare(
    `select sp.id, sp.name, sp.user_id,
        case when sp.user_id = ?1 then 'owner' else m.role end as role
      from spaces sp
      left join space_members m
        on m.space_id = sp.id and m.item = ''
       and m.email = (select email from users where id = ?1)
     where sp.deleted = 0 and (sp.user_id = ?1 or m.role is not null)
     order by sp.name limit ?2`,
  )
    .bind(userId, MOST_SPACES)
    .all<Space>()

  return results
}

/** Accepts a name or an id, so an LLM can use whichever it saw last. Only the
 *  spaces the caller can reach are ever looked at, so an id belonging to
 *  somebody who shared nothing with them is simply not found.
 *
 *  A name is not an id, and two spaces can share one. Being invited is enough to
 *  have a space in the list, so anybody who knows an address can put a space
 *  called Notes beside that person's own Notes - and the first of two equal names
 *  was whichever the database handed back first, which made "write this into
 *  Notes" a way to write it into a stranger's space. So the account's own space
 *  wins its own name, and two spaces nobody here owns are named back by id rather
 *  than chosen between. */
async function findSpace(env: Env, userId: string, wanted: string): Promise<Space | string | null> {
  const all = await spacesFor(env, userId)
  const byId = all.find((space) => space.id === wanted)
  if (byId) return byId

  const needle = wanted.trim().toLowerCase()
  const named = all.filter((space) => space.name.toLowerCase() === needle)
  const own = named.find((space) => space.role === 'owner')
  if (own || named.length < 2) return own ?? named[0] ?? null

  const ids = named.map((space) => space.id).join(', ')
  return `${named.length} spaces shared with you are called ${wanted}: ${ids}. Name one by its id.`
}

export async function noteBody(env: Env, spaceId: string, noteId: string): Promise<string> {
  const object = await env.NOTES.get(noteKey(spaceId, noteId))
  return object ? object.text() : ''
}

/** The space an argument names, or the sentence to answer with instead. */
async function askedSpace(
  env: Env,
  userId: string,
  args: Record<string, unknown>,
): Promise<Space | string> {
  const wanted = text(args, 'space')
  if (wanted === null) return 'The space has to be a name or an id.'
  if (!wanted?.trim()) return 'Which space?'

  return (await findSpace(env, userId, wanted)) ?? `No space called ${wanted}.`
}

async function listNotes(env: Env, space: Space): Promise<string> {
  const { results } = await env.DB.prepare(
    'select path from notes where space_id = ? and deleted = 0 order by path limit ?',
  )
    .bind(space.id, MOST_NOTES)
    .all<{ path: string }>()

  return results.map((row) => row.path).join('\n') || 'No notes yet.'
}

async function readNote(env: Env, space: Space, args: Record<string, unknown>): Promise<string> {
  const path = cleanPath(text(args, 'path') ?? '')
  if (!path) return 'That is not a note path.'

  const note = await env.DB.prepare(
    'select id from notes where space_id = ? and path = ? and deleted = 0',
  )
    .bind(space.id, path)
    .first<{ id: string }>()

  if (!note) return `No note at ${path}.`
  return noteBody(env, space.id, note.id)
}

async function searchNotes(
  env: Env,
  scope: Space[],
  args: Record<string, unknown>,
): Promise<string> {
  const asked = text(args, 'query')
  if (asked === null) return 'The query has to be text.'

  const needle = (asked ?? '').toLowerCase()
  if (!needle) return 'Give me something to look for.'

  const found: string[] = []
  let read = 0

  for (const one of scope) {
    if (found.length >= MOST_MATCHES || read >= MOST_SEARCHED) break

    const { results } = await env.DB.prepare(
      'select id, path from notes where space_id = ? and deleted = 0 order by path limit ?',
    )
      .bind(one.id, MOST_NOTES)
      .all<{ id: string; path: string }>()

    for (const row of results) {
      if (found.length >= MOST_MATCHES || read >= MOST_SEARCHED) break
      read++

      const body = await noteBody(env, one.id, row.id)
      const line = body.split('\n').find((entry) => entry.toLowerCase().includes(needle))
      if (line) found.push(`${one.name}/${row.path}: ${line.trim().slice(0, 200)}`)
    }
  }

  return found.join('\n') || 'Nothing found.'
}

/** Which notes link to one note, and the line each says it on.
 *
 *  A link may name a note by its file name or by any tail of its path, so the
 *  names the note answers to are worked out once and every link in the space is
 *  compared against them. Nothing here resolves a name the way the editor does -
 *  which of two notes of one name is meant depends on where the link was written,
 *  and a connector answering "these mention it" is honest and cheap. */
async function listBacklinks(
  env: Env,
  space: Space,
  args: Record<string, unknown>,
): Promise<string> {
  const path = cleanPath(text(args, 'path') ?? '')
  if (!path) return 'That is not a note path.'

  const names = new Set<string>()
  const parts = path.replace(MARKDOWN, '').toLowerCase().split('/')
  for (let at = 0; at < parts.length; at++) names.add(parts.slice(at).join('/'))

  const { results } = await env.DB.prepare(
    'select id, path from notes where space_id = ? and deleted = 0 order by path limit ?',
  )
    .bind(space.id, MOST_NOTES)
    .all<{ id: string; path: string }>()

  const found: string[] = []

  for (const row of results) {
    if (found.length >= MOST_MATCHES || row.path === path) continue

    const body = await noteBody(env, space.id, row.id)
    for (const link of findLinks(body)) {
      if (!names.has(link.target.replace(MARKDOWN, '').toLowerCase())) continue
      found.push(`${row.path}:${lineAt(body, link.from) + 1}`)
      break
    }
  }

  return found.join('\n') || `Nothing links to ${path}.`
}

/** Writes through the same two limits the sync API applies: a note is at most
 *  so large, and an account holds at most so much. A connector that skipped
 *  them would be the way around the quota. */
async function writeNote(env: Env, space: Space, args: Record<string, unknown>): Promise<string> {
  const path = cleanPath(text(args, 'path') ?? '')
  if (!path) return 'That is not a note path.'

  const asked = text(args, 'content')
  if (asked === null) return 'The content has to be text.'
  const content = asked ?? ''
  const size = byteLength(content)
  if (size > MAX_NOTE_BYTES) return 'That note is too large.'

  const existing = await env.DB.prepare(
    'select * from notes where space_id = ? and path = ? and deleted = 0',
  )
    .bind(space.id, path)
    .first<Note>()

  // Against whoever owns the space rather than whoever is writing: the bytes
  // land in their storage, so it is their quota the note has to fit inside.
  if (!(await fits(env, space.user_id, size, existing?.size ?? 0))) {
    return 'This account is out of space.'
  }

  // The same two writes the sync API makes, so a note a model wrote is a note
  // like any other: the same version, the same cursor, the same conflict rule.
  // Which includes losing to somebody who saved while this was being written:
  // said plainly, because a model that is told so can read the note again.
  if (existing) {
    const saved = await saveNote(env, existing, content, path)
    if (!saved) return `${path} changed while I was writing it. Read it again first.`
  } else {
    await addNote(env, space.id, path, content)
  }

  return `Saved ${path}.`
}

/** Runs one tool for one caller. Everything reachable is reached through the
 *  token's own account: there is no argument that names a user. */
export async function callTool(
  env: Env,
  token: TokenRow,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const userId = token.user_id

  switch (name) {
    case 'list_spaces': {
      const all = await spacesFor(env, userId)
      return all.map((space) => space.name).join('\n') || 'No spaces yet.'
    }

    case 'list_notes': {
      const space = await askedSpace(env, userId, args)
      return typeof space === 'string' ? space : listNotes(env, space)
    }

    case 'read_note': {
      const space = await askedSpace(env, userId, args)
      return typeof space === 'string' ? space : readNote(env, space, args)
    }

    case 'search_notes': {
      // A search may name a space or leave it out, which searches the account.
      if (args.space !== undefined && args.space !== null) {
        const space = await askedSpace(env, userId, args)
        return typeof space === 'string' ? space : searchNotes(env, [space], args)
      }
      return searchNotes(env, await spacesFor(env, userId), args)
    }

    case 'list_backlinks': {
      const space = await askedSpace(env, userId, args)
      return typeof space === 'string' ? space : listBacklinks(env, space, args)
    }

    case 'write_note': {
      if (token.read_only)
        return 'This token may only read. Allow writing in nibeditor’s settings first.'

      const space = await askedSpace(env, userId, args)
      if (typeof space === 'string') return space
      if (space.role === 'read') return `${space.name} was shared with you to read, not to write.`

      return writeNote(env, space, args)
    }

    default:
      return `No tool called ${name}.`
  }
}
