/** How a run of Claude Code or Codex that did not answer is said, in nib's words.
 *
 *  The plan is the reader's own, so its limit is said as theirs, with when it resets
 *  where the program said; a program that is not signed in is told apart from one that
 *  failed, because the one thing to do about it is different; and anything else is the
 *  program's own sentence, the way a provider's refusal is the provider's. */

import { t } from '../../i18n.svelte'
import { when } from '../../when'
import type { Heard, Limit } from './heard'

/** How the crate says a run ended; see `Ended` in src-tauri/src/ai_cli/run.rs. */
export interface Ending {
  code: number | null
  timedOut: boolean
  stopped: boolean
  err: string
}

/** What a plan at its limit is called: "Your Claude plan is at its limit until 15:05." */
export function limitSentence(plan: string, limit: Limit): string {
  if (limit.until !== null) {
    return t('Your {plan} plan is at its limit until {time}.', {
      plan,
      time: when(limit.until, 'medium'),
    })
  }
  if (limit.untilWords) {
    return t('Your {plan} plan is at its limit until {time}.', { plan, time: limit.untilWords })
  }
  return t('Your {plan} plan is at its limit for now.', { plan })
}

/** The sentence a run ends on, or null for one that answered. `name` is the program's
 *  name and `plan` the plan's: Claude Code spends a Claude plan, Codex a ChatGPT one. */
export function troubleOf(
  name: string,
  plan: string,
  heard: Heard,
  ended: Ending,
  answered: boolean,
): string | null {
  if (heard.limit?.state === 'reached') return limitSentence(plan, heard.limit)
  if (heard.signedOut) return t('Sign in to {name} first.', { name })
  if (ended.timedOut) return t('{name} took too long to answer.', { name })
  if (heard.trouble) return heard.trouble
  if (ended.code === 0 || (ended.code === null && answered)) return null

  if (/unknown option|unexpected argument|unrecognized/i.test(ended.err)) {
    return t('{name} is out of date. Update it and try again.', { name })
  }
  const last = ended.err
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  return last ?? (answered ? null : t('The model did not answer.'))
}
