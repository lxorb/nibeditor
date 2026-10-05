/** Which thread was answering when: what tells the review (lib/ai/review) whose an
 *  edit of a provider's built-in agent was (docs/ai-sidebar.md 4.5).
 *
 *  Every thread of one provider acts as that provider's one grant (`nib-<id>`, see
 *  src-tauri/src/ai_agent.rs), whichever road answers it, so the edit itself cannot
 *  say which thread made it; the time it was made can. Every engine's sends pass
 *  through `engineFor`, which writes each one down here as it starts and ends. A few
 *  hundred, kept for the session, like the edits they explain. */

import { runs } from '../../parting'
import type { Engine, Thread } from './types'

/** One send: the thread, the provider it asked, from when to when (null while it is
 *  still running). `held` is the thread itself while it runs, whose title the question
 *  before quitting names it by (lib/quitting); let go of at the end, so five hundred
 *  sends do not keep five hundred transcripts. */
interface Send {
  thread: string
  held: Thread | null
  provider: string
  from: number
  to: number | null
}

/** How many sends are remembered. */
const KEPT = 500

const sends: Send[] = []
runs(() => sends.some((send) => send.to === null))

/** Whoever wants to hear a send start: the review, which forgets what a rewind could
 *  put back once the next message goes. */
const starting = new Set<(thread: string) => void>()

/** Whoever wants to hear a send end: the review, whose list of moved and deleted notes
 *  is read off the turn the send wrote. */
const ending = new Set<(thread: string) => void>()

/** Listens; answers the way to stop. */
export function onSend(listener: (thread: string) => void): () => void {
  starting.add(listener)
  return () => starting.delete(listener)
}

/** Listens for a send's end; answers the way to stop. */
export function onSent(listener: (thread: string) => void): () => void {
  ending.add(listener)
  return () => ending.delete(listener)
}

/** A send starting; answers its end. */
function began(thread: Thread): () => void {
  const send: Send = {
    thread: thread.id,
    held: thread,
    provider: thread.provider,
    from: Date.now(),
    to: null,
  }
  sends.push(send)
  if (sends.length > KEPT) sends.splice(0, sends.length - KEPT)
  for (const listener of starting) listener(thread.id)
  return () => {
    send.to = Date.now()
    send.held = null
    for (const listener of ending) listener(thread.id)
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

/** The threads answering now, each once: every send still running. */
export function answering(): Thread[] {
  const threads = sends.flatMap((send) => (send.to === null && send.held ? [send.held] : []))
  return [...new Set(threads)]
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
