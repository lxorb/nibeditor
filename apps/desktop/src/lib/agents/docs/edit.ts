/** An agent editing a note: the live words when the note is open, the file when not.
 *
 *  Open, the edit is resolved and applied in one synchronous step on the window's
 *  thread: the words are read off the document, every anchor is found in them, and
 *  the edits go in as one CodeMirror transaction before anything else can run. There
 *  is no await between reading and writing, so there is no gap for a keystroke to
 *  fall into - which is the whole difference from reading a note and writing the
 *  file back (docs/agent-native.md 8.2). The transaction is the agent's step in the
 *  reader's Ctrl+Z, apart from the typing either side of it, and every caret in
 *  every pane is carried through it rather than moved.
 *
 *  Closed, the same edits on the file's words, written through the road every write
 *  of a note nobody has open takes (`replaceInNotes`): a version kept, the file
 *  written, the index told, sync nudged. A note opened while that write is in the air
 *  is carried there.
 *
 *  Where the reader has been writing in the last two seconds, an edit that would land
 *  there waits for them to pause, and is then resolved again against what they wrote
 *  (8.3). Edits elsewhere in the note land at once. */

import { oneEdit } from '@nib/markdown/edits'
import { applied, changeOf, type Edit } from '../../search/replace'
import type { Keeping } from '../../workspace/note-text'
import { waited } from '../../timing'
import type { NoteDoc } from '../../workspace/documents.svelte'
import type { Selected } from './anchors'
import { type Desk, type Located, located, type NoteAt, openNote, wordsOf } from './desk'
import { type Planned, plan, readEdits, type Replacement } from './edits'
import { type Agent, showAgent } from './presence'
import { DocError } from './problem'
import { revOf } from './rev'
import { touch } from './touched'
import { Track } from './track'

/** How far back the reader's own writing keeps an edit away: two seconds. */
export const TYPING = 2000

/** How long an edit waits for the reader to pause before it gives up and says so.
 *  An agent's call is a request somebody's program is holding open. */
export const PATIENCE = 30_000

/** What an edit answers: the note, its words' new `rev`, how many edits went in, and
 *  the line each landed on, counting from zero, in the order they were asked. */
export interface NoteEdited {
  path: string
  rev: string
  edits: number
  lines: number[]
}

/** Every agent's edits of every note this session, by agent and note. */
const tracks = new Map<string, Track>()

/** The notes an agent has edited this session, whose version from before was kept. */
const kept = new Set<string>()

/** One call at a time per agent and note, in the order they were asked: an agent
 *  that sent two edits means the second to follow the first, even when the first is
 *  waiting for the reader. */
const turns = new Map<string, Promise<unknown>>()

function keyOf(agent: string, path: string): string {
  return `${agent}\n${path}`
}

function inTurn<T>(key: string, run: () => Promise<T>): Promise<T> {
  const mine = (turns.get(key) ?? Promise.resolve()).then(run, run)
  const done = mine.then(
    () => undefined,
    () => undefined,
  )
  turns.set(key, done)
  void done.then(() => {
    if (turns.get(key) === done) turns.delete(key)
  })
  return mine
}

/** An agent's track of a note, made the first time it writes there. */
function trackOf(agent: Agent, path: string): Track {
  const key = keyOf(agent.id, path)
  const found = tracks.get(key)
  if (found) return found

  const made = new Track(agent.id, (edits) => {
    touch(path, agent, edits)
    for (const listener of listeners) listener(agent.id, path)
  })
  tracks.set(key, made)
  return made
}

/** Whoever wants to know when an agent's edits of a note change: one made, some taken
 *  back, the reader's Ctrl+Z of one. The review (lib/ai/review) is. */
const listeners = new Set<(agent: string, path: string) => void>()

