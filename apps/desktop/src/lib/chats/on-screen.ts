/** Which chats are on screen in this window (docs/chats.md 4.11): a chat tab says so while
 *  it is drawn, nothing pings for it while the window is in front, and what was showing
 *  for it goes. Apart from notices.ts, which starts the notifications, so a tab saying it
 *  is here starts nothing. */

import { unshow } from '../notify'

const looking = new Map<string, number>()

/** A chat on screen, as often as a surface says so. Answers how to say it is not. */
export function onScreen(chat: string): () => void {
  looking.set(chat, (looking.get(chat) ?? 0) + 1)
  unshow(chat)
  return () => {
    const left = (looking.get(chat) ?? 1) - 1
    if (left > 0) looking.set(chat, left)
    else looking.delete(chat)
  }
}

/** Whether a chat is on screen in this window, and the window in front of the reader. */
export function inFront(chat: string): boolean {
  return (
    (looking.get(chat) ?? 0) > 0 && document.visibilityState === 'visible' && document.hasFocus()
  )
}
