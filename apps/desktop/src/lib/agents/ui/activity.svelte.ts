/** The activity store: what the window knows about agents, and every press the reader
 *  can make about them.
 *
 *  What an event means is `seen.ts`; which tab wears what is `marks.ts`; this holds the
 *  two together as state and answers the presses - Stop, Resume, Take over, Give back,
 *  Allow, Show, Add to note, Undo - by asking the crate, whose answer comes back as an
 *  event like everyone else's. So a press in one window is seen in every window, and
 *  nothing here guesses at what the crate will say. */

import { accentFor } from '../../accents'
import { without } from '../../records'
import { theme } from '../../theme.svelte'
import { pages } from '../../web-tab/pages.svelte'
import { workspace } from '../../workspace.svelte'
import type { NoteDoc } from '../../workspace/documents.svelte'
import type { AgentEvent, Approval, Grant } from '../verbs'
import { touchedBy } from '../docs/touched'
import { keepInNote } from './keep'
import { callsOf, sessionMarkdown, today, type Call } from './session'
import { heard, isStopped, nothing, overviewed, pausedKey, type Seen, wrote } from './seen'
import type { Source } from './source'

export class Activity {
  /** What is known. */
  seen = $state<Seen>(nothing())

  /** The moment the marks are read at. Moved on by every event and by the timer that
   *  lets an acting tab go; see `ACTIVE_FOR` in marks.ts. */
  now = $state(Date.now())

  /** The last picture of each agent tab, as an address an `<img>` can show. */
  frames = $state<Record<string, string>>({})

  /** Today's audit log, as the crate wrote it. */
  lines = $state<readonly unknown[]>([])

  /** Whether the agents' pages live in this window, which is where Show can put them. */
  holds = $state(false)

  constructor(readonly source: Source) {}

  /** The events heard while the overview was on its way, applied again over it: the
   *  overview is what the crate held when it answered, and a pause said meanwhile is
   *  newer than that. Null once it has arrived. */
  private meanwhile: AgentEvent[] | null = null

  /** Everything at once, from the crate. */
  async load(): Promise<void> {
    this.meanwhile = []
    try {
      const [overview, holds] = await Promise.all([this.source.state(), this.source.holds()])
      overviewed(this.seen, overview, Date.now())
      for (const event of this.meanwhile) heard(this.seen, event, Date.now())
      this.holds = holds
      this.now = Date.now()
    } finally {
      this.meanwhile = null
    }
  }

  /** One event. */
  hear(event: AgentEvent): void {
    const now = Date.now()
    this.meanwhile?.push(event)
    heard(this.seen, event, now)
    if (event.kind === 'closed') this.frames = without(this.frames, event.id)
    this.now = now

    // An agent this window has not met - paired since it arrived - is read, so it has
    // its name and its colour rather than its id. Only the grants: the rest of what the
    // crate answers is older than the events that came in while it was answering.
    if (event.kind === 'connected' && event.agents.some((one) => !this.grantOf(one))) {
      void this.source
        .state()
        .then((overview) => (this.seen.agents = overview.agents))
        .catch(() => undefined)
    }
  }

  /** An agent wrote in a note: every tab showing it wears the mark. */
  wrote(note: NoteDoc, agent: string): void {
    const now = Date.now()
    wrote(
      this.seen,
      agent,
      workspace.tabs.filter((tab) => tab.note === note).map((tab) => tab.id),
      now,
    )
    this.now = now
  }

  /** Today's log, read again. */
  async readLog(): Promise<void> {
    this.lines = await this.source.log(today())
  }

  // ---- who and what --------------------------------------------------------------

  grantOf(agent: string): Grant | undefined {
    return this.seen.agents.find((one) => one.id === agent)
  }

  nameOf(agent: string): string {
    return this.grantOf(agent)?.name ?? agent
  }

  /** The colour an agent wears, which is its caret's in a note: the same function of
   *  its name, so one agent is one colour everywhere. See presence.ts. */
  colourOf(agent: string): string {
    return accentFor(this.nameOf(agent), theme.current)
  }

