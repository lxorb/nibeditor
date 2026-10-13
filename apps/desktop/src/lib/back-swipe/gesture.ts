/** Two fingers swept sideways, or one finger from the side of the screen: back and
 *  forward, the way Chrome and Edge take them.
 *
 *  Emil, 2026-10-03: *"Swiping (left/right) to go to the previous / redo page."* What a
 *  browser does with it is narrow, and everything that is not it is a scroll:
 *
 *  - **Only what the content left over.** A sideways scroll the thing under the fingers
 *    can take - a wide table, a carousel, a stacked pane - is that thing's. And a stream
 *    of scroll that began by moving the content stays the content's to its end, even once
 *    the content has reached its edge: Chrome's scroll latching, which is what keeps a
 *    fling along a carousel from turning into Back as the carousel runs out.
 *  - **Sideways on purpose.** The scroll has to have gone 60 pixels sideways (50 for a
 *    finger on the screen) and at least two and a half times as far sideways as down
 *    before anything shows; a stream that went down first is a scroll down to its end.
 *  - **Shown before it happens.** Past the start the arrow follows the fingers pixel for
 *    pixel; nothing happens until they lift, and then it goes if they had come far enough
 *    along - three tenths of the window's longer side, less the start, on a touchpad, and
 *    a quarter on a screen, but never more than `MOST` - or were moving towards it at more
 *    than 1100 pixels a second. Lifted short of that, brought back, or flicked back the
 *    way they came (`BACKING`), and nothing happens.
 *  - **Nowhere to go is no arrow.** A side with nothing in the history that way never
 *    shows one, and the stream is left alone.
 *
 *  Those numbers are Chromium's own (overscroll_configuration.cc, overscroll_controller.cc
 *  and gesture_nav_simple.cc), so a hand that knows Chrome's swipe knows this one - but for
 *  `MOST`, because Chrome measures the screen and a touchpad is the same size under a
 *  window of any width: on a wide window Chrome's share was most of the pad (#209).
 *
 *  **Which way, from the first step.** A stream is read from its very first step, a step
 *  straight down included, so its callers hand every step in: a scroll down a page is a
 *  scroll down to its end, however far it then drifts sideways, and never brings the
 *  arrow out half way down (#209).
 *
 *  **When the fingers lift.** A finger on a screen says so, and so does a precision
 *  touchpad, through the crate (`touchpad.rs`, which reads the pad's own reports of what
 *  is touching it): then a stream is `told`, and is decided at that lift and nowhere
 *  else. Held still past the distance for as long as the hand likes, it is only armed
 *  (#209: *"it is possible to swipe and trigger a back whilst not even released the
 *  touchpad"*). That is Chrome's arrangement, which decides at the fling or the end of
 *  the scroll that Windows reports as the fingers leave the pad.
 *
 *  Where nothing says it - a touchpad that is not a precision one, a Mac - a stream ends
 *  when the events stop for a moment (`QUIET`, the caller's clock), and sooner when the
 *  events turn into the touchpad's own coasting after a flick - a run of steadily
 *  shrinking steps, which only a pad that has been let go of makes. That run is where
 *  Chrome would have seen the fling, so the fling decides there, at the speed the run
 *  started at, and the rest of it is swallowed rather than read as fingers still moving.
 *
 *  Pure, with the clock and the room handed in: the window's listeners are swipes.ts
 *  and a web page's are src-tauri/src/web_swipe.js. Sides are the screen's: `left` is the
 *  arrow at the left edge, which is Back unless the interface reads right to left. */

/** The side of the pane an arrow comes in at. */
export type Side = 'left' | 'right'

/** What made the scroll: two fingers on a touchpad, or one on the screen. */
export type Source = 'touchpad' | 'touch'

/** How far sideways a stream has to go before the arrow shows, in CSS pixels. */
export const START: Record<Source, number> = { touchpad: 60, touch: 50 }

/** How much of the window's longer side the fingers go, start included, to go. */
const SHARE: Record<Source, number> = { touchpad: 0.3, touch: 0.25 }

/** How much further sideways than down a stream has to go to be a swipe. */
export const RATIO = 2.5

/** Let go moving towards the arrow faster than this, in pixels a millisecond, and it
 *  goes however far it had come: Chrome's 1100 pixels a second. */
export const FLING = 1.1

/** How long the scroll has to stop for before the fingers are taken to have lifted,
 *  in milliseconds. Long enough for the pause a touchpad leaves between two reports
 *  of a slow hand, short enough that letting go feels like letting go. */
export const QUIET = 120

/** The shortest run that reads as the touchpad coasting rather than a hand slowing,
 *  and how fast its first step has to be. */
