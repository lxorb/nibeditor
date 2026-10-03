/** Ask mode's citations, carried through a thread (docs/ai-sidebar.md 3.3: "answers
 *  cite their passages").
 *
 *  Ask keeps what the Ask panel did: the space is searched for the passages a question
 *  is about (ai/retrieve.ts, no index), they go with the message numbered from one, the
 *  model cites them as `[2]`, and each number is a button that opens its note at its
 *  line. Here a passage is one of the message's attachments, so the engine sends it
 *  like any chip, the thread keeps it, and an answer finds its sources in the message
 *  it answered. Pure. */

import type { Passage } from '../retrieve'
import type { Attachment, Draft, Turn } from '../chat/types'

/** Where a citation points: a note of the space, and a line of it. */
export interface Source {
  path: string
  name: string
  line: number
}

/** An attachment that is a passage. `cite` is ours: the engine sends the label and
 *  the words and keeps the rest of the object as it was handed, so it survives the
 *  thread being written and read. */
export interface Cited extends Attachment {
  cite: Source
}

function isSource(value: unknown): value is Source {
  if (typeof value !== 'object' || value === null) return false
  const { path, name, line } = value as Record<string, unknown>
  return typeof path === 'string' && typeof name === 'string' && typeof line === 'number'
}

function isCited(one: Attachment): one is Cited {
  return isSource((one as Partial<Cited>).cite)
}

/** The passages as a message's attachments, numbered in the order the answer's
 *  citations will count them. */
export function passageAttachments(passages: readonly Passage[]): Cited[] {
  return passages.map((one, at) => ({
    label: `[${at + 1}] ${one.name}, line ${one.line + 1}`,
    text: one.text,
    cite: { path: one.path, name: one.name, line: one.line },
  }))
}

/** A message's passages, in their order. */
export function sourcesIn(draft: Draft | undefined): Source[] {
  return (draft?.attachments ?? []).filter(isCited).map((one) => one.cite)
}

/** The passages an answer may cite: the ones that went with the message it answers,
 *  which is the last of the reader's before it. */
export function sourcesFor(turns: readonly Turn[], at: number): Source[] {
  for (let index = at - 1; index >= 0; index--) {
    const turn = turns[index]
    if (turn?.role === 'you' && !turn.steered) return sourcesIn(turn.draft)
  }
  return []
}

/** What the model is told when a message carries passages. Not translated: nobody
 *  reads it, and the answer is asked for in the question's own language. */
export const CITING = [
  'Attachments labelled [1], [2] and so on are passages from the reader’s own notes.',
  'After each statement that uses one, cite it by its number in brackets, like [2], or [1][3] for several.',
  'Cite only numbers you were given. Where the passages do not answer the question, say so in one sentence.',
].join(' ')

/** Whether the thread's last message carried passages, which is when the rule above
 *  goes with the request. */
export function cites(turns: readonly Turn[]): boolean {
  return sourcesFor(turns, turns.length).length > 0
}
