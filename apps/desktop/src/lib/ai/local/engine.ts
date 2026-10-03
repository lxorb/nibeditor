/** The thread engine for a reader's own plan: Claude Code or Codex on this machine,
 *  running the loop themselves with `nib mcp` as their only tool (docs/ai-sidebar.md 4.4,
 *  5.1). The same `Engine` the API loop is, so the panel cannot tell the roads apart.
 *
 *  **A session per thread.** A thread's first send opens one (session.ts) and every
 *  later send is a turn in it, so the program keeps the conversation, its cache and its
 *  compaction. A session that ended - idle for ten minutes, the program gone, the mode
 *  changed (a mode is the tools the program was started with) - is opened again at the
 *  next send and seeded from nib's own transcript, written into that first message
 *  together with the space's instructions. Model, effort and Fast are said to the live
 *  session as they change.
 *
 *  **What a turn becomes.** The program's lines are read by its own reader (claude.ts,
 *  codex.ts) into parts: words, thinking, a row per call of nib's tools with its answer,
 *  and the counts the ring draws, the window learnt from the program where the model
 *  list did not say. A stop interrupts the turn and keeps what arrived. */

import { t } from '../../i18n.svelte'
import { userStep } from '../chat/transcript'
import type {
  Draft,
  Effort,
  Engine,
  EngineEvent,
  Mode,
  ModelInfo,
  Part,
  Stop,
  Thread,
  Turn,
  Usage,
} from '../chat/types'
import { KIND_NAMES, type LocalKind, type Message, type Provider } from '../providers'
import { PLANS } from './ask'
import { claudeReader } from './claude'
import { codexReader } from './codex'
import type { Heard as Read } from './heard'
import { modelsIn } from './models'
import { promptFor } from './prompt'
import { listedModels, type Heard, type Level, openSession, type Session } from './session'
import { plans } from './status.svelte'
import { troubleOf } from './trouble'

/** What the engine needs from the app around it: the API engine's `Setup`, read. */
export interface LocalSetup {
  provider(id: string): Provider | null
  /** The space's instructions (`AGENTS.md`) and the reader's own. */
  instructions?(thread: Thread): Promise<string>
}

/** How long a stopped turn is given to say it stopped before its program is ended. */
const STOPPING = 10_000

/** One thread's session, and what it was last told. */
interface Live {
  session: Session
  mode: Mode
  model: string
  effort: Effort
  fast: boolean
  /** Who hears its lines: the send in flight, or nobody between sends. */
  hear: ((said: Heard) => void) | null
  /** What it said before anybody heard: the first send hears it, a later one not. */
  early: Heard[]
}

/** A send in flight, which a steer reaches. */
interface Running {
  thread: Thread
  on: (event: EngineEvent) => void
  /** Steered messages Claude Code has yet to answer: it answers each with a turn of its
   *  own, so the model turn is split at each end rather than at once. */
  pending: number
  steered: (text: string) => void
}

/** The level a program is told, or nothing for the model's own default. */
function levelOf(kind: LocalKind, effort: Effort): Level | null {
  if (effort === 'auto') return null
  // Claude Code has no level below low; the popover never offers one there.
  if (kind === 'claude-code' && (effort === 'off' || effort === 'minimal')) return null
  return effort
}

function fresh(): string {
  return crypto.randomUUID()
}

/** The words of a model turn, for a transcript. */
function wordsOf(turn: Turn): string {
  return turn.parts
    .map((part) => (part.kind === 'text' ? part.text : ''))
    .join('')
    .trim()
}

/** The conversation so far as one message: the instructions, the earlier turns, and the
 *  reader's message, for a session that starts in the middle of a thread. */
function seeded(thread: Thread, instructions: string, message: string): string {
  const said: Message[] = []
  if (instructions) said.push({ role: 'system', content: instructions })
  for (const turn of thread.turns) {
    if (turn.role === 'you' && turn.draft)
      said.push({ role: 'user', content: userStep(turn.draft).text })
    else if (turn.role === 'model') {
      const words = wordsOf(turn)
      if (words) said.push({ role: 'assistant', content: words })
    }
  }
  said.push({ role: 'user', content: message })
  return promptFor(said)
}

