/** The graph, drawn.
 *
 *  Canvas rather than elements: a space of thousands of notes is thousands of
 *  circles and twice as many lines, and that many DOM nodes cannot be panned at
 *  sixty frames a second.
 *
 *  Everything of one colour is collected into one path and filled once, which is
 *  what keeps the whole picture to a handful of drawing calls however many notes
 *  are in it: eight for the nodes - the four kinds, each faint or not - one more per
 *  colour group in use, a handful for the lines and one for every arrowhead
 *  together. Colours come in from the stylesheet, so the graph is whatever the theme
 *  says it is.
 *
 *  What is hidden is hidden here rather than taken out of the graph. A filter, the
 *  orphan switch and the time being scrubbed to all arrive as one byte per node, so
 *  changing any of them costs this one pass and never a new arrangement: the notes
 *  that are still shown do not move. See `shown`. */

import type { Camera } from './camera'
import { SMALLEST_DOT } from './camera'
import type { NoteGraph } from './graph'

/** How wide a note is drawn, in graph units, by how many links it has. The square
 *  root, so a note with a hundred links is noticeably bigger than one with four
 *  and not twenty five times bigger, and a ceiling on top of that: past a few
 *  dozen links the only thing a bigger circle says is that it covers the notes
 *  behind it. */
export function radiusOf(degree: number): number {
  return 3 + Math.min(7, Math.sqrt(degree))
}

/** How faint everything that is not being pointed at goes. */
const DIMMED = 0.16

/** Half the side of the square a file a note embeds is drawn as, as a fraction of
 *  the radius a note of the same size would have: close enough in area that a
 *  picture among notes reads as another shape rather than as a bigger thing. */
const SQUARE = 0.88

/** How close the view has to be before the names appear, and where they are fully
 *  there. Below the first a label would be smaller than the gaps between the notes;
 *  between the two they fade up, so a name arrives as the view comes in rather than
 *  four hundred of them appearing at once on one notch of the wheel.
 *
 *  A threshold that follows the zoom, so there is nothing to set - and one dial for
 *  where it sits, because how dense a space is is a fact about the space rather than
 *  about the picture of one. `fade` multiplies both: one is these two numbers
 *  exactly, below one the names arrive while the space is still small, above one they
 *  wait until the view is in among the notes. See `fade` in
 *  workspace/graph-settings.svelte.ts. */
const LABELS_FROM = 0.55
const LABELS_FULL = 0.85

/** How many names are worth drawing at once. Past this the view is showing more
 *  notes than anyone reads at a glance, and the text is what costs. */
const MOST_LABELS = 400

const LABEL_SIZE = 11

/** How wide a link is drawn, in the screen's own pixels rather than in the page's,
 *  at each of the three steps the Lines dial offers.
 *
 *  A link is a hairline, and a hairline is one pixel of the screen: at one device
 *  pixel Skia strokes a line by walking it, and above that it tessellates the
 *  stroke into geometry and hands it to the card as a shape. The difference is not
 *  a few per cent. Measured on a space of five thousand notes and ten thousand
 *  links, on a screen at two device pixels to the page's one: 617 ms a frame at one
 *  page pixel, 17 ms at one device pixel. Two frames a second against sixty, for a
 *  line half a pixel thinner on a dense screen - and thinner is what a picture of
 *  ten thousand links wants anyway. See test/e2e/graph.py, which is where those
 *  numbers come from and what measures them again.
 *
 *  Which is why the thick step is not a wider stroke. The cliff is at one device
 *  pixel exactly - measured again for the dial, on the same five thousand notes:
 *  20 ms a frame at one device pixel and 3.6 seconds at one and a quarter - so
 *  thick is the same hairline stroked three times, a device pixel apart in x and in
 *  y. A line comes out two device pixels wide whichever way it runs, and every one
 *  of the three strokes is still a hairline. See `brushed`.
 *
 *  The lit ones are the handful around whatever the pointer is on, so they can
 *  afford to be twice as wide and say so: a dozen tessellated lines cost nothing. */
const LINES: readonly { wide: number; brush: readonly (readonly [number, number])[] }[] = [
  { wide: 0.6, brush: [[0, 0]] },
  { wide: 1, brush: [[0, 0]] },
  {
    wide: 1,
    brush: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  },
]

/** How wide the handful of lit links are at each step, in the screen's pixels. */
const LIT_LINES: readonly number[] = [1.2, 2, 4]

