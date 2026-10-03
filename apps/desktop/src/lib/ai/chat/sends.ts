/** Which thread was answering when: what tells the review (lib/ai/review) whose an
 *  edit of a provider's built-in agent was (docs/ai-sidebar.md 4.5).
 *
 *  Every thread of one provider acts as that provider's one grant (`nib-<id>`, see
 *  src-tauri/src/ai_agent.rs), whichever road answers it, so the edit itself cannot
 *  say which thread made it; the time it was made can. Every engine's sends pass
 *  through `engineFor`, which writes each one down here as it starts and ends. A few
 *  hundred, kept for the session, like the edits they explain. */

import type { Engine, Thread } from './types'

/** One send: the thread, the provider it asked, from when to when (null while it is
 *  still running). */
export interface Send {
  thread: string
  provider: string
  from: number
  to: number | null
}

/** How many sends are remembered. */
const KEPT = 500

const sends: Send[] = []

/** Whoever wants to hear a send start: the review, which forgets what a rewind could
 *  put back once the next message goes. */
const starting = new Set<(thread: string) => void>()

/** Listens; answers the way to stop. */
export function onSend(listener: (thread: string) => void): () => void {
  starting.add(listener)
  return () => starting.delete(listener)
}

/** A send starting; answers its end. */
function began(thread: Thread): () => void {
  const send: Send = { thread: thread.id, provider: thread.provider, from: Date.now(), to: null }
  sends.push(send)
  if (sends.length > KEPT) sends.splice(0, sends.length - KEPT)
  for (const listener of starting) listener(thread.id)
  return () => {
    send.to = Date.now()
  }
}

/** The thread that was answering for `provider` at `at`: the latest send of it that
 *  had started by then and not yet ended. Null where none was. */
export function answeringAt(provider: string, at: number): string | null {
  for (let index = sends.length - 1; index >= 0; index--) {
    const send = sends[index]
    if (send?.provider === provider && send.from <= at && (send.to === null || at <= send.to))
      return send.thread
  }
  return null
}

const watched = new WeakMap<Engine, Engine>()

/** An engine whose sends are written down here; the same one each time it is asked. */
export function watching(engine: Engine): Engine {
  const held = watched.get(engine)
  if (held) return held
  // Everything else is the engine's own, whatever it grows: only a send is watched.
  const made = Object.assign(Object.create(engine) as Engine, {
    async send(...[thread, message, on, signal]: Parameters<Engine['send']>) {
      const ended = began(thread)
      try {
        await engine.send(thread, message, on, signal)
      } finally {
        ended()
      }
    },
  })
  watched.set(engine, made)
  return made
}
