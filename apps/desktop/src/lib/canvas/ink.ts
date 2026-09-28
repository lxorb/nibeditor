/** What a pen leaves on the plane: the arithmetic of a stroke.
 *
 *  The stroke itself - its points, its pressure, its tilt and its
 *  timestamps - is part of the file format and lives in `@nib/markdown/canvas`.
 *  What is here is everything a surface does with one: the outline it paints as,
 *  how a tool behaves, what an eraser cuts out of it, what a lasso caught, and
 *  what a held pen meant to draw.
 *
 *  Pure, and without a canvas context in sight, because the outline of a stroke
 *  is arithmetic and arithmetic is testable. `paint.ts` next door turns these
 *  outlines into paint. */

import { getStroke } from 'perfect-freehand'
import type { Felt, PenTraits, Reported } from './contacts'
import { freshId, type InkPoint, type InkStroke, type InkTool } from './format'
import { awayFromSegment, type Box, type Point } from './geometry'

/** How a tool behaves: how much pressure thins it, how translucent it is, how it
 *  sits on what is under it, and whether it is a round nib or a flat one.
 *
 *  One table rather than seven branches, so adding a tool is adding a row and
 *  the renderer never grows a case for it. */
export interface InkStyle {
  /** How much of the width pressure takes away, 0 to 1. */
  thinning: number
  smoothing: number
  streamline: number
  /** 0 to 1, painted straight onto the alpha. */
  opacity: number
  /** Whether the tool darkens what it crosses rather than covering it. */
  multiply: boolean
  /** Whether the ends taper to a point rather than ending in a cap. */
  taper: number
  /** A flat nib at this angle in degrees, or null for a round one. */
  nib: number | null
  /** Whether the tool leaves a grain rather than a solid body. */
  grain: boolean
  /** The width a fresh tool starts at, in plane units. */
  size: number
}

export const INK_STYLES: Record<InkTool, InkStyle> = {
  /** An even line whatever the hand does, which is what a ballpoint is. */
  pen: {
    thinning: 0.12,
    smoothing: 0.5,
    streamline: 0.5,
    opacity: 1,
    multiply: false,
    taper: 0,
    nib: null,
    grain: false,
    size: 3,
  },
  /** Pressure is the whole point: lean on it and the line swells. */
  fountain: {
    thinning: 0.75,
    smoothing: 0.55,
    streamline: 0.45,
    opacity: 1,
    multiply: false,
    taper: 12,
    nib: null,
    grain: false,
    size: 4,
  },
  /** Grainy, a little translucent, and thin. */
  pencil: {
    thinning: 0.45,
    smoothing: 0.4,
    streamline: 0.35,
    opacity: 0.9,
    multiply: true,
    taper: 4,
    nib: null,
    grain: true,
    size: 3.5,
  },
  /** Broad and flat and solid, like a felt tip. */
  marker: {
    thinning: 0,
    smoothing: 0.6,
    streamline: 0.55,
    opacity: 0.95,
    multiply: false,
    taper: 0,
    nib: null,
    grain: false,
    size: 8,
  },
  /** Wide, translucent and darkening, so two passes over one word do not turn
   *  it into a block: the whole stroke is one shape drawn once. */
  highlighter: {
    thinning: 0,
    smoothing: 0.7,
    streamline: 0.6,
    opacity: 0.32,
    multiply: true,
    taper: 0,
    nib: null,
    grain: false,
    size: 18,
  },
  /** Pressure and speed both, with ends that come to a point. */
  brush: {
    thinning: 0.85,
    smoothing: 0.6,
    streamline: 0.4,
    opacity: 0.95,
    multiply: false,
    taper: 26,
    nib: null,
    grain: false,
    size: 7,
  },
  /** A flat nib held at an angle: thick across the stroke and thin along it. */
  calligraphy: {
    thinning: 0.3,
    smoothing: 0.5,
    streamline: 0.45,
    opacity: 1,
    multiply: false,
    taper: 0,
    nib: -40,
    grain: false,
    size: 9,
  },
}

/** How much of the colour a stroke lands, 0 to 1.
 *
 *  A stroke that was drawn with the dial turned says so itself; one that was not
 *  wears whatever this kind of pen is, which is how a highlighter has always been
 *  translucent and a biro has not. One answer, read by the two layers on screen
 *  and by every export, so a drawing looks the same wherever it is painted. */
export function inkOpacity(stroke: InkStroke): number {
  return stroke.opacity ?? INK_STYLES[stroke.tool].opacity
}

/** What the spec asks a device with no pressure to report, and what the ink draws
 *  when the pressure it is told is worth nothing: the middle of the range, so the
 *  line comes out at the width the nib is set to. */
const MIDDLE = 0.5