/** Listens; answers the way to stop. */
export function onTracks(listener: (agent: string, path: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Every agent with edits of its own this session. */
export function trackedAgents(): string[] {
  return [...new Set([...tracks.keys()].map((key) => key.slice(0, key.indexOf('\n'))))]
}

/** One agent's tracks, by the path of the note each is of: what the review reads. */
export function tracksOf(agent: string): Map<string, Track> {
  const prefix = keyOf(agent, '')
  const found = new Map<string, Track>()
  for (const [key, track] of tracks) {
    if (key.startsWith(prefix)) found.set(key.slice(prefix.length), track)
  }
  return found
}

/** Turns an agent's edits, against the words as they are at the moment of applying,
 *  into characters. `again` is true when the edit waited for the reader and is being
 *  worked out a second time. */
type Planner = (
  text: string,
  selected: Selected | null,
  open: NoteDoc | null,
  again: boolean,
) => Planned

/** Anchored edits into a note. See the top of this file. */
export async function editNote(
  desk: Desk,
  agent: Agent,
  at: NoteAt,
  edits: unknown,
  ifRev?: string,
): Promise<NoteEdited> {
  const asked = readEdits(edits)
  const note = located(desk, at)

  return inTurn(keyOf(agent.id, note.path), () =>
    change(desk, agent, note, ifRev, (text, selected, _open, again) => {
      try {
        return plan(asked, text, selected)
      } catch (error) {
        // The anchor was there before the reader got to it, and is not now.
        if (again && error instanceof DocError && error.code !== 'overlapping') {
          throw new DocError(
            'reader_edited_here',
            error.about,
            `the reader edited there: ${error.message}`,
          )
        }
        throw error
      }
    }),
  )
}

/** The whole of a note, as the smallest edit between what is there and what is sent,
 *  so it is an edit like the rest: one transaction, carets carried, typing kept. A
 *  wait for the reader carries that edit through what they wrote rather than working
 *  it out again, which would take their words out. */
export async function writeNote(
  desk: Desk,
  agent: Agent,
  at: NoteAt,
  text: string,
  ifRev?: string,
): Promise<NoteEdited> {
  const note = located(desk, at)
  const wanted = text.replace(/\r\n?/g, '\n')
  let first: { text: string; edits: Replacement[] } | null = null

  return inTurn(keyOf(agent.id, note.path), () =>
    change(desk, agent, note, ifRev, (words, _selected, open) => {
      if (first && open) {
        const edits = open.live.carried(first.edits, first.text, true) ?? first.edits
        return { edits, places: [] }
      }

      const edit = oneEdit(words, wanted)
      first = { text: words, edits: edit ? [edit] : [] }
      return { edits: first.edits, places: [] }
    }),
  )
}

/** One call's edits into one note, open or closed, waiting for the reader where it
 *  has to. */
async function change(
  desk: Desk,
  agent: Agent,
  note: Located,
  ifRev: string | undefined,
  planner: Planner,
): Promise<NoteEdited> {
  const started = Date.now()
  let again = false

  for (;;) {
    const open = openNote(desk, note)
    if (!open) {
      const done = await changeClosed(desk, agent, note, ifRev, planner)
      if (done) return done
      // It was opened while its words were being read: the open way, then.
      continue
    }

    const done = changeOpen(desk, agent, note, open, ifRev, planner, again)
    if (done) return done

    if (Date.now() - started > PATIENCE) {
      throw new DocError(
        'reader_typing',
        note.relative,
        'the reader is still writing where the edit goes',
      )
    }
    await quiet(open)
    again = true
  }
}

/** Until the reader has not written in the note for two seconds. */
function quiet(note: NoteDoc): Promise<void> {
  const last = note.live.readerAt ?? 0
  return waited(Math.max(50, TYPING - (Date.now() - last) + 10))
}

function refuseStale(text: string, ifRev: string | undefined, note: Located) {
  if (ifRev === undefined || revOf(text) === ifRev) return
  throw new DocError('rev_changed', note.relative, `${note.relative} has changed since it was read`)
}

/** Whether two ranges share a character or a place, ends included: a keystroke right
 *  where an insertion would go is the reader writing there. */
function meet(one: { from: number; to: number }, other: { from: number; to: number }): boolean {
  return one.from <= other.to && other.from <= one.to
}

/** The reader's selection in the note, when it is the one in front of them. */
function selectedIn(desk: Desk, open: NoteDoc): Selected | null {
  const view = desk.frontView(open)
  if (!view) return null

  const { from, to } = view.state.selection.main
  return { from, to }
}

/** The edits into the open note, in one synchronous step, or null when the reader is
 *  writing where they go. */
function changeOpen(
  desk: Desk,
  agent: Agent,
  note: Located,
  open: NoteDoc,
  ifRev: string | undefined,
  planner: Planner,
  again: boolean,
): NoteEdited | null {
  const text = open.live.text.toString()
  refuseStale(text, ifRev, note)

  const planned = planner(text, selectedIn(desk, open), open, again)
  if (!planned.edits.length) return answer(note, text, planned, null)

  const typed = open.live.touchedWithin(TYPING)
  if (planned.edits.some((edit) => typed.some((one) => meet(one, edit)))) return null

  const track = trackOf(agent, note.path)
  const first = firstEdit(agent, note)
  const changes = track.applyOpen(open, planned.edits, track.nextId())

  // The version before, kept once per agent and note, and said whose edit it was
  // kept for. After the edit rather than before it, because nothing may come between
  // resolving and applying; the words are the ones read above.
  // A note with no file has nowhere a version could be kept.
  if (first && !note.draft) void desk.snapshot(note.path, text, agent.name)

  const last = planned.edits.at(-1)
  if (last) showAgent(open, agent, changes.mapPos(last.to, 1), desk.scheme())

  return answer(note, open.live.text.toString(), planned, changes)
}

/** The edits into a closed note's words, written. Null when the note was opened while
 *  its words were being read, which the open way then takes. */
async function changeClosed(
  desk: Desk,
  agent: Agent,
  note: Located,
  ifRev: string | undefined,
  planner: Planner,
): Promise<NoteEdited | null> {
  const before = await wordsOf(desk, note)
  if (openNote(desk, note)) return null

  refuseStale(before, ifRev, note)
  const planned = planner(before, null, null, false)
  if (!planned.edits.length) return answer(note, before, planned, null)

  const after = applied(before, planned.edits)
  const track = trackOf(agent, note.path)
  track.catchUp(null, before)
  const id = track.nextId()

  const snapshot = firstEdit(agent, note)
  const wrote = await writeClosed(desk, note, before, planned.edits, {
    snapshot,
    source: agent.name,
  })
  // The reader wrote in the scratchpad's card meanwhile: worked out again.
  if (!wrote) return null

  track.recordClosed(before, planned.edits, after, id)
  return answer(note, after, planned, null)
}

/** A closed note's words written with `edits`: the one road a note nobody has open is
 *  written by, or the scratchpad's own, which carries its card's caret. False when the
 *  scratchpad's words were no longer `before`. */
async function writeClosed(
  desk: Desk,
  note: Located,
  before: string,
  edits: readonly Edit[],
  keeping?: Keeping,
): Promise<boolean> {
  if (note.pad) return desk.padWrite(before, edits)
  await desk.replaceInNotes([changeOf(note.path, before, [...edits])], keeping)
  return true
}

/** Whether this is the agent's first edit of the note this session, remembered. */
function firstEdit(agent: Agent, note: Located): boolean {
  const key = keyOf(agent.id, note.path)
  if (kept.has(key)) return false

  kept.add(key)
  return true
}

/** What the agent is told: the new `rev`, and where each edit landed. */
function answer(
  note: Located,
  after: string,
  planned: Planned,
  changes: { mapPos(at: number, assoc?: number): number } | null,
): NoteEdited {
  const starts = [0]
  for (let at = after.indexOf('\n'); at !== -1; at = after.indexOf('\n', at + 1))
    starts.push(at + 1)

  const lineOf = (at: number) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if ((starts[middle] ?? 0) <= at) low = middle
      else high = middle - 1
    }
    return low
  }

  // Where each place is now: through the transaction when there was one, and through
  // the edits in front of it when the words were written.
  const moved = (at: number) => {
    if (changes) return changes.mapPos(at, 1)
    let shift = 0
    for (const edit of planned.edits) {
      if (edit.from > at) break
      if (edit.to <= at) shift += edit.insert.length - (edit.to - edit.from)
    }
    return at + shift
  }

  return {
    path: note.relative,
    rev: revOf(after),
    edits: planned.edits.length,
    lines: planned.places.map((place) => lineOf(moved(place.from))),
  }
}

