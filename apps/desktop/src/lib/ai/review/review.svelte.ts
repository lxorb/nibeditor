/** The review of what the sidebar's agent changed (docs/ai-sidebar.md 4.5): the
 *  changes of each thread, Keep and Undo, the marks in the notes, rewinding to a
 *  message, Redo, and editing a message.
 *
 *  Nothing underneath is new. An agent's edits are live transactions, each a step of
 *  its own that can be taken back through whatever was typed since
 *  (lib/agents/docs/track.ts); this reads those steps, says which thread made each
 *  one (changes.ts), and takes some of them back through the same machinery the
 *  palette's "Undo edits by" uses. Keep only says the reader has read a change: the
 *  edit was already in the note.
 *
 *  Like the steps it reads, it lasts the session. Fetched with the panel; nothing of
 *  it is in the first paint. */

import { SvelteSet } from 'svelte/reactivity'
import { carryIntoEditors, type SharedDoc, StateEffect } from '@nib/editor'
import {
  type ReviewMark,
  reviewMarks,
  setReviewActions,
  setReviewMarks,
  setReviewSource,
} from '@nib/editor/review'
import { onTracks, putBackIn, trackedAgents, tracksOf, undoSomeIn } from '../../agents/docs'
import { plural } from '../../i18n.svelte'
import { insideSpace, nameOf, withinSpace } from '../../space-paths'
import { dur } from '../../motion'
import { onceAFrame } from '../../timing'
import { workspace } from '../../workspace.svelte'
import type { NoteDoc } from '../../workspace/documents.svelte'
import { writeFile } from '../../workspace/write-file'
import { answeringAt, onSend, onSent } from '../chat/sends'
import type { Thread, Turn } from '../chat/types'
import { cutForEdit } from './branches'
import {
  agentOf,
  type Change,
  byNote,
  changesOf,
  type Edit,
  type NoteChanges,
  providerOf,
  providersOf,
  type Reviewed,
} from './changes'
import { redoFile, undoFile } from './file-ops'
import { type FileChange, fileChangesOf } from './files'
import { type Choice, type Made, planFor, type Plan } from './plan'
import { summarized } from './summary'

/** What the review needs of the panel: the field, a send, and a thread changed
 *  outside a send drawn again and written down (docs/ai-sidebar.md 6.6). */
export interface ReviewPanel {
  send(text: string): void
  text?: string
  touched?(thread: Thread): void
}

/** What a rewind took back, to put back with Redo until the next message. */
interface Redo {
  thread: string
  token: string
  notes: { agent: string; path: string }[]
  made: { path: string; words: string }[]
  /** The moves and deletes it took back, oldest first. */
  files: FileChange[]
  turns: Turn[] | null
}

/** How long a kept change's tint takes to fade: `--dur-stage`. */
const FADE = 170

/** The note a document is of, as the agents' steps name it. */
function keyOf(note: NoteDoc): string {
  return note.path ?? `unsaved:${note.key}`
}

/** The open document a note is, by the key above. */
function documentOf(path: string): NoteDoc | null {
  return workspace.documents.find((one) => keyOf(one) === path) ?? null
}

/** A turn's words, put back into the field. */
function wordsOf(turn: Turn): string {
  return turn.draft?.text ?? ''
}

class Review {
  /** Moves whenever any agent's edits change. */
  private version = $state(0)
  /** The changes the reader kept, by id. */
  readonly kept = new SvelteSet<string>()
  /** The file changes kept or taken back, by their call's id. */
  readonly filesDone = new SvelteSet<string>()
  /** Kept a moment ago, still fading out of the note. */
  private readonly fading = new SvelteSet<string>()
  /** The changes list, open for this thread. */
  listing = $state<string | null>(null)
  /** The rewind sheet: the thread, the panel that asked, and the message picked. */
  sheet = $state.raw<{ thread: Thread; panel: ReviewPanel | null; turn: string | null } | null>(
    null,
  )
  /** What the last rewind can put back. */
  redo = $state.raw<Redo | null>(null)
  /** A few words the bar says for a moment: "and 1 after it". */
  said = $state<string | null>(null)
  /** The threads whose edits bring their note to the front as they land (Follow, Zed's
   *  word; off unless the reader turns it on). */
  readonly following = new SvelteSet<string>()

