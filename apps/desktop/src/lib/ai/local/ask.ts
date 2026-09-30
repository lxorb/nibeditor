/** One question asked of Claude Code or Codex on this machine, through the crate.
 *
 *  The crate starts the program with its own fixed arguments and the question on stdin,
 *  and streams back every line it prints, then how it ended (see src-tauri/src/ai_cli.rs).
 *  This reads the lines with the program's own reader, hands the answer on as it grows,
 *  says which model is answering, keeps where the plan stands for the pane, and turns an
 *  ending that is not an answer into nib's sentence. A stop ends the program and
 *  everything it started, and is thrown as the same `AbortError` a stopped request is,
 *  so no caller tells the two roads apart. Fetched by the first question that needs it. */

import { t } from '../../i18n.svelte'
import { identifier } from '../../identifier'
import { Channel } from '../../native'
import { invoke, isDesktop } from '../../tauri'
import type { Ask } from '../complete'
import { KIND_NAMES, type LocalKind } from '../providers'
import { claudeReader } from './claude'
import { codexReader } from './codex'
import type { Heard } from './heard'
import { promptFor } from './prompt'
import { plans } from './status.svelte'
import { type Ending, troubleOf } from './trouble'

/** Which plan each program spends. */
const PLANS: Record<LocalKind, string> = { 'claude-code': 'Claude', codex: 'ChatGPT' }

/** One message off the crate's channel, read rather than trusted. */
function messageIn(value: unknown): { line: string } | { end: Ending } | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  if (said.kind === 'line' && typeof said.line === 'string') return { line: said.line }
  if (said.kind !== 'end') return null
  return {
    end: {
      code: typeof said.code === 'number' ? said.code : null,
      timedOut: said.timedOut === true,
      stopped: said.stopped === true,
      err: typeof said.err === 'string' ? said.err : '',
    },
  }
}

function stopped(): DOMException {
  return new DOMException('The question was stopped.', 'AbortError')
}

/** Asks, and answers with the whole of what came back; throws a sentence otherwise. */
export async function askLocal(ask: Ask & { provider: { kind: LocalKind } }): Promise<string> {
  const kind = ask.provider.kind
  const name = KIND_NAMES[kind]
  if (!isDesktop) throw new Error(t('Only in the desktop app.'))
  if (ask.signal?.aborted) throw stopped()

  const read = kind === 'claude-code' ? claudeReader() : codexReader()
  const heard: Heard = {}
  let answer = ''
  let model = ''

  const id = `ask-${identifier()}`
  const channel = new Channel<unknown>()
  const ended = new Promise<Ending>((resolve) => {
    channel.onmessage = (value) => {
      const message = messageIn(value)
      if (!message) return
      if ('end' in message) {
        resolve(message.end)
        return
      }

      const said = read(message.line)
      if (said.model) model = said.model
      if (said.limit) {
        heard.limit = said.limit
        plans.heard(kind, said.limit)
      }
      if (said.trouble) heard.trouble = said.trouble
      if (said.signedOut) heard.signedOut = true
      if (!said.text) return

      // The model is said once, before the first words, as every provider says it.
      if (!answer) ask.named?.(model || ask.model || name)
      answer += said.text
      ask.stream?.(said.text)
    }
  })

  const stop = () => void invoke('ai_cli_stop', { id }).catch(() => undefined)
  ask.signal?.addEventListener('abort', stop, { once: true })

  try {
    try {
      await invoke('ai_cli_ask', {
        id,
        tool: kind,
        model: ask.model.trim() || null,
        prompt: promptFor(ask.messages),
        output: channel,
      })
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      if (said === 'missing')
        throw new Error(t('{name} is not installed.', { name }), { cause: error })
      throw new Error(said, { cause: error })
    }
    // A stop pressed while the program was still being started reached a crate that
    // had nothing to stop yet; now there is.
    if (ask.signal?.aborted) stop()

    const end = await ended
    if (end.stopped || ask.signal?.aborted) throw stopped()
    if (heard.signedOut) plans.signedOut(kind)

    const trouble = troubleOf(name, PLANS[kind], heard, end, !!answer)
    if (trouble) throw new Error(trouble)
    return answer
  } finally {
    ask.signal?.removeEventListener('abort', stop)
  }
}
