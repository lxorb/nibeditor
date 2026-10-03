/** The Ask panel's conversations, kept as threads, once.
 *
 *  The Ask panel kept one conversation per space in `localStorage` (`nib:ask`): the words
 *  said and where each answer's citations pointed. The panel that replaced it keeps
 *  threads, so the first time a space is opened here its old conversation becomes a
 *  thread of its own and the old row is dropped: nothing a reader asked before goes
 *  missing, and nothing is converted twice. */

import { isRecord, isString } from '../../stored'
import type { Thread, Turn } from '../chat/types'
import { newThread } from '../chat/threads'
import type { Cited, Source } from './citations'

/** The key the Ask panel wrote under. */
export const OLD_KEY = 'nib:ask'

function sourceIn(value: unknown): Source | null {
  if (!isRecord(value)) return null
  const { path, name, line } = value
  return isString(path) && isString(name) && typeof line === 'number' ? { path, name, line } : null
}

/** One space's old turns as a thread, or null where there were none. */
export function threadFromAsk(
  turns: unknown,
  space: string,
  provider: string,
  model: string,
): Thread | null {
  if (!Array.isArray(turns)) return null
  const thread = newThread(space, provider, model)
  let at = Date.now() - turns.length
  for (const value of turns) {
    if (!isRecord(value) || !isString(value.text) || !value.text) continue
    at++
    if (value.role === 'you') {
      thread.turns.push({
        id: crypto.randomUUID(),
        role: 'you',
        at,
        draft: { text: value.text, attachments: [] },
        parts: [],
      })
      continue
    }
    if (value.role !== 'model') continue
    const sources = (Array.isArray(value.sources) ? value.sources : [])
      .map(sourceIn)
      .filter((one): one is Source => one !== null)
    // The passages an answer cited went with the question before it, which is where
    // the panel looks for them now.
    const asked = thread.turns.at(-1)
    if (asked?.role === 'you' && asked.draft && sources.length) {
      const cited: Cited[] = sources.map((cite, index) => ({
        label: `[${index + 1}] ${cite.name}, line ${cite.line + 1}`,
        cite,
      }))
      asked.draft = { ...asked.draft, attachments: cited }
    }
    const answer: Turn = {
      id: crypto.randomUUID(),
      role: 'model',
      at,
      parts: [{ kind: 'text', text: value.text }],
      provider,
      model,
    }
    thread.turns.push(answer)
  }
  if (!thread.turns.length) return null
  thread.title = thread.turns[0]?.draft?.text.split('\n')[0]?.slice(0, 80) ?? ''
  thread.created = thread.turns[0]?.at ?? thread.created
  thread.updated = at
  return thread
}

/** The old store's conversations by space, or an empty record. */
export function oldSpaces(saved: unknown): Record<string, unknown> {
  return isRecord(saved) && isRecord(saved.spaces) ? saved.spaces : {}
}