/** How hard the pen was pressed, as the ink reads it: nought to one, and never
 *  nothing.
 *
 *  The gain is the platform's, and the whole of what a platform changes about the
 *  ink; see GAINS in contacts.ts. A pen that reports nought is a pen that reports no
 *  pressure - a finger, a mouse, a stylus whose digitiser has none - and it draws at
 *  the middle rather than at nothing, because a nib that thins with pressure and is
 *  told nought draws a hairline and a hairline is not what a mouse should leave. */
export function forceOf(reported: number, gain: number): number {
  if (!(reported > 0)) return MIDDLE

  return Math.min(1, reported ** gain)
}

/** How near flat a pen has to be before the arithmetic below is asked to divide by
 *  its own tangent. The spec answers a flat pen with five special cases; holding the
 *  altitude off nought instead agrees with all five to the degree. */
const NEARLY_FLAT = 1e-6

const DEGREES = 180 / Math.PI

/** Which way the pen is leaning, as the two angles off the vertical that the file
 *  format keeps, from whichever of the two the browser reported.
 *
 *  Chromium reports `tiltX` and `tiltY`: degrees off the vertical in the plane of
 *  each of the screen's axes. Safari reports `altitudeAngle` and `azimuthAngle`
 *  instead: radians up from the glass, and radians round it anticlockwise from the
 *  screen's x axis. They are the same fact in two coordinate systems, and the
 *  conversion is the one in the Pointer Events spec.
 *
 *  One representation from here on, so nothing downstream ever asks which browser it
 *  is: a stroke drawn with an Apple Pencil and a stroke drawn with an S Pen are the
 *  same six numbers a point. */
export function tiltOf(event: Felt): { tiltX: number; tiltY: number } {
  if (event.tiltX !== 0 || event.tiltY !== 0) return { tiltX: event.tiltX, tiltY: event.tiltY }

  const up = event.altitudeAngle
  // A pen standing straight up, or a browser that reports neither pair: level.
  if (typeof up !== 'number' || up >= Math.PI / 2) return { tiltX: 0, tiltY: 0 }

  const round = event.azimuthAngle ?? 0
  const tan = Math.tan(Math.max(up, NEARLY_FLAT))
  // Whole degrees, which is what a browser reports tilt in; `|| 0` because half the
  // corners of the circle come out as a negative nought, and a lean of minus nothing
  // is a lean of nothing.
  const degrees = (radians: number) => Math.round(radians * DEGREES) || 0

  return {
    tiltX: degrees(Math.atan(Math.cos(round) / tan)),
    tiltY: degrees(Math.atan(Math.sin(round) / tan)),
  }
}

/** Level, which is what a finger and a mouse lean by. */
const LEVEL = { tiltX: 0, tiltY: 0 }

/** Everything one pointer event says about the nib, in the one representation the
 *  rest of the app knows: how hard, and which way it leans.
 *
 *  The pen's own gain and its flat-pressure fallback are a stylus's alone. A finger
 *  and a mouse go through the same floor and no curve, and lean no way at all, which
 *  is what the format has always held for them. */
export function penFelt(
  event: Reported & Felt,
  traits: PenTraits,
): { pressure: number; tiltX: number; tiltY: number } {
  const pen = event.pointerType === 'pen'
  // A pen whose pressure never changes has none to report, and a constant handed to
  // a nib that thins is every stroke at one wrong width; see `Stylus`.
  const said = pen && traits.force === 'flat' ? 0 : event.pressure

  return {
    pressure: forceOf(said, pen ? traits.gain : 1),
    ...(pen ? tiltOf(event) : LEVEL),
  }
}

/** The outline of a stroke, as a ring of points in plane coordinates.
 *
 *  A flat nib is a ribbon and a round one is what perfect-freehand works out, so
 *  the two kinds of pen are two cases here and one shape everywhere after.
 *
 *  A stroke of one point is a tap, and a tap leaves the nib's own footprint: a
 *  disc under a round nib, a dash under a blade. */
export function outlineOf(stroke: InkStroke, finished = true): Point[] {
  const style = INK_STYLES[stroke.tool]
  // The curve through the samples rather than the straight lines between them, for
  // the browsers that report few of them; see `smoothed`.
  const said = smoothed(stroke.points, stroke.size)
  if (style.nib !== null) return ribbon(said, stroke.size, style)

  const dot = stroke.points.length === 1
  const points = evenly(said).map((point) => [point.x, point.y, point.pressure])
  const ring = getStroke(points, {
    size: stroke.size,
    thinning: style.thinning,
    smoothing: style.smoothing,
    streamline: style.streamline,
    simulatePressure: false,
    last: finished,
    // A tap has no length to taper along, and tapering both ends of a stroke that
    // is one point leaves nothing at all - so a dot is capped, whatever this pen
    // does at the ends of a line.
    ...(style.taper && !dot
      ? { start: { taper: style.taper }, end: { taper: style.taper } }
      : { start: { cap: true }, end: { cap: true } }),
  })

  return ring.map(([x, y]) => ({ x, y }))
}

