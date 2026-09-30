/** An agent reading a note: the words as the reader has them.
 *
 *  Through `noteText`, which prefers the open document over the disk, so a note in a
 *  pane is read with the words not yet saved; with the one line ending the editor
 *  holds, so what an agent quotes back is what an anchor finds. Every answer carries
 *  `rev`, a name for these exact words, and an anchor for every heading, task and
 *  block, which is what the agent hands back to say where an edit goes. For the note
 *  in front of the reader it can also say what they have selected, where the caret
 *  is, which lines are on screen and whether they are typing right now, so "rewrite
 *  this paragraph" is about the paragraph they mean. See docs/agent-native.md 8.1.
 *
 *  The outline, the tasks and the blocks are read by the grammar the link index and
 *  the editor read them by (@nib/markdown), properties by the reader the rows above a
 *  note use, links and backlinks off the index, the same answers the automation
 *  verbs give (`automation/answers.ts`). */

import type { EditorView } from '@nib/editor'
import { blocksOf, lines } from '@nib/markdown/links'
import { type Property, readProperties } from '@nib/markdown/properties'
import { taskAt } from '@nib/markdown/tasks'
import type { NoteDoc } from '../../workspace/documents.svelte'
import { type Anchor, headingPath, headingsIn, taskWords } from './anchors'
import { type Desk, located, type NoteAt, openNote, wordsOf } from './desk'
import { TYPING } from './edit'
import { DocError } from './problem'
import { revOf } from './rev'

/** What a read may carry besides `rev`. */
const INCLUDES = [
  'text',
  'outline',
  'properties',
  'tasks',
  'links',
  'backlinks',
  'blocks',
  'selection',
] as const

type Include = (typeof INCLUDES)[number]

/** What a read carries when the agent does not say: the words and every anchor in
 *  them, which is what an edit needs and costs one pass over the note. */
const PLAIN: readonly Include[] = ['text', 'outline', 'tasks', 'blocks']

/** The parts an agent asked for, checked. */
function readIncludes(value: unknown): readonly Include[] {
  if (value === undefined || value === null) return PLAIN
  if (!Array.isArray(value)) throw new DocError('bad_include', value, 'include is a list')

  return value.map((one: unknown) => {
    const found = INCLUDES.find((part) => part === one)
    if (!found) throw new DocError('bad_include', one, `include is some of ${INCLUDES.join(', ')}`)
    return found
  })
}

/** A heading as an agent reads it, with the anchor that names it. */
interface OutlineRow {
  anchor: Anchor
  level: number
  title: string
  line: number
}

interface TaskRow {
  anchor: Anchor
  done: boolean
  line: number
}

interface BlockRow {
  anchor: Anchor
  line: number
  /** The first words of it, so the list reads. */
  text: string
}

/** Where the reader is, in the note in front of them. Lines count from zero. */
interface Where {
  from: number
  to: number
  selected: string
  caret: { line: number; column: number }
  visible: { from: number; to: number }
}

export interface NoteRead {
  path: string
  space: string
  rev: string
  /** Whether a pane has it open, which is when unsaved words are part of it. */
  open: boolean
  /** Whether the reader wrote in it within the last two seconds. */
  typing: boolean
  text?: string
  outline?: OutlineRow[]
  tasks?: TaskRow[]
  blocks?: BlockRow[]
  properties?: Property[]
  links?: unknown[]
  backlinks?: unknown[]
  /** Null when the note is not the one in front of the reader. */
  selection?: Where | null
}

/** Several things with one name get a number each, from one, in the order they sit;
 *  one thing alone does not need one. */
function numbered<T>(rows: readonly T[], nameOf: (row: T) => string): (number | undefined)[] {
  const seen = new Map<string, number>()
  const total = new Map<string, number>()
  for (const row of rows) total.set(nameOf(row), (total.get(nameOf(row)) ?? 0) + 1)

  return rows.map((row) => {
    const name = nameOf(row)
    const at = (seen.get(name) ?? 0) + 1
    seen.set(name, at)
    return (total.get(name) ?? 0) > 1 ? at : undefined
  })
}

function outlineOf(text: string): OutlineRow[] {
  const headings = headingsIn(text)
  const paths = headings.map(headingPath)
  const nth = numbered(paths, (path) => path)

  return headings.map((heading, index) => {
    const which = nth[index]
    return {
      anchor: { heading: paths[index] ?? heading.title, ...(which ? { nth: which } : {}) },
      level: heading.level,
      title: heading.title,
      line: heading.line,
    }
  })
}

function tasksOf(text: string): TaskRow[] {
  const found: { words: string; done: boolean; line: number }[] = []

  for (const row of lines(text)) {
    if (row.code) continue
    const words = taskWords(row.text)
    const task = taskAt(row.text)
    if (words !== null && task) found.push({ words, done: task.done, line: row.line })
  }

  const nth = numbered(found, (one) => one.words)
  return found.map((one, index) => {
    const which = nth[index]
    return {
      anchor: { task: one.words, ...(which ? { nth: which } : {}) },
      done: one.done,
      line: one.line,
    }
  })
}

function blocksIn(text: string): BlockRow[] {
  return blocksOf(text).flatMap((block) =>
    block.id === null ? [] : [{ anchor: { block: block.id }, line: block.line, text: block.text }],
  )
}

/** Where the reader is in a view, when it is the one in front of them. */
function whereIn(view: EditorView): Where {
  const { state } = view
  const { from, to, head } = state.selection.main
  const caret = state.doc.lineAt(head)
  const shown = view.visibleRanges
  const first = shown[0]?.from ?? 0
  const last = shown.at(-1)?.to ?? state.doc.length

  return {
    from,
    to,
    selected: state.sliceDoc(from, to),
    caret: { line: caret.number - 1, column: head - caret.from },
    visible: {
      from: state.doc.lineAt(first).number - 1,
      to: state.doc.lineAt(last).number - 1,
    },
  }
}

/** Whether the reader has written in a note within the last two seconds. */
function typingIn(open: NoteDoc | null): boolean {
  const last = open?.live.readerAt ?? null
  return last !== null && Date.now() - last < TYPING
}

export async function readNote(desk: Desk, at: NoteAt, include?: unknown): Promise<NoteRead> {
  const asked = new Set(readIncludes(include))
  const note = located(desk, at)
  const text = await wordsOf(desk, note)
  const open = openNote(desk, note)
  const view = open ? desk.frontView(open) : null

  return {
    path: note.relative,
    space: note.space.name,
    rev: revOf(text),
    open: open !== null,
    typing: typingIn(open),
    ...(asked.has('text') ? { text } : {}),
    ...(asked.has('outline') ? { outline: outlineOf(text) } : {}),
    ...(asked.has('tasks') ? { tasks: tasksOf(text) } : {}),
    ...(asked.has('blocks') ? { blocks: blocksIn(text) } : {}),
    ...(asked.has('properties') ? { properties: readProperties(text) ?? [] } : {}),
    ...(asked.has('links') ? { links: desk.linksOf(note.path) } : {}),
    ...(asked.has('backlinks') ? { backlinks: desk.backlinksOf(note.path) } : {}),
    ...(asked.has('selection') ? { selection: view ? whereIn(view) : null } : {}),
  }
}
