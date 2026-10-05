/** The notes' verbs, on the road every other agent verb takes: `read_note`,
 *  `edit_note`, `write_note`, `append_note`, `set_property`, `set_task` and
 *  `create_note` (docs/agent-native.md 5.3).
 *
 *  What a read and an edit of a note's words mean is lib/agents/docs: the words as
 *  they are on screen, anchors, one transaction, the reader's typing winning. This is
 *  the rest of what a call owes on its way there: the space checked against the grant
 *  and never switched to, a space shared to be read refused, `confirm` mode's question,
 *  the words of a shared space marked, and the links of a space that is not open read
 *  off that space's own index. The four verbs past the first three are anchored edits
 *  too, so each is one undo step with the agent's caret, like any other. */

import { frontMatterEdit } from '@nib/markdown/front-matter'
import { taskAt } from '@nib/markdown/tasks'
import type { AgentAnswer } from '../../automation/caller'
import { canWriteAt } from '../../sharing.svelte'
import { isMarkdownPath, nameOf } from '../../space-paths'
import { writeFile } from '../../workspace/write-file'
import { type Tab, workspace } from '../../workspace.svelte'
import { isDraft } from '../../workspace/drafts'
import { DocError, type NoteRead, notes } from '../docs'
import { asked } from './asks'
import { type Call, done, flag, maybe, need, text, writerOf } from './call'
import { heldIndex, indexOf } from './links'
import { Refused } from './problem'
import { createFile, fileKindOf } from './new-files'
import { namedTab } from './tab-target'
import { judged, judgedForWriting, onDisk, type Place, placeFor, sharedSource } from './spaces'

/** The note a call names, in a space it may reach: its place, and its path as the
 *  space speaks of it, with `.md` where the name has no ending - or `tab`, any note tab
 *  `get_context` lists: one with a file is that file, as though its path were said, and
 *  a note with no file yet (workspace/drafts.ts) is reached by the tab alone. */
export function noteOf(
  call: Call,
  writing: boolean,
): { place: Place; relative: string; tab?: string } {
  if (maybe(call, 'tab') !== null) {
    const named = namedTab(call, ['note'], 'a note')
    if (named.relative !== null) {
      return noteOf({ ...call, args: { ...call.args, tab: null, path: named.relative } }, writing)
    }

    return { place: placeFor(call, spaceOfTab(named.tab)), relative: '', tab: named.tab.id }
  }

  const place = placeFor(call, maybe(call, 'space'))
  const asked = need(call, 'path')
  const safe = writing ? judgedForWriting(asked) : judged(asked)
  const relative = nameOf(safe).includes('.') ? safe : `${safe}.md`
  if (!isMarkdownPath(relative)) {
    throw new Refused('bad_arguments', `${relative} is not a markdown note`)
  }

  if (writing && !canWriteAt(onDisk(place, relative))) {
    throw new Refused('read_only', `${place.space.name} is shared with you to read`)
  }

  return { place, relative }
}

/** The space of a note tab with no file: the draft's own. */
function spaceOfTab(tab: Tab): string {
  const space = isDraft(tab.note) ? workspace.spaceOf(tab.note) : null
  if (space === null) {
    throw new Refused('no_such_tab', `tab ${tab.id} holds a note outside every space`)
  }
  return space
}

export function at({ place, relative, tab }: { place: Place; relative: string; tab?: string }) {
  return { path: relative, space: place.space.id, ...(tab === undefined ? {} : { tab }) }
}

function ifRev(call: Call): string | undefined {
  return maybe(call, 'if_rev') ?? undefined
}

/** The words a call sends, under either of the names the two servers use for them. */
function wordsSent(call: Call): string | null {
  return text(call, 'content') ?? text(call, 'text')
}

export async function readNote(call: Call): Promise<AgentAnswer> {
  const named = noteOf(call, false)
  const { place, relative } = named
  const read: NoteRead = await notes.readNote(at(named), call.args.include)

  // The window's index is the open space's, so a note of another space has its links
  // read off that space's own.
  if (!place.open && (read.links !== undefined || read.backlinks !== undefined)) {
    const index = await indexOf(place)
    const path = onDisk(place, relative)
    if (read.links !== undefined) read.links = index.outgoing(path)
    if (read.backlinks !== undefined) read.backlinks = index.backlinks(path)
  }

  return done(read, sharedSource(place))
}

export async function editNote(call: Call): Promise<AgentAnswer> {
  const named = noteOf(call, true)
  const { place, relative } = named
  const question = await asked(call, null, `Edit ${relative} in ${place.space.name}`)
  if (question) return question

  return done(await notes.editNote(writerOf(call), at(named), call.args.edits, ifRev(call)))
}

export async function writeNote(call: Call): Promise<AgentAnswer> {
  const named = noteOf(call, true)
  const { place, relative } = named
  const words = wordsSent(call)
  if (words === null) throw new Refused('bad_arguments', 'say the content')

  const question = await asked(call, null, `Write ${relative} in ${place.space.name}`)
  if (question) return question

  // A note that is not there yet is made: the connector's write_note makes one too.
  if (!named.tab && (await workspace.noteText(onDisk(place, relative))) === null) {
    return done(await made(place, relative, words, false))
  }

  return done(await notes.writeNote(writerOf(call), at(named), words, ifRev(call)))
}