  /** The agents the panel lists: every one connected, and any with a question or a tab
   *  though it went quiet. */
  get listed(): string[] {
    const seen = this.seen
    const ids = [
      ...seen.connected,
      ...seen.approvals.flatMap((one) => (one.agent === '' ? [] : [one.agent])),
      ...Object.values(seen.tabs).map((one) => one.agent),
    ]
    return ids.filter((one, at) => ids.indexOf(one) === at)
  }

  /** One agent's session, newest first. */
  callsOf(agent: string): Call[] {
    return callsOf(this.lines, agent)
  }

  /** Whether an agent is stopped. */
  stopped(agent: string): boolean {
    return isStopped(this.seen, agent)
  }

  /** The questions waiting, pairings apart: those are asked in a bubble of their own. */
  get questions(): Approval[] {
    return this.seen.approvals.filter((one) => one.category !== 'pairing')
  }

  // ---- presses ---------------------------------------------------------------------

  /** The stop: every agent, or one. */
  async stop(agent?: string): Promise<void> {
    await this.source.stop(agent)
  }

  /** The stop given back: every agent's, or one's. */
  async resume(agent?: string): Promise<void> {
    await this.source.resume(agent)
  }

  /** A press on a tab's mark or a row of its menu. */
  async act(tab: string, what: 'stop' | 'take-over' | 'give-back'): Promise<void> {
    const touch = this.seen.acting[tab]
    const agent =
      touch?.agent ??
      Object.keys(this.seen.paused)
        .find((key) => key.endsWith(`\n${tab}`))
        ?.split('\n')[0]
    if (agent === undefined) return

    if (what === 'give-back') {
      if (pausedKey(agent, tab) in this.seen.paused) await this.source.resume(agent, tab)
      else if (agent in this.seen.halted) await this.source.resume(agent)
      else if (this.seen.stopped !== null) await this.source.resume()
      return
    }

    await this.source.pause(agent, tab, what === 'stop')
    // Taking over is taking the tab: it comes to the front, as a press in it would.
    if (what === 'take-over') workspace.activate(tab)
  }

  /** The reader's answer to a question. Allowing a Show shows the tab; a takeover's
   *  answer is the tab handed back. */
  async answer(approval: Approval, allow: boolean, always = false): Promise<void> {
    const answered = await this.source.answer(approval.id, allow, always)
    if (answered.answer === 'allowed' && answered.category === 'showing' && answered.tab) {
      await this.show(answered.tab)
    }
  }

  /** An agent's tab made a tab of the reader's, beside the one in front, without
   *  loading it again (6.7). It goes on being acted in, framed. */
  async show(agentTab: string): Promise<void> {
    const held = this.seen.tabs[agentTab]
    if (!held) return

    const id = workspace.openPage(held.url, 'front', workspace.activeTabId ?? undefined)
    if (id === null) return

    const touch = this.seen.acting[agentTab]
    if (touch) this.seen.acting[id] = touch
    await pages.adopt(id, () => this.source.adopt(agentTab, id))
  }

  /** The reader's tab a question is about, brought to the front. */
  goTo(tab: string): void {
    if (workspace.tabs.some((one) => one.id === tab)) workspace.activate(tab)
  }

  /** The session written into the note in front, or into a note of its own. */
  async addToNote(agent: string): Promise<void> {
    await this.readLog()
    await keepInNote(sessionMarkdown(this.nameOf(agent), this.callsOf(agent)))
  }

  /** The note in front, if the agent has edits of its own to take back in it: what
   *  Undo is about. The same list the palette's Undo rows read; see touched.ts. */
  undoable(agent: string): string | null {
    const path = workspace.active?.path ?? null
    return touchedBy(path).some((one) => one.id === agent) ? path : null
  }

  /** Takes back everything one agent wrote in the note in front, keeping the reader's
   *  own words since; see lib/agents/docs. */
  async undo(agent: string): Promise<void> {
    const path = this.undoable(agent)
    if (path === null) return

    const { undoAgentIn } = await import('../docs/index')
    await undoAgentIn({ id: agent, name: this.nameOf(agent) }, path)
  }
}
