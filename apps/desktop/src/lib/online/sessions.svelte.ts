/** The sessions on the account's online machine, for Settings' list of them
 *  (docs/online-terminal.md 4.10): what the account keeps and what the machine has,
 *  every one whether a tab is open on it or not (`GET /v2/online/terms`).
 *
 *  Asked when the pane opens, and again whenever the account's hub says a session was
 *  made or ended on any device, or a shell in one ended (`terms`), so the list follows
 *  what happens elsewhere without polling. End takes the row away at once and asks the
 *  account again after, which puts it back where the end was refused. Fetched with the
 *  Settings pane, never at launch. */

import { hub } from '../sync2/hub.svelte'
import { endSession, type Listed, listed } from './calls'

class OnlineSessions {
  /** What the account last said, or null before it has. */
  list = $state<Listed[] | null>(null)
  /** Whether the last question went unanswered. */
  failed = $state(false)

  async refresh(): Promise<void> {
    try {
      this.list = await listed()
      this.failed = false
    } catch {
      this.failed = true
    }
  }

  /** Asked again whenever the hub says the sessions changed; answers what stops it. */
  watch(): () => void {
    return hub.on('terms', () => {
      void this.refresh()
    })
  }

  /** A session ended, its program with it: gone from the list now, and asked about after. */
  async end(one: Listed): Promise<void> {
    if (this.list) this.list = this.list.filter((other) => other.session !== one.session)
    await endSession(one.term ?? one.session).catch(() => undefined)
    await this.refresh()
  }
}

export const sessions = new OnlineSessions()
