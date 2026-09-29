import { dur } from './motion'

/** A sheet on a phone put away by pulling it down from its head, as an iPhone's
 *  are. The menus drew the grip and pulling it did nothing. */

/** Pixels of pull that mean nothing, however quick: a thumb settling. */
const TWITCH = 12

/** Far enough for a slow pull: a quarter of the sheet, at most a thumb's length. */
const SHARE = 0.25
const THUMB = 120

/** Pixels a millisecond at which a pull is a flick. */
const FLICK = 0.5

/** How far below its top a pull may start; below are rows a finger scrolls. */
const HEAD = 64

const SETTLE = 220

/** Whether a sheet let go of after `pulled` pixels at `speed` goes away. */
export function putsAway(pulled: number, height: number, speed: number): boolean {
  if (pulled <= TWITCH) return false
  if (speed >= FLICK) return true
  return pulled >= Math.min(height * SHARE, THUMB)
}

/** The gesture on the sheet. A touch on a control is the control's; `translate`
 *  because the sheet's way in is drawn with `transform`. Handed null, it is off. */
export function pullsAway(node: HTMLElement, close: (() => void) | null) {
  let closing = close
  let from: number | null = null
  let lastY = 0
  let lastAt = 0
  let speed = 0
  let pulled = 0

  const onStart = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined
    const target = event.target instanceof Element ? event.target : null
    if (!closing || !touch || target?.closest('button, a, input, textarea, select')) return
    if (touch.clientY - node.getBoundingClientRect().top > HEAD) return

    from = lastY = touch.clientY
    lastAt = event.timeStamp
    speed = 0
    pulled = 0
  }

  const onMove = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (from === null || !touch) return

    // The page under the sheet must not scroll with it.
    event.preventDefault()
    const elapsed = event.timeStamp - lastAt
    if (elapsed > 0) speed = (touch.clientY - lastY) / elapsed
    lastY = touch.clientY
    lastAt = event.timeStamp

    pulled = Math.max(0, touch.clientY - from)
    node.style.transition = 'none'
    node.style.translate = `0 ${pulled}px`
  }

  const onEnd = () => {
    if (from === null) return
    from = null

    const away = putsAway(pulled, node.offsetHeight, speed)
    const ms = dur(SETTLE)
    node.style.transition = `translate ${ms}ms cubic-bezier(0.32, 0.72, 0, 1)`
    node.style.translate = away ? `0 ${node.offsetHeight}px` : ''
    setTimeout(() => {
      node.style.transition = ''
      if (away) closing?.()
    }, ms)
  }

  node.addEventListener('touchstart', onStart, { passive: true })
  node.addEventListener('touchmove', onMove, { passive: false })
  node.addEventListener('touchend', onEnd)
  node.addEventListener('touchcancel', onEnd)

  return {
    update(next: (() => void) | null) {
      closing = next
    },
    destroy() {
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
      node.removeEventListener('touchend', onEnd)
      node.removeEventListener('touchcancel', onEnd)
    },
  }
}
