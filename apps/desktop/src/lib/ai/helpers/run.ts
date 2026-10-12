/** `run_agent` and `agent_result`, answered in the window: the helpers' rules
 *  (helpers.svelte.ts) on the panel's own roads. Reached two ways, with one answer: an
 *  agent in a program's session or outside nib calls them through `nib mcp` and the
 *  dispatcher (agents/workspace/helpers.ts); the API loop calls them here directly
 *  (chat/tools.ts), since it is already in the window.
 *
 *  A call waits for its helper for `WAIT` at the most, under the half minute the
 *  endpoint waits for the window, and says it is still running past that; `nib mcp`
 *  then asks again (`agent_result`) until it has ended, inside the ten minutes each
 *  program gives one tool, and the API loop waits for it outright. */

import { workspace } from '../../workspace.svelte'
import type { Effort, Mode, Thread } from '../chat/types'
import { usable } from '../providers'
import { ai } from '../store.svelte'
import { type Helper, helpers } from './helpers.svelte'
import type { Offered } from './route'

/** The tools, by name. */
export const HELPER_TOOLS: ReadonlySet<string> = new Set(['run_agent', 'agent_result'])

/** How long one call waits for its helper before saying it is still running. */
export const WAIT = 20_000

/** How long the models of one provider are waited for. */
const LISTING = 10_000

/** Who asks: the thread a session or the API loop runs for, and how much it may do; an
 *  outside agent has no thread. */
export interface Asker {
  thread: string | null
  /** The mode an outside agent's helper works in, from its grant. */
  mode: Mode
}

/** What both tools answer: where the helper stands, and its words once it has ended. */
export type Answered =
  | {
      agent: string
      state: Helper['state']
      provider: string
      model: string
      answer?: string
      error?: string
    }
  | { refused: string }

function said(helper: Helper): Answered {
  return {
    agent: helper.id,
    state: helper.state,
    provider: helper.provider,
    model: helper.model,
    ...(helper.state === 'running' ? {} : { answer: helper.answer }),
    ...(helper.error ? { error: helper.error } : {}),
  }
}

/** The first of some words that says anything, or the empty string. */
const first = (...words: (string | undefined)[]): string => words.find(Boolean) ?? ''

/** The arguments, read: whatever crossed a boundary is unknown until it is. */
function word(args: Record<string, unknown>, name: string): string {
  const value = args[name]
  return typeof value === 'string' ? value.trim() : ''
}

const EFFORTS: readonly Effort[] = [
  'auto',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

/** Every provider in use with the models it lists; one that does not answer in time
 *  is offered with none. */
async function offered(): Promise<Offered[]> {
  const { chat } = await import('../sidebar/chat.svelte')
  const usableOnes = ai.providers.filter(usable)
  return await Promise.all(
    usableOnes.map(async (provider) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<[]>((done) => (timer = setTimeout(() => done([]), LISTING)))
      const models = await Promise.race([chat.loadModels(provider), late])
      clearTimeout(timer)
      return { provider, models }
    }),
  )
}

/** `run_agent`: a helper started, and its answer if it ends within the wait. */
export async function runAgent(args: Record<string, unknown>, asker: Asker): Promise<Answered> {
  const prompt = word(args, 'prompt')
  if (!prompt) return { refused: 'say prompt: the whole task, as the helper should read it' }
  const { chat } = await import('../sidebar/chat.svelte')
  const parent = asker.thread ? chat.threadOf(asker.thread) : null
  const space = parent?.space ?? workspace.activeSpace?.id ?? ''
  if (!space) return { refused: 'open a space first' }

  const type = word(args, 'subagent_type')
  const profile = type
    ? await import('../commands/found').then((one) => one.foundNamed('agent', type))
    : null
  if (type && !profile) return { refused: `there is no agent profile called "${type}"` }
  const effort = first(word(args, 'effort'), profile?.effort)
  const started = await helpers.start(
    {
      parent,
      space,
      prompt,
      description: word(args, 'description'),
      model: first(word(args, 'model'), profile?.model),
      ...(EFFORTS.includes(effort as Effort) ? { effort: effort as Effort } : {}),
      mode: parent?.mode ?? asker.mode,
      ...(profile?.body ? { instructions: profile.body } : {}),
    },
    {
      offered,
      run: (thread: Thread, text: string, signal: AbortSignal) => {
        chat.adopt(thread)
        return chat.turn(thread, text, { signal })
      },
    },
  )
  if ('refused' in started) return started
  const now = await helpers.wait(started.id, WAIT)
  return said(now ?? started)
}

/** `agent_result`: where a helper stands, once it has ended or after the wait. */
export async function agentResult(args: Record<string, unknown>): Promise<Answered> {
  const id = word(args, 'agent')
  const now = id ? await helpers.wait(id, WAIT) : null
  return now ? said(now) : { refused: `there is no helper called "${id}"` }
}

/** The API loop's road: the call answered, waiting until the helper has ended. */
export async function helperHere(
  name: string,
  args: Record<string, unknown>,
  asker: Asker,
): Promise<Answered> {
  let answered = name === 'run_agent' ? await runAgent(args, asker) : await agentResult(args)
  while (!('refused' in answered) && answered.state === 'running') {
    answered = await agentResult({ agent: answered.agent })
  }
  return answered
}

/** An answer as a model reads it: the helper's words, or a sentence about where it is. */
export function answerText(answered: Answered): string {
  if ('refused' in answered) return answered.refused
  const who = `helper ${answered.agent} (${answered.model || answered.provider})`
  switch (answered.state) {
    case 'running':
      return `${who} is still working. Call agent_result with agent "${answered.agent}" to wait for its answer.`
    case 'done':
      return first(answered.answer, `${who} finished without a word.`)
    case 'stopped':
      return `${who} was stopped${answered.answer ? `. What it said so far:\n\n${answered.answer}` : '.'}`
    case 'failed':
      return `${who} failed: ${answered.error ?? 'it did not answer'}`
  }
}
