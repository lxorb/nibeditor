/** What of a conversation goes back with the next question: the Ask panel's and the
 *  quick question's, which are the two that have one. */

import type { Message } from './providers'
import { tokensIn, uncited } from './retrieve'

/** One thing said, as a conversation keeps it. `you` and `model` rather than the
 *  wire's words, because it is what a panel draws. */
export interface Said {
  role: 'you' | 'model'
  text: string
}

/** How much of the conversation goes back with the next question, oldest dropped
 *  first, so the tenth question does not cost ten times the first. */
const HISTORY_BUDGET = 2000

/** The turns as the wire wants them, newest last, within a budget. Only whole
 *  exchanges: a question that was never answered is not sent again, and an answer's
 *  citations are taken out, since the passages they counted are not being sent. */
export function history(turns: readonly Said[], budget = HISTORY_BUDGET): Message[] {
  const out: Message[] = []
  let spent = 0

  for (let at = turns.length - 1; at > 0; at--) {
    const answer = turns[at]
    const question = turns[at - 1]
    if (answer?.role !== 'model' || question?.role !== 'you') continue

    const said = uncited(answer.text)
    const cost = tokensIn(question.text) + tokensIn(said)
    if (spent + cost > budget) break

    spent += cost
    out.unshift({ role: 'user', content: question.text }, { role: 'assistant', content: said })
    at--
  }

  return out
}
