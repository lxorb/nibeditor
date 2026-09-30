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
}

const unasked = (): Plan => ({
  state: 'unknown',
  program: null,
  plan: null,
  account: null,
  limit: null,
})

class Plans {
  local = $state<Record<LocalKind, Plan>>({ 'claude-code': unasked(), codex: unasked() })
  /** Who is signed in to ChatGPT here, `null` for nobody, `undefined` until asked. */
  chatgpt = $state<{ email: string | null } | null | undefined>(undefined)
  /** Where the ChatGPT plan stood when a request last heard, in this run. */
  chatgptLimit = $state<Limit | null>(null)

  private watching = new Set<string>()

  /** Asks a program whether it is installed and signed in. */
  async check(kind: LocalKind): Promise<Plan> {
    const said = await invoke<unknown>('ai_cli_status', { tool: kind }).catch(() => undefined)
    const standing = said === undefined ? null : standingOf(kind, saidIn(said))
    const now: Plan = {
      ...(standing ?? { state: 'unknown', program: null, plan: null, account: null }),
      limit: this.local[kind].limit,
    }
    this.local[kind] = now
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

  /** Asks again every few seconds until the program says it is signed in. */
  watch(kind: LocalKind): void {
    if (this.watching.has(kind)) return
    this.watching.add(kind)
    const started = Date.now()

    const again = async () => {
      await waited(EVERY)
      const now = await this.check(kind)
      if (now.state === 'in' || Date.now() - started > FOR) this.watching.delete(kind)
      else void again()
    }
    void again()
  }

  /** What a question heard about the plan's limit. */
  heard(kind: LocalKind, limit: Limit): void {
    this.local[kind].limit = limit
  }

  /** A question found the program signed out. */
  signedOut(kind: LocalKind): void {
    this.local[kind].state = 'out'
  }
}

export const plans = new Plans()
