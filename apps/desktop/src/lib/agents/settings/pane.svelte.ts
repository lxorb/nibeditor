/** What Settings > Agents shows, kept while the pane is open: the grants, the log read
 *  so far, the program a client runs, and a token made a moment ago.
 *
 *  **A change is written to what the crate holds, not to what the pane read.** The crate
 *  takes the whole list back (`agents_write`), and a grant the list leaves out is gone,
 *  token and all. So a client that paired while the pane was open would be removed by
 *  the next switch if the pane wrote its own copy. Every change is therefore read,
 *  applied to the one grant it is about, and written, one after another in the order
 *  they were made; the switch itself moves at once, and moves back with the reason if
 *  the write fails.
 *
 *  **The log is read a day at a time**, newest first (`agents_log_days`, then
 *  `agents_log` per day): a month of an unsupervised agent is tens of thousands of lines,
 *  and the list only needs to know when each agent last did something, which the newest
 *  days usually answer. Reading goes on until every agent's last call is found or the
 *  days run out; the log of one agent reads further on request. */

import { SvelteMap } from 'svelte/reactivity'
import { message } from '../../i18n.svelte'
import type { Grant, Minted } from '../verbs'
import type { AgentsCrate, Heard } from './crate'
import { type Call, readCall } from '../ui/session'
import { lastActive } from './sessions'

export class AgentsPane {
  grants = $state<Grant[]>([])
  ready = $state(false)
  error = $state<string | null>(null)
  program = $state<string | null>(null)
  /** Every call read so far, oldest first. */
  calls = $state.raw<Call[]>([])
  /** When each agent last called, by id: from the log, and from what the crate says. */
  readonly last = new SvelteMap<string, number>()
  /** Whether the log has days not read yet. */
  earlier = $state(false)
  /** An agent made by hand a moment ago, with its token, which is said this once. */
  minted = $state<Minted | null>(null)

  private unread: string[] = []
  private writing: Promise<unknown> = Promise.resolve()
  private pending = 0
  private stop: (() => void) | null = null
  private closed = false

  constructor(private readonly crate: AgentsCrate) {}

  async open(): Promise<void> {
    try {
      const [grants, days, program] = await Promise.all([
        this.crate.read(),
        this.crate.days(),
        this.crate.program(),
      ])
      this.grants = grants
      this.program = program
      this.unread = days
      this.earlier = days.length > 0
      this.ready = true

      const stop = await this.crate.hear((heard) => {
        this.heard(heard)
      })
      if (this.closed) stop()
      else this.stop = stop

      while (this.earlier && this.grants.some((one) => !this.last.has(one.id))) {
        await this.readEarlier()
      }
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }

  close(): void {
    this.closed = true
    this.stop?.()
    this.stop = null
  }

  /** The next day of the log back. */
  async readEarlier(): Promise<void> {
    const day = this.unread.shift()
    this.earlier = this.unread.length > 0
    if (day === undefined) return

    try {
      const read = (await this.crate.day(day)).flatMap((one, seq) => readCall(one, seq) ?? [])
      this.calls = [...read, ...this.calls]
      // An earlier day never moves a later answer back.
      for (const [agent, at] of lastActive(read)) {
        if (at > (this.last.get(agent) ?? 0)) this.last.set(agent, at)
      }
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }

  /** News from the crate: an agent acting is active now, and a question answered may
   *  have made an agent (a pairing) or changed one ("Always on this site"). */
  private heard(heard: Heard): void {
    if (heard.kind === 'acting' && heard.agent !== null) {
      this.last.set(heard.agent, Date.now())
    }
    if (heard.kind === 'answered' && this.pending === 0) void this.reload()
  }

  private async reload(): Promise<void> {
    try {
      this.grants = await this.crate.read()
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }

  /** One grant changed: on screen at once, then in the crate, in order. */
  change(id: string, edit: (grant: Grant) => Grant): Promise<void> {
    this.error = null
    this.grants = this.grants.map((one) => (one.id === id ? edit(one) : one))
    return this.write((grants) => grants.map((one) => (one.id === id ? edit(one) : one)))
  }

  /** An agent removed, and its token worth nothing from now on. */
  remove(id: string): Promise<void> {
    this.error = null
    this.grants = this.grants.filter((one) => one.id !== id)
    return this.write((grants) => grants.filter((one) => one.id !== id))
  }

  /** The list as the crate holds it now, changed and written. A later change waiting
   *  behind this one is already on screen, so the pane takes the crate's answer only
   *  when nothing is waiting: it would otherwise flick back for the moment between. */
  private write(change: (grants: Grant[]) => Grant[]): Promise<void> {
    this.pending += 1
    const done = this.writing.then(async () => {
      try {
        const written = await this.crate.write(change(await this.crate.read()))
        if (this.pending === 1) this.grants = written
      } catch (error) {
        this.error = message(error, 'that did not work')
        await this.reload()
      } finally {
        this.pending -= 1
      }
    })
    this.writing = done
    return done
  }

  /** A grant made by hand for a client somewhere else, with its token. */
  async mint(name: string): Promise<void> {
    this.error = null
    try {
      const minted = await this.crate.mint(name)
      this.minted = minted
      this.grants = [...this.grants.filter((one) => one.id !== minted.grant.id), minted.grant]
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }

  /** One agent's calls out of the log. */
  async clearLog(id: string): Promise<void> {
    this.error = null
    try {
      await this.crate.clear(id)
      this.calls = this.calls.filter((one) => one.agent !== id)
      this.last.delete(id)
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }
}
