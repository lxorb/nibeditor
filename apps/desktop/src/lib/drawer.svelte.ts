import { flushSync } from 'svelte'
import {
  CLAIM,
  claimsGesture,
  fromEdge,
  isFinger,
  opensDrawer,
  ownsGesture,
  SETTLE_MAX,
  SETTLE_MIN,
  settleOpen,
} from './swipe'
import { readingFactor } from './direction'
import { fullscreen } from './fullscreen.svelte'
import { dur } from './motion'
import { viewport } from './viewport.svelte'
import { type Panel, type PanelSide, workspace } from './workspace.svelte'

/** The sidebars as a phone shows them: drawers that follow the thumb.
 *
 *  Two of them, one engine. The file list comes out of the side the lines start
 *  at, and the other side's panel comes in over the note from the far edge the
 *  way a members panel does; a drag is the same gesture either way, so the rules
 *  are written once about "this drawer's own edge" and each drawer carries the
 *  one number - `sign` - that says which edge that is. A second engine for the
 *  second edge would be a second set of claim thresholds, a second settle curve
 *  and a second thing to keep in step.
 *
 *  The maths of the gesture - whose it is, when a sideways move counts as a
 *  drag, and where the drawer lands when the finger lifts - lives in `swipe.ts`
 *  and is tested there. This is the part that needs a real element: measuring
 *  how far a drawer can travel, and driving the transform while a finger is
 *  down.
 *
 *  Nothing in the move handler reads the layout. The one measurement a drag
 *  needs is taken once per screen size and remembered, so the transform under
 *  the finger is the only work a frame does. */
class Drawer {
  /** How far the drawer is pulled out while a finger is on it, in pixels.
   *  `null` hands it back to CSS, which is what animates the settle. */
  at = $state<number | null>(null)

  /** How far it can travel, measured when the gesture starts. */
  width = $state(0)

  /** A finger is down on something the drawer may move. What puts both layers
   *  on the compositor before the first move rather than on it, so the drag
   *  starts in the frame it was asked for. */
  held = $state(false)

  /** How long the drawer takes to settle once the finger lifts, in
   *  milliseconds. The tap-to-open transition is tuned to feel prompt, which
   *  is far too quick for the last stretch of a drag: the drawer would leap
   *  the rest of the way. Set from how far it still has to go, and cleared
   *  once it has arrived so a tap goes back to being prompt. */
  settle = $state<number | null>(null)

  /** The last travel measured with the sidebar in place, and the window width
   *  it was measured at. */
  private travel = 0
  private travelAt = 0

  constructor(private readonly side: PanelSide) {}

  /** 1 for the drawer on the side the lines start at and -1 for the other
   *  side's: what turns a screen position into a distance from this drawer's own
   *  edge, and a finger's movement into how far this drawer has been pulled out.
   *  See `fromEdge` in swipe.ts. */
  get sign(): number {
    return this.side === 'left' ? 1 : -1
  }

  /** Which panel is open on this side, or nothing. */
  get panel(): Panel | null {
    return this.side === 'left' ? workspace.panel : workspace.rightPanel
  }

  /** Whether this side has a drawer to pull out at all. The left always has the
   *  file list; the other side exists only once a panel has been moved over - a
   *  window nobody has arranged has no right side, not an empty one - so until
   *  then a drag from that edge means nothing, which is what it meant before
   *  this drawer existed. */
  get there(): boolean {
    return this.side === 'left' || workspace.right.length > 0
  }

  /** How far out the drawer is as a fraction, or nothing while no finger is
   *  moving it. What the one scrim both drawers share fades with. */
  get progress(): number | null {
    return this.at === null || !this.width ? null : this.at / this.width
  }

  /** Buttons inside a layer finish transitions of their own; only the layer's
   *  own slide means it has arrived. */
  arrived(event: TransitionEvent) {
    if (event.target === event.currentTarget && event.propertyName === 'transform') {
      this.settle = null
    }
  }

  /** Shows this side's drawer, which is what a drag that has claimed the gesture
   *  does before it starts moving anything.
   *
   *  The left shows the file list, the way its own button always has. The other
   *  side shows whatever was last open there, which on a side holding one panel
   *  is that panel - the same rule the bar's button follows; see
   *  SidebarToggle.svelte. */
  open() {
    if (this.side === 'left') {
      workspace.showPanel('tree')
      return
    }

    const next = workspace.nextRight
    if (next) workspace.showPanel(next)
  }

  close() {
    workspace.closePanel(this.side)
  }

  /** How far the drawer can move, with its panel in place to be measured.
   *  Remembered against the window's width, so turning the tablet takes the
   *  measurement again and a drag never has to. */
  measure(host: HTMLElement): number {
    const width = host.querySelector<HTMLElement>(this.layer)?.getBoundingClientRect().width ?? 0
    if (width) {
      this.travel = width
      this.travelAt = window.innerWidth
    }

    return width
  }

