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
      this.steps.carry(since?.desc ?? ChangeSet.of(span ? [span] : [], this.seen.length).desc)
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
    this.steps.push([id], changes, before)
    this.tell()
    return changes
  }

  /** An edit of this agent's written into a closed note: `before` the words it was
   *  resolved against, which the track was caught up to, and `after` what was
   *  written. */
  recordClosed(before: string, edits: readonly Replacement[], after: string, id: string) {
    this.steps.push([id], ChangeSet.of(edits, before.length), ropeOf(before))
    this.seen = after
    this.tell()
  }

  /** Every step taken back as one change, applied to the open note as one
   *  transaction. Answers how many edits it took back. */
  undoOpen(note: NoteDoc): number {
    this.catchUp(note, note.live.text.toString())
    const all = this.steps.takeAll()
    if (!all) return 0

    const marks: Mark[] = all.ids.map((id) => ({ id, undone: true }))
    this.quietly(() => note.live.edit(all.changes, { userEvent: UNDO_EVENT, marks }))
    this.tell()
    return all.ids.length
  }

  /** Every step taken back against a closed note's words, as the edits that do it.
   *  The caller writes them; the track takes the result as what it last knew. */
  undoClosed(words: string): { edits: Replacement[]; after: string; count: number } | null {
    this.catchUp(null, words)
    const all = this.steps.takeAll()
    if (!all) return null

    const edits: Replacement[] = []
    all.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      edits.push({ from, to, insert: inserted.toString() })
    })

    const after = all.changes.apply(ropeOf(words)).toString()
    this.seen = after
    this.tell()
    return { edits, after, count: all.ids.length }
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

    if (!this.steps.heard(heard)) this.steps.carry(heard.changes.desc)
    this.tell()
  }

  private tell() {
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
