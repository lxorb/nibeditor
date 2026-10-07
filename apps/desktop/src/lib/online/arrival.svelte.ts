/** An online terminal on its way to its session's screen: what it waits on, said over
 *  the screen while it does, or why it stopped, with Try again under it - or New online
 *  terminal, where the session is no more. See OnlineStatus.svelte.
 *
 *  Never an empty pane: from the moment the tab opens until the session's own screen is
 *  drawn there is a line saying what is happening - the socket connecting, the machine
 *  starting, the session's screen being put back after a boot. A machine that went back
 *  to sleep while it was starting, a refusal, or nothing heard for `PATIENCE` is the
 *  end of the wait, and says why. Emil, 2026-10-05: a start that failed on the host left
 *  a terminal open with nothing in it, forever.
 *
 *  Pure of the page: the clock is the world's, so the tests drive it with a fake. */

import type { DownReason } from '@nib/online/wire'
import { t } from '../i18n.svelte'
import type { Machine } from '../terminal/source'
import { refusalWords } from './words'

/** How long a wait may go without a word from the socket before it is given up on; and
 *  once the machine said it is starting, how long its start may take - a restart after
 *  its link died saves and boots it again, each step bounded on the server, and the home
 *  is put back from its backup after that. */
export const PATIENCE = 45_000
export const BOOT_PATIENCE = 3 * 60_000

/** What a terminal is waiting on. */
type Waiting = 'connecting' | 'starting' | 'restoring'

/** What is said over the screen. A failure that is `gone` is a session that is no more,
 *  which Try again cannot bring back: a new online terminal is offered instead. */
export type Status = { waiting: Waiting } | { failed: string; gone?: true }

interface Clock {
  /** Calls `run` after `ms`; answers what cancels it. */
  after(ms: number, run: () => void): () => void
}

const timers: Clock = {
  after: (ms, run) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  },
}

/** The one line a status is said in. */
export function statusLine(status: Status): string {
  if ('failed' in status) return status.failed
  switch (status.waiting) {
    case 'starting':
      return t('Starting machine…')
    case 'restoring':
      return t('Restoring…')
    case 'connecting':
      return t('Connecting…')
  }
}

/** Why a machine that was starting went back to sleep, in words. */
function downWords(reason: DownReason | undefined): string {
  const refused =
    reason === 'allowance' || reason === 'budget' || reason === 'off' || reason === 'flag'
  return (refused ? refusalWords(reason) : null) ?? t('Your machine could not start')
}

export class Arrival {
  /** Why the wait ended without the screen, in words; null while it goes on. */
  failure = $state<string | null>(null)
  /** Whether it ended because the session is no more. */
  gone = $state(false)
  /** Whether the socket is open. */
  private linked = $state(false)
  /** The machine's state, as the socket last said it. */
  private state = $state<Machine | null>(null)
  /** Whether the machine was seen starting since this wait began: a session still
   *  without its screen after that is being put back. */
  private booted = $state(false)
  /** Whether the session's screen is drawn, after which there is nothing to wait on
   *  until the socket drops. */
  private here = false
  private giveUp: (() => void) | null = null

  constructor(private readonly clock: Clock = timers) {}

  get status(): Status {
    if (this.failure !== null)
      return this.gone ? { failed: this.failure, gone: true } : { failed: this.failure }
    if (this.linked && this.state === 'starting') return { waiting: 'starting' }
    if (this.linked && this.booted) return { waiting: 'restoring' }
    return { waiting: 'connecting' }
  }

  /** A new wait: the tab opening, Try again, Reconnect. */
  begin(): void {
    this.failure = null
    this.gone = false
    this.linked = false
    this.state = null
    this.booted = false
    this.here = false
    this.wait()
  }

  /** The socket opened or dropped. A drop after the screen was here waits again. */
  linkedNow(open: boolean): void {
    this.linked = open
    if (!open) this.here = false
    this.heard()
  }

  /** The machine's state, and why it is down. Asleep again after starting is a boot
   *  that failed; the socket stays, and the screen arriving after all still ends it. */
  machine(state: Machine, reason?: DownReason): void {
    this.state = state
    if (state === 'starting') this.booted = true
    else if (state === 'asleep' && this.booted && !this.here) {
      this.booted = false
      this.fail(downWords(reason))
      return
    }
    this.heard()
  }

  /** A terminal that was live, whose machine is starting again (its link to the machine
   *  died): waiting once more, so a frozen screen never looks live. */
  lost(): void {
    this.here = false
    this.booted = false
    this.failure = null
    this.gone = false
    this.wait()
  }

  /** The wait ends without the screen, and why; `gone` where the session is no more. */
  fail(words: string, gone = false): void {
    this.stop()
    this.failure = words || (refusalWords('other') ?? '')
    this.gone = gone
  }

  /** Something came from the socket, which gives it `PATIENCE` again. */
  heard(): void {
    if (!this.here && this.failure === null) this.wait()
  }

  /** The session's screen is drawn: nothing to wait on. */
  arrived(): void {
    this.here = true
    this.booted = false
    this.stop()
    this.failure = null
    this.gone = false
  }

  /** The tab or its source is gone. */
  stop(): void {
    this.giveUp?.()
    this.giveUp = null
  }

  private wait(): void {
    this.stop()
    const patience = this.booted ? BOOT_PATIENCE : PATIENCE
    this.giveUp = this.clock.after(patience, () => {
      this.giveUp = null
      this.fail(refusalWords('other') ?? '')
    })
  }
}