/** One device pixel, which is what a ring around a node the space has not got is
 *  drawn at whatever the dial says: it is a node rather than a link. */
const HAIRLINE = 1

/** How wide the ring around the note being read is, in the screen's pixels. One
 *  circle, so nothing about the frame rate turns on it. */
const RING_PIXELS = 2

/** How close the view has to be before arrowheads are worth drawing. Further out
 *  than this they are a smudge at the end of a line, and ten thousand smudges are
 *  what a picture of a space does not need. */
const ARROWS_FROM = 0.4
/** An arrowhead, in pixels: how far back from the node it starts and how wide it
 *  opens. Small, because it is a hint about one link rather than a symbol. */
const HEAD_LONG = 7
const HEAD_WIDE = 3

/** The colours the graph is drawn in, all of them from the tokens. No ground
 *  among them: the canvas is left transparent and the surface it sits on shows
 *  through, so the graph is on the same ground as whatever is around it. */
export interface GraphColours {
  edge: string
  litEdge: string
  node: string
  hollow: string
  current: string
  label: string
  font: string
  /** The six the theme names, resolved: a 2d context cannot look `var(--canvas-1)`
   *  up, so they are read off the stylesheet with the rest. A note in a colour group
   *  is drawn in one of these. */
  groups: string[]
}

export interface GraphView {
  graph: NoteGraph
  x: Float64Array
  y: Float64Array
  radii: Float64Array
  camera: Camera
  width: number
  height: number
  colours: GraphColours
  /** Which node is the note being read, or -1. */
  current: number
  /** Which node the pointer is on, or -1. Everything not touching it is faint. */
  hovered: number
  /** One byte per node: 2 for the hovered node, 1 for one joined to it, 0 for
   *  the rest, which go faint. Read only while something is hovered. */
  lit: Uint8Array
  /** One byte per node: 1 for a note the reader is being shown, 0 for one the
   *  filter, the orphan switch or the time being scrubbed to has taken out. An edge
   *  with either end hidden is not drawn.
   *
   *  Hiding rather than removing, and here rather than in the graph, is the whole
   *  of why a filter costs one frame: the arrangement is over every note that
   *  passed, so turning a switch or dragging the scrub bar changes what is painted
   *  and never where anything is. Nothing is laid out again. */
  shown: Uint8Array
  /** One byte per node: which colour group it is in, counting from zero, or -1 for
   *  none. */
  tint: Int8Array
  /** Whether a link is drawn with a head saying which note reached for which. */
  arrows: boolean
  /** How wide a link is drawn: 1 thin, 2 the hairline the picture has always had,
   *  3 thick. See `LINES`. */
  lines: number
  /** Where the names fade in, as a multiple of `LABELS_FROM`. One is the zoom they
   *  have always faded in at. */
  fade: number
  /** How many of the screen's pixels one of the page's is worth, which is what the
   *  context has been scaled by. The line widths are stated in the screen's; see
   *  `LINES`. */
  ratio: number
}

