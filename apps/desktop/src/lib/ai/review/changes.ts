/** What a thread changed, worked out from the agents' edits (docs/ai-sidebar.md 4.5).
 *
 *  Every thread of a provider writes as that provider's one built-in agent, so an
 *  edit says which agent and when, and the sends (chat/sends.ts) say which thread was
 *  answering for that provider then. The message an edit answered is the reader's
 *  latest message before it: that message's checkpoint is where taking the edit back
 *  goes back to. Steered messages joined a running turn and have no checkpoint of
 *  their own, as in Claude Code.
 *
 *  Pure: the edits come in as plain rows, so this is tested apart from any note. */

import type { Thread, Turn } from '../chat/types'

/** Where one edit is in its note now: what it put in, and what it took out there. */
interface Spot {
  from: number
  to: number
  removed: string
  inserted: string
}

/** One edit of an agent's, as the docs keep it. */
export interface Edit {
  /** The step's id in the agent's track: what Undo names. */
  id: string
  agent: string
  /** The note: a path on this disk, or a draft's `unsaved:` key. */
  path: string
  at: number
  spots: readonly Spot[]
}

/** One change of a thread's: an edit, the message it answered, and its size in lines. */
export interface Change extends Edit {
  /** The reader's message it answered. */
  turn: string | null
  added: number
  removed: number
}

/** A note a thread changed, with the changes still waiting for Keep or Undo. */
export interface NoteChanges {
  path: string
  agent: string
  changes: Change[]
  added: number
  removed: number
}

/** The built-in agent of a provider, as its grant is named (src-tauri/src/ai_agent.rs). */
export function agentOf(provider: string): string {
  return `nib-${provider}`
}

/** The provider a built-in agent is, or null for any other agent. */
export function providerOf(agent: string): string | null {
  return agent.startsWith('nib-') ? agent.slice('nib-'.length) : null
}

/** How many lines some words are, the way a diff counts them. */
export function linesOf(words: string): number {
  if (!words) return 0
  const lines = words.split('\n').length
  return words.endsWith('\n') ? lines - 1 : lines
}

/** The providers a thread has asked: its own and every one that answered in it. */
export function providersOf(thread: Pick<Thread, 'provider' | 'turns'>): string[] {
  const all = new Set([thread.provider])
  for (const turn of thread.turns)
    if (turn.role === 'model' && turn.provider) all.add(turn.provider)
  return [...all]
}

/** The reader's messages that have a checkpoint, oldest first. */
export function checkpoints(turns: readonly Turn[]): Turn[] {
  return turns.filter((turn) => turn.role === 'you' && !turn.steered)
}

/** The message an edit made at `at` answered: the latest checkpoint at or before it. */
export function answered(turns: readonly Turn[], at: number): string | null {
  let found: string | null = null
  for (const turn of checkpoints(turns)) if (turn.at <= at) found = turn.id
  return found
}

/** A thread as the review reads it: with the helper threads a command started from it
 *  (`/batch`, `/subtask`; lib/ai/commands/helpers.ts), whose changes are its own. */
export type Reviewed = Pick<Thread, 'id' | 'provider' | 'turns'> & { helpers?: readonly string[] }

/** The thread's changes, oldest first: every edit the thread, or a helper of it, was
 *  answering for when it was made, but those `kept`. */
export function changesOf(
  thread: Reviewed,
  edits: readonly Edit[],
  answering: (provider: string, at: number) => string | null,
  kept: ReadonlySet<string>,
): Change[] {
  const threads = new Set([thread.id, ...(thread.helpers ?? [])])
  const changes: Change[] = []
  for (const edit of edits) {
    if (kept.has(edit.id)) continue
    const provider = providerOf(edit.agent)
    const by = provider === null ? null : answering(provider, edit.at)
    if (by === null || !threads.has(by)) continue
    changes.push({
      ...edit,
      turn: answered(thread.turns, edit.at),
      added: edit.spots.reduce((sum, spot) => sum + linesOf(spot.inserted), 0),
      removed: edit.spots.reduce((sum, spot) => sum + linesOf(spot.removed), 0),
    })
  }
  return changes.sort((one, other) => one.at - other.at)
}

/** The changes by note, in the order each note was first changed. */
export function byNote(changes: readonly Change[]): NoteChanges[] {
  const notes = new Map<string, NoteChanges>()
  for (const change of changes) {
    const key = `${change.agent}\n${change.path}`
    const note = notes.get(key) ?? {
      path: change.path,
      agent: change.agent,
      changes: [],
      added: 0,
      removed: 0,
    }
    note.changes.push(change)
    note.added += change.added
    note.removed += change.removed
    notes.set(key, note)
  }
  return [...notes.values()]
}

/** The changes made after a checkpoint: in answer to that message or a later one. */
export function changesSince(
  changes: readonly Change[],
  turns: readonly Turn[],
  turn: string,
): Change[] {
  const marks = checkpoints(turns).map((one) => one.id)
  const from = marks.indexOf(turn)
  if (from < 0) return []
  const after = new Set(marks.slice(from))
  return changes.filter((change) => change.turn !== null && after.has(change.turn))
}
