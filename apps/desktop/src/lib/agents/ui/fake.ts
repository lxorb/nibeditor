/** A crate in memory: the agents' half of the app, answering the activity UI the way
 *  `src-tauri/src/agents` does and telling it the same news.
 *
 *  For the tests, and for the drive of the browser build, which has no crate. It keeps
 *  the crate's rules where the UI can see them - a first stop pauses and a second
 *  closes the tabs, a takeover answered gives its tab back, a tab shown is no longer
 *  the agent's - and nothing the UI cannot see. Every call it is asked is written down
 *  in `asked`, so a test can say what a press did. */

import type {
  AgentEvent,
  AgentTab,
  Approval,
  Category,
  Frame,
  Grant,
  Overview,
  ShellWords,
} from '../verbs'
import type { Source } from './source'

/** A grant with the defaults the crate gives the reader's own agents. */
function grantFor(id: string, name: string): Grant {
  return {
    id,
    name,
    client: name,
    scopes: [
      'context',
      'notes.read',
      'notes.write',
      'tree',
      'workspace',
      'browser',
      'browser.reader',
    ],
    spaces: 'all',
    sites: {},
    scripts: [],
    mode: 'unsupervised',
    asks: {},
    always: {},
    programs: [],
    limits: { tabs: 4, calls: 600, navigations: 60 },
    created: 0,
  }
}

export class FakeCrate implements Source {
  /** What the crate holds. */
  readonly overview: Overview = {
    agents: [],
    tabs: [],
    approvals: [],
    stopped: false,
    paused: [],
    halted: [],
    connected: [],
  }

  /** Every call the UI made, in order. */
  readonly asked: { command: string; args: unknown[] }[] = []

  /** The audit log, one day of it. */
  readonly lines: Record<string, unknown>[] = []

  /** Which tabs are being watched. */
  watching: string[] = []

  /** What the shell was last told. */
  told: { key: string | null; words: ShellWords } | null = null

  /** Whether this window holds the agents' pages, and whether it was hidden. */
  holding = true
  hidden = false

  private hearing: ((event: AgentEvent) => void) | null = null
  private framing = new Set<(frame: Frame) => void>()
  private next = 1

  /** Where the news goes: the UI's `hear`. */
  listen(hear: (event: AgentEvent) => void): void {
    this.hearing = hear
  }

  /** News, said. */
  emit(event: AgentEvent): void {
    this.hearing?.(event)
  }

  // ---- scripted: what an agent does --------------------------------------------------

  /** An agent connects. */
  connect(id: string, name: string): Grant {
    const grant = this.overview.agents.find((one) => one.id === id) ?? grantFor(id, name)
    if (!this.overview.agents.includes(grant)) this.overview.agents.push(grant)
    if (!this.overview.connected.includes(id)) this.overview.connected.push(id)
    this.emit({ kind: 'connected', agents: [...this.overview.connected] })
    return grant
  }

  /** An agent opens a tab of its own. */
  open(agent: string, url: string, title = ''): AgentTab {
    const tab: AgentTab = {
      id: `a${String(this.next++)}`,
      url,
      title,
      loading: false,
      store: 'reader',
      parked: false,
    }
    this.overview.tabs.push([agent, tab])
    this.emit({ kind: 'tab', agent, id: tab.id, url, title })
    return tab
  }

  /** An agent calls a verb on a tab. */
  act(agent: string, tab: string, verb: string, args: Record<string, unknown> = {}): void {
    this.lines.push({ at: Date.now(), agent, verb, tab, args, status: 'ok', ms: 20 })
    this.emit({ kind: 'acting', agent, tab, verb })
  }

  /** An agent's call needs asking. */
  ask(agent: string, category: Category, summary: string, site?: string, tab?: string): Approval {
    const grant = this.overview.agents.find((one) => one.id === agent)
    const approval: Approval = {
      id: `q${String(this.next++)}`,
      agent,
      name: grant?.name ?? agent,
      category,
      summary,
      ...(site === undefined ? {} : { site }),
      ...(tab === undefined ? {} : { tab }),
      asked: Date.now(),
      answer: 'pending',
    }
    this.overview.approvals.push(approval)
    if (category === 'takeover' && tab !== undefined) this.paused(agent, tab, 'takeover')
    this.emit({ kind: 'asked', approval })
    return approval
  }

  /** A client asking to become an agent (9.1). */
  pair(client: string): Approval {
    return this.ask('', 'pairing', client)
  }

  /** The reader pressed or typed in a tab an agent acts in. */
  readerTook(agent: string, tab: string): void {
    this.paused(agent, tab, 'reader')
  }

