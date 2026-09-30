/** What the shell draws of agents, and the one door they come in by.
 *
 *  The strip, the web tab and the sidebar read these few fields, and `lib/agents/ui`
 *  writes them once an agent has been heard: nothing of `lib/agents` is in the first
 *  paint (docs/agent-native.md 11). The rules for which tab wears what are
 *  `lib/agents/ui/marks.ts`; this is only what they came to.
 *
 *  The door is the one listener on `nib://agent`: the first event fetches the activity
 *  UI, and every event after it is handed straight on. */

import { isDesktop } from './tauri'

/** An agent's mark on one tab: whose, in its colour, and whether paused there. */
export interface Worn {
  agent: string
  colour: string
  paused: boolean
}

/** What a press on the mark, or a row of the tab's menu, asks of the agent. */
type TabAct = 'stop' | 'take-over' | 'give-back'

class AgentMarks {
  /** The mark each tab wears, by tab id. */
  on = $state<Record<string, Worn>>({})

  /** Whether an agent has spoken in this run: the activity panel has a tab from then. */
  heard = $state(false)

  /** Questions waiting: the badge on that tab. */
  waiting = $state(0)

  /** Takeovers waiting, by the reader's tab: the question and the agent's one line. */
  takeovers = $state<Record<string, { id: string; reason: string }>>({})

  /** Whether closing this window hides it: an agent is connected and its pages live
   *  here. Plain, because the close handler must answer before it can wait. */
  holding = false

  /** A press on a tab's mark or menu row, once the UI has arrived. */
  act: ((tab: string, what: TabAct) => void) | null = null

  /** Hides the window rather than closing it; false where the crate would not keep it. */
  hide: (() => Promise<boolean>) | null = null
}

export const agentMarks = new AgentMarks()

/** Listens for agents, once the space is open. Answers how to stop. */
export async function listenForAgents(): Promise<() => void> {
  if (!isDesktop) return () => undefined

  const { listen } = await import('@tauri-apps/api/event')
  let heard: Promise<(event: unknown) => void> | null = null

  return listen<unknown>('nib://agent', ({ payload }) => {
    heard ??= import('./agents/ui/index').then(({ start }) => start())
    void heard.then((hear) => hear(payload))
  })
}
