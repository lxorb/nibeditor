;(function () {
  // What a page in a web tab says about a swipe, from nib's own world in it; see
  // web_swipe.rs. Every sideways scroll the page leaves over, and a finger from the
  // side of the screen, is said to the app, which decides
  // (apps/desktop/src/lib/back-swipe). Nothing the page does is changed: every
  // listener is passive and only reads.

  // How near the side of the screen a finger has to land to be a swipe and not a pan.
  const SIDE = 24
  // A wheel's notch, which a touchpad's scroll never comes in whole multiples of.
  const NOTCH = 120
  const SLACK = 0.5

  // Taken now, so a page that replaces its own `window.open` replaces nothing of this.
  const open = window.open.bind(window)

  // Through the binding where nib's world has one (nib's own Chromium), and otherwise
  // as a window asked for under a name that says it, which the crate reads and never
  // opens (`WebView2`); see web_swipe.rs.
  function say(said) {
    const words = JSON.stringify(said)
    const bound = globalThis.nibSwiped
    if (typeof bound === 'function') bound(words)
    else open('about:blank', 'nib-swipe:' + words)
  }

  // Whether the content would take a scroll each way, from the element under the
  // pointer up to the page's own root: the same question lib/back-swipe/edge.ts asks in
  // the app. A scroll container that keeps its overscroll (`overscroll-behavior-x: contain`
  // or `none`) takes both, which is how a page says no swipe here.
  function takes(from) {
    let left = false
    let right = false
    const root = document.scrollingElement || document.documentElement
    for (let at = from instanceof Element ? from : root; at; at = at.parentElement) {
      const style = getComputedStyle(at)
      const rooted = at === root
      let overflow = style.overflowX
      // The root that says nothing scrolls the way its body says.
      if (rooted && overflow === 'visible' && document.body)
        overflow = getComputedStyle(document.body).overflowX
      const container = rooted || (overflow !== 'visible' && overflow !== 'clip')
      const keeps =
        container &&
        (style.overscrollBehaviorX === 'contain' || style.overscrollBehaviorX === 'none')
      const sideways = rooted
        ? overflow !== 'hidden' && overflow !== 'clip'
        : /auto|scroll|overlay/.test(overflow)
      const range = at.scrollWidth - at.clientWidth
      if (sideways && range > SLACK) {
        const rtl = style.direction === 'rtl'
        const least = rtl ? -range : 0
        const most = rtl ? 0 : range
        if (at.scrollLeft > least + SLACK) left = true
        if (at.scrollLeft < most - SLACK) right = true
      }
      if (keeps) return [true, true]
    }
    // The body's own `overscroll-behavior` is the page's as much as the root's is.
    if (document.body && /contain|none/.test(getComputedStyle(document.body).overscrollBehaviorX)) {
      return [true, true]
    }
    return [left, right]
  }

  // A frame's worth of scroll, said once: a touchpad reports faster than a page draws.
  let heard = null
  let waiting = 0

  function flush() {
    waiting = 0
    const one = heard
    heard = null
    if (!one) return
    // Asked after every handler in the page has had the scroll: one that took it for
    // itself - a map, a slideshow - keeps it.
    const taken = one.events.some(function (event) {
      return event.defaultPrevented
    })
    say({
      k: 'w',
      dx: one.dx,
      dy: one.dy,
      t: one.t,
      l: taken || one.l,
      r: taken || one.r,
    })
  }

  addEventListener(
    'wheel',
    function (event) {
      if (!event.isTrusted || event.deltaMode !== 0 || !event.deltaX) return
      if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return
      // A tilted wheel turns in notches; Chrome never swipes on a mouse.
      if (event.wheelDeltaX && event.wheelDeltaX % NOTCH === 0) return
      const free = takes(event.target)
      if (!heard) heard = { dx: 0, dy: 0, t: 0, l: false, r: false, events: [] }
      heard.dx += event.deltaX
      heard.dy += event.deltaY
      heard.t = event.timeStamp
      heard.l = heard.l || free[0]
      heard.r = heard.r || free[1]
      heard.events.push(event)
      if (!waiting) waiting = requestAnimationFrame(flush)
    },
    { capture: true, passive: true },
  )

  // A finger from the side of the screen, in the page itself and not a frame in it.
  let finger = null

  addEventListener(
    'touchstart',
    function (event) {
      finger = null
      if (!event.isTrusted || event.touches.length !== 1 || window !== window.top) return
      const touch = event.touches[0]
      if (touch.clientX > SIDE && touch.clientX < innerWidth - SIDE) return
      const free = takes(event.target)
      finger = { x: touch.clientX, y: touch.clientY, l: free[0], r: free[1] }
    },
    { capture: true, passive: true },
  )

  addEventListener(
    'touchmove',
    function (event) {
      if (!finger || !event.isTrusted) return
      if (event.touches.length !== 1) return lift(event)
      const touch = event.touches[0]
      // A finger moving right scrolls towards the left, as two fingers on a pad do.
      say({
        k: 't',
        dx: finger.x - touch.clientX,
        dy: finger.y - touch.clientY,
        t: event.timeStamp,
        l: finger.l,
        r: finger.r,
      })
      finger.x = touch.clientX
      finger.y = touch.clientY
    },
    { capture: true, passive: true },
  )

  function lift(event) {
    if (!finger) return
    finger = null
    say({ k: 'e', t: event.timeStamp })
  }

  addEventListener('touchend', lift, { capture: true, passive: true })
  addEventListener('touchcancel', lift, { capture: true, passive: true })
})()
