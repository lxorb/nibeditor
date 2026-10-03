/** The thread engine for the providers nib asks itself: a Claude or OpenAI key, a
 *  ChatGPT plan, an OpenAI-compatible server (5.1). One loop for all four, an adapter
 *  per API under it, and nib's own tools on top.
 *
 *  A send is: compact first if the window would overflow, the reader's message as a
 *  turn, then rounds - a request, its stream, the tools it asked for, their answers -
 *  until the model answers without asking for a tool, the reader stops it, or the step
 *  limit is reached. Words the reader sends into a running turn (Ctrl+Enter) go in after
 *  the call in flight, as a message of their own.
 *
 *  The engine writes into the thread it is handed, in place, and says each change
 *  through `on`; the thread store writes the thread down once a send is over. Claude
 *  Code and Codex are engines of their own (lane 2), joined through `localEngines`. */

import { t } from '../../i18n.svelte'
import { type LocalKind, isLocal, type Provider, type ProviderKind } from '../providers'
import { anthropic } from './anthropic'
import { catalogue, unlisted, windowIn } from './catalogue'
import { compactThread } from './compact'
import { completions } from './completions'
import { within } from './effort'
import { learn, learnt } from './learned'
import { Refused, wasStopped } from './request'
import { responses } from './responses'
import { type Adjusted, round } from './round'
import { crateTools, type Tools } from './tools'
import { baseEffort, type Call, stepsOf, type Step } from './transcript'
import type {
  Api,
  Draft,
  Engine,
  EngineEvent,
  ModelInfo,
  Part,
  Stop,
  Thread,
  ToolOutput,
  Turn,
  Usage,
} from './types'
import { added, estimate, shouldCompact } from './usage'
import type { ToolDef, Wire } from './wire'

/** The API a kind is asked through, or null for a program on this machine. */
function apiOf(kind: ProviderKind): Api | null {
  if (kind === 'anthropic') return 'anthropic'
  if (kind === 'openai' || kind === 'chatgpt') return 'responses'
  if (kind === 'compatible') return 'completions'
  return null
}

const WIRES: Record<Api, Wire> = { anthropic, responses, completions }

/** How many rounds of tool calls one message may take before the loop stops and says
 *  so: Windsurf's forty. The reader says "go on" to carry on. */
export const MOST_ROUNDS = 40

/** What the model is told, by mode. Not translated: nobody reads it, and the answer is
 *  asked for in the reader's own language. */
const SYSTEM: Record<Thread['mode'], string> = {
  ask: [
    'You are the reader’s assistant inside nib, their notes app and web browser, in a panel beside what they are reading.',
    'You are in Ask mode: read and search with the tools you have, change nothing, and answer from what you read.',
    'Name the note or page each claim comes from as a [[wikilink]] or its address.',
    'Reply in the language of the question, in markdown, briefly: no preamble, no sign-off.',
  ].join(' '),
  plan: [
    'You are the reader’s assistant inside nib, their notes app and web browser, in a panel beside what they are reading.',
    'You are in Plan mode: read what you need, then write the plan as one new note with create_note, a task (- [ ]) per step, and change nothing else.',
    'Reply in the language of the request, briefly.',
  ].join(' '),
  agent: [
    'You are the reader’s agent inside nib, their notes app and web browser, in a panel beside what they are reading.',
    'Do what they ask with the tools you have; every change you make is shown to them to keep or undo.',
    'Change part of a note with edit_note rather than write_note: they may be typing in it.',
    'Reply in the language of the request, briefly, saying what you did.',
  ].join(' '),
}

/** What the engine needs from the app around it. */
export interface Setup {
  /** A provider by its id in Settings > AI. */
  provider(id: string): Provider | null
  tools?: Tools
  /** The space's instructions (`AGENTS.md`) and the reader's own, for the system prompt. */
  instructions?(thread: Thread): Promise<string>
}