const COAST_RUN = 4
const COAST_FROM = 0.3
/** How much each step of a coast keeps of the one before: between these. */
const COAST_KEEPS: readonly [number, number] = [0.55, 0.98]

/** The least a window can ask the fingers to travel, so a small window still wants a
 *  deliberate sweep rather than a twitch. */
const LEAST = 80

/** The most it can ask, so a wide window does not want the whole pad and then some. The
 *  arrow follows the fingers pixel for pixel, and is this far in when letting go goes. */
export const MOST = 200

/** How long after a swipe that went a new stream is still the last one's: the pad's coast
 *  carried on over the page the step brought, after the gap the step itself left. Such a
 *  stream is nobody's, so one swipe is one step. Short of a hand lifting and sweeping
 *  again, which takes longer. In milliseconds, from the lift. */
export const SETTLE = 300

/** How far back the speed at a lift is measured, in milliseconds: the hand's last few
 *  reports, not the whole sweep. */
const WINDOW = 80

/** Lifted this long after the last step, the hand had stopped: no speed at all. */
const HELD = QUIET / 2

/** Let go moving back the way it came faster than this, in pixels a millisecond, and it
 *  stays however far it had come: the hand changed its mind on the way out. */
export const BACKING = 0.5

/** One step of a scroll: how far it went each way - `dx` below nought is a scroll
 *  towards the left, the way a wheel event says it - when, and what the content and the
 *  history make of each side right now. */
export interface Turn {
  dx: number
  dy: number
  /** Milliseconds, on any clock the stream keeps to. */
  at: number
  /** Whether the content under the fingers would scroll that way itself. */
  scrolls: Record<Side, boolean>
  /** Whether there is somewhere in the history to go at that side. */
  goes: Record<Side, boolean>
}

/** Where a stream is.
 *
 *  - `idle`: none, or one that has ended.
 *  - `gathering`: sideways and down are being added up until one of them wins.
 *  - `content`: the stream is the content's, to its end.
 *  - `tracking`: the arrow is out and follows the fingers.
 *  - `went` / `stayed`: the swipe was decided, and the rest of the stream is nobody's. */
export type Phase = 'idle' | 'gathering' | 'content' | 'tracking' | 'went' | 'stayed'

/** What the arrow draws: the side, how far along, and whether the stream has been
 *  decided yet. `progress` is one where letting go goes, and may run past it. */
export interface Shown {
  phase: Phase
  side: Side
  progress: number
  /** How far past the start the fingers have come, in pixels: where the arrow is. */
  travel: number
}

/** How far the fingers have to travel past the start, in a window of this size. */
export function distance(source: Source, width: number, height: number): number {
  const share = Math.max(width, height) * SHARE[source] - START[source]
  return Math.min(MOST, Math.max(LEAST, share))
}

/** The side a sideways scroll pushes against: one towards the left overscrolls at the
 *  left edge. */
function sideOf(dx: number): Side {
  return dx < 0 ? 'left' : 'right'
}

/** One stream of scroll at a time, from its first step to its end. */
export class Swipe {
  private phase: Phase = 'idle'
  private side: Side = 'left'
  /** Sideways and down, added up while gathering. */
  private across = 0
  private down = 0
  /** How far past the start the fingers have come, towards the arrow's side. */
  private travel = 0
  /** Where the fingers have been towards the arrow's side, never clamped, and when: the
   *  speed at a lift is read off it. Newest last, and only the last moments of it. */
  private pushed = 0
  private trail: { at: number; pushed: number }[] = []
  private last = 0
  /** The newest steps, newest last: how far each went and how long it took. */
  private steps: { along: number; gap: number }[] = []

  constructor(
    private readonly source: Source,
    /** The window's size now: what the fingers have to travel depends on it. */
    private readonly room: () => { width: number; height: number },
    /** Whether the hand says when it lifts: a finger on a screen always does, and a
     *  precision touchpad does through the crate. Told, nothing but the lift decides. */
    private readonly told = source === 'touch',
  ) {}

  /** What there is to draw. */
  get shown(): Shown {
    const progress = this.progress()
    return {
      phase: this.phase,
      side: this.side,
      progress,
      travel: progress === 0 ? 0 : this.travel,
    }
  }

  /** Whether the next step's `scrolls` is read at all: only until the stream has said
   *  whose it is. */
  get asking(): boolean {
    return this.phase === 'idle' || this.phase === 'gathering'
  }

  /** One step of the stream. */
  turn(step: Turn): Shown {
    switch (this.phase) {
      case 'idle':
        this.reset()
        this.phase = 'gathering'
        this.gather(step)
        break
      case 'gathering':
        this.gather(step)
        break
      case 'tracking':
        this.track(step)
        break
      case 'content':
      case 'went':
      case 'stayed':
        break
    }
    this.last = step.at
    return this.shown
  }

