/** One agent's edits of one note in this session, kept in step with the note.
 *
 *  `Steps` knows what taking them back means; this keeps it told. While the note is
 *  open it listens to the document, so every change after an edit - the reader's
 *  typing, another agent, the room - is carried into the steps as it happens, and
 *  the reader's own Ctrl+Z of an edit is heard as that rather than as a change. While
 *  it is closed there is nothing to listen to, so the words the steps last knew are
 *  kept, and whatever the note says when it is next touched is carried through as
 *  the one span it differs by. A note closed and opened again is caught up the same
 *  way and listened to again.
 *
 *  The listening costs a mapping of one step per change, and exists only for notes
 *  an agent has written in. */

import { ChangeSet, type Heard, type Mark, Text } from '@nib/editor'
import { fold } from '@nib/rooms/fold'
import type { NoteDoc } from '../../workspace/documents.svelte'
import type { Replacement } from './edits'
import { Steps } from './steps'

/** How an agent's edit is named in the reader's history. */
const AGENT_EVENT = 'agent'

/** And taking an agent's edits back. */
const UNDO_EVENT = 'undo.agent'

/** The words as a rope, for a change that has to be turned round against them. */
function ropeOf(words: string): Text {
  return Text.of(words.split('\n'))
}

type ChangeDesc = ChangeSet['desc']

/** Where one edit is in the note now: the words it put in, from `from` to `to`, and
 *  the words it took out there; `inserted` is what it put in as it wrote it. What the
 *  review marks and counts; see lib/ai/review. */
export interface Span {
  from: number
  to: number
  removed: string
  inserted: string
}

/** The spans of a change, in the words after it. */
function spansOf(changes: ChangeSet, before: Text): Span[] {
  const spans: Span[] = []
  changes.iterChanges((fromA, toA, from, to, inserted) => {
    spans.push({ from, to, removed: before.sliceString(fromA, toA), inserted: inserted.toString() })
  })
  return spans
}

/** A span carried through a change after it; null when nothing of it is left. Words
 *  typed right at either edge stay outside it. */
function spanThrough(span: Span, change: ChangeDesc): Span | null {
  const from = change.mapPos(span.from, 1)
  const to = Math.max(from, change.mapPos(span.to, -1))
  return to > from || span.removed ? { ...span, from, to } : null
}

/** Edits as the replacements that make them. */
function replacementsOf(changes: ChangeSet): Replacement[] {
  const edits: Replacement[] = []
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    edits.push({ from, to, insert: inserted.toString() })
  })
  return edits
}

export class Track {
  readonly steps = new Steps()
  private held: { note: NoteDoc; stop: () => void } | null = null
  /** The words the steps last knew, while no document is being listened to. */
  private seen: string | null = null
  /** True while this track is making a change itself, which it does not hear. */
  private making = false
  private made = 0
  /** How many steps were last said; see `told`. */
  private said = 0
  /** Where each edit still there to take back is now, by id. */
  private readonly where = new Map<string, Span[]>()
  /** When each was made. */
  private readonly when = new Map<string, number>()
  /** What putting back edits taken out by `undoSome` would do, by the caller's name
   *  for that take, carried through everything since: a rewind's Redo. */
  private readonly takenBack = new Map<string, { ids: string[]; changes: ChangeSet }>()

  /** `told` hears how many edits there are to take back whenever that changes -
   *  the agent writing, the reader's Ctrl+Z taking one back, everything taken back
   *  at once - so the palette offers taking back only what is there. */
  constructor(
    private readonly prefix: string,
    private readonly told: (edits: number) => void,
  ) {}

  /** A name for the next edit's mark: unique in this session. */
  nextId(): string {
    this.made++
    return `${this.prefix}:${String(this.made)}`
  }

  /** Brings the steps up to the note as it is now: `open` is the document it is open
   *  as, or null, and `words` what it says. */
  catchUp(open: NoteDoc | null, words: string) {
    if (open && this.held?.note === open) return
    this.letGo()

    if (this.seen !== null && this.seen !== words) {
      // What the document remembers is exact; otherwise the one span they differ by.
      const since = open?.live.since(this.seen) ?? null
      const span = since ? null : fold(this.seen, words)
      this.carry(since?.desc ?? ChangeSet.of(span ? [span] : [], this.seen.length).desc)
    }

    this.seen = words
    if (open) this.hold(open)
    this.tell()
  }