function fresh(): string {
  return crypto.randomUUID()
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

/** The provider and model that answered last, where one has. */
function lastModel(thread: Thread): string {
  for (let at = thread.turns.length - 1; at >= 0; at--) {
    const turn = thread.turns[at]
    if (turn?.role === 'model' && turn.model) return `${turn.provider ?? ''}/${turn.model}`
  }
  return ''
}

/** Builds the API engine. */
export function createApiEngine(setup: Setup): Engine {
  const tools = setup.tools ?? crateTools
  const listed = new Map<string, ModelInfo[]>()
  const steering = new Map<string, string[]>()

  function providerOf(thread: Thread): Provider {
    const provider = setup.provider(thread.provider)
    if (!provider || !apiOf(provider.kind)) throw new Error(t('That provider is not set up yet.'))
    return provider
  }

  /** A model as its provider listed it, the list asked for once a session. A list that
   *  cannot be had leaves the model known by its name and what was learnt. */
  async function modelOf(provider: Provider, id: string): Promise<ModelInfo> {
    let models = listed.get(provider.id)
    if (!models) {
      models = await catalogue(provider).catch(() => [])
      if (models.length) listed.set(provider.id, models)
    }
    return models.find((one) => one.id === id) ?? unlisted(provider, id)
  }

  async function systemFor(thread: Thread, instructions: string): Promise<string> {
    const own = (await setup.instructions?.(thread).catch(() => '')) ?? ''
    return [SYSTEM[thread.mode], instructions, own].filter(Boolean).join('\n\n')
  }

  async function send(
    thread: Thread,
    message: Draft,
    on: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    let provider: Provider
    let api: Api
    try {
      provider = providerOf(thread)
      api = apiOf(provider.kind) ?? 'completions'
    } catch (error) {
      on({
        type: 'done',
        stop: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
    const wire = WIRES[api]
    let model = await modelOf(provider, thread.model)
    thread.effort = within(thread.effort, model.efforts)

    if (shouldCompact(thread.usage, estimate(message), thread.autocompact)) {
      // Compacting first is what keeps the send from being refused for its length; a
      // compaction that fails leaves the send to try as it is.
      await compact(thread).catch(() => undefined)
    }

    const switched = lastModel(thread)
    const you: Turn = {
      id: fresh(),
      role: 'you',
      at: Date.now(),
      draft: message,
      parts: [],
      effort: thread.effort,
    }
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
    if (switched && switched !== `${thread.provider}/${thread.model}`)
      say({ kind: 'notice', code: 'model', text: model.name })

    let listing = { instructions: '', tools: [] as ToolDef[] }
    if (learnt(provider.id, model.id).tools !== false) {
      listing = await tools.list(provider, thread.mode).catch(() => listing)
    }
    const system = await systemFor(thread, listing.instructions)
    const perMessage = api === 'anthropic' && learnt(provider.id, model.id).perMessage !== false
    let steps: Step[] = stepsOf(
      {
        turns: thread.turns.slice(0, -1),
        ...(thread.compaction ? { compaction: thread.compaction } : {}),
      },
      api,
      model.id,
      perMessage,
    )
    let addedNow: unknown[] = []
    let used: Usage | null = null
    let answered = ''
    let stop: Stop = 'end'
    steering.set(thread.id, [])

    const adjusted = (change: Adjusted) => {
      if (change.effort) {
        thread.effort = change.effort
        turn.effort = change.effort
      }
      if (change.efforts) {
        const efforts = change.efforts
        model = { ...model, efforts }
        // The next send asks the list again, with what was learnt in it.
        listed.set(
          provider.id,
          (listed.get(provider.id) ?? []).map((one) =>
            one.id === model.id ? { ...one, efforts } : one,
          ),
        )
      }
      if (change.toolsRefused) {
        listing = { ...listing, tools: [] }
        say({ kind: 'notice', code: 'no_tools', text: '' })
      }
    }

    /** Ends the turn: what the provider said of it, kept for the next request. */
    const close = (whole: boolean) => {
      turn.model = model.id
      if (used) turn.usage = used
      if (whole && addedNow.length) turn.replay = { api, model: model.id, messages: addedNow }
    }

    try {
      for (let rounds = 0; ; rounds++) {
        if (rounds >= MOST_ROUNDS) {
          say({ kind: 'notice', code: 'steps', text: String(MOST_ROUNDS) })
          stop = 'steps'
          break
        }
        const start = turn.parts.length
        const result = await round(
          wire,
          {
            provider,
            model,
            effort: thread.effort,
            base: perMessage ? baseEffort(thread, thread.effort) : thread.effort,
            fast: !!thread.fast,
            system,
            tools: listing.tools,
            steps,
            added: addedNow,
            web: !!message.web,
            perMessage,
          },
          (parts, changed, said) => {
            if (said && !answered) {
              answered = said
              on({ type: 'model', model: said })
            }
            for (const index of changed) {
              const part = parts[index]
              if (!part) continue
              // A copy, so the thread's own part is a new value each time it grows.
              const copy = { ...part }
              turn.parts[start + index] = copy
              on({ type: 'part', turn: turn.id, index: start + index, part: copy })
            }
          },
          adjusted,
          signal,
        )
        // The parts as the round ended them: a call's arguments are whole only now.
        result.parts.forEach((part, index) => (turn.parts[start + index] = { ...part }))
        if (result.usage) {
          used = used ? added(used, result.usage) : result.usage
          thread.usage = { ...result.usage, window: result.usage.window ?? model.window }
          spend(thread, result.usage)
          on({ type: 'usage', usage: thread.usage })
        }
        addedNow = [...addedNow, ...result.answer.messages]

        const { ending, calls } = result.answer
        if (ending === 'pause') continue
        if (ending === 'tool') {
          const outputs = await runCalls(thread, provider, calls, turn, on)
          addedNow = [...addedNow, ...wire.results(outputs)]
          if (signal.aborted) throw new DOMException('stopped', 'AbortError')
        } else if (ending !== 'end') {
          stop = ending
          say({ kind: 'notice', code: ending, text: result.answer.refusal ?? '' })
          break
        }

        // Words the reader sent into the running turn: the turn so far is closed, their
        // message is a turn of its own, and the loop goes on with the answer to it.
        const steered = steering.get(thread.id)?.splice(0) ?? []
        if (steered.length) {
          close(true)
          steps = [...steps, { role: 'native', messages: addedNow }]
          for (const words of steered) {
            const draft: Draft = { text: words, attachments: [] }
            const said: Turn = {
              id: fresh(),
              role: 'you',
              at: Date.now(),
              draft,
              steered: true,
              parts: [],
              effort: thread.effort,
            }
            thread.turns.push(said)
            on({ type: 'turn', turn: said })
            steps = [...steps, ...stepsOf({ turns: [said] }, api, model.id)]
          }
          addedNow = []
          used = null
          turn = modelTurn(thread)
          thread.turns.push(turn)
          on({ type: 'turn', turn })
          continue
        }
        if (ending === 'end') break
      }
      close(stop === 'end' || stop === 'steps')
      on({ type: 'done', stop })
    } catch (error) {
      // What arrived stays; nothing of a turn cut short is sent back as the provider's
      // own record, since a half-written thinking block is refused. The turn is rebuilt
      // from its parts instead.
      close(false)
      for (const part of turn.parts)
        if (part.kind === 'tool' && part.state === 'running') part.state = 'error'
      if (wasStopped(error) || signal.aborted) {
        say({ kind: 'notice', code: 'stopped', text: '' })
        on({ type: 'done', stop: 'stopped' })
      } else {
        const words = error instanceof Error ? error.message : String(error)
        if (error instanceof Refused) {
          const window = windowIn(words)
          if (window) learn(provider.id, model.id, { window })
        }
        say({ kind: 'notice', code: 'error', text: words })
        on({ type: 'done', stop: 'error', error: words })
      }
    } finally {
      steering.delete(thread.id)
      thread.updated = Date.now()
    }
  }

  /** Runs a round's calls side by side, and writes each answer into its part. */
  async function runCalls(
    thread: Thread,
    provider: Provider,
    calls: readonly Call[],
    turn: Turn,
    on: (event: EngineEvent) => void,
  ): Promise<{ call: Call; output: ToolOutput }[]> {
    return await Promise.all(
      calls.map(async (call) => {
        const output = await tools.call(provider, thread.mode, call.name, call.args)
        const index = turn.parts.findIndex((one) => one.kind === 'tool' && one.id === call.id)
        const part = turn.parts[index]
        if (part?.kind === 'tool') {
          const done: Part = {
            ...part,
            args: call.args,
            state: output.approval ? 'asking' : output.error ? 'error' : 'ok',
            result: output,
          }
          turn.parts[index] = done
          on({ type: 'part', turn: turn.id, index, part: done })
        }
        return { call, output }
      }),
    )
  }

  async function compact(thread: Thread, focus?: string): Promise<void> {
    const provider = providerOf(thread)
    const api = apiOf(provider.kind) ?? 'completions'
    const model = await modelOf(provider, thread.model)
    const listing = await tools
      .list(provider, thread.mode)
      .catch(() => ({ instructions: '', tools: [] }))
    const system = await systemFor(thread, listing.instructions)
    await compactThread({
      thread,
      provider,
      api,
      wire: WIRES[api],
      model,
      system,
      tools: listing.tools,
      focus,
    })
  }

  return {
    async models(provider) {
      const models = await catalogue(provider)
      listed.set(provider.id, models)
      return models
    },
    send,
    steer(thread, text) {
      steering.get(thread.id)?.push(text)
      return Promise.resolve()
    },
    compact,
  }
}

/** Adds a request's counts to what the thread spent. */
function spend(thread: Thread, usage: Usage): void {
  const before = thread.spent ?? { input: 0, output: 0 }
  const cost = (before.cost ?? 0) + (usage.cost ?? 0)
  thread.spent = {
    input: before.input + usage.input,
    output: before.output + usage.output,
    ...(before.cost !== undefined || usage.cost !== undefined ? { cost } : {}),
  }
}

/** Claude Code's and Codex's engines, which lane 2 builds, each fetched the first time a
 *  thread on that program sends. */
const localEngines: Partial<Record<LocalKind, () => Promise<Engine>>> = {}

/** Joins a program's engine to the registry. */
export function registerLocalEngine(kind: LocalKind, load: () => Promise<Engine>): void {
  localEngines[kind] = load
}

/** The API engine built for each setup, so the panel and the commands that share a
 *  setup share an engine, and words steered into a running turn reach it. */
const built = new WeakMap<Setup, Engine>()

/** The engine for a kind of provider. */
export async function engineFor(kind: ProviderKind, setup: Setup): Promise<Engine> {
  if (isLocal(kind)) {
    const load = localEngines[kind]
    if (!load) throw new Error(t('That provider is not set up yet.'))
    return await load()
  }
  const held = built.get(setup)
  if (held) return held
  const engine = createApiEngine(setup)
  built.set(setup, engine)
  return engine
}
