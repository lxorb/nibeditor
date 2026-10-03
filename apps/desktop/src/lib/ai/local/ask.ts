/** One question asked of Claude Code or Codex on this machine, through the crate.
 *
 *  Claude Code is started with the crate's own fixed arguments and the question on
 *  stdin, and every line it prints is streamed back, then how it ended (see
 *  src-tauri/src/ai_cli.rs). Codex is asked on its app-server, as a thread with no tool
 *  that is closed once it has answered (session.ts). Either way the lines are read with
 *  the program's own reader; the answer is handed on as it grows, the model answering is
 *  named, where the plan stands is kept for the pane, and an ending that is not an
 *  answer becomes nib's sentence. A stop ends the program's turn, and is thrown as the
 *  same `AbortError` a stopped request is, so no caller tells the two roads apart.
 *  Fetched by the first question that needs it. */

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
import { heardIn, openSession, type Session } from './session'
import { plans } from './status.svelte'
import { type Ending, troubleOf } from './trouble'

/** Which plan each program spends. */
export const PLANS: Record<LocalKind, string> = { 'claude-code': 'Claude', codex: 'ChatGPT' }

function stopped(): DOMException {
  return new DOMException('The question was stopped.', 'AbortError')
}

/** What a question heard so far, kept as each line is read. */
class Listening {
  heard: Heard = {}
  answer = ''
  model = ''

  constructor(
    private readonly kind: LocalKind,
    private readonly ask: Ask,
    private readonly read: (line: string) => Heard,
  ) {}

  /** One line; answers how the turn ended, once it has. */
  line(line: string): Heard['ended'] {
    const said = this.read(line)
    if (said.model) this.model = said.model
    if (said.limit) {
      this.heard.limit = said.limit
      plans.heard(this.kind, said.limit)
    }
    if (said.trouble) this.heard.trouble = said.trouble
    if (said.signedOut) this.heard.signedOut = true
    if (said.text) {
      // The model is said once, before the first words, as every provider says it.
      if (!this.answer) this.ask.named?.(this.model || this.ask.model || KIND_NAMES[this.kind])
      this.answer += said.text
      this.ask.stream?.(said.text)
    }
    return said.ended
  }

  /** The answer, or the sentence the run ended on. */
  finish(end: Ending): string {
    if (end.stopped || this.ask.signal?.aborted) throw stopped()
    if (this.heard.signedOut) plans.signedOut(this.kind)
    const name = KIND_NAMES[this.kind]
    const trouble = troubleOf(name, PLANS[this.kind], this.heard, end, !!this.answer)
    if (trouble) throw new Error(trouble)
    return this.answer
  }
}

/** The crate's refusal to start a program, as nib's sentence. */
function startError(error: unknown, kind: LocalKind): Error {
  const said = error instanceof Error ? error.message : String(error)
  if (said === 'missing')
    return new Error(t('{name} is not installed.', { name: KIND_NAMES[kind] }), { cause: error })
  return new Error(said, { cause: error })
}

/** Asks, and answers with the whole of what came back; throws a sentence otherwise. */
export async function askLocal(ask: Ask & { provider: { kind: LocalKind } }): Promise<string> {
  if (!isDesktop) throw new Error(t('Only in the desktop app.'))
  if (ask.signal?.aborted) throw stopped()
  return ask.provider.kind === 'codex' ? await askCodex(ask) : await askClaude(ask)
}

async function askClaude(ask: Ask): Promise<string> {
  const listening = new Listening('claude-code', ask, claudeReader())
  const id = `ask-${identifier()}`
  const channel = new Channel<unknown>()
  const ended = new Promise<Ending>((resolve) => {
    channel.onmessage = (value) => {
      const said = heardIn(value)
      if (said?.kind === 'end') resolve(said.end)
      else if (said?.kind === 'line') listening.line(said.line)
    }
  })

  const stop = () => void invoke('ai_cli_stop', { id }).catch(() => undefined)
  ask.signal?.addEventListener('abort', stop, { once: true })
  try {
    try {
      await invoke('ai_cli_ask', {
        id,
        tool: 'claude-code',
        model: ask.model.trim() || null,
        prompt: promptFor(ask.messages),
        output: channel,
      })
    } catch (error) {
      throw startError(error, 'claude-code')
    }
    // A stop pressed while the program was still being started reached a crate that
    // had nothing to stop yet; now there is.
    if (ask.signal?.aborted) stop()
    return listening.finish(await ended)
  } finally {
    ask.signal?.removeEventListener('abort', stop)
  }
}

/** Codex: a thread with no tool on the window's app-server, closed once it answered. */
async function askCodex(ask: Ask): Promise<string> {
  const listening = new Listening('codex', ask, codexReader())
  let done: (end: Ending) => void = () => undefined
  const ended = new Promise<Ending>((resolve) => (done = resolve))
  let session: Session
  try {
    session = await openSession(
      {
        tool: 'codex',
        agent: { id: ask.provider.id, name: ask.provider.name },
        mode: null,
        model: ask.model.trim() || null,
        effort: null,
      },
      (said) => {
        if (said.kind === 'end') done(said.end)
        else if (said.kind === 'reply' && said.error) {
          listening.heard.trouble = said.error
          done({ code: null, timedOut: false, stopped: false, err: said.error })
        } else if (said.kind === 'line') {
          const how = listening.line(said.line)
          if (how)
            done({
              code: how === 'error' ? 1 : 0,
              timedOut: false,
              stopped: how === 'stopped',
              err: '',
            })
        }
      },
    )
  } catch (error) {
    throw startError(error, 'codex')
  }

  const stop = () => void session.say({ kind: 'interrupt' }).catch(() => undefined)
  ask.signal?.addEventListener('abort', stop, { once: true })
  try {
    await session.say({ kind: 'turn', text: promptFor(ask.messages), images: [] })
    if (ask.signal?.aborted) stop()
    return listening.finish(await ended)
  } finally {
    ask.signal?.removeEventListener('abort', stop)
    void session.close()
  }
}
