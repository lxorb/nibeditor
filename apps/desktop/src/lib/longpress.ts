/** A finger held still on something, which is what a right click is on a
 *  touch screen.
 *
 *  Used as a Svelte action, so a row or a space says what its menu is and this
 *  decides when to ask for it:
 *
 *      <button use:longPress={(event) => menu.show(event, noteMenu(entry))}>
 *
 *  The menu wants a `MouseEvent` to place itself by, so the touch is handed
 *  over as one at the same point. */

/** Long enough not to fire on a tap, short enough not to feel like a wait. */
const HOLD = 500

/** How far the finger may stray before it counts as a drag instead. */
const SLOP = 10

export function longPress(node: HTMLElement, show: (event: MouseEvent) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let startX = 0
  let startY = 0
  /** Whether the press being held has already opened its menu. */
  let fired = false

  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }

  /** The finger lifting after a press is the end of the press, not a tap:
   *  left to itself the browser would follow it with a click, and the click
   *  would land on the menu's scrim and close what the press just opened. */
  const onEnd = (event: TouchEvent) => {
    cancel()
    if (!fired) return

    fired = false
    if (event.cancelable) event.preventDefault()
  }

  const onStart = (event: TouchEvent) => {
    // Two fingers down is a pinch or a scroll, not a press.
    const touch = event.touches.length === 1 ? event.touches[0] : undefined
    if (!touch) {
      cancel()
      return
    }

    startX = touch.clientX
    startY = touch.clientY
    fired = false

    timer = setTimeout(() => {
      timer = undefined
      fired = true

      // The row is being pressed, not tapped: the browser should not also
      // select the text under it or fire a click afterwards.
      node.dispatchEvent(new CustomEvent('longpress', { bubbles: true }))
      show(
        new MouseEvent('contextmenu', {
          clientX: startX,
          clientY: startY,
          bubbles: true,
          cancelable: true,
        }),
      )
    }, HOLD)
  }

  const onMove = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (!touch) return

    // Moving means dragging or scrolling, and either outranks the menu.
    if (Math.abs(touch.clientX - startX) > SLOP || Math.abs(touch.clientY - startY) > SLOP) {
      cancel()
    }
  }

  node.addEventListener('touchstart', onStart, { passive: true })
  node.addEventListener('touchmove', onMove, { passive: true })
  node.addEventListener('touchend', onEnd)
  node.addEventListener('touchcancel', cancel)
  // Something nearer the finger has taken the press over, and it is the same finger
  // on the same thing: a tab that has started to be dragged along its strip, which a
  // finger can do inside the slop this allows. Said by whoever took it, so the menu
  // stands down rather than opening over a tab that is already being carried; see
  // Tabs.svelte.
  node.addEventListener('nib-took-over', cancel)

  return {
    update(next: (event: MouseEvent) => void) {
      show = next
    },
    destroy() {
      cancel()
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
      node.removeEventListener('touchend', onEnd)
      node.removeEventListener('touchcancel', cancel)
      node.removeEventListener('nib-took-over', cancel)
    },
  }
}