  /** An edit of this agent's into the open note: one transaction, its own step in the
   *  reader's Ctrl+Z, marked so the reader taking it back is heard. Synchronous, so
   *  nothing can come between the words it was resolved against and this. */
  applyOpen(note: NoteDoc, edits: readonly Replacement[], id: string): ChangeSet {
    this.catchUp(note, note.live.text.toString())
    const before = note.live.text

    const changes = this.quietly(() =>
      note.live.edit(edits, { userEvent: AGENT_EVENT, marks: [{ id, undone: false }] }),
    )
    this.recorded(id, changes, before)
    return changes
  }

  /** An edit of this agent's written into a closed note: `before` the words it was
   *  resolved against, which the track was caught up to, and `after` what was
   *  written. */
  recordClosed(before: string, edits: readonly Replacement[], after: string, id: string) {
    this.seen = after
    this.recorded(id, ChangeSet.of(edits, before.length), ropeOf(before))
  }

  /** Listens to `open`, the note this track is of as it is open now, brought up to it
   *  first where it was not listening to it: a note closed and opened again since. */
  follow(open: NoteDoc) {
    if (this.held?.note !== open) this.catchUp(open, open.live.text.toString())
  }

  /** The ids of the edits there are to take back, oldest first. */
  get ids(): string[] {
    return this.steps.ids
  }

  /** Where an edit is in the note now, as of the last change this track heard. */
  spansOf(id: string): readonly Span[] {
    return this.where.get(id) ?? []
  }

  /** When an edit was made, in milliseconds since 1970. */
  madeAt(id: string): number {
    return this.when.get(id) ?? 0
  }

  /** Some of the edits taken back, as one transaction in the open note: the review's
   *  Undo. Answers the ids that went, which include any later edit that rewrote their
   *  words. `token` names the take, for `putBackOpen`. */
  undoSomeOpen(note: NoteDoc, ids: ReadonlySet<string>, token?: string): string[] {
    this.catchUp(note, note.live.text.toString())
    const before = note.live.text
    const some = this.steps.take(ids, before)
    if (!some?.ids.length) return []

    const marks: Mark[] = some.ids.map((id) => ({ id, undone: true }))
    const changes = this.quietly(() =>
      note.live.edit(some.changes, { userEvent: UNDO_EVENT, marks }),
    )
    this.tookBack(some.ids, changes, before, token)
    return some.ids
  }

  /** The same against a closed note's words, as the edits that do it. */
  undoSomeClosed(
    words: string,
    ids: ReadonlySet<string>,
    token?: string,
  ): { edits: Replacement[]; after: string; ids: string[] } | null {
    this.catchUp(null, words)
    const before = ropeOf(words)
    const some = this.steps.take(ids, before)
    if (!some?.ids.length) return null

    const after = some.changes.apply(before).toString()
    this.seen = after
    this.tookBack(some.ids, some.changes, before, token)
    return { edits: replacementsOf(some.changes), after, ids: some.ids }
  }

  /** What `token` took back, put back into the open note as one edit of this agent's,
   *  carried through everything since. Answers the ids that came back. */
  putBackOpen(note: NoteDoc, token: string): string[] {
    this.catchUp(note, note.live.text.toString())
    const back = this.takenBack.get(token)
    if (!back) return []
    this.takenBack.delete(token)

    const before = note.live.text
    const marks: Mark[] = back.ids.map((id) => ({ id, undone: false }))
    const changes = this.quietly(() =>
      note.live.edit(back.changes, { userEvent: AGENT_EVENT, marks }),
    )
    this.recorded(back.ids, changes, before)
    return back.ids
  }

  /** The same for a closed note: the edits to write, and the words they make. */
  putBackClosed(
    words: string,
    token: string,
  ): { edits: Replacement[]; after: string; ids: string[] } | null {
    this.catchUp(null, words)
    const back = this.takenBack.get(token)
    if (!back) return null
    this.takenBack.delete(token)

    const before = ropeOf(words)
    const after = back.changes.apply(before).toString()
    this.seen = after
    this.recorded(back.ids, back.changes, before)
    return { edits: replacementsOf(back.changes), after, ids: back.ids }
  }

  /** Whether `token` has anything to put back. */
  holds(token: string): boolean {
    return this.takenBack.has(token)
  }

  /** Forgets what a take could put back: the next message was sent. */
  forgetTaken(token: string) {
    this.takenBack.delete(token)
  }