/** How far past the last real sample the ink may be drawn while the pen is still
 *  down, as a share of the step the hand is actually making.
 *
 *  A browser will guess where the pen is going next, which is worth having: the
 *  compositor is a frame or two behind the digitiser and the guess is what puts the
 *  ink under the nib rather than trailing it. What it is not worth is what it does
 *  on a turn. `getPredictedEvents` hands over a fan of points twenty or thirty
 *  milliseconds ahead, and every time the hand changes direction that fan is still
 *  pointing the old way: the tail of the stroke flicks forward past the nib and
 *  snaps back on the next event. That is the flash.
 *
 *  So the guess is kept and held to one step, in the direction the hand is already
 *  going. Anything further is thrown away, and anything that turns a corner is
 *  thrown away with it. */
const LEAD = 1

/** How far off the current direction a guess may point and still be believed, as
 *  the cosine of the angle. Forty-five degrees: more turning than the curve of a
 *  letter makes in one sample, less than a corner. */
const STRAIGHT_ENOUGH = 0.7

/** The one point of the browser's guess that is worth drawing, or none.
 *
 *  Never kept, never committed, and never more than one step ahead of where the nib
 *  really is; see LEAD. Pure, so a stroke that turns sharply is a test rather than
 *  something to try with a pen. */
export function leadPoint(
  before: InkPoint | undefined,
  nib: InkPoint | undefined,
  guessed: readonly InkPoint[],
): InkPoint[] {
  const guess = guessed[0]
  if (!nib || !before || !guess) return []

  // Which way the hand is going, and how far it went last time.
  const wasX = nib.x - before.x
  const wasY = nib.y - before.y
  const step = Math.hypot(wasX, wasY)
  if (step === 0) return []

  const aheadX = guess.x - nib.x
  const aheadY = guess.y - nib.y
  const ahead = Math.hypot(aheadX, aheadY)
  if (ahead === 0) return []

  // A guess that turns a corner is the guess that flicks: it is pointing where the
  // hand was going, not where it is going.
  const along = (wasX * aheadX + wasY * aheadY) / (step * ahead)
  if (along < STRAIGHT_ENOUGH) return []

  // And never further than the hand itself is moving, so the ink reaches the nib
  // and stops there.
  const most = step * LEAD
  const held = Math.min(1, most / ahead)

  return [
    {
      ...guess,
      x: nib.x + aheadX * held,
      y: nib.y + aheadY * held,
    },
  ]
}

/** How far apart the points the outliner is given are, in plane units. Fine
 *  enough that handwriting keeps every turn it had. */
const STEP = 1

/** And never more points than this, however long the stroke is: a line drawn
 *  right across a plane that has been zoomed out is thousands of units long and
 *  needs no more of them than a written word does. */
const MOST = 2000

/** The line walked at an even step, with pressure carried along it.
 *
 *  The outliner smooths the points it is handed one at a time, so how smooth a
 *  stroke comes out depends on how many of them there are. A hand moving slowly
 *  reports five times as many samples over the same curve as one moving fast,
 *  and a stroke written down with the points that said nothing dropped has fewer
 *  again: one curve, three shapes. Walking it at an even step first takes the
 *  counting out of it, so the stroke that lands on the plane is the stroke that
 *  was under the nib, and a slow hand and a fast one draw alike.
 *
 *  The first and last points are always kept, so the ink starts and ends where
 *  the pen did. */
function evenly(points: readonly InkPoint[]): InkPoint[] {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last || points.length < 3) return [...points]

  let length = 0
  for (let one = 1; one < points.length; one++) {
    const from = points[one - 1]
    const to = points[one]
    if (from && to) length += Math.hypot(to.x - from.x, to.y - from.y)
  }

  const step = Math.max(STEP, length / MOST)
  const walked: InkPoint[] = [first]
  // How far past the last point put down the walk has got, so a step carries on
  // across a segment boundary rather than starting again at every sample.
  let over = 0

  for (let one = 1; one < points.length; one++) {
    const from = points[one - 1]
    const to = points[one]
    if (!from || !to) continue

    const span = Math.hypot(to.x - from.x, to.y - from.y)
    if (span === 0) continue

    for (let at = step - over; at < span; at += step) {
      walked.push(between(from, to, at / span))
    }

    over = (over + span) % step
  }

  walked.push(last)
  return walked
}

/** How long a step between two samples has to be, in nibs, before the curve through
 *  it is drawn rather than the straight line. */