/** One pass over the graph, into as few drawing calls as it takes. */
export function paint(context: CanvasRenderingContext2D, view: GraphView) {
  const { graph, x, y, radii, camera, width, height, colours, current, hovered, lit } = view
  const { shown, tint, arrows, ratio } = view
  const highlighting = hovered >= 0
  /** One pixel of the screen, in the units everything here is drawn in. */
  const hair = 1 / Math.max(1, ratio)
  /** Which of the three widths the dial is on, as an index. */
  const step = Math.min(LINES.length, Math.max(1, Math.round(view.lines || 2))) - 1
  const line = LINES[step] ?? LINES[1]

  const scale = camera.scale
  const offsetX = width / 2 - camera.x * scale
  const offsetY = height / 2 - camera.y * scale
  const screenX = (one: number) => (x[one] ?? 0) * scale + offsetX
  const screenY = (one: number) => (y[one] ?? 0) * scale + offsetY

  // A margin the width of the largest node, so one whose centre is just off
  // screen still draws the sliver of it that shows.
  const margin = 40

  const edges = new Path2D()
  const litEdges = new Path2D()
  const heads = arrows && scale >= ARROWS_FROM ? new Path2D() : null

  for (const edge of graph.edges) {
    // A link is only as visible as the two notes it joins.
    if (!shown[edge.a] || !shown[edge.b]) continue

    const ax = screenX(edge.a)
    const ay = screenY(edge.a)
    const bx = screenX(edge.b)
    const by = screenY(edge.b)

    if (Math.max(ax, bx) < -margin || Math.min(ax, bx) > width + margin) continue
    if (Math.max(ay, by) < -margin || Math.min(ay, by) > height + margin) continue

    const path = highlighting && (lit[edge.a] === 2 || lit[edge.b] === 2) ? litEdges : edges
    path.moveTo(ax, ay)
    path.lineTo(bx, by)

    if (!heads) continue
    // At the end the link points at, just clear of the note it lands on - and at
    // both ends for a pair that link each way.
    head(heads, ax, ay, bx, by, Math.max(SMALLEST_DOT, (radii[edge.b] ?? 0) * scale))
    if (edge.both) {
      head(heads, bx, by, ax, ay, Math.max(SMALLEST_DOT, (radii[edge.a] ?? 0) * scale))
    }
  }

  context.lineWidth = (line?.wide ?? 1) * hair
  context.strokeStyle = colours.edge
  context.globalAlpha = highlighting ? DIMMED : 1
  brushed(context, edges, line?.brush ?? [[0, 0]], hair)
  if (heads) {
    context.fillStyle = colours.edge
    context.fill(heads)
  }

  if (highlighting) {
    context.lineWidth = (LIT_LINES[step] ?? 2) * hair
    context.strokeStyle = colours.litEdge
    context.globalAlpha = 1
    context.stroke(litEdges)
  }

  // Six paths: the three kinds of node, each faint or not.
  const plain = new Path2D()
  const litPlain = new Path2D()
  const hollow = new Path2D()
  const litHollow = new Path2D()
  const here = new Path2D()
  const litHere = new Path2D()
  /** The files the notes embed, which are squares rather than dots. */
  const files = new Path2D()
  const litFiles = new Path2D()
  /** Which nodes are on screen and close enough to name, gathered on the way
   *  past so the labels do not walk the whole graph again. */
  const naming: number[] = []
  /** Where the names start arriving and where they are fully there, as the dial has
   *  asked for them. */
  const namesFrom = LABELS_FROM * (view.fade || 1)
  const namesFull = LABELS_FULL * (view.fade || 1)
  const labelling = scale >= namesFrom
  /** One path per colour group, and one for the groups' nodes brought forward.
   *  Made only where a group has something in it, so a space with no groups pays
   *  nothing for them. */
  const grouped: (Path2D | undefined)[] = []
  const litGrouped: (Path2D | undefined)[] = []

  for (let one = 0; one < graph.nodes.length; one++) {
    if (!shown[one]) continue

    const px = screenX(one)
    const py = screenY(one)
    if (px < -margin || px > width + margin || py < -margin || py > height + margin) continue

    const radius = Math.max(SMALLEST_DOT, (radii[one] ?? 0) * scale)
    // With nothing hovered there is nothing to bring forward: the whole picture
    // is drawn plainly, at full strength.
    const brought = highlighting && lit[one] !== 0
    const group = tint[one] ?? -1

    const node = graph.nodes[one]
    // A file a note embeds is a square rather than a dot, which is the same way the
    // picture already says a thing is not what its neighbours are: a note the space
    // has not got is a ring, and a picture is a square.
    const attached = node?.attachment === true

    const path = attached
      ? brought
        ? litFiles
        : files
      : one === current
        ? brought
          ? litHere
          : here
        : // A note in a colour group wears its group's colour rather than the plain
          // one, and a note the space does not hold is still a ring: a group says
          // which notes these are, not whether they exist.
          group >= 0 && node?.path !== null
          ? brought
            ? (litGrouped[group] ??= new Path2D())
            : (grouped[group] ??= new Path2D())
          : node?.path === null
            ? brought
              ? litHollow
              : hollow
            : brought
              ? litPlain
              : plain

    if (attached) {
      // A square of about a dot's area, so a picture among notes is a different
      // shape rather than a bigger thing.
      const side = radius * SQUARE
      path.rect(px - side, py - side, side * 2, side * 2)
    } else {
      path.moveTo(px + radius, py)
      path.arc(px, py, radius, 0, Math.PI * 2)
    }

    if (labelling && naming.length < MOST_LABELS) naming.push(one)
  }

  context.globalAlpha = highlighting ? DIMMED : 1
  fill(context, plain, colours.node)
  fill(context, files, colours.node)
  fill(context, here, colours.current)
  outline(context, hollow, colours.hollow, hair)
  fillGroups(context, grouped, colours.groups)

  if (highlighting) {
    context.globalAlpha = 1
    fill(context, litPlain, colours.node)
    fill(context, litFiles, colours.node)
    fill(context, litHere, colours.current)
    outline(context, litHollow, colours.hollow, hair)
    fillGroups(context, litGrouped, colours.groups)
  }

  // The note being read wears a ring as well as the accent, so it is the one
  // node that can be picked out without hovering anything.
  if (current >= 0 && shown[current]) {
    const px = screenX(current)
    const py = screenY(current)
    const radius = Math.max(SMALLEST_DOT, (radii[current] ?? 0) * scale)

    context.globalAlpha = highlighting && lit[current] === 0 ? DIMMED : 1
    context.strokeStyle = colours.current
    context.lineWidth = Math.max(1.2, RING_PIXELS * hair)
    context.beginPath()
    context.arc(px, py, radius + 3.5, 0, Math.PI * 2)
    context.stroke()
  }

  if (!labelling) {
    context.globalAlpha = 1
    return
  }

  context.font = `${LABEL_SIZE}px ${colours.font}`
  context.textAlign = 'center'
  context.textBaseline = 'top'
  context.fillStyle = colours.label

  // How far up the fade the view has come, so the names arrive rather than appear.
  const arriving = Math.min(1, (scale - namesFrom) / (namesFull - namesFrom))

  for (const one of naming) {
    context.globalAlpha = (highlighting && lit[one] === 0 ? DIMMED : 1) * arriving
    const radius = Math.max(SMALLEST_DOT, (radii[one] ?? 0) * scale)
    context.fillText(graph.nodes[one]?.name ?? '', screenX(one), screenY(one) + radius + 3)
  }

  context.globalAlpha = 1
}

