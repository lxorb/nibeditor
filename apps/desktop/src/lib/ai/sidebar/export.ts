/** A thread as a note (`/export`, docs/ai-sidebar.md 3.1): the title as its heading,
 *  each message quoted, each answer as the model wrote it with its citations made the
 *  wikilinks they point at, and nothing of the tool rows, the thinking or the notices,
 *  which are how the answer was reached rather than what it said. Pure. */

import { linkedAnswer } from '../retrieve'
import type { Thread } from '../chat/types'
import { sourcesFor } from './citations'

/** A message, quoted line by line, so a heading or a list in it stays inside the quote. */
function quoted(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
}

/** The answer's words, its parts joined in the order they arrived. */
function answerOf(thread: Thread, at: number): string {
  const turn = thread.turns[at]
  const words = (turn?.parts ?? [])
    .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
    .join('')
    .trim()
  return linkedAnswer(words, sourcesFor(thread.turns, at))
}

export function threadMarkdown(thread: Thread, untitled: string): string {
  const blocks = [`# ${thread.title.trim() || untitled}`]
  thread.turns.forEach((turn, at) => {
    if (turn.role === 'you') {
      const text = turn.draft?.text ?? ''
      if (text.trim()) blocks.push(quoted(text))
      return
    }
    const words = answerOf(thread, at)
    if (words) blocks.push(words)
  })
  return `${blocks.join('\n\n')}\n`
}
