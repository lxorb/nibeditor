/** A web tab's hole moving without changing size, and the screen's scale changing, heard
 *  as they happen.
 *
 *  A page is a native webview placed over the hole its pane leaves, and the hole's box is
 *  the one source of where the page goes: every change of it has to be said to the crate,
 *  or the page stays where the hole was. A resize observer hears the hole change size, and
 *  that is most of what a layout does to it - but not all of it. Emil, 2026-10-12 (#246):
 *  *"often they just freeze in a wrong sizing"*. The file list moved to the other side of
 *  the window moves the panes across without changing their width, and the language
 *  turned to one that reads the other way does the same; a resize observer says nothing
 *  of either, and the page stayed where the panes had been, over the list.
 *
 *  Chrome never meets this - its page is a view in the same layout pass as everything
 *  round it - and neither does anything drawn in the window's own document. What the web
 *  has for "keep this glued to that element" is Floating UI's `autoUpdate`, whose answer
 *  to a box that moves is an intersection observer whose root is shrunk to exactly the
 *  box: it sees the whole of the element, and the frame the element moves by a pixel it
 *  sees less of it and says so. No polling, nothing on a frame where nothing moved. That
 *  is `watchShifts`, after Floating UI's `observeMove`.
 *
 *  And the screen's scale: a window moved to a screen of another scale keeps its size in
 *  the window's own pixels, so neither the hole nor the window says anything, while every
 *  pixel of the page's window is now another size. `watchScale` hears it. */

/** A box, in the window's own pixels. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** The root margin that shrinks a viewport of `width` by `height` to `box`, rounded so the
 *  root never cuts into the box: an observer of that root sees all of it until it moves. */
export function marginAround(box: Box, width: number, height: number): string {
  const top = Math.floor(box.top)
  const left = Math.floor(box.left)
  const right = Math.floor(width - (box.left + box.width))
  const bottom = Math.floor(height - (box.top + box.height))
  return `${String(-top)}px ${String(-right)}px ${String(-bottom)}px ${String(-left)}px`
}

/** Whether two boxes are the same box. */
export function sameBox(one: Box, other: Box): boolean {
  return (
    one.left === other.left &&
    one.top === other.top &&
    one.width === other.width &&
    one.height === other.height
  )
}

function boxOf(node: Element): Box {
  const { left, top, width, height } = node.getBoundingClientRect()
  return { left, top, width, height }
}

/** How long to wait before looking again at a box that is out of the window altogether,
 *  where every position is the same nothing; Floating UI's figure. */
const CLIPPED_AGAIN = 1000

/** Calls `shifted` whenever `node` moves on the screen, and answers the way to stop. A
 *  change of size is a resize observer's to hear, though this hears most of those too.
 *
 *  The root is the box as it was when the observer was made, so it is made again on
 *  every change of size, the element's or the window's. A box that shrinks inside its
 *  root, or a window that grows round it, is still seen whole - nothing is said - and a
 *  move inside a root that is out of date is never seen at all: the sidebar opened, then
 *  moved to the other side, was a page left where the panes had been, which the probe
 *  found with the first version of this. Floating UI's `observeMove` has the same gap. */
export function watchShifts(node: Element, shifted: () => void): () => void {
  if (typeof IntersectionObserver !== 'function') return () => undefined

  let observer: IntersectionObserver | null = null
  let again: ReturnType<typeof setTimeout> | undefined

  const unarm = () => {
    clearTimeout(again)
    observer?.disconnect()
    observer = null
  }

  const arm = (threshold = 1) => {
    unarm()
    const box = boxOf(node)
    if (box.width < 1 || box.height < 1) return

    const root = document.documentElement
    let first = true
    const heard = (entries: IntersectionObserverEntry[]) => {
      const ratio = entries[0]?.intersectionRatio ?? 1
      if (ratio !== threshold) {
        // The observer's first answer is where the element was when it started watching:
        // a ratio a hair under the line is the rounding of the margin, and becomes the
        // line. Any answer after it is the element having moved.
        shifted()
        if (!first) arm()
        else if (ratio === 0) again = setTimeout(() => arm(1e-7), CLIPPED_AGAIN)
        else arm(ratio)
        return
      }
      // Seen whole and still moved: an observer can say the old ratio for a frame that
      // has the element somewhere else, which Floating UI found under load.
      if (!sameBox(box, boxOf(node))) {
        shifted()
        arm()
        return
      }
      first = false
    }
    observer = new IntersectionObserver(heard, {
      rootMargin: marginAround(box, root.clientWidth, root.clientHeight),
      threshold: Math.max(0, Math.min(1, threshold)) || 1,
    })
    observer.observe(node)
  }

  const resized = () => {
    arm()
  }
  const sizing = typeof ResizeObserver === 'function' ? new ResizeObserver(resized) : null
  sizing?.observe(node)
  window.addEventListener('resize', resized)

  arm()
  return () => {
    unarm()
    sizing?.disconnect()
    window.removeEventListener('resize', resized)
  }
}

/** Calls `changed` whenever the screen's scale under the window changes, and answers the
 *  way to stop. A media query for the scale there is now, asked again each time. */
export function watchScale(changed: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined

  let query: MediaQueryList | null = null
  const heard = () => {
    changed()
    arm()
  }
  const arm = () => {
    query?.removeEventListener('change', heard)
    query = matchMedia(`(resolution: ${String(devicePixelRatio)}dppx)`)
    query.addEventListener('change', heard)
  }

  arm()
  return () => query?.removeEventListener('change', heard)
}
