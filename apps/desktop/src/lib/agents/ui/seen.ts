/** Everything the window knows about agents, and how each piece of news changes it.
 *
 *  One plain object, kept by the activity store as state, and one function per kind
 *  of event that changes it where it stands: the crate's overview once, then the
 *  events of 13.1 as they come. Pure, so the whole of what an event means is readable
 *  as arithmetic and tested without a window; which tab wears what is `marks.ts`, read
 *  off this. */

import { without } from '../../records'
import type { AgentEvent, AgentTab, Approval, Grant, Overview } from '../verbs'

/** An agent tab, with the agent it belongs to. */
export interface Held extends AgentTab {
  agent: string
}

/** The last call an agent made on a tab, or in a note. */
interface Touch {
  agent: string
  verb: string
  /** Milliseconds since 1970. */
  at: number
}

/** What the window knows. */
export interface Seen {
  agents: Grant[]
  /** The agents' own tabs, by id. */
  tabs: Record<string, Held>
  /** The questions waiting, oldest first. */
  approvals: Approval[]
  /** When the stop for everyone was pressed, or null while it is not. */
  stopped: number | null
  /** The agents stopped one at a time, and when. */
  halted: Record<string, number>
  /** The agents that called lately and did not say goodbye. */
  connected: string[]
  /** The last call on each tab, a reader's or an agent's own, by the tab's id. */
  acting: Record<string, Touch>
  /** Each agent's last call, whatever it was on: what the panel says it is doing. */
  doing: Record<string, Touch & { tab: string | null }>
}

/** Nothing known yet. */
export function nothing(): Seen {
  return {
    agents: [],
    tabs: {},
    approvals: [],
    stopped: null,
    halted: {},
    connected: [],
    acting: {},
    doing: {},
  }
}

/** What the crate's overview says, over whatever was known: the calls seen stay,
 *  because the overview has none. */
export function overviewed(seen: Seen, overview: Overview, now: number): void {
  seen.agents = overview.agents
  seen.tabs = Object.fromEntries(
    overview.tabs.map(([agent, tab]) => [tab.id, { ...tab, agent }] as const),
  )
  seen.approvals = overview.approvals.filter((one) => one.answer === 'pending')
  seen.stopped = overview.stopped ? (seen.stopped ?? now) : null
  seen.halted = Object.fromEntries(
    overview.halted.map((agent) => [agent, seen.halted[agent] ?? now]),
  )
  seen.connected = overview.connected
}

/** One event, applied. */
export function heard(seen: Seen, event: AgentEvent, now: number): void {
  switch (event.kind) {
    case 'acting': {
      const touch = { agent: event.agent, verb: event.verb, at: now }
      seen.acting[event.tab] = touch
      seen.doing[event.agent] = { ...touch, tab: event.tab }
      if (!seen.connected.includes(event.agent)) seen.connected = [...seen.connected, event.agent]
      return
    }
    case 'paused':
      seen.halted[event.agent] = now
      return
    case 'resumed':
      resumed(seen, event.agent)
      return
    case 'asked':
      seen.approvals = [
        ...seen.approvals.filter((one) => one.id !== event.approval.id),
        event.approval,
      ]
      return
    case 'answered':
      seen.approvals = seen.approvals.filter((one) => one.id !== event.approval.id)
      return
    case 'tab': {
      const was = seen.tabs[event.id]
      seen.tabs[event.id] = {
        id: event.id,
        agent: event.agent,
        url: event.url,
        title: event.title,
        loading: was?.loading ?? false,
        store: was?.store ?? 'reader',
        parked: false,
      }
      return
    }
    case 'closed':
      closed(seen, event.id)
      return
    case 'stopped':
      seen.stopped ??= now
      if (event.closed) for (const id of Object.keys(seen.tabs)) closed(seen, id)
      return
    case 'connected':
      seen.connected = event.agents
      return
  }
}

/** The stop lifted: everybody's when no agent is named, else one agent's own. */
function resumed(seen: Seen, agent: string): void {
  if (agent === '') {
    seen.stopped = null
    seen.halted = {}
    return
  }

  seen.halted = without(seen.halted, agent)
}

/** A tab gone, the agent's own or the reader's: nothing of it is kept. */
function closed(seen: Seen, id: string): void {
  seen.tabs = without(seen.tabs, id)
  seen.acting = without(seen.acting, id)
}

/** An agent wrote in a note: the tabs showing it wear its mark as a page's would. */
export function wrote(seen: Seen, agent: string, tabs: readonly string[], now: number): void {
  for (const tab of tabs) seen.acting[tab] = { agent, verb: 'edit_note', at: now }
  seen.doing[agent] = { agent, verb: 'edit_note', at: now, tab: tabs[0] ?? null }
}

/** Whether an agent is stopped: by the stop for everyone, or on its own. */
export function isStopped(seen: Seen, agent: string): boolean {
  return seen.stopped !== null || agent in seen.halted
}
