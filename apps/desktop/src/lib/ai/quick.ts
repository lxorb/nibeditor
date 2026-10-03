/** What a quick question is sent with, and where its answer goes into a note. Pure;
 *  the store and the sheet are quick.svelte.ts and QuickQuestion.svelte.
 *
 *  The context is one thing, chosen rather than offered, because a field that asks
 *  which context it should have is a field nobody types into quickly. Notion's space
 *  bar, Arc's page question and Raycast's selection all make the same choice: what the
 *  reader is looking at goes along. Here that is, in order, what is selected in the
 *  note in front, the note in front, or the page in front - a page's selection, else
 *  its article, which is what the clipper reads. It is shown as a chip over the field,
 *  and a press takes it off. */

import type { Said } from './history'
import { history } from './history'
import type { Message } from './providers'
import { fitted } from './retrieve'

/** Where a question's context came from, which is what the chip draws. */
export type ContextKind = 'selection' | 'note' | 'page'

export interface Context {
  kind: ContextKind
  /** The note's or the page's name, which the chip says. */
  name: string
  text: string
}

/** How much of a note or a page goes along: a long article in full is most of a
 *  small model's window, and the question is about what is on screen. */
const CONTEXT_BUDGET = 4000

/** What the model is told. Not translated: nobody reads it, and the question's own
 *  language covers every language the app has. */
const SYSTEM = [
  'You answer a quick question on the side, in a small window over what the reader is',
  'working on. Answer briefly and directly, in markdown, in the language of the',
  'question: no preamble, no sign-off, and never wrap the whole reply in a code fence.',
].join(' ')

/** How each kind of context is introduced, and the tag it is fenced in. */
const INTRODUCED: Record<ContextKind, [string, string]> = {
  selection: ['What the reader has selected in the note', 'selection'],
  note: ['The note the reader has in front of them', 'note'],
  page: ['The web page the reader has in front of them', 'page'],
}

/** The context as the model is handed it: labelled, so it knows what it is looking at,
 *  and fenced, so it can tell it from the question. */
export function contextMessage(context: Context): Message {
  const [said, tag] = INTRODUCED[context.kind]
  const name = context.name.replace(/"/g, "'")
  return {
    role: 'system',
    content: `${said}, "${name}":\n\n<${tag}>\n${fitted(context.text, CONTEXT_BUDGET)}\n</${tag}>`,
  }
}

/** Everything one question goes with: the rules, the context while it is on, the
 *  conversation so far within its budget, and the question. */
export function quickMessages(
  context: Context | null,
  before: readonly Said[],
  question: string,
): Message[] {
  return [
    { role: 'system', content: SYSTEM },
    ...(context?.text.trim() ? [contextMessage(context)] : []),
    ...history(before),
    { role: 'user', content: question },
  ]
}

/** Where an answer goes into a note, and what goes in: on lines of its own after the
 *  line `at` is on - under the selection it was asked about, or the caret's line -
 *  with a blank line either side of it, however much space was already there. */
export function insertion(
  doc: string,
  at: number,
  answer: string,
): { from: number; insert: string; caret: number } {
  const end = doc.indexOf('\n', Math.min(Math.max(at, 0), doc.length))
  const from = end === -1 ? doc.length : end
  const words = answer.trim()

  const before = doc.slice(0, from)
  const after = doc.slice(from)
  const lead = before.trim() ? '\n'.repeat(2 - breaks(/\n*$/, before)) : ''
  const trail = after.trim() ? '\n'.repeat(2 - breaks(/^\n*/, after)) : ''

  const insert = `${lead}${words}${trail}`
  return { from, insert, caret: from + lead.length + words.length }
}

/** How many line breaks, up to two, the run `at` finds at one end of a text holds. */
function breaks(at: RegExp, text: string): number {
  return Math.min(2, at.exec(text)?.[0].length ?? 0)
}