  /** The fingers have lifted, at `at`, which says how fresh the last speed still is. A
   *  swipe that was tracking is decided now, `went` or `stayed`, for the caller to act on;
   *  anything else simply ends, as `idle` - including a swipe a coast already decided,
   *  which its caller acted on then. Either way the next step starts a new stream. */
  lift(at: number): Shown {
    const tracking = this.phase === 'tracking'
    if (tracking) {
      // Held still before letting go is letting go at no speed at all.
      const speed = at - this.last > HELD ? 0 : this.speed()
      this.decide(speed, this.travel)
    }
    const decided: Shown = tracking
      ? this.shown
      : { phase: 'idle', side: this.side, progress: 0, travel: 0 }
    this.reset()
    return decided
  }

  private reset() {
    this.phase = 'idle'
    this.across = 0
    this.down = 0
    this.travel = 0
    this.pushed = 0
    this.trail = []
    this.steps = []
  }

  private gather(step: Turn) {
    // The content takes any sideways step it can, and from then on the stream is its.
    if (step.dx !== 0 && step.scrolls[sideOf(step.dx)]) {
      this.phase = 'content'
      return
    }

    this.across += step.dx
    this.down += step.dy
    const start = START[this.source]
    const across = Math.abs(this.across)
    const down = Math.abs(this.down)

    if (down > start && down > across * RATIO) {
      this.phase = 'content'
      return
    }
    if (across <= start || across <= down * RATIO) return

    this.side = sideOf(this.across)
    // Nowhere to go that way: no arrow, and the rest of the stream is nobody's.
    this.phase = step.goes[this.side] ? 'tracking' : 'stayed'
    this.travel = this.phase === 'tracking' ? across - start : 0
    this.pushed = this.travel
    this.trail = [{ at: step.at, pushed: this.pushed }]
  }

  private track(step: Turn) {
    // Towards the arrow's side is further along; the other way brings it back, never
    // past where it started.
    const along = this.side === 'left' ? -step.dx : step.dx
    this.travel = Math.max(0, this.travel + along)
    this.pushed += along
    const recent = this.trail.filter((one) => one.at >= step.at - WINDOW * 2)
    this.trail = [...recent, { at: step.at, pushed: this.pushed }]

    const gap = step.at - this.last
    if (gap <= 0) return
    this.steps = [...this.steps.slice(1 - COAST_RUN), { along, gap }]

    // A hand that says when it lifts is decided then and only then: one slowing down is
    // still on the pad. See the top of the file.
    const coast = this.told ? null : coasting(this.steps)
    if (coast !== null) this.decide(coast.from, this.travel + coast.left)
  }

  /** Pixels a millisecond towards the arrow's side over the last `WINDOW`, below nought
   *  for a hand on its way back. */
  private speed(): number {
    const newest = this.trail[this.trail.length - 1]
    if (!newest) return 0
    const oldest =
      this.trail.find((one) => one !== newest && one.at >= newest.at - WINDOW) ??
      this.trail[this.trail.length - 2]
    if (!oldest || newest.at <= oldest.at) return 0
    return (newest.pushed - oldest.pushed) / (newest.at - oldest.at)
  }

  private decide(speed: number, reached: number) {
    const { width, height } = this.room()
    const far = distance(this.source, width, height)
    const went = reached >= far || (speed >= FLING && this.travel > 0)
    this.phase = went && speed > -BACKING ? 'went' : 'stayed'
  }

  private progress(): number {
    if (this.phase === 'idle' || this.phase === 'gathering' || this.phase === 'content') return 0
    const { width, height } = this.room()
    return this.travel / distance(this.source, width, height)
  }
}

/** Whether the newest steps are the pad coasting on its own: each a steady share
 *  shorter than the one before, starting fast. Then the speed it started at, and how
 *  much further it would carry the arrow before it ran out. */
export function coasting(
  steps: readonly { along: number; gap: number }[],
): { from: number; left: number } | null {
  if (steps.length < COAST_RUN) return null
  const speeds = steps.map((one) => one.along / one.gap)
  const first = speeds[0] ?? 0
  if (first < COAST_FROM) return null

  const [least, most] = COAST_KEEPS
  let kept = 0
  for (let at = 1; at < speeds.length; at++) {
    const share = (speeds[at] ?? 0) / (speeds[at - 1] ?? 1)
    if (share < least || share > most) return null
    kept += share
  }

  // Each step keeps about this much of the last, so what is left of the coast is the
  // rest of that series, in steps as long as the newest one.
  const keeps = kept / (speeds.length - 1)
  const newest = steps[steps.length - 1]?.along ?? 0
  return { from: first, left: (newest * keeps) / (1 - keeps) }
}
