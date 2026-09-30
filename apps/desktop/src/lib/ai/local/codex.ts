/** Codex's `exec --json`, read line by line.
 *
 *  One event per line: `thread.started`, `turn.started`, then `item.started`,
 *  `item.updated` and `item.completed` for each thing the turn makes - reasoning, a
 *  command, an `agent_message`, which is the answer - and `turn.completed` or
 *  `turn.failed`, with a bare `error` where something went wrong on the way. See
 *  https://learn.chatgpt.com/docs/non-interactive-mode.
 *
 *  In exec mode an `agent_message` does not stream: it arrives whole in its
 *  `item.completed`. An `item.updated` that does carry its text is read too, and each
 *  item hands on only the part of its text not handed on before, so the answer never
 *  says a word twice whichever of the two a version sends. */

import { eventIn, type Heard, saysLimit, saysSignedOut } from './heard'

/** A reader for one run, which remembers how much of each message it has handed on. */
export function codexReader(): (line: string) => Heard {
  const said = new Map<string, number>()

  return (line) => {
    const event = eventIn(line)
    if (!event) return {}

    switch (event.type) {
      case 'item.updated':
      case 'item.completed': {
        const item =
          typeof event.item === 'object' && event.item !== null
            ? (event.item as Record<string, unknown>)
            : null
        if (item?.type !== 'agent_message' || typeof item.text !== 'string') return {}

        const id = typeof item.id === 'string' ? item.id : ''
        const before = said.get(id) ?? 0
        said.set(id, item.text.length)
        const text = item.text.slice(before)
        // A new message after an earlier one is a new paragraph of the same answer.
        const gap = before === 0 && said.size > 1 ? '\n\n' : ''
        return text ? { text: gap + text } : {}
      }

      case 'turn.failed':
      case 'error': {
        const words = messageOf(event)
        if (!words) return {}
        return {
          trouble: words,
          ...(saysSignedOut(words) ? { signedOut: true } : {}),
          ...(saysLimit(words)
            ? { limit: { state: 'reached', until: null, untilWords: againAt(words) } }
            : {}),
        }
      }

      default:
        return {}
    }
  }
}

function messageOf(event: Record<string, unknown>): string {
  if (typeof event.message === 'string') return event.message
  const error = event.error
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

/** When Codex says a plan may be used again, as it wrote it: "try again at 3:05 PM",
 *  "try again in 2 days 3 hours". */
export function againAt(words: string): string | null {
  const found = /try again (?:at|in) ([^.]+?)\.?$/i.exec(words.trim())
  return found?.[1]?.trim() ?? null
}