/** Builds the engine for one program. */
export function createLocalEngine(kind: LocalKind, setup: LocalSetup): Engine {
  const sessions = new Map<string, Live>()
  const running = new Map<string, Running>()
  /** Windows learnt from the program's own counts, by model. */
  const windows = new Map<string, number>()
  let listed: ModelInfo[] = []

  function providerOf(thread: Thread): Provider {
    const provider = setup.provider(thread.provider)
    if (provider?.kind !== kind) throw new Error(t('That provider is not set up yet.'))
    return provider
  }

  /** The thread's session, opened now if it has none that fits its mode. */
  async function liveFor(thread: Thread, provider: Provider): Promise<[Live, boolean]> {
    const held = sessions.get(thread.id)
    if (held && !held.session.ended && held.mode === thread.mode) return [held, false]
    if (held) await held.session.close()

    let session: Session
    const early: Heard[] = []
    // Filled in once the session answers; a line before that waits in `early`.
    const box: { live?: Live } = {}
    try {
      session = await openSession(
        {
          tool: kind,
          agent: { id: provider.id, name: provider.name },
          mode: thread.mode,
          model: thread.model || null,
          effort: levelOf(kind, thread.effort),
        },
        (said) => {
          if (box.live?.hear) box.live.hear(said)
          else (box.live?.early ?? early).push(said)
        },
      )
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      throw new Error(
        said === 'missing' ? t('{name} is not installed.', { name: KIND_NAMES[kind] }) : said,
        { cause: error },
      )
    }
    const live: Live = {
      session,
      mode: thread.mode,
      model: thread.model,
      effort: thread.effort,
      fast: !!thread.fast,
      hear: null,
      early,
    }
    box.live = live
    sessions.set(thread.id, live)
    return [live, true]
  }

  /** Tells a live session what changed on the chip since it last heard. */
  async function retell(live: Live, thread: Thread): Promise<void> {
    if (thread.model && thread.model !== live.model) {
      await live.session.say({ kind: 'model', model: thread.model })
      live.model = thread.model
    }
    if (thread.effort !== live.effort) {
      await live.session.say({ kind: 'effort', effort: levelOf(kind, thread.effort) })
      live.effort = thread.effort
    }
    if (kind === 'codex' && !!thread.fast !== live.fast) {
      await live.session.say({ kind: 'fast', on: !!thread.fast })
      live.fast = !!thread.fast
    }
  }

  async function send(
    thread: Thread,
    message: Draft,
    on: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const switched = [...thread.turns].reverse().find((one) => one.role === 'model')?.model
    const you: Turn = {
      id: fresh(),
      role: 'you',
      at: Date.now(),
      draft: message,
      parts: [],
      effort: thread.effort,
    }
    const before: Thread = { ...thread, turns: [...thread.turns] }
    thread.turns.push(you)
    if (!thread.title) thread.title = message.text.trim().split('\n')[0]?.slice(0, 80) ?? ''
    on({ type: 'turn', turn: you })

    let turn = modelTurn(thread)
    thread.turns.push(turn)
    on({ type: 'turn', turn })
    const say = (part: Part) => {
      turn.parts.push(part)
      on({ type: 'part', turn: turn.id, index: turn.parts.length - 1, part })
    }
    const grow = (index: number, part: Part) => {
      turn.parts[index] = part
      on({ type: 'part', turn: turn.id, index, part })
    }
    if (switched && thread.model && switched !== thread.model)
      say({ kind: 'notice', code: 'model', text: thread.model })

    let live: Live
    let opened: boolean
    try {
      const provider = providerOf(thread)
      ;[live, opened] = await liveFor(thread, provider)
      if (!opened) await retell(live, thread)
    } catch (error) {
      const words = error instanceof Error ? error.message : String(error)
      say({ kind: 'notice', code: 'error', text: words })
      on({ type: 'done', stop: 'error', error: words })
      return
    }

    const read: (line: string) => Read = kind === 'claude-code' ? claudeReader() : codexReader()
    const heard: Read = {}
    let answered = ''
    let named = false
    let thinkingAt = 0
    let stopping = false

    const finished = new Promise<{ stop: Stop; error?: string }>((resolve) => {
      const close = (stop: Stop, error?: string) => {
        for (const part of turn.parts)
          if (part.kind === 'tool' && part.state === 'running') part.state = 'error'
        resolve(error === undefined ? { stop } : { stop, error })
      }

      const ended = (how: NonNullable<Read['ended']>) => {
        const flight = running.get(thread.id)
        if (how === 'end' && flight && flight.pending > 0) {
          // Claude Code answered the turn before the steered words: the steered words'
          // answer is a model turn of its own.
          flight.pending--
          turn = modelTurn(thread)
          thread.turns.push(turn)
          on({ type: 'turn', turn })
          return
        }
        if (stopping || how === 'stopped') {
          close('stopped')
          return
        }
        if (how === 'end') {
          close('end')
          return
        }
        const name = KIND_NAMES[kind]
        const words =
          troubleOf(
            name,
            PLANS[kind],
            heard,
            { code: 1, timedOut: false, stopped: false, err: '' },
            !!answered,
          ) ?? t('The model did not answer.')
        close('error', words)
      }

      const line = (text: string) => {
        const said = read(text)
        if (said.model && !named) {
          named = true
          on({ type: 'model', model: said.model })
        }
        if (said.limit) {
          heard.limit = said.limit
          plans.heard(kind, said.limit)
          on({ type: 'limit', limit: said.limit })
        }
        if (said.trouble) heard.trouble = said.trouble
        if (said.signedOut) {
          heard.signedOut = true
          plans.signedOut(kind)
        }
        if (said.thinking) {
          const last = turn.parts.at(-1)
          if (last?.kind === 'thinking') {
            grow(turn.parts.length - 1, {
              ...last,
              text: last.text + said.thinking,
              ms: Date.now() - thinkingAt,
            })
          } else {
            thinkingAt = Date.now()
            say({ kind: 'thinking', text: said.thinking, ms: 0 })
          }
        }
        if (said.text) {
          answered += said.text
          const last = turn.parts.at(-1)
          if (last?.kind === 'text')
            grow(turn.parts.length - 1, { ...last, text: last.text + said.text })
          else say({ kind: 'text', text: said.text })
        }
        if (said.tool) {
          const tool = said.tool
          const at = turn.parts.findIndex((one) => one.kind === 'tool' && one.id === tool.id)
          const part = turn.parts[at]
          if (part?.kind === 'tool' && tool.done) {
            grow(at, {
              ...part,
              state: tool.done.error ? 'error' : 'ok',
              result: { text: tool.done.text, images: [], error: tool.done.error },
            })
          } else if (at < 0) {
            say({
              kind: 'tool',
              id: tool.id,
              verb: tool.name,
              args: tool.args ?? {},
              state: tool.done ? (tool.done.error ? 'error' : 'ok') : 'running',
              ...(tool.done
                ? { result: { text: tool.done.text, images: [], error: tool.done.error } }
                : {}),
            })
          }
        }
        if (said.compacted) say({ kind: 'notice', code: 'compacted', text: '' })
        if (said.usage) counted(said.usage)
        if (said.ended) ended(said.ended)
      }

      const counted = (usage: NonNullable<Read['usage']>) => {
        if (usage.window) windows.set(thread.model, usage.window)
        const window =
          usage.window ??
          windows.get(thread.model) ??
          listed.find((one) => one.id === thread.model)?.window ??
          null
        const now: Usage = {
          input: usage.input ?? 0,
          cached: usage.cached ?? 0,
          output: usage.output ?? 0,
          reasoning: usage.reasoning ?? 0,
          window,
        }
        thread.usage = now
        turn.usage = now
        on({ type: 'usage', usage: now })
      }

      const hear = (said: Heard) => {
        if (said.kind === 'line') line(said.line)
        else if (said.kind === 'reply' && said.error && said.to !== 'model') {
          heard.trouble = said.error
          ended('error')
        } else if (said.kind === 'end') {
          if (stopping || said.end.stopped) {
            close('stopped')
            return
          }
          const words =
            troubleOf(KIND_NAMES[kind], PLANS[kind], heard, said.end, !!answered) ??
            t('The model did not answer.')
          close('error', words)
        }
      }
      live.hear = hear
      // What a session said while it was being opened is this send's; what an older one
      // said between sends is nobody's.
      const early = live.early.splice(0)
      if (opened) for (const said of early) hear(said)
    })

    const steered = (text: string) => {
      const said: Turn = {
        id: fresh(),
        role: 'you',
        at: Date.now(),
        draft: { text, attachments: [] },
        steered: true,
        parts: [],
        effort: thread.effort,
      }
      thread.turns.push(said)
      on({ type: 'turn', turn: said })
      if (kind === 'codex') {
        // Codex takes the words into the turn that is running.
        turn = modelTurn(thread)
        thread.turns.push(turn)
        on({ type: 'turn', turn })
      }
    }
    running.set(thread.id, { thread, on, pending: 0, steered })

    const stop = () => {
      stopping = true
      void live.session.say({ kind: 'interrupt' }).catch(() => undefined)
      // A program that does not say it stopped is ended, and the next send starts over.
      setTimeout(() => {
        if (running.get(thread.id)?.thread === thread) void live.session.close()
      }, STOPPING)
    }
    signal.addEventListener('abort', stop, { once: true })

    try {
      const instructions = opened
        ? ((await setup.instructions?.(thread).catch(() => '')) ?? '')
        : ''
      const step = userStep(message)
      const text =
        opened && (instructions || before.turns.length)
          ? seeded(before, instructions, step.text)
          : step.text
      await live.session.say({ kind: 'turn', text, images: step.images })
      if (signal.aborted) stop()
      const end = await finished
      if (end.stop === 'stopped') say({ kind: 'notice', code: 'stopped', text: '' })
      else if (end.stop === 'error') say({ kind: 'notice', code: 'error', text: end.error ?? '' })
      if (turn.usage) spend(thread, turn.usage)
      on(
        end.error === undefined
          ? { type: 'done', stop: end.stop }
          : { type: 'done', stop: end.stop, error: end.error },
      )
    } catch (error) {
      const words = error instanceof Error ? error.message : String(error)
      say({ kind: 'notice', code: 'error', text: words })
      on({ type: 'done', stop: 'error', error: words })
    } finally {
      signal.removeEventListener('abort', stop)
      running.delete(thread.id)
      live.hear = null
      thread.updated = Date.now()
    }
  }

  return {
    async models(provider) {
      if (provider.kind !== kind) return []
      listed = modelsIn(kind, await listedModels(kind))
      return listed.map((one) => ({ ...one, window: one.window ?? windows.get(one.id) ?? null }))
    },
    send,
    async steer(thread, text) {
      const flight = running.get(thread.id)
      const live = sessions.get(thread.id)
      if (!flight || !live || live.session.ended) return
      if (kind === 'codex') {
        await live.session.say({ kind: 'steer', text })
      } else {
        // Claude Code reads a message sent mid-turn after the turn, as a turn of its own.
        flight.pending++
        await live.session.say({ kind: 'turn', text, images: [] })
      }
      flight.steered(text)
    },
    async compact(thread, focus) {
      const live = sessions.get(thread.id)
      if (!live || live.session.ended || running.has(thread.id)) return
      await new Promise<void>((resolve) => {
        const read: (line: string) => Read = kind === 'claude-code' ? claudeReader() : codexReader()
        // A compaction that never says it finished lets go after two minutes.
        const timer = setTimeout(() => {
          done()
        }, 120_000)
        const done = () => {
          clearTimeout(timer)
          live.hear = null
          resolve()
        }
        live.hear = (said) => {
          const over =
            said.kind === 'end' ||
            (said.kind === 'reply' && said.to === 'compact') ||
            (said.kind === 'line' && finished(read(said.line)))
          if (over) done()
        }
        live.session.say({ kind: 'compact', focus: focus ?? '' }).catch(done)
      })
    },
  }
}

/** Whether a line says a compaction is over. */
function finished(heard: Read): boolean {
  return !!heard.compacted || !!heard.ended
}

/** A model turn, empty. */
function modelTurn(thread: Thread): Turn {
  return {
    id: fresh(),
    role: 'model',
    at: Date.now(),
    parts: [],
    provider: thread.provider,
    model: thread.model,
    effort: thread.effort,
  }
}

/** Adds a request's counts to what the thread spent. */
function spend(thread: Thread, usage: Usage): void {
  const before = thread.spent ?? { input: 0, output: 0 }
  thread.spent = {
    ...before,
    input: before.input + usage.input,
    output: before.output + usage.output,
  }
}