const COARSE = 1.2

/** And never more than this many points on one step, however long it is. A step long
 *  enough to want more than eight is a hand that moved further than a letter between
 *  two events, and eight is already a curve. */
const MOST_ON_A_STEP = 8

/** The samples with the curve through them drawn, where a browser reported too few
 *  of them to be drawn as lines.
 *
 *  A browser hands over what it has. Chromium reports a nib two hundred times a
 *  second and hands over every sample between two frames in `getCoalescedEvents`;
 *  Safari has never had that call at all and reports what fits in a frame. The same
 *  hand writing the same word is two hundred points on one and thirty on the other,
 *  and thirty points joined by straight lines is a word with corners in it. The
 *  answer cannot be to lean on a call half the browsers there are do not have: it is
 *  to draw the curve the samples describe, which is the same curve either way.
 *
 *  So a step longer than the nib is wide has the curve through it drawn, and anything
 *  finer is left exactly as it was reported - a dense stroke is not something to
 *  improve, and the fast path is one comparison a point. The samples themselves are
 *  never moved: the ink still passes through every point the pen reported, which is
 *  what makes this an interpolation rather than a smoothing.
 *
 *  Judged against the nib rather than against a distance on screen, because the nib
 *  is what the corner would show up in: a stroke drawn while the plane is zoomed out
 *  covers more plane units a sample, and its corners are just as visible. */
export function smoothed(points: readonly InkPoint[], size: number): readonly InkPoint[] {
  if (points.length < 3) return points

  const most = Math.max(size * COARSE, STEP)
  let coarse = false
  for (let one = 1; one < points.length && !coarse; one++) {
    const from = points[one - 1]
    const to = points[one]
    if (from && to && Math.hypot(to.x - from.x, to.y - from.y) > most) coarse = true
  }

  if (!coarse) return points

  const out: InkPoint[] = []

  for (let one = 1; one < points.length; one++) {
    const from = points[one - 1]
    const to = points[one]
    if (!from || !to) continue

    out.push(from)

    const span = Math.hypot(to.x - from.x, to.y - from.y)
    if (span <= most) continue

    // The two samples either side steer the curve. At the ends of a stroke there is
    // no sample to steer with, so one is reflected: the curve then leaves the first
    // point and arrives at the last one straight, which is what a pen does.
    const before = points[one - 2] ?? mirrored(from, to)
    const after = points[one + 1] ?? mirrored(to, from)
    const many = Math.min(MOST_ON_A_STEP, Math.ceil(span / most) - 1)

    for (let at = 1; at <= many; at++) {
      out.push(curved(before, from, to, after, at / (many + 1)))
    }
  }

  const last = points[points.length - 1]
  if (last) out.push(last)

  return out
}

/** A sample as far the other side of `from` as `to` is this side of it. */
function mirrored(from: InkPoint, to: InkPoint): InkPoint {
  return { ...from, x: 2 * from.x - to.x, y: 2 * from.y - to.y }
}

/** Never divided by, so two samples in the same place do not become a not-a-number
 *  halfway through a letter. */
const TINY = 1e-6

/** A point on the curve through four samples, `share` of the way from the second to
 *  the third: Catmull and Rom, with each span weighted by the square root of its own
 *  length.
 *
 *  Centripetal rather than uniform, which is the whole reason this is written down
 *  rather than taken off a shelf. A uniform spline through samples that are not
 *  evenly spaced loops back on itself at a sharp turn, and a loop in the middle of a
 *  letter is worse than the corner it was drawn to hide. The centripetal one cannot
 *  do it: between two samples it has no cusp and never crosses itself, whatever the
 *  hand did.
 *
 *  Everything else the digitiser said rides along in proportion, so the ink between
 *  two samples is as hard-pressed and as far over as the line between them was. */
function curved(
  before: InkPoint,
  from: InkPoint,
  to: InkPoint,
  after: InkPoint,
  share: number,
): InkPoint {
  const span = (a: InkPoint, b: InkPoint) =>
    Math.max(TINY, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)))
  const first = span(before, from)
  const middle = span(from, to)
  const last = span(to, after)

  const dx = to.x - from.x
  const dy = to.y - from.y

  // The tangents at the two ends, from the three spans: a Catmull-Rom spline read as
  // a Hermite one, which is one cubic rather than a matrix.
  const fromX = dx + middle * ((from.x - before.x) / first - (to.x - before.x) / (first + middle))
  const fromY = dy + middle * ((from.y - before.y) / first - (to.y - before.y) / (first + middle))
  const toX = dx + middle * ((after.x - to.x) / last - (after.x - from.x) / (middle + last))
  const toY = dy + middle * ((after.y - to.y) / last - (after.y - from.y) / (middle + last))

  const t = share
  const t2 = t * t
  const t3 = t2 * t
  const here = 2 * t3 - 3 * t2 + 1
  const there = -2 * t3 + 3 * t2
  const leaving = t3 - 2 * t2 + t
  const arriving = t3 - t2

  return {
    ...between(from, to, share),
    x: here * from.x + there * to.x + leaving * fromX + arriving * toX,
    y: here * from.y + there * to.y + leaving * fromY + arriving * toY,
  }
}

