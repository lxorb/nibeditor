/** Which person's card is up, and where: a press on anybody's face or name opens it
 *  beside what was pressed, Slack's card. The card itself is fetched and put on the page
 *  the first time one is asked for; nobody who never presses a face downloads it. See
 *  ProfileCard.svelte and docs/chats.md 4.15. */

import { mount } from 'svelte'

/** Where the press was: the box of what was pressed, in the window's pixels. */
interface Anchor {
  left: number
  top: number
  right: number
  bottom: number
}

class Card {
  /** The person, the space the press was in (for what they are called there), and
   *  where; null while no card is up. */
  shown = $state<{ id: string; space: string | null; at: Anchor } | null>(null)

  close(): void {
    this.shown = null
  }
}

export const card = new Card()

let mounted = false

/** Opens somebody's card beside the element that was pressed. */
export function showProfile(id: string, from: Element, space: string | null = null): void {
  const box = from.getBoundingClientRect()
  card.shown = {
    id,
    space,
    at: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
  }
  // Never in the glasses' plugin, which shows nobody's face to press.
  if (mounted || __EVEN_PLUGIN__) return
  mounted = true
  void import('./ProfileCard.svelte').then((one) => mount(one.default, { target: document.body }))
}
