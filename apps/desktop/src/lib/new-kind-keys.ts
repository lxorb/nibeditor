/** Which kind a letter picks where the kinds are offered, and whether a letter pressed
 *  now is theirs at all.
 *
 *  Emil, issue #213: *"each one should have a shortcut button there so you don't have to
 *  manually click it [...] but of course these shortcuts should only work if you first
 *  click out of the url input in the top that should already be selected after pressing
 *  ctrl + T"*. So a letter is the view's only while the keyboard is nowhere in
 *  particular - the field let go of it, a press landed on the pane's own ground - or on
 *  something of the pane's own that takes no words: a card, a button of the bar. Never in
 *  a field, a note or a terminal, and never in another region of the window, where a
 *  letter spells a name in a list. See NewHere.svelte.
 *
 *  Pure but for `takesWords`, which asks the element what it is. */

import { chorded, type Keystroke } from './keys'
import { takesWords } from './typing-pointer'

/** The kind a press picks: its letter, bare or with Shift, which asks a kind for its
 *  other forms. Null for anything else - a chord on its way to the window, a key held
 *  down repeating, a letter an input method is still composing. */
export function kindOfLetter<Kind extends { letter: string }>(
  kinds: readonly Kind[],
  event: Keystroke & { repeat?: boolean },
): Kind | null {
  if (chorded(event) || event.repeat || event.isComposing || event.key.length !== 1) return null

  const letter = event.key.toLowerCase()
  return kinds.find((one) => one.letter === letter) ?? null
}

/** Whether the keyboard is somewhere a letter may pick a kind: nowhere at all, or inside
 *  the pane the kinds are offered in, on something that takes no words. */
export function letterIsOurs(at: Element | null, pane: Element | null): boolean {
  if (at === null || at === document.body || at === document.documentElement) return true
  if (takesWords(at)) return false

  return pane?.contains(at) ?? false
}