/** A point part of the way along a segment, with everything the digitiser said
 *  about the two ends mixed in the same proportion. */
function between(from: InkPoint, to: InkPoint, share: number): InkPoint {
  const mix = (a: number, b: number) => a + (b - a) * share

  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    pressure: mix(from.pressure, to.pressure),
    tiltX: mix(from.tiltX, to.tiltX),
    tiltY: mix(from.tiltY, to.tiltY),
    t: Math.round(mix(from.t, to.t)),
  }
}

/** Somewhere a ring can be drawn to. A `Path2D` is one, and so is the little
 *  builder the SVG export keeps, so the shape of a stroke is worked out once
 *  here and every surface that paints one paints the same curve. */
export interface InkSink {
  moveTo(x: number, y: number): void
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void
  closePath(): void
}

/** A ring drawn as one smooth closed curve: a quadratic through every point of
 *  it, from the middle of one segment to the middle of the next.
 *
 *  Drawn as straight segments instead, a ring shows every corner it has the
 *  moment there are few of them, and that is exactly what a stroke becomes once
 *  the points that said nothing have been dropped: the curve the pen drew, in
 *  flats. Under the nib the same ring has hundreds of points and its flats are
 *  too short to see, so a stroke used to go visibly hard the instant it was
 *  written down. Curved, twenty points read as a curve, four hundred cost the
 *  same to paint, and the stroke that lands is the stroke that was drawn.
 *
 *  A ring of fewer than three points encloses nothing and is left undrawn. */
export function traceInk(ring: readonly Point[], sink: InkSink): void {
  const count = ring.length
  if (count < 3) return

  const first = ring[0]
  const last = ring[count - 1]
  if (!first || !last) return

  sink.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2)

  for (let one = 0; one < count; one++) {
    const at = ring[one]
    const next = ring[(one + 1) % count]
    if (!at || !next) continue

    // The point itself steers and the middle of the next segment is landed on,
    // so the curve is smooth at every one of them and passes through none.
    sink.quadraticCurveTo(at.x, at.y, (at.x + next.x) / 2, (at.y + next.y) / 2)
  }

  sink.closePath()
}

/** A ring as an SVG path, curved exactly as the app paints it, so a picture that
 *  has left the app - an export, or the preview in the pen's own popover - is the
 *  picture that was on screen. */
export function inkPath(ring: readonly Point[]): string {
  const out: string[] = []
  const round = (value: number) => Math.round(value * 10) / 10

  traceInk(ring, {
    moveTo: (x, y) => out.push(`M${round(x)} ${round(y)}`),
    quadraticCurveTo: (cx, cy, x, y) =>
      out.push(`Q${round(cx)} ${round(cy)} ${round(x)} ${round(y)}`),
    closePath: () => out.push('Z'),
  })

  return out.join(' ')
}

/** How thick a blade is along its own edge, against how wide it is across. A
 *  chisel tip pressed down and lifted leaves a dash rather than a disc, and this
 *  is how deep that dash is. */
const NIB_DEPTH = 0.16

/** A flat nib's outline: every point offset by the same vector one way, then the
 *  same points offset the other way on the return leg. Because the offset never
 *  turns, the stroke is broad across the nib and vanishes along it, which is
 *  what a chisel-tipped pen does. */
function ribbon(points: readonly InkPoint[], size: number, style: InkStyle): Point[] {
  const angle = ((style.nib ?? 0) * Math.PI) / 180
  const half = size / 2
  const ax = Math.cos(angle)
  const ay = Math.sin(angle)

  const only = points.length === 1 ? points[0] : undefined
  if (only) {
    // A tap. Going out along the nib and back along it again encloses nothing, so
    // the one point becomes the four corners of the blade's own footprint: as wide
    // as the nib across, and as deep as the blade is thick along it.
    const width = half * (1 - style.thinning * (1 - only.pressure))
    const depth = (size * NIB_DEPTH) / 2
    const bx = -ay * depth
    const by = ax * depth

    return [
      { x: only.x + ax * width + bx, y: only.y + ay * width + by },
      { x: only.x - ax * width + bx, y: only.y - ay * width + by },
      { x: only.x - ax * width - bx, y: only.y - ay * width - by },
      { x: only.x + ax * width - bx, y: only.y + ay * width - by },
    ]
  }

  const forward: Point[] = []
  const back: Point[] = []

  for (const point of points) {
    const width = half * (1 - style.thinning * (1 - point.pressure))
    forward.push({ x: point.x + ax * width, y: point.y + ay * width })
    back.unshift({ x: point.x - ax * width, y: point.y - ay * width })
  }

  return [...forward, ...back]
}

