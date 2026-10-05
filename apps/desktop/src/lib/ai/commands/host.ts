/** What the runners stand on: the panel's own roads where it has them (6.5), and the
 *  same roads built here where it has not yet.
 *
 *  A turn through the panel is drawn as it runs, queued behind one already running, and
 *  stopped by the panel's own stop; the road built here sends straight through the
 *  engine into the same thread and writes it down after, which is all a panel that has
 *  not grown `turn` can be given. Every runner asks this and never the engine, so the
 *  goal is the same goal on every provider and in every panel. */

import { t } from '../../i18n.svelte'
import { complete } from '../complete'
import type { Message, Provider } from '../providers'
import { ai } from '../store.svelte'
import { engineFor, type Setup } from '../chat/engine'
import { keepThread } from '../chat/threads'
import type { Draft, EngineEvent, NoticeCode, Thread, Turn, Usage } from '../chat/types'
import { added } from '../chat/usage'
import { instructionsFor } from './instructions'
import type { Ended, Once, Panel } from './types'

export interface Host {
  panel: Panel
  /** The thread's provider, or null where it is gone from Settings. */
  provider(thread: Thread): Provider | null
  /** Sends in a thread and waits for its turn to end. */
  turn(thread: Thread, text: string, once?: Once): Promise<Ended>
  adopt(thread: Thread, open?: boolean): void
  touched(thread: Thread): void
  /** A command's own line at the end of a thread, never sent to the model: words, or
   *  under another code what the thread draws its own way (`tasks`). */
  line(thread: Thread, text: string, code?: NoticeCode): void
  /** One question to the thread's provider and model, outside the thread. */
  ask(thread: Thread, messages: readonly Message[], signal?: AbortSignal): Promise<string>
}

const providerOf = (id: string): Provider | null =>
  ai.providers.find((one) => one.id === id) ?? null

/** The engine's setup where the panel's is not to hand: the providers in Settings, and
 *  the commands' own lines on top of nothing else. */
const setup: Setup = { provider: providerOf, instructions: instructionsFor }

/** Folds a send's events into how it ended. */
function ending(): { on: (event: EngineEvent) => void; ended: () => Ended } {
  let stop: Ended['stop'] = 'end'
  let error: string | undefined
  let turn: Turn | null = null
  let usage: Usage | null = null
  let limit: Ended['limit']
  return {
    on(event) {
      if (event.type === 'turn' && event.turn.role === 'model') turn = event.turn
      else if (event.type === 'usage') usage = usage ? added(usage, event.usage) : event.usage
      else if (event.type === 'limit') limit = event.limit
      else if (event.type === 'done') {
        stop = event.stop
        error = event.error
      }
    },
    ended: () => ({
      stop,
      turn,
      usage,
      ...(error !== undefined ? { error } : {}),
      ...(limit ? { limit } : {}),
    }),
  }
}

/** A send straight through the engine, for a panel without `turn`. */
async function directTurn(thread: Thread, text: string, once: Once = {}): Promise<Ended> {
  const provider = providerOf(thread.provider)
  if (!provider)
    return {
      stop: 'error',
      error: t('Add an AI provider in Settings first.'),
      turn: null,
      usage: null,
    }
  const engine = await engineFor(provider.kind, setup)
  const before = { mode: thread.mode, model: thread.model, effort: thread.effort }
  Object.assign(thread, {
    ...(once.mode ? { mode: once.mode } : {}),
    ...(once.model ? { model: once.model } : {}),
    ...(once.effort ? { effort: once.effort } : {}),
  })
  const heard = ending()
  const draft: Draft = { text, attachments: [] }
  try {
    await engine.send(thread, draft, heard.on, once.signal ?? new AbortController().signal)
  } finally {
    Object.assign(thread, before)
    await keepThread(thread).catch(() => undefined)
  }
  return heard.ended()
}

export function hostOf(panel: Panel): Host {
  const touched = (thread: Thread) => {
    if (panel.touched) panel.touched(thread)
    else void keepThread(thread).catch(() => undefined)
  }
  return {
    panel,
    provider: (thread) => providerOf(thread.provider),
    turn: (thread, text, once) =>
      panel.turn ? panel.turn(thread, text, once) : directTurn(thread, text, once),
    adopt(thread, open = false) {
      if (panel.adopt) panel.adopt(thread, open)
      else void keepThread(thread).catch(() => undefined)
    },
    touched,
    line(thread, text, code = 'command') {
      thread.turns.push({
        id: crypto.randomUUID(),
        role: 'model',
        at: Date.now(),
        parts: [{ kind: 'notice', code, text }],
      })
      thread.updated = Date.now()
      touched(thread)
    },
    async ask(thread, messages, signal) {
      const provider = providerOf(thread.provider)
      if (!provider) throw new Error(t('Add an AI provider in Settings first.'))
      return await complete({
        provider,
        model: thread.model,
        messages,
        ...(signal ? { signal } : {}),
      })
    },
  }
}

/** Words sent from a command into the open thread, as if typed: through the field's
 *  own road where nothing differs for this send, and through `turn` where the mode or
 *  model does, which is what the field cannot say. */
export function sendHere(host: Host, thread: Thread | null, text: string, once?: Once): void {
  const { panel } = host
  if (!once) {
    panel.send(text)
    return
  }
  const open = thread ?? panel.ensure?.() ?? null
  if (open && panel.turn) {
    void panel.turn(open, text, once)
    return
  }
  if (once.mode) panel.setMode(once.mode)
  panel.send(text)
}

/** Waits, or stops waiting the moment `signal` says so. */
export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done)
  })
}