function fill(context: CanvasRenderingContext2D, path: Path2D, colour: string) {
  context.fillStyle = colour
  context.fill(path)
}

/** The links, stroked once per place the brush puts them.
 *
 *  One path moved rather than a second path built: the path is ten thousand lines,
 *  and the thick step wants the same ten thousand a device pixel over. Which is the
 *  whole trick - three hairlines a pixel apart read as one line two pixels wide, and
 *  a stroke wider than a device pixel is what costs three and a half seconds a
 *  frame. See `LINES`. */
function brushed(
  context: CanvasRenderingContext2D,
  path: Path2D,
  brush: readonly (readonly [number, number])[],
  hair: number,
) {
  for (const [dx, dy] of brush) {
    if (!dx && !dy) {
      context.stroke(path)
      continue
    }

    context.save()
    context.translate(dx * hair, dy * hair)
    context.stroke(path)
    context.restore()
  }
}

/** Each colour group's notes, one fill per colour. */
function fillGroups(
  context: CanvasRenderingContext2D,
  paths: readonly (Path2D | undefined)[],
  colours: readonly string[],
) {
  for (let group = 0; group < paths.length; group++) {
    const path = paths[group]
    const colour = colours[group]
    if (path && colour) fill(context, path, colour)
  }
}

/** An arrowhead at the `b` end of a line, pulled back by the radius of the note it
 *  lands on so it sits against the circle rather than under it. Two lines rather
 *  than a filled triangle would be a third stroke of its own; this goes in the one
 *  path every head shares. */
function head(path: Path2D, ax: number, ay: number, bx: number, by: number, radius: number): void {
  const dx = bx - ax
  const dy = by - ay
  const length = Math.hypot(dx, dy)
  // Two notes on top of each other have no direction between them to point in.
  if (length < radius + HEAD_LONG) return

  const alongX = dx / length
  const alongY = dy / length
  const tipX = bx - alongX * radius
  const tipY = by - alongY * radius
  const backX = tipX - alongX * HEAD_LONG
  const backY = tipY - alongY * HEAD_LONG

  path.moveTo(tipX, tipY)
  path.lineTo(backX - alongY * HEAD_WIDE, backY + alongX * HEAD_WIDE)
  path.lineTo(backX + alongY * HEAD_WIDE, backY - alongX * HEAD_WIDE)
  path.closePath()
}

/** A note the space does not hold is a ring rather than a dot, the same "there is
 *  nothing here yet" the dotted link in the text says. */
function outline(context: CanvasRenderingContext2D, path: Path2D, colour: string, hair: number) {
  context.strokeStyle = colour
  context.lineWidth = HAIRLINE * hair
  context.stroke(path)
}