  private marked = new WeakSet<NoteDoc>()
  private readonly draw = onceAFrame(() => this.pushMarks())
  private saidTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    onTracks((agent, path) => {
      this.version++
      this.draw()
      this.follow(agent, path)
    })
    onSend((thread) => {
      if (this.redo?.thread === thread) this.forgetRedo()
    })
    // A note moved or deleted is read off the turn, which is whole once its send ends.
    onSent(() => this.version++)
    setReviewSource((doc) => this.marksOfDoc(doc))
    // The marks are fetched with the review: every editor made from now on carries
    // them, and every note open now is handed them.
    carryIntoEditors(reviewMarks())
    for (const note of workspace.documents)
      note.live.announce([StateEffect.appendConfig.of(reviewMarks())])
    setReviewActions((id, keep) => {
      const change = this.edits().find((one) => one.id === id)
      if (!change) return
      if (keep) this.keep([change])
      else void this.undo([change])
    })
  }

  // ── Reading ─────────────────────────────────────────────

  /** Every edit of the sidebar's agents still there to take back, open notes brought
   *  up to date first. */
  edits(agents = trackedAgents().filter((one) => providerOf(one) !== null)): Edit[] {
    this.heard()
    const edits: Edit[] = []
    for (const agent of agents) {
      for (const [path, track] of tracksOf(agent)) {
        const open = documentOf(path)
        if (open) track.follow(open)
        for (const id of track.ids)
          edits.push({ id, agent, path, at: track.madeAt(id), spots: track.spansOf(id) })
      }
    }
    return edits
  }

  /** A thread's changes the reader has not kept, oldest first. */
  changes(thread: Reviewed): Change[] {
    return changesOf(thread, this.edits(providersOf(thread).map(agentOf)), answeringAt, this.kept)
  }

  /** The same by note. */
  notes(thread: Reviewed): NoteChanges[] {
    return byNote(this.changes(thread))
  }

  /** The notes a thread moved or deleted that the reader has not kept, oldest first. */
  files(thread: Pick<Thread, 'turns'>): FileChange[] {
    this.heard()
    return fileChangesOf(thread.turns, this.filesDone)
  }

  /** What rewinding a thread to its message `turn` would do. */
  plan(thread: Thread, turn: string): Plan | null {
    return planFor(thread, turn, this.changes(thread), this.filesDone)
  }

  // ── Keep and Undo ──────────────────────────────────────

  /** The reader has read these: their marks fade and they leave the list. */
  keep(changes: readonly Change[] | readonly Edit[]): void {
    for (const change of changes) {
      this.kept.add(change.id)
      this.fading.add(change.id)
    }
    this.draw()
    setTimeout(() => {
      for (const change of changes) this.fading.delete(change.id)
      this.draw()
    }, dur(FADE))
  }

  /** These taken back, each through everything since. Answers how many later edits
   *  went with them because they rewrote their words, and says so for a moment. */
  async undo(changes: readonly Edit[], token?: string): Promise<number> {
    let more = 0
    for (const [key, group] of this.grouped(changes)) {
      const [agent = '', path = ''] = key.split('\n')
      const asked = new Set(group.map((one) => one.id))
      const went = await undoSomeIn({ id: agent, name: agent }, path, asked, token)
      more += went.filter((id) => !asked.has(id)).length
    }
    if (more) this.say(plural(more, { one: 'and {count} after it', other: 'and {count} after it' }))
    return more
  }

  /** Moves and deletes the reader has read: they leave the list. */
  keepFiles(files: readonly FileChange[]): void {
    for (const one of files) this.filesDone.add(one.id)
  }

  /** Moves and deletes taken back, newest first, so a note moved twice goes back the
   *  way it came. Answers those that were. */
  async undoFiles(thread: Thread, files: readonly FileChange[]): Promise<FileChange[]> {
    const undone: FileChange[] = []
    for (const one of [...files].reverse()) {
      if (!(await undoFile(one, thread))) continue
      this.filesDone.add(one.id)
      undone.unshift(one)
    }
    return undone
  }

  /** Changes by the agent and the note they are in, which is what one take is of. */
  private grouped(changes: readonly Edit[]): [string, Edit[]][] {
    const groups: Record<string, Edit[]> = {}
    for (const change of changes) (groups[`${change.agent}\n${change.path}`] ??= []).push(change)
    return Object.entries(groups)
  }

  /** Reads the version, so whatever asked is asked again when an agent's edits change. */
  private heard(): number {
    return this.version
  }

  private say(words: string): void {
    this.said = words
    clearTimeout(this.saidTimer)
    this.saidTimer = setTimeout(() => (this.said = null), 3000)
  }

  /** Opens the note a change is in, at the change. */
  async show(change: Pick<Edit, 'path' | 'spots'>): Promise<void> {
    if (change.path.startsWith('unsaved:')) return
    await workspace.open(change.path)
    const note = documentOf(change.path)
    const from = change.spots[0]?.from ?? 0
    if (note)
      workspace.goto = {
        path: change.path,
        line: note.live.text.lineAt(Math.min(from, note.live.text.length)).number - 1,
      }
  }

  /** Follow on or off for a thread. */
  toggleFollow(thread: Pick<Thread, 'id'>): void {
    if (this.following.has(thread.id)) this.following.delete(thread.id)
    else this.following.add(thread.id)
  }

  /** A note an agent just wrote in, brought to the front where the thread answering
   *  for it follows: only in the space in front, so an agent working in another space
   *  never moves the reader there (docs/agent-native.md 8.6). */
  private follow(agent: string, path: string): void {
    const provider = providerOf(agent)
    if (!this.following.size || provider === null || path.startsWith('unsaved:')) return
    const thread = answeringAt(provider, Date.now())
    const root = workspace.activeSpace?.root
    if (!thread || !this.following.has(thread) || !root || withinSpace(root, path) === null) return
    if (workspace.active?.path !== path) void workspace.open(path)
  }

  // ── Marks in the notes ─────────────────────────────────

  /** The changes the reader has not kept in one note, as the editor draws them. */
  private marksOf(path: string): ReviewMark[] {
    const marks: ReviewMark[] = []
    for (const edit of this.edits()) {
      if (edit.path !== path) continue
      const fading = this.fading.has(edit.id)
      if (this.kept.has(edit.id) && !fading) continue
      for (const spot of edit.spots) {
        marks.push({
          id: edit.id,
          from: spot.from,
          to: spot.to,
          removed: spot.removed,
          ...(fading ? { fading: true } : {}),
        })
      }
    }
    return marks
  }

  private marksOfDoc(doc: SharedDoc): ReviewMark[] {
    const note = workspace.documents.find((one) => one.live === doc)
    return note ? this.marksOf(keyOf(note)) : []
  }

  /** Every open note told what it has now. */
  private pushMarks(): void {
    for (const note of workspace.documents) {
      const marks = this.marksOf(keyOf(note))
      if (!marks.length && !this.marked.has(note)) continue
      note.live.announce([setReviewMarks.of(marks)])
      if (marks.length) this.marked.add(note)
      else this.marked.delete(note)
    }
  }

  // ── Rewind ─────────────────────────────────────────────

  /** The rewind sheet for a thread, at a message where one was named. */
  openRewind(thread: Thread, panel: ReviewPanel | null, turn: string | null = null): void {
    this.listing = null
    this.sheet = { thread, panel, turn }
  }

  closeRewind(): void {
    this.sheet = null
  }

  /** Rewinds `thread` to before its message `turn`, the way `choice` says. */
  async rewind(
    thread: Thread,
    turn: string,
    choice: Choice,
    panel: ReviewPanel | null,
  ): Promise<void> {
    const plan = this.plan(thread, turn)
    if (!plan) return
    this.forgetRedo()
    const token = crypto.randomUUID()
    const redo: Redo = { thread: thread.id, token, notes: [], made: [], files: [], turns: null }

    if (choice === 'both' || choice === 'notes') {
      await this.undo(plan.changes, token)
      redo.notes = this.grouped(plan.changes).map(([key]) => {
        const [agent = '', path = ''] = key.split('\n')
        return { agent, path }
      })
      redo.made = await this.unmake(thread, plan.made)
      redo.files = await this.undoFiles(thread, plan.files)
    }

    const index = thread.turns.findIndex((one) => one.id === turn)
    if (choice === 'both' || choice === 'conversation') {
      redo.turns = thread.turns.splice(index)
      this.cut(thread, panel, plan.turn)
    } else if (choice === 'summarize-from') {
      const summary = await summarized(thread, thread.turns.slice(index))
      thread.turns.splice(index, thread.turns.length - index, {
        id: crypto.randomUUID(),
        role: 'model',
        at: Date.now(),
        parts: [
          { kind: 'notice', code: 'compacted', text: '' },
          { kind: 'text', text: summary },
        ],
      })
      this.cut(thread, panel, plan.turn)
    } else if (choice === 'summarize-to') {
      const summary = await summarized(thread, thread.turns.slice(0, index))
      const marker: Turn = {
        id: crypto.randomUUID(),
        role: 'model',
        at: Date.now(),
        parts: [{ kind: 'notice', code: 'compacted', text: '' }],
      }
      thread.turns.splice(index, 0, marker)
      thread.compaction = { upTo: marker.id, kind: 'summary', model: thread.model, summary }
      panel?.touched?.(thread)
    }

    this.sheet = null
    if (redo.notes.length || redo.made.length || redo.files.length || redo.turns) this.redo = redo
  }

  /** The conversation cut: a compaction of turns now gone forgotten, a program that
   *  remembers them told, the message back in the field, the thread drawn again. */
  private cut(thread: Thread, panel: ReviewPanel | null, turn: Turn): void {
    const upTo = thread.compaction?.upTo
    if (upTo && !thread.turns.some((one) => one.id === upTo)) delete thread.compaction
    thread.updated = Date.now()
    void rewound(thread)
    if (panel) {
      panel.text = wordsOf(turn)
      panel.touched?.(thread)
    }
  }

  /** Notes the thread made since, to Recently deleted, their words kept for Redo. */
  private async unmake(thread: Thread, made: readonly Made[]): Promise<Redo['made']> {
    const kept: Redo['made'] = []
    for (const one of made) {
      const space =
        workspace.spaces.find((each) => each.id === one.space || each.name === one.space) ??
        workspace.spaces.find((each) => each.id === thread.space)
      if (!space) continue
      const relative = nameOf(one.path).includes('.') ? one.path : `${one.path}.md`
      const path = insideSpace(space.root, relative)
      const words = await workspace.noteText(path).catch(() => null)
      if (words === null) continue
      await workspace.remove(path, false).catch(() => undefined)
      kept.push({ path, words })
    }
    return kept
  }

  /** Whether the open thread has a rewind to put back. */
  canRedo(thread: Pick<Thread, 'id'> | null): boolean {
    return !!thread && this.redo?.thread === thread.id
  }

  /** Puts back what the last rewind took: the notes, through what was typed since,
   *  the notes it sent to Recently deleted, and the conversation. */
  async putBack(thread: Thread, panel: ReviewPanel | null): Promise<void> {
    const redo = this.redo
    if (redo?.thread !== thread.id) return
    this.redo = null
    for (const { agent, path } of redo.notes)
      await putBackIn({ id: agent, name: agent }, path, redo.token)
    for (const { path, words } of redo.made) {
      if ((await workspace.noteText(path).catch(() => null)) === null) await writeFile(path, words)
    }
    if (redo.made.length) await workspace.loadTree()
    for (const one of redo.files) {
      await redoFile(one, thread)
      this.filesDone.delete(one.id)
    }
    if (redo.turns) {
      thread.turns.push(...redo.turns)
      void rewound(thread)
      if (panel) panel.text = ''
      panel?.touched?.(thread)
    }
  }

  private forgetRedo(): void {
    const redo = this.redo
    if (!redo) return
    this.redo = null
    for (const { agent, path } of redo.notes) tracksOf(agent).get(path)?.forgetTaken(redo.token)
  }

  // ── Editing a message ──────────────────────────────────

  /** The reader's message `turn` sent again as `text`: the notes and the conversation
   *  back to before it, what followed kept as a branch, and the new words sent. */
  async edit(thread: Thread, turn: string, text: string, panel: ReviewPanel): Promise<void> {
    const plan = this.plan(thread, turn)
    if (!plan) return
    this.forgetRedo()
    await this.undo(plan.changes)
    await this.unmake(thread, plan.made)
    await this.undoFiles(thread, plan.files)
    if (!cutForEdit(thread, turn)) return
    const upTo = thread.compaction?.upTo
    if (upTo && !thread.turns.some((one) => one.id === upTo)) delete thread.compaction
    await rewound(thread)
    panel.touched?.(thread)
    panel.send(text)
  }
}

/** Tells the engine a thread's turns were cut, where it keeps a conversation of its
 *  own (Claude Code, Codex). The panel's engines, found through its setup. */
async function rewound(thread: Thread): Promise<void> {
  const setup = Object.values(import.meta.glob<SetupModule>('../sidebar/setup.ts'))[0]
  if (!setup) return
  const { ai } = await import('../store.svelte')
  const provider = ai.providers.find((one) => one.id === thread.provider)
  if (!provider) return
  const engine = await (await setup()).engineOf(provider.kind).catch(() => null)
  engine?.rewound?.(thread)
}

interface SetupModule {
  engineOf(kind: import('../providers').ProviderKind): Promise<import('../chat/types').Engine>
}

export const review = new Review()