/** The box of every stroke that has been asked about, kept.
 *
 *  A pointer moving over a plane of five thousand strokes asks all five thousand
 *  where they are, sixty times a second, and walking every point of every one of
 *  them is the difference between a canvas that pans and one that does not. Weak,
 *  and keyed on the stroke itself: every edit hands back a new object for what it
 *  touched, so the answers cannot go stale and nothing has to sweep up. */
const boxes = new WeakMap<InkStroke, Box>()

/** The box a stroke covers, with room for its own width, so a stroke can be
 *  culled from a frame, or from a hit test, without working its outline out. */
export function strokeBox(stroke: InkStroke): Box {
  const held = boxes.get(stroke)
  if (held) return held

  const box = measured(stroke)
  boxes.set(stroke, box)
  return box
}

function measured(stroke: InkStroke): Box {
  const [first] = stroke.points
  if (!first) return { x: 0, y: 0, width: 0, height: 0 }

  let least = first.x
  let most = first.x
  let lowest = first.y
  let highest = first.y

  for (const point of stroke.points) {
    if (point.x < least) least = point.x
    if (point.x > most) most = point.x
    if (point.y < lowest) lowest = point.y
    if (point.y > highest) highest = point.y
  }

  const room = stroke.size
  return {
    x: least - room,
    y: lowest - room,
    width: most - least + 2 * room,
    height: highest - lowest + 2 * room,
  }
}

/** How far off the line a point may sit and still be dropped, as a share of the
 *  nib's width. A pen reports far more samples than a line needs. */
const TOLERANCE = 0.12

/** And never further than this, in plane units, whatever the nib.
 *
 *  What is dropped here is what the stroke on the plane is drawn from ever
 *  after, so the tolerance is how far the ink may move when the pen comes up. A
 *  broad nib hides more than a fine one, but not without limit: at a tenth of a
 *  plane unit nothing moves that an eye could follow at any zoom, and a
 *  highlighter smoothed by two units visibly changed shape as it landed. */
const FURTHEST = 0.3

/** The same stroke with the points that say nothing taken out: Ramer, Douglas
 *  and Peucker, which keeps every corner and drops the middle of every straight
 *  run. Pressure and tilt ride along on the points that are kept.
 *
 *  A point says something in two ways, and both are measured here in the plane
 *  units the ink moves by. Where it is, which is how far it sits off the line
 *  between its neighbours; and how hard the pen was pressed there, since on a
 *  pen that thins with pressure a swell dropped from the middle of a stroke is
 *  the line visibly changing width. `swell` is what a whole unit of pressure is
 *  worth in width, so a pen that ignores pressure passes nought and gets plain
 *  Douglas-Peucker.
 *
 *  Done once, when the pen comes up, so what is written down is a fraction of
 *  what the digitiser said and looks exactly the same. */
export function simplified(points: readonly InkPoint[], tolerance: number, swell = 0): InkPoint[] {
  if (points.length < 3) return [...points]

  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack: [number, number][] = [[0, points.length - 1]]

  while (stack.length) {
    const span = stack.pop()
    if (!span) break

    const [from, to] = span
    const start = points[from]
    const end = points[to]
    if (!start || !end || to - from < 2) continue

    let worst = -1
    let at = -1

    for (let one = from + 1; one < to; one++) {
      const point = points[one]
      if (!point) continue

      // Pressure is read off where the point sits between the two ends, which is
      // how the ink is drawn between them once the point itself has gone.
      const share = (one - from) / (to - from)
      const guessed = start.pressure + (end.pressure - start.pressure) * share
      const away = awayFromSegment(point, start, end) + swell * Math.abs(point.pressure - guessed)

      if (away > worst) {
        worst = away
        at = one
      }
    }

    if (at < 0 || worst <= tolerance) continue

    keep[at] = 1
    stack.push([from, at], [at, to])
  }

  return points.filter((_point, index) => keep[index] === 1)
}

/** A stroke ready to be written down: fewer points, and none of the jitter a
 *  digitiser reports while the nib is nearly still. */
export function tidied(stroke: InkStroke): InkStroke {
  // Half the width the nib gains between a feather touch and a firm one: what
  // one whole unit of pressure moves the edge of the stroke by.
  const swell = (stroke.size * INK_STYLES[stroke.tool].thinning) / 2

  return {
    ...stroke,
    points: simplified(stroke.points, Math.min(stroke.size * TOLERANCE, FURTHEST), swell),
  }
}

