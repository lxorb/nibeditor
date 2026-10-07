/** The one bubble a chat shows what something is in: who reacted, when a message was
 *  written, what it said before it was edited (docs/chats.md 3, #7 and #31). The app's
 *  bubble (`.nib-bubble`), never a `title`, which arrives late, in the system's font,
 *  and never under a finger.
 *
 *  `tip` is an action: a pointer resting on the element for a moment shows the words
 *  over it, leaving takes them away, and a long press on a phone shows them too. One
 *  bubble for the whole chat, drawn by Tip.svelte. */

import type { Box } from './place'

/** How long a pointer rests before the bubble comes: long enough not to flicker as it
 *  crosses a row, short enough to feel like an answer. */
const REST = 350

class Tips {
  shown = $state<{ text: string; at: Box } | null>(null)
}

export const tips = new Tips()

export function tip(node: HTMLElement, words: () => string) {
  let waiting: ReturnType<typeof setTimeout> | undefined
  let say = words

  const show = () => {
    const text = say()
    if (!text) return
    const box = node.getBoundingClientRect()
    tips.shown = {
      text,
      at: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
    }
  }
  const enter = (event: PointerEvent) => {
    clearTimeout(waiting)
    waiting = setTimeout(show, event.pointerType === 'mouse' ? REST : REST * 1.5)
  }
  // Out of the frame it was asked in: a focus leaves as its element is taken out of
  // the page, which is in the middle of a redraw, where no state may change.
  const leave = () => {
    clearTimeout(waiting)
    if (tips.shown) queueMicrotask(() => (tips.shown = null))
  }

  node.addEventListener('pointerenter', enter)
  node.addEventListener('pointerleave', leave)
  node.addEventListener('pointerdown', leave)
  node.addEventListener('focusin', show)
  node.addEventListener('focusout', leave)

  return {
    update(next: () => string) {
      say = next
    },
    destroy() {
      leave()
      node.removeEventListener('pointerenter', enter)
      node.removeEventListener('pointerleave', leave)
      node.removeEventListener('pointerdown', leave)
      node.removeEventListener('focusin', show)
      node.removeEventListener('focusout', leave)
    },
  }
}
