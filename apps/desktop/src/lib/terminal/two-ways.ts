/** A key that is both the app's and the shell's, asked about once.
 *
 *  Emil, issue #213: *"when pressing a shortcut in a terminal like interface or anywhere
 *  where it could have mulitple meanings then there should be a quick modal asking you
 *  which of the two should be used from now on (or you can tick always ask)"*. In a
 *  terminal those are Ctrl+T and Ctrl+N - a new tab and the scratchpad, and the shell's
 *  swapped letters and next line of history - so the first press of either in a terminal
 *  asks which, in the app's one small question (see prompt.svelte.ts), and the answer is
 *  every terminal's from then on unless "Always ask" was ticked. Settings, General,
 *  Terminal shows the answer and takes it back; see preferences.ts.
 *
 *  Which keys are both is keys.ts's (`TWO_WAYS`); where the answer is kept is
 *  shells.svelte.ts's. Fetched with the first question: most people never get one. */

import { key, t } from '../i18n.svelte'
import { prompt } from '../prompt.svelte'
import { shortcuts } from '../shortcuts.svelte'
import { BY_ID } from '../shortcuts/registry'
import { shells, type Way } from './shells.svelte'

/** The name a key that is both goes by: the key as this platform writes it, the way
 *  the question and its row in Settings both say it. */
export function bothName(command: string): string {
  return t('{key} in a terminal', { key: shortcuts.hint(command) ?? '' })
}

/** Asks which the key a command is on means in a terminal, and keeps the answer unless
 *  asked not to. The app's command is the answer that stands, as the key means it
 *  everywhere else. Null when the question was put away, which means nothing at all. */
export async function whichWay(command: string): Promise<Way | null> {
  const answer = await prompt.chooseTicking({
    title: bothName(command),
    options: [
      { id: 'shell', label: key('Terminal') },
      { id: 'app', label: BY_ID.get(command)?.label() ?? command, primary: true },
    ],
    tick: t('Always ask'),
  })
  if (answer === null) return null

  const way: Way = answer.id === 'app' ? 'app' : 'shell'
  if (!answer.ticked) shells.setWay(command, way)
  return way
}