/** Whether a stroke passes within `reach` of a point: what the stroke eraser and
 *  a tap on a line both ask. The nib's own width counts, so a fat highlighter is
 *  hit where it looks like it is. */
export function nearStroke(stroke: InkStroke, point: Point, reach: number): boolean {
  const room = reach + stroke.size / 2
  const box = strokeBox(stroke)
  if (
    point.x < box.x - room ||
    point.x > box.x + box.width + room ||
    point.y < box.y - room ||
    point.y > box.y + box.height + room
  ) {
    return false
  }

  const points = stroke.points
  if (points.length === 1) {
    const only = points[0]
    return !!only && Math.hypot(point.x - only.x, point.y - only.y) <= room
  }

  for (let one = 1; one < points.length; one++) {
    const from = points[one - 1]
    const to = points[one]
    if (from && to && awayFromSegment(point, from, to) <= room) return true
  }

  return false
}

/** The stroke with the part under the eraser taken out. One stroke goes in and
 *  nought, one or several come out: rubbing through the middle of a line leaves
 *  the two ends, which is what a partial eraser means and what a stroke eraser
 *  deliberately does not do.
 *
 *  A piece of one point is dropped: a stroke with nothing to draw between is not
 *  ink, it is a speck the eraser missed. */
export function erased(stroke: InkStroke, at: Point, reach: number): InkStroke[] {
  const room = reach + stroke.size / 2
  const pieces: InkPoint[][] = []
  let piece: InkPoint[] = []

  for (const point of stroke.points) {
    if (Math.hypot(point.x - at.x, point.y - at.y) <= room) {
      if (piece.length > 1) pieces.push(piece)
      piece = []
      continue
    }

    piece.push(point)
  }

  if (piece.length > 1) pieces.push(piece)

  // Untouched: the same object back, so a rub that met nothing costs nothing and
  // the caller can tell in one comparison.
  if (pieces.length === 1 && pieces[0]?.length === stroke.points.length) return [stroke]

  return pieces.map((points, index) => ({
    ...stroke,
    // The first piece keeps the name, so an eraser that only shortened a line
    // leaves the same stroke rather than a new one for a sync to argue over.
    // Every other piece is a stroke that did not exist before and is named like
    // one: counting from the stroke it came out of would hand the same name out
    // twice the second time the same line is cut, and the plane would lose a
    // piece of the drawing the next time the file was read.
    id: index === 0 ? stroke.id : freshId(),
    points: retimed(points),
  }))
}

/** Times counted from the first point again, so a piece cut out of the middle of
 *  a stroke still starts at zero. */
function retimed(points: readonly InkPoint[]): InkPoint[] {
  const [first] = points
  if (!first) return []

  return points.map((point) => ({ ...point, t: point.t - first.t }))
}

/** Whether a point is inside a closed polygon: the ray-crossing count, which is
 *  what a lasso asks of everything it might have caught. */
export function insidePolygon(polygon: readonly Point[], point: Point): boolean {
  let inside = false

  for (let one = 0, other = polygon.length - 1; one < polygon.length; other = one++) {
    const a = polygon[one]
    const b = polygon[other]
    if (!a || !b) continue

    if (a.y > point.y !== b.y > point.y) {
      const across = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      if (point.x < across) inside = !inside
    }
  }

  return inside
}

/** Every stroke a lasso caught: one whose points are all inside it, so half a
 *  word is never dragged away from the other half. `partly` is the other answer,
 *  for a box pulled over three lines of handwriting where the long strokes always
 *  poke out of it: a stroke it touched at all is caught. */
export function strokesInLasso(
  strokes: readonly InkStroke[],
  lasso: readonly Point[],
  partly = false,
): string[] {
  if (lasso.length < 3) return []

  return strokes
    .filter((stroke) =>
      partly
        ? stroke.points.some((point) => insidePolygon(lasso, point))
        : stroke.points.every((point) => insidePolygon(lasso, point)),
    )
    .map((stroke) => stroke.id)
}

/** A stroke moved, scaled and turned in one pass. The whole of a selection goes
 *  through this, so a lasso that is dragged, pulled bigger and spun round is one
 *  arithmetic rather than three. */
export interface InkTransform {
  dx: number
  dy: number
  /** Multiplied about `about`. One each means no change. */
  sx: number
  sy: number
  /** Radians about `about`. */
  turn: number
  about: Point
}

/** A stroke scaled about a point, turned about it, and moved. One pass, because
 *  a lasso that is dragged, pulled bigger and spun round is one arithmetic
 *  rather than three. */
