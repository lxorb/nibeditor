/** Part of a thread as a summary: what a rewind's "Summarize from here" and
 *  "Summarize up to here" put in place of those turns (Claude Code's two).
 *
 *  Asked through `complete()`, the one-shot seam every other surface uses, of the
 *  thread's own provider and model, so it works the same on a key, a plan and a
 *  program on this machine. */

import { t } from '../../i18n.svelte'
import { complete } from '../complete'
import type { Message } from '../providers'
import { ai } from '../store.svelte'
import type { Thread, Turn } from '../chat/types'

/** What a summary must keep. Sent to the model, never shown, so not translated. */
const KEEP =
  'Summarize this part of a conversation so it can be continued from the summary alone. Keep every note path, page address, decision, change made and still to make, and the reader’s requests, in their own words where they matter. Reply with the summary only.'

/** Some turns as plain words: the reader's messages and the answers' words. */
function transcriptOf(turns: readonly Turn[]): string {
  const lines: string[] = []
  for (const turn of turns) {
    if (turn.role === 'you') {
      if (turn.draft?.text) lines.push(`Reader: ${turn.draft.text}`)
      continue
    }
    const words = turn.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join('')
    const calls = turn.parts.flatMap((part) => (part.kind === 'tool' ? [part.verb] : []))
    if (calls.length) lines.push(`(used ${calls.join(', ')})`)
    if (words.trim()) lines.push(`Assistant: ${words.trim()}`)
  }
  return lines.join('\n\n')
}

/** The turns as a summary, in the thread's provider's words. */
export async function summarized(thread: Thread, turns: readonly Turn[]): Promise<string> {
  const provider = ai.providers.find((one) => one.id === thread.provider)
  if (!provider) throw new Error(t('That provider is not set up yet.'))
  const messages: Message[] = [
    { role: 'system', content: KEEP },
    { role: 'user', content: transcriptOf(turns) },
  ]
  const summary = await complete({ provider, model: thread.model, messages })
  if (!summary.trim()) throw new Error(t('No answer'))
  return summary.trim()
}
