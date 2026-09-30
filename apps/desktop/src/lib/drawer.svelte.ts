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
 *  down. What drives it - the listeners a drag is read through - is
 *  drawer-follow.ts, fetched the first time there is a drawer to drag, so what is
 *  here is only what the markup reads.
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