export async function appendNote(call: Call): Promise<AgentAnswer> {
  const named = noteOf(call, true)
  const { place, relative } = named
  const words = wordsSent(call)
  if (words === null) throw new Refused('bad_arguments', 'say the content')

  const question = await asked(call, null, `Add to ${relative} in ${place.space.name}`)
  if (question) return question

  // The day's note that is not there yet is the day's note to make, as nib://append
  // makes one.
  if (!named.tab && (await workspace.noteText(onDisk(place, relative))) === null) {
    return done(await made(place, relative, words, false))
  }

  const under = maybe(call, 'under')
  const edit = { at: under === null ? { end: true } : { heading: under }, insert_after: words }
  return done(await notes.editNote(writerOf(call), at(named), [edit]))
}

/** A front matter value as the one line it is written on: a list in brackets, a
 *  number or a yes as itself, and words quoted where YAML would read them as more. */
function yamlOf(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map((one) => yamlOf(String(one))).join(', ')}]`

  const words = typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim() : ''
  const plain = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^:#]*$/.test(words) && !/\s$/.test(words)
  return plain ? words : JSON.stringify(words)
}

export async function setProperty(call: Call): Promise<AgentAnswer> {
  const named = noteOf(call, true)
  const { relative } = named
  const key = need(call, 'key')
  if (!/^[\w-][\w -]*$/.test(key)) throw new Refused('bad_arguments', `${key} is not a key`)
  if (!('value' in call.args)) throw new Refused('bad_arguments', 'say the value, or null')
  const value = yamlOf(call.args.value)

  const question = await asked(call, null, `Set ${key} of ${relative}`)
  if (question) return question

  // Read, worked out, and written as the whole note against the words it was worked
  // out from: a note the reader typed in meanwhile is read again rather than written
  // over.
  for (let tries = 0; ; tries++) {
    const read = await notes.readNote(at(named), ['text'])
    const words = read.text ?? ''
    const edit = frontMatterEdit(words, key, value)
    if (!edit) return done({ path: relative, key, value, changed: false, rev: read.rev })

    const after = words.slice(0, edit.from) + edit.insert + words.slice(edit.to)
    try {
      const wrote = await notes.writeNote(writerOf(call), at(named), after, read.rev)
      return done({ ...wrote, key, value, changed: true })
    } catch (error) {
      if (!(error instanceof DocError && error.code === 'rev_changed') || tries > 2) throw error
    }
  }
}

export async function setTask(call: Call): Promise<AgentAnswer> {
  const note = noteOf(call, true)
  const { relative } = note
  const anchor = call.args.at
  if (typeof anchor !== 'object' || anchor === null || !('task' in anchor)) {
    throw new Refused('bad_arguments', 'at is {task, nth?}')
  }
  const wanted = flag(call, 'done')

  const read = await notes.readNote(at(note), ['text', 'tasks'])
  const named = anchor as { task: unknown; nth?: unknown }
  const row = read.tasks?.find(
    (one) =>
      'task' in one.anchor &&
      one.anchor.task === named.task &&
      (named.nth === undefined || one.anchor.nth === named.nth),
  )
  if (!row) throw new Refused('not_found', `there is no task ${String(named.task)} in ${relative}`)
  if (row.done === wanted) return done({ path: relative, rev: read.rev, changed: false })

  const line = (read.text ?? '').split('\n')[row.line] ?? ''
  const task = taskAt(line)
  if (!task) throw new Refused('not_found', `the task ${String(named.task)} has moved`)

  const question = await asked(call, null, `${wanted ? 'Tick' : 'Clear'} a task in ${relative}`)
  if (question) return question

  const box = task.box + 1
  const ticked = line.slice(0, box) + (wanted ? 'x' : ' ') + line.slice(box + 1)
  const edit = { at: row.anchor, replace: ticked }
  return done(await notes.editNote(writerOf(call), at(note), [edit], read.rev))
}

export async function createNote(call: Call): Promise<AgentAnswer> {
  if (maybe(call, 'tab') !== null)
    throw new Refused('bad_arguments', 'a new note is made at a path')

  // A canvas, a page note or a web note is a file of its own kind; see new-files.ts.
  const kind = fileKindOf(call)
  if (kind !== 'note') return createFile(call, placeFor(call, maybe(call, 'space')), kind, made)

  const { place, relative } = noteOf(call, true)
  if ((await workspace.noteText(onDisk(place, relative))) !== null) {
    throw new Refused('exists', `${relative} is already there, and nothing is written over`)
  }

  const question = await asked(call, null, `Make ${relative} in ${place.space.name}`)
  if (question) return question

  return done(await made(place, relative, wordsSent(call) ?? '', flag(call, 'open')))
}

/** A new note, written where it goes. Opened behind the tab in front when asked, and
 *  only in the space the reader is in: opening one in another would move them. */
export async function made(place: Place, relative: string, words: string, open: boolean) {
  const path = onDisk(place, relative)
  await writeFile(path, words)

  if (place.open) {
    await workspace.loadTree()
    if (open) await workspace.openEntry(path, { activate: false, beside: true })
  } else {
    heldIndex(place)?.noteSaved(path, words)
  }

  const { sync } = await import('../../sync.svelte')
  sync.nudge()

  return { path: relative, created: true }
}
