/** Whether sound can be turned into words at all, and by whose provider - both asked
 *  without waking the store that knows, or the road that would do it.
 *
 *  A leaf, and it exists for one measured reason. Two rows ask this question the moment a
 *  menu opens - Transcribe on a recording, and Meeting notes - and the modules that build
 *  those rows are in front of the first paint, where the providers deliberately are not:
 *  the store, what a provider is and where a key lives are some fifteen kilobytes for a
 *  window that has not been asked anything yet. One import of `ai.transcriber` put all
 *  three there. See test/weight.test.ts, which is what said so.
 *
 *  `canTranscribe` is here for the same reason and it is the bigger half: the editor's
 *  own menu asks it for every caret, and asking it of recorder/transcribe.ts was reading
 *  that whole module - the two roads, the multipart request, the model a server turns out
 *  to answer under - fourteen kilobytes in front of every first paint, for a row most
 *  readers never press. The predicate needs the account's token and this file's own
 *  answer and nothing else, so it sits with the answer.
 *
 *  So the store says what it can do as it arrives, and until it has, the answer is "no
 *  provider of your own". That is the right answer at that moment rather than a guess:
 *  the store is fetched at the last turn of the launch, before any hand could have opened
 *  a menu, and a reader with no provider - which is most of them - is answered by the
 *  account either way. See `warmDoors` in surfaces.svelte.ts.
 *
 *  Nothing here holds a provider. It holds the one question, and the store answers it. */

import { account } from '../account.svelte'
import type { Provider } from './providers'

/** What the store answers, once the store is there to answer. */
let asking: (() => Provider | null) | null = null

/** Said by the store as it loads, and by nothing else. */
export function transcribersAre(answer: () => Provider | null): void {
  asking = answer
}

/** The provider that would be asked to hear a recording, or null for a reader who has
 *  set none up - and for the moment before the store has arrived. */
export function transcriberNow(): Provider | null {
  return asking?.() ?? null
}

/** Whether there is anything at all to ask: a provider of the reader's own, or an
 *  account. Recording needs neither; transcribing needs one of them. Asked before a row
 *  is offered rather than after it is pressed. */
export function canTranscribe(): boolean {
  return !!transcriberNow() || !!account.accountToken
}