export function transformed(stroke: InkStroke, by: InkTransform): InkStroke {
  const cos = Math.cos(by.turn)
  const sin = Math.sin(by.turn)

  return {
    ...stroke,
    // The nib grows with the drawing: writing pulled to twice the size is twice
    // as thick, the way it would be if it had been written that big. A stroke
    // stretched one way takes the smaller of the two, since a nib is round.
    size: stroke.size * Math.min(Math.abs(by.sx), Math.abs(by.sy)),
    points: stroke.points.map((point) => {
      const x = (point.x - by.about.x) * by.sx
      const y = (point.y - by.about.y) * by.sy

      return {
        ...point,
        x: by.about.x + x * cos - y * sin + by.dx,
        y: by.about.y + x * sin + y * cos + by.dy,
      }
    }),
  }
}

/** How straight a stroke has to be before it is taken for a line, as a share of
 *  its own length. */
const STRAIGHT = 0.06
/** How near the two ends have to be before a stroke counts as closed. */
const CLOSED = 0.22
/** How round a closed stroke has to be before it is taken for an ellipse rather
 *  than a rectangle: the spread of its radius about the mean, as a share of it.
 *
 *  A square's own spread is about 0.115, since its corners are half again as far
 *  from the middle as its sides; a hand-drawn ring wobbling by a tenth comes out
 *  near 0.06. The line between them is here. */
const ROUND = 0.08

export type Assisted = 'line' | 'ellipse' | 'rectangle'

/** What a stroke was probably meant to be, or null for one that was meant to be
 *  itself. Held still at the end of a stroke and this is what it becomes.
 *
 *  Three answers rather than a menagerie: a line, a ring and a box are what
 *  anybody actually draws by hand and wants tidied, and a fourth would only make
 *  the other three less certain. */
export function assisted(stroke: InkStroke): Assisted | null {
  const points = stroke.points
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last || points.length < 6) return null

  const box = strokeBox(stroke)
  const across = box.width - 2 * stroke.size
  const down = box.height - 2 * stroke.size
  const span = Math.hypot(across, down)
  if (span < stroke.size * 4) return null

  const ends = Math.hypot(last.x - first.x, last.y - first.y)

  if (ends > span * CLOSED) {
    let worst = 0
    for (const point of points) worst = Math.max(worst, awayFromSegment(point, first, last))

    return worst <= ends * STRAIGHT ? 'line' : null
  }

  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const radii = points.map((point) => Math.hypot(point.x - middle.x, point.y - middle.y))
  const mean = radii.reduce((sum, one) => sum + one, 0) / radii.length
  if (mean === 0) return null

  const spread =
    Math.sqrt(radii.reduce((sum, one) => sum + (one - mean) ** 2, 0) / radii.length) / mean

  return spread <= ROUND ? 'ellipse' : 'rectangle'
}

/** How many points a tidied shape is drawn with. Enough that an ellipse reads as
 *  a curve at any zoom the camera allows. */
const SIDES = 64

/** The stroke a held pen becomes: the same ink, on the shape it was aiming at,
 *  at an even pressure so a tidied line does not wobble in width. */
export function tidyShape(stroke: InkStroke, shape: Assisted): InkStroke {
  const box = strokeBox(stroke)
  const room = stroke.size
  const inner = {
    x: box.x + room,
    y: box.y + room,
    width: Math.max(0, box.width - 2 * room),
    height: Math.max(0, box.height - 2 * room),
  }

  const last = stroke.points[stroke.points.length - 1]
  const span = last?.t ?? 0
  const at = (points: Point[]): InkStroke => ({
    ...stroke,
    points: points.map((point, index) => ({
      ...point,
      pressure: 0.6,
      tiltX: 0,
      tiltY: 0,
      t: Math.round((span * index) / Math.max(1, points.length - 1)),
    })),
  })

  switch (shape) {
    case 'line': {
      const first = stroke.points[0]
      if (!first || !last) return stroke
      return at([
        { x: first.x, y: first.y },
        { x: last.x, y: last.y },
      ])
    }
    case 'rectangle':
      return at([
        { x: inner.x, y: inner.y },
        { x: inner.x + inner.width, y: inner.y },
        { x: inner.x + inner.width, y: inner.y + inner.height },
        { x: inner.x, y: inner.y + inner.height },
        { x: inner.x, y: inner.y },
      ])
    case 'ellipse': {
      const middle = { x: inner.x + inner.width / 2, y: inner.y + inner.height / 2 }
      const points: Point[] = []
      for (let one = 0; one <= SIDES; one++) {
        const angle = (one / SIDES) * Math.PI * 2
        points.push({
          x: middle.x + (Math.cos(angle) * inner.width) / 2,
          y: middle.y + (Math.sin(angle) * inner.height) / 2,
        })
      }
      return at(points)
    }
  }
}