  /** An edit of this agent's, made: a step, and where its words are. */
  private recorded(ids: string | readonly string[], changes: ChangeSet, before: Text) {
    const all = typeof ids === 'string' ? [ids] : [...ids]
    this.mapSpans(changes.desc)
    this.steps.push(all, changes, before)
    const spans = spansOf(changes, before)
    const now = Date.now()
    for (const id of all) {
      this.where.set(id, spans)
      if (!this.when.has(id)) this.when.set(id, now)
    }
    this.tell()
  }

  /** Edits taken back by one change: the spans of the rest carried through it, and
   *  what would put them back kept under `token`. */
  private tookBack(ids: readonly string[], changes: ChangeSet, before: Text, token?: string) {
    for (const id of ids) this.where.delete(id)
    this.mapSpans(changes.desc)
    this.mapTaken(changes.desc)
    if (token) this.takenBack.set(token, { ids: [...ids], changes: changes.invert(before) })
    this.tell()
  }

  /** Every step, span and put-back carried through a change that is not a step. */
  private carry(change: ChangeDesc) {
    this.steps.carry(change)
    this.mapSpans(change)
    this.mapTaken(change)
  }

  private mapTaken(change: ChangeDesc) {
    if (change.empty) return
    for (const [name, back] of this.takenBack) {
      this.takenBack.set(name, { ...back, changes: back.changes.map(change) })
    }
  }

  private mapSpans(change: ChangeDesc) {
    if (change.empty) return
    for (const [id, spans] of this.where) {
      const left = spans.map((span) => spanThrough(span, change)).filter((one) => one !== null)
      if (left.length) this.where.set(id, left)
      else this.where.delete(id)
    }
  }

  /** Every step taken back as one change, applied to the open note as one
   *  transaction. Answers how many edits it took back. */
  undoOpen(note: NoteDoc): number {
    this.catchUp(note, note.live.text.toString())
    const before = note.live.text
    const all = this.steps.takeAll()
    if (!all) return 0

    const marks: Mark[] = all.ids.map((id) => ({ id, undone: true }))
    const changes = this.quietly(() =>
      note.live.edit(all.changes, { userEvent: UNDO_EVENT, marks }),
    )
    this.tookBack(all.ids, changes, before)
    return all.ids.length
  }

  /** Every step taken back against a closed note's words, as the edits that do it.
   *  The caller writes them; the track takes the result as what it last knew. */
  undoClosed(words: string): { edits: Replacement[]; after: string; count: number } | null {
    this.catchUp(null, words)
    const all = this.steps.takeAll()
    if (!all) return null

    const before = ropeOf(words)
    const after = all.changes.apply(before).toString()
    this.seen = after
    this.tookBack(all.ids, all.changes, before)
    return { edits: replacementsOf(all.changes), after, count: all.ids.length }
  }

  private hold(note: NoteDoc) {
    const stop = note.live.listen((heard) => {
      this.heard(heard)
    })
    this.held = { note, stop }
    this.seen = null
  }

  private letGo() {
    if (!this.held) return

    this.seen = this.held.note.live.text.toString()
    this.held.stop()
    this.held = null
  }

  private heard(heard: Heard) {
    if (this.making) return

    // The document took another note on: what it says now is not this note's.
    if (heard.by === 'switch') {
      this.seen = heard.before.toString()
      this.held?.stop()
      this.held = null
      return
    }

    const had = new Set(this.steps.ids)
    if (this.steps.heard(heard)) {
      // The reader's own Ctrl+Z took some back, or their redo put some back.
      this.mapSpans(heard.changes.desc)
      this.mapTaken(heard.changes.desc)
      const now = this.steps.ids
      for (const id of had) if (!now.includes(id)) this.where.delete(id)
      const spans = spansOf(heard.changes, heard.before)
      for (const id of now) if (!had.has(id)) this.where.set(id, spans)
    } else {
      this.carry(heard.changes.desc)
    }
    this.tell()
  }

  private tell() {
    // A step the reader's changes emptied is gone from the steps; so is its place.
    if (this.where.size > this.steps.ids.length) {
      const ids = new Set(this.steps.ids)
      for (const id of this.where.keys()) if (!ids.has(id)) this.where.delete(id)
    }
    if (this.steps.size === this.said) return

    this.said = this.steps.size
    this.told(this.said)
  }

  private quietly<T>(make: () => T): T {
    this.making = true
    try {
      return make()
    } finally {
      this.making = false
    }
  }
}