  /** What the last drag at this size measured, or nothing. */
  remembered(): number {
    return this.travelAt === window.innerWidth ? this.travel : 0
  }

  /** The element that travels, which is the one to measure. Named rather than
   *  taken as the first `.panels` in the host: both sides are one. */
  private get layer(): string {
    return this.side === 'left' ? '.panels:not(.right)' : '.panels.right'
  }
}

/** The file list's drawer, and the other side's. */
export const drawer = new Drawer('left')
export const rightDrawer = new Drawer('right')

/** Listens on the element that holds both layers, for both drawers.
 *
 *  One set of listeners rather than one per drawer: a gesture is read once -
 *  whose it is, what is under the finger, which way it went - and only then does
 *  it belong to an edge. Two engines would ask the same questions of the same
 *  touch twice and could both answer yes.
 *
 *  Attached by hand rather than with `ontouchmove`, because claiming the gesture
 *  means calling preventDefault, and that needs a listener that is not passive.
 *
 *  Answers the teardown, so the effect that calls this can hand it straight back
 *  to Svelte. */
export function followDrawers(host: HTMLElement): () => void {
  let startX = 0
  let startY = 0
  let width = 0
  /** Whether this gesture could still become a drag. Cleared the moment it
   *  turns out to be something else, and every later handler bails. */
  let candidate = false
  let claimed = false
  let openedByDrag = false
  let ready = false
  let lastX = 0
  let lastAt = 0
  let velocity = 0
  /** 1 while the interface reads left to right and -1 while it reads the other
   *  way, read once at the start of each gesture: a language cannot change
   *  half way through a swipe, and reading the document on every move would be
   *  a read in the middle of the one handler that must not do any. */
  let factor = 1
  /** What is on the screen. A stylus reaches a webview as a touch as well as
   *  a pointer, and only the pointer says which it is, so the kind is taken
   *  from the pointer event that runs first. */
  let pointer = 'touch'
  /** Which drawer this gesture is moving. Settled at the start where one of them
   *  is already out - that one is under the finger - and otherwise at the first
   *  claimed move, by the direction the finger went. */
  let moving: Drawer | null = null
  /** The drawers this gesture could still turn out to belong to, which is both
   *  of them while neither is out. Both are promoted while it is undecided, and
   *  the one that loses comes off the compositor as soon as it has. */
  let could: Drawer[] = []

  /** How near the edge a drag has to start on a tablet. Read from the
   *  tokens as the gesture is wired up, never during one. */
  const edge = edgeWidth()

  /** The one finger on the screen, or nothing when there is not exactly one:
   *  a second finger is a pinch or a two-finger scroll, and neither is this. */
  const single = (event: TouchEvent) => (event.touches.length === 1 ? event.touches[0] : undefined)

  /** Nothing is a drawer's any more: this gesture belongs to whatever else
   *  wanted it, and neither layer is waiting to move. */
  const letGo = () => {
    candidate = false
    moving = null
    could = []
    drawer.held = false
    rightDrawer.held = false
  }

  const onPointerDown = (event: PointerEvent) => {
    pointer = event.pointerType
  }

  const onStart = (event: TouchEvent) => {
    claimed = false
    openedByDrag = false
    ready = false
    width = 0
    letGo()

    const touch = single(event)
    if (!touch || !isFinger(pointer) || isStylus(touch)) return

    // Full screen has taken the drawers away, so there is nothing to drag out:
    // a swipe there would open a file list nobody can see. See
    // fullscreen.svelte.ts.
    if (fullscreen.on) return

    // Whatever is under the finger gets first refusal: a table that scrolls
    // sideways, a strip of tabs, a canvas being drawn on.
    if (ownsGesture(document.elementFromPoint(touch.clientX, touch.clientY), host)) return

    // Closed, only the edge strip opens a drawer on a tablet, where the note is a
    // page wide enough to be written and drawn on. Open, the drag that puts it
    // away may start anywhere over the note.
    //
    // Measured from the edge each drawer comes out of rather than from the left
    // of the glass: a drawer comes out of the side its panel is on, so under a
    // right-to-left interface both strips are at the other end and the whole
    // gesture runs the other way. `factor` and each drawer's sign are the only
    // places that say so.
    const anywhere = viewport.device === 'phone'
    factor = readingFactor()

    // Whichever drawer is out is the one a drag moves, and it is under the
    // finger wherever the finger is. Where both are out it is the other side's:
    // that one is over the note at every width, so it is the one on top.
    const out = rightDrawer.panel ? rightDrawer : drawer.panel ? drawer : null

    if (out) {
      moving = out
      could = [out]
      // The layer is there to measure and the measurement is cheap and exact.
      width = out.measure(host)
      out.width = width
    } else {
      // Neither is out, so either could be the one and only the direction of the
      // first real movement says which. Both are made ready here; the claim drops
      // the one that turns out not to be moving.
      could = [drawer, rightDrawer].filter(
        (one) =>
          one.there && opensDrawer(fromEdge(touch.clientX, factor, one.sign), edge, anywhere),
      )
      if (!could.length) return

      // There is nothing in a shut drawer at all, so what the last drag at this
      // size measured stands in - and if there is none, the claim below has to
      // lay the page out once to find it.
      for (const one of could) one.width = one.remembered()
    }

    startX = touch.clientX
    startY = touch.clientY
    lastX = touch.clientX
    lastAt = event.timeStamp
    velocity = 0
    candidate = true
    for (const one of could) one.held = true
  }

  const onMove = (event: TouchEvent) => {
    const touch = single(event)
    if (!candidate || !touch) return

    /** How far the finger has gone along the line, which is the one direction
     *  every rule is written in; each drawer's sign turns it into how far that
     *  drawer has been pulled out. */
    const along = (touch.clientX - startX) * factor
    const dy = touch.clientY - startY

    if (!claimed) {
      // Settled once: a scroll stays a scroll for the whole gesture, and a
      // drag stays a drag. Going vertical first gives the drawers up.
      if (Math.abs(dy) > CLAIM) {
        letGo()
        return
      }
      if (!claimsGesture(along, dy)) return

      // Neither drawer is out, so the direction is what says which of them this
      // is: a pull along the line brings out the drawer at the near edge, one
      // back against it the drawer at the far edge. A direction with no drawer on
      // that side means nothing on the document and is left alone.
      moving ??= could.find((one) => one.sign === Math.sign(along)) ?? null
      if (!moving) {
        letGo()
        return
      }

      // The other side is not moving after all: off the compositor now rather
      // than at the end of the gesture.
      for (const one of could) if (one !== moving) one.held = false
      could = [moving]

      claimed = true
      width = moving.width

      if (!moving.panel) {
        moving.open()
        openedByDrag = true

        // The first drag of a session has no remembered width, and a shut
        // drawer has no width of its own to fall back on. `flushSync` puts
        // the panel in the DOM now so the real width can be read; every
        // later drag has it already and this never runs.
        if (!width) {
          flushSync()
          width = moving.measure(host)
          moving.width = width
        }
      }

      ready = true
    }

    if (!ready || !width || !moving) return

    const elapsed = event.timeStamp - lastAt
    // Positive while the finger is pulling this drawer out, whichever edge it
    // comes from, which is what `settleOpen` reads a flick off.
    if (elapsed > 0) velocity = ((touch.clientX - lastX) / elapsed) * factor * moving.sign
    lastX = touch.clientX
    lastAt = event.timeStamp

    // Opening counts from nothing; closing counts down from wide open.
    const base = openedByDrag ? 0 : width
    moving.at = Math.max(0, Math.min(width, base + along * moving.sign))
    event.preventDefault()
  }

  const onEnd = () => {
    const one = moving
    drawer.held = false
    rightDrawer.held = false
    if (!claimed || !one) {
      letGo()
      return
    }

    const settled = settleOpen(one.at ?? 0, width, velocity)
    // The remaining distance decides the time, so the drawer moves at
    // roughly the same pace whether it was let go near its end or its start.
    const remaining = Math.abs((one.at ?? 0) - (settled ? width : 0))
    // Through `dur`, because this one number is worked out here and written
    // onto the element as a length: the stylesheet's own durations answer
    // prefers-reduced-motion where they are declared, and this one cannot.
    one.settle = dur(
      Math.round(SETTLE_MIN + (SETTLE_MAX - SETTLE_MIN) * (width ? remaining / width : 0)),
    )
    one.at = null
    claimed = false
    candidate = false
    moving = null
    could = []

    if (settled !== !!one.panel) {
      if (settled) one.open()
      else one.close()
    }
  }

  host.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true })
  host.addEventListener('touchstart', onStart, { passive: true })
  host.addEventListener('touchmove', onMove, { passive: false })
  host.addEventListener('touchend', onEnd)
  host.addEventListener('touchcancel', onEnd)

  return () => {
    host.removeEventListener('pointerdown', onPointerDown, { capture: true })
    host.removeEventListener('touchstart', onStart)
    host.removeEventListener('touchmove', onMove)
    host.removeEventListener('touchend', onEnd)
    host.removeEventListener('touchcancel', onEnd)
  }
}

/** How near an edge of the screen a drag has to start before it is a drawer's
 *  rather than the page's, from the tokens. A stylesheet that does not say
 *  leaves the whole width open, which is what a phone uses anyway. */
function edgeWidth(): number {
  const width = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--swipe-edge'),
  )

  return Number.isFinite(width) ? width : Number.POSITIVE_INFINITY
}

/** Apple's webviews name the pen on the touch rather than on the pointer, and
 *  that is the only place they name it. Cast because `touchType` is theirs and
 *  not in the standard's Touch. */
function isStylus(touch: Touch): boolean {
  return (touch as Touch & { touchType?: string }).touchType === 'stylus'
}
