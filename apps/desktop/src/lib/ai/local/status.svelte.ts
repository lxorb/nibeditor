/** Where each plan stands on this machine: Claude Code and Codex installed or not,
 *  signed in or not, and how close the plan is to its limit; and the ChatGPT plan's own
 *  sign-in.
 *
 *  Asked of the programs themselves and of the crate, never read off their files, and
 *  only when the AI pane is looked at or a sign-in is waited for - never at launch. The
 *  answers are kept for the run and not written down: a sign-in done in a terminal an
 *  hour ago is the program's news, and asking again is how nib hears it.
 *
 *  A sign-in happens somewhere else - a terminal tab running the program's own login, or
 *  the browser for ChatGPT - so after one starts, the answer is asked for again every few
 *  seconds until it changes or a few minutes pass, whether or not the pane is still open. */

import { invoke } from '../../tauri'
import { waited } from '../../timing'
import type { LocalKind } from '../providers'
import type { Limit } from './heard'
import { saidIn, type Standing, standingOf } from './standing'

/** How often a sign-in in progress is asked about, and for how long. */
const EVERY = 3000
const FOR = 5 * 60_000

interface Plan extends Standing {
  /** Where the plan stood when its program last said, in this run. */
  limit: Limit | null
  /** The account's home where it is a second sign-in, for the line that signs it in. */
  home: string | null
}

/** One account of a program on this machine: which program, and which account. */
export interface LocalAccount {
  id: string
  kind: LocalKind
}

const unasked = (): Plan => ({
  state: 'unknown',
  program: null,
  plan: null,
  account: null,
  limit: null,
  home: null,
})

class Plans {
  /** Where each account stands, by its id. */
  local = $state<Record<string, Plan>>({})
  /** Who is signed in to ChatGPT here, `null` for nobody, `undefined` until asked. */
  chatgpt = $state<{ email: string | null } | null | undefined>(undefined)
  /** Where the ChatGPT plan stood when a request last heard, in this run. */
  chatgptLimit = $state<Limit | null>(null)

  private watching = new Set<string>()

  /** Where an account stands, as last heard: not asked yet until it is. */
  of(id: string): Plan {
    return this.local[id] ?? unasked()
  }

  /** Asks a program whether it is installed and signed in, in the account's own home. */
  async check(account: LocalAccount): Promise<Plan> {
    // A crate that could not ask is a program that cannot be run from here, which the
    // row says the way it says one that is not installed.
    const said = await invoke<unknown>('ai_cli_status', {
      tool: account.kind,
      account: account.id,
    }).catch(() => null)
    const home =
      typeof said === 'object' &&
      said !== null &&
      typeof (said as { home?: unknown }).home === 'string'
        ? (said as { home: string }).home
        : null
    const now: Plan = {
      ...standingOf(account.kind, saidIn(said)),
      limit: this.of(account.id).limit,
      home,
    }
    this.local = { ...this.local, [account.id]: now }
    return now
  }

  /** Asks the crate who is signed in to ChatGPT here. */
  async checkChatgpt(): Promise<void> {
    const said = await invoke<unknown>('chatgpt_account').catch(() => null)
    this.chatgpt =
      typeof said === 'object' && said !== null
        ? {
            email:
              typeof (said as { email?: unknown }).email === 'string'
                ? (said as { email: string }).email
                : null,
          }
        : null
  }

  /** Asks again every few seconds until the program says the account is signed in. */
  watch(account: LocalAccount): void {
    if (this.watching.has(account.id)) return
    this.watching.add(account.id)
    const started = Date.now()

    const again = async () => {
      await waited(EVERY)
      const now = await this.check(account)
      if (now.state === 'in' || Date.now() - started > FOR) this.watching.delete(account.id)
      else void again()
    }
    void again()
  }

  /** What a question heard about the plan's limit. */
  heard(id: string, limit: Limit): void {
    this.local = { ...this.local, [id]: { ...this.of(id), limit } }
  }

  /** A question found the program signed out. */
  signedOut(id: string): void {
    this.local = { ...this.local, [id]: { ...this.of(id), state: 'out' } }
  }
}

// Pure: making it asks nothing yet. Said so the glasses' plugin, which asks no program,
// can leave it out where nothing reads it.
export const plans = /* @__PURE__ */ new Plans()