/** Takes back everything one agent did to one note this session, as one step, mapped
 *  through everything since so the reader's words stay (8.5). Answers how many of
 *  the agent's edits were taken back. */
export async function undoAgent(desk: Desk, agent: Agent, at: NoteAt): Promise<{ undone: number }> {
  return undoAt(desk, agent, located(desk, at))
}

/** The same, for a note already found: what the palette's row asks with the note in
 *  front. */
export async function undoAt(desk: Desk, agent: Agent, note: Located): Promise<{ undone: number }> {
  const key = keyOf(agent.id, note.path)
  const track = tracks.get(key)
  if (!track?.steps.size) return { undone: 0 }

  return inTurn(key, async () => {
    const open = openNote(desk, note)
    if (open) return { undone: track.undoOpen(open) }

    const words = await wordsOf(desk, note)
    const back = track.undoClosed(words)
    if (!back) return { undone: 0 }

    await writeClosed(desk, note, words, back.edits)
    return { undone: back.count }
  })
}

/** Some of one agent's edits of a note taken back, as one step, mapped through
 *  everything since: the review's Undo of a change, and a rewind. Answers the ids
 *  that went, a later edit that rewrote their words among them. `token` names the
 *  take so `putBackAt` can undo it (a rewind's Redo). */
export async function undoSomeAt(
  desk: Desk,
  agent: Agent,
  note: Located,
  ids: ReadonlySet<string>,
  token?: string,
): Promise<string[]> {
  const key = keyOf(agent.id, note.path)
  const track = tracks.get(key)
  if (!track?.steps.size) return []

  return inTurn(key, async () => {
    const open = openNote(desk, note)
    if (open) return track.undoSomeOpen(open, ids, token)

    const words = await wordsOf(desk, note)
    const back = track.undoSomeClosed(words, ids, token)
    if (!back) return []

    await writeClosed(desk, note, words, back.edits)
    return back.ids
  })
}

/** What `undoSomeAt` took back under `token`, put back. Answers the ids that came
 *  back. */
export async function putBackAt(
  desk: Desk,
  agent: Agent,
  note: Located,
  token: string,
): Promise<string[]> {
  const key = keyOf(agent.id, note.path)
  const track = tracks.get(key)
  if (!track?.holds(token)) return []

  return inTurn(key, async () => {
    const open = openNote(desk, note)
    if (open) return track.putBackOpen(open, token)

    const words = await wordsOf(desk, note)
    const back = track.putBackClosed(words, token)
    if (!back) return []

    await writeClosed(desk, note, words, back.edits)
    return back.ids
  })
}