  /** A picture of a tab, sent to whoever watches. */
  frame(tab: string, jpeg: string): void {
    if (!this.watching.includes(tab)) return
    for (const on of this.framing) on({ tab, jpeg })
  }

  // ---- the Source: what the UI asks ------------------------------------------------

  state(): Promise<Overview> {
    this.asked.push({ command: 'state', args: [] })
    return Promise.resolve(structuredClone(this.overview))
  }

  stop(agent?: string): Promise<boolean> {
    this.asked.push({ command: 'stop', args: [agent] })
    if (agent !== undefined) {
      if (!this.overview.halted.includes(agent)) this.overview.halted.push(agent)
      this.emit({ kind: 'paused', agent, by: 'stop' })
      return Promise.resolve(false)
    }

    const again = this.overview.stopped
    this.overview.stopped = true
    if (again) {
      for (const [agent, tab] of this.overview.tabs)
        this.emit({ kind: 'closed', agent, id: tab.id })
      this.overview.tabs = []
    }
    this.emit({ kind: 'stopped', closed: again })
    return Promise.resolve(again)
  }

  resume(agent?: string, tab?: string): Promise<void> {
    this.asked.push({ command: 'resume', args: [agent, tab] })
    if (agent === undefined && tab === undefined) {
      this.overview.stopped = false
      this.overview.halted = []
      this.overview.paused = []
      this.emit({ kind: 'resumed', agent: '' })
      return Promise.resolve()
    }

    this.overview.paused = this.overview.paused.filter(
      ([one, on]) => !(one === agent && (tab === undefined || on === tab)),
    )
    if (tab === undefined)
      this.overview.halted = this.overview.halted.filter((one) => one !== agent)
    this.emit({ kind: 'resumed', agent: agent ?? '', ...(tab === undefined ? {} : { tab }) })
    return Promise.resolve()
  }

  pause(agent: string, tab: string, stop: boolean): Promise<void> {
    this.asked.push({ command: 'pause', args: [agent, tab, stop] })
    this.paused(agent, tab, stop ? 'stop' : 'reader')
    return Promise.resolve()
  }

  answer(id: string, allow: boolean, always: boolean): Promise<Approval> {
    this.asked.push({ command: 'answer', args: [id, allow, always] })
    const approval = this.overview.approvals.find((one) => one.id === id)
    if (!approval) return Promise.reject(new Error('there is no such question'))

    approval.answer = allow ? (approval.category === 'takeover' ? 'done' : 'allowed') : 'denied'
    this.overview.approvals = this.overview.approvals.filter((one) => one.id !== id)
    this.emit({ kind: 'answered', approval: { ...approval } })
    if (approval.category === 'takeover' && approval.tab !== undefined) {
      void this.resume(approval.agent, approval.tab)
    }
    return Promise.resolve({ ...approval })
  }

  log(day: string): Promise<unknown[]> {
    this.asked.push({ command: 'log', args: [day] })
    return Promise.resolve([...this.lines])
  }

  adopt(agentTab: string, tab: string): Promise<void> {
    this.asked.push({ command: 'adopt', args: [agentTab, tab] })
    const held = this.overview.tabs.find(([, one]) => one.id === agentTab)
    if (!held) return Promise.reject(new Error('there is no such agent tab'))

    this.overview.tabs = this.overview.tabs.filter(([, one]) => one.id !== agentTab)
    this.emit({ kind: 'closed', agent: held[0], id: agentTab })
    return Promise.resolve()
  }

  watch(tabs: string[]): Promise<void> {
    this.asked.push({ command: 'watch', args: [tabs] })
    this.watching = [...tabs]
    return Promise.resolve()
  }

  frames(on: (frame: Frame) => void): Promise<() => void> {
    this.framing.add(on)
    return Promise.resolve(() => this.framing.delete(on))
  }

  shell(key: string | null, words: ShellWords): Promise<void> {
    this.asked.push({ command: 'shell', args: [key] })
    this.told = { key, words }
    return Promise.resolve()
  }

  holds(): Promise<boolean> {
    return Promise.resolve(this.holding)
  }

  hide(): Promise<boolean> {
    this.asked.push({ command: 'hide', args: [] })
    this.hidden = this.holding && this.overview.connected.length > 0
    return Promise.resolve(this.hidden)
  }

  private paused(agent: string, tab: string, by: 'reader' | 'takeover' | 'stop'): void {
    if (!this.overview.paused.some(([one, on]) => one === agent && on === tab)) {
      this.overview.paused.push([agent, tab])
    }
    this.emit({ kind: 'paused', agent, tab, by })
  }
}
