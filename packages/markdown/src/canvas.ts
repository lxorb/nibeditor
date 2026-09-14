/** A canvas file, read and written.
 *
 *  Two halves. The first is JSON Canvas 1.0, which is somebody else's and is
 *  public: jsoncanvas.org/spec/1.0/. A canvas Nib writes opens in Obsidian and
 *  comes back unchanged, which is the whole reason for using it, so every field
 *  in that half is a field the spec defines and nothing written there is an
 *  invention of ours.
 *
 *  The second is one top-level key, `nib`, which holds what the spec has no
 *  place for: the ink a pen left, the shapes, when each thing was last touched
 *  and what has been thrown away. Under a key of its own rather than as a fifth
 *  node type, because the spec names four types and a file with a fifth in
 *  `nodes` asks every other reader of the format to guess. Under this key the
 *  file is the spec exactly, plus something no other app has to look at.
 *
 *  Here rather than in the app because three parts of Nib read it: the surface
 *  somebody draws on, the sync client that has to put two copies of a file back
 *  together, and the worker that notices the two copies in the first place. One
 *  reading of the format, so the three cannot drift.
 *
 *  Reading is tolerant and writing is exact, which is the usual division: a file
 *  on disk may have been written by an older app, by a newer one, or by hand, so
 *  what reads as a node becomes one and what does not is left out rather than
 *  taking the whole canvas with it. Writing puts the spec's fields down in the
 *  order the spec lists them and leaves out every one that is absent, so a
 *  canvas that has not changed is written back byte for byte. */

import { oneEdit, type TextEdit } from './edits'
import { isPaper, type Paper, PAPERS } from './papers'

/** A colour, as the spec spells it: one of six presets named `"1"` to `"6"`, or
 *  a hex string. The presets are what Obsidian writes, so a canvas coloured in
 *  either app keeps its colours in the other. */
export type CanvasColour = string

/** The six the spec names, in its order: red, orange, yellow, green, cyan,
 *  purple. What the floating bar offers, and what a file carries. */
export const PRESET_COLOURS = ['1', '2', '3', '4', '5', '6'] as const

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export type Side = 'top' | 'right' | 'bottom' | 'left'
type End = 'none' | 'arrow'
type BackgroundStyle = 'cover' | 'ratio' | 'repeat'

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']
const ENDS: readonly End[] = ['none', 'arrow']
const BACKGROUNDS: readonly BackgroundStyle[] = ['cover', 'ratio', 'repeat']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** What every node has, whichever kind it is. The spec makes all six required
 *  and the position and the size integers. */
interface NodeBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  color?: CanvasColour
}

interface TextNode extends NodeBase {
  type: 'text'
  /** Plain text, with markdown syntax. */
  text: string
}

interface FileNode extends NodeBase {
  type: 'file'
  /** A path to a file inside the space. */
  file: string
  /** A heading or a block inside that file, beginning with `#`. */
  subpath?: string
}

interface LinkNode extends NodeBase {
  type: 'link'
  url: string
}

interface GroupNode extends NodeBase {
  type: 'group'
  label?: string
  /** A path to an image. */
  background?: string
  backgroundStyle?: BackgroundStyle
}

/** What a shape is: four bodies and three lines.
 *
 *  The bodies are the four a diagram is drawn out of - a box, a ring, a diamond
 *  and a triangle - and the lines are a plain one, one with a head on it, and one
 *  that turns a corner. Seven and not eight thousand: a shape catalogue is a
 *  drawing program, and this is the set anybody sketching beside a note reaches
 *  for. */
export const SHAPES = ['rect', 'ellipse', 'rhombus', 'triangle', 'line', 'arrow', 'elbow'] as const
export type Shape = (typeof SHAPES)[number]

/** Whether a name is one of the seven. What a tool list checks before it hands a
 *  name to something that draws. */
export function isShape(value: unknown): value is Shape {
  return SHAPES.some((one) => one === value)
}

/** A shape: a node like any other in memory, so one drag, one resize and one
 *  snap serve every kind, and written under `nib` rather than into `nodes`.
 *
 *  Its box is always the right way up. A line, an arrow and an elbow run corner
 *  to corner inside it, and `up` says which pair of corners, which is how one box
 *  says all four diagonals. */
interface ShapeNode extends NodeBase {
  type: 'shape'
  shape: Shape
  /** Filled rather than drawn as an outline. */
  fill?: boolean
  /** Bottom left to top right rather than top left to bottom right. */
  up?: boolean
  /** The words inside it, with markdown syntax, the way a text card holds them.
   *  A shape in a diagram is a shape with a name on it far more often than it is
   *  a shape. */
  text?: string
}

/** The papers, which are a leaf module of their own: the app's modes store asks
 *  `isPaper` about a setting, and that store is in front of the first paint where this
 *  format deliberately is not. Re-exported here, so every reader of the format still
 *  finds them where they were. See papers.ts and test/weight.test.ts in the app. */
export { endless, isPaper, type Paper, PAPER_NAMES, PAPERS, paperSized } from './papers'

/** What is ruled on a page under everything written on it. The four the canvas's
 *  own background already offers, named the same, because it is the same drawing
 *  code: see lattice.ts in the app. */
export const PATTERNS = ['blank', 'lines', 'grid', 'dots'] as const
export type Pattern = (typeof PATTERNS)[number]

export function isPattern(value: unknown): value is Pattern {
  return PATTERNS.some((one) => one === value)
}

/** A page: a sheet with a size, a ruling, and possibly a page of a PDF behind it.
 *
 *  A node like any other, which is the whole design. Everything on a page note
 *  already lives on a plane - the cards, the pictures, the shapes, the ink - and
 *  making a page one more thing on that plane means one drag, one merge, one
 *  tombstone and one room for all of it. Nothing in the app or in a room has to
 *  know a page from a card; only this file does, and only when it writes one down.
 *
 *  On disk a page is a node the JSON Canvas spec names, so a page note renamed to
 *  `.canvas` opens in Obsidian: a page with a PDF behind it is a `file` node with
 *  `subpath: "#page=3"`, which is the spelling Obsidian's own PDF embed reads, and
 *  a page with nothing behind it is a `group` node with a label. What the spec has
 *  no word for - the size preset and the ruling - goes in one record under
 *  `nib.pages`, beside the id it belongs to. A hand-edited file that lost that
 *  record loses the ruling and keeps the page as the frame it looks like, which is
 *  the right way for this to fail.
 *
 *  `file` and `page` travel together: a page of a PDF is a path and a number, and
 *  neither means anything without the other. The PDF itself stays in the space, so
 *  Obsidian opens the paper whatever happens to this file. */
interface PageNode extends NodeBase {
  type: 'page'
  paper: Paper
  pattern: Pattern
  /** The PDF this page is a page of, relative to the space, or absent. */
  file?: string
  /** Which page of it, counting from one. */
  page?: number
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode | ShapeNode | PageNode
export type NodeKind = CanvasNode['type']

/** Whether a node is a page. The one question the app asks that this module
 *  answers rather than the app, because `type` is the only thing that says so and
 *  a string comparison spelled out in twenty places is twenty places to misspell
 *  it. */
export function isPage(node: CanvasNode): node is PageNode {
  return node.type === 'page'
}

export type { PageNode }

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: Side
  /** `none` unless it says otherwise, which is what the spec says. */
  fromEnd?: End
  toNode: string
  toSide?: Side
  /** `arrow` unless it says otherwise. */
  toEnd?: End
  color?: CanvasColour
  label?: string
}

/** The tools a pen offers. The names are the ones anybody who has held a pen
 *  already knows; what each one does to a line is in the app, beside the paint. */
export const INK_TOOLS = [
  'pen',
  'fountain',
  'pencil',
  'marker',
  'highlighter',
  'brush',
  'calligraphy',
] as const

export type InkTool = (typeof INK_TOOLS)[number]

export function isInkTool(value: unknown): value is InkTool {
  return INK_TOOLS.some((one) => one === value)
}

/** One sample from the digitiser. Tilt is in degrees the way Pointer Events give
 *  it, and `t` is milliseconds since this stroke began rather than a wall clock:
 *  small numbers, and a stroke that means the same thing whenever it is read. */
export interface InkPoint {
  x: number
  y: number
  /** 0 to 1. Half for a device that reports none, which is what the spec says. */
  pressure: number
  tiltX: number
  tiltY: number
  t: number
}

/** A stroke of ink: the points the pen went through, and never a picture of
 *  them. Vectors mean a stroke drawn at one zoom is the same stroke at every
 *  other one, and that an eraser can still cut a line in half years later. */
export interface InkStroke {
  id: string
  tool: InkTool
  color: CanvasColour
  /** The nib's width in plane units, before pressure thins it. */
  size: number
  /** How much of the colour lands, 0 to 1, or absent for however translucent
   *  this kind of pen is by itself. Absent rather than filled in, so a canvas
   *  drawn before anybody could turn the dial reads and writes back unchanged. */
  opacity?: number
  points: InkPoint[]
}

/** One canvas. Every list is optional in the file and always present here:
 *  everything that reads a canvas wants the lists, and "absent" and "empty" mean
 *  the same thing to all of them.
 *
 *  `at` and `gone` are how two devices drawing on one file are put back
 *  together: when each thing was last touched, and what has been thrown away.
 *  They are kept up to date in one place, by `stamped` in canvas-merge.ts,
 *  rather than by every edit remembering to. */
export interface Canvas {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  ink: InkStroke[]
  at: Record<string, number>
  gone: Record<string, number>
  /** What the canvas wears in the file list, as written, or null where it wears
   *  nothing. The same value a note keeps under `icon:` in its front matter, and
   *  read by the same icons.ts: Lucide's own name, Iconize's `LiFileText`, or an
   *  emoji.
   *
   *  Here rather than in a store beside the space, because it is the canvas's own
   *  and has to travel with the file: a canvas copied into another vault keeps
   *  the icon somebody chose for it, and Obsidian leaves the key alone. A note
   *  says it in the one place a markdown file has for metadata, and a canvas in
   *  the one place a JSON Canvas file has.
   *
   *  The one field here that may be absent rather than empty, because it is the
   *  only one that is about the file and not about the plane. A room carries a
   *  plane, a copy puts a plane on the clipboard, and neither of those is a file:
   *  they say nothing about the icon, which is different from saying there is
   *  none. A canvas read from a file always says one way or the other. */
  icon?: string | null
  /** The colour a stroked icon is drawn in, as an accent's own id, or null for the
   *  plain foreground. Beside the icon rather than folded into it for the reason a
   *  note keeps `icon-color:` on its own line: the icon has to stay a value another
   *  app can read. Meaningless for an emoji or a coloured drawing, which have their
   *  own colours; see icons.ts in the app. */
  iconColor?: string | null
}

export function emptyCanvas(): Canvas {
  return { nodes: [], edges: [], ink: [], at: {}, gone: {}, icon: null, iconColor: null }
}

/** A colour the spec would accept, or undefined. Anything else is dropped rather
 *  than written back out: a value nothing can draw is not a colour. */
function colourOf(value: unknown): CanvasColour | undefined {
  if (!isString(value)) return undefined
  const colour = value.trim()

  return PRESET_COLOURS.some((one) => one === colour) || HEX.test(colour) ? colour : undefined
}

/** How far from the origin anything on a canvas may be, in plane units.
 *
 *  A plane is endless in the sense that nobody reaches the end of one: this is
 *  further than a hand could drag a card in a lifetime. A file may still say
 *  otherwise - it can arrive from a share, a room or a paste - and a coordinate
 *  from past here is not a place but a number, which turns every sum after it
 *  into infinity: the box round the canvas, the camera that frames it, and every
 *  hit test from then on. So what a file claims is brought back to somewhere a
 *  canvas can be looked at. */
export const FURTHEST = 1e9

function held(value: number): number {
  return Math.min(FURTHEST, Math.max(-FURTHEST, value))
}

/** A whole number of pixels. The spec says integers, and a node dragged with a
 *  pointer would otherwise land on a fraction of one. */
function pixels(value: unknown, fallback: number): number {
  return isNumber(value) ? held(Math.round(value)) : fallback
}

/** How big a node is when the file forgot to say. Wide enough to read a line of
 *  text in and the same as Obsidian's own new card, so a canvas missing a size
 *  does not come back looking like somebody else's. */
export const DEFAULT_WIDTH = 250
export const DEFAULT_HEIGHT = 60

function one<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((entry) => entry === value)
}

/** The colour as a field to spread, so an absent one stays absent rather than
 *  becoming a `color: undefined` that has to be checked for everywhere. */
function colour(value: unknown): { color?: CanvasColour } {
  const found = colourOf(value)
  return found === undefined ? {} : { color: found }
}

/** One node, once it reads as one. Null for a record with no id, an unknown
 *  type, or nothing where its kind's own field should be: those three are what
 *  make a node a node, and a canvas is better off without a card that cannot say
 *  what it holds. */
function readNode(value: unknown): CanvasNode | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null

  const base: NodeBase = {
    id: value.id,
    x: pixels(value.x, 0),
    y: pixels(value.y, 0),
    width: Math.max(1, pixels(value.width, DEFAULT_WIDTH)),
    height: Math.max(1, pixels(value.height, DEFAULT_HEIGHT)),
    ...colour(value.color),
  }

  switch (value.type) {
    case 'text':
      return isString(value.text) ? { ...base, type: 'text', text: value.text } : null
    case 'file':
      if (!isString(value.file) || !value.file) return null
      return {
        ...base,
        type: 'file',
        file: value.file,
        ...(isString(value.subpath) && value.subpath.startsWith('#')
          ? { subpath: value.subpath }
          : {}),
      }
    case 'link':
      if (!isString(value.url) || !value.url) return null
      return { ...base, type: 'link', url: value.url }
    case 'group': {
      const style = one(value.backgroundStyle, BACKGROUNDS)
      return {
        ...base,
        type: 'group',
        ...(isString(value.label) ? { label: value.label } : {}),
        ...(isString(value.background) ? { background: value.background } : {}),
        ...(style ? { backgroundStyle: style } : {}),
      }
    }
    default:
      return null
  }
}

/** One edge, once it reads as one. Both ends have to name a node the canvas
 *  actually holds: an edge into nothing is drawn from nowhere to nowhere. */
function readEdge(value: unknown, nodes: ReadonlySet<string>): CanvasEdge | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null
  if (!isString(value.fromNode) || !isString(value.toNode)) return null
  if (!nodes.has(value.fromNode) || !nodes.has(value.toNode)) return null

  const fromSide = one(value.fromSide, SIDES)
  const toSide = one(value.toSide, SIDES)
  const fromEnd = one(value.fromEnd, ENDS)
  const toEnd = one(value.toEnd, ENDS)

  return {
    id: value.id,
    fromNode: value.fromNode,
    ...(fromSide ? { fromSide } : {}),
    ...(fromEnd ? { fromEnd } : {}),
    toNode: value.toNode,
    ...(toSide ? { toSide } : {}),
    ...(toEnd ? { toEnd } : {}),
    ...colour(value.color),
    ...(isString(value.label) ? { label: value.label } : {}),
  }
}

/** The flattened points of every stroke that has been written down, kept.
 *
 *  A canvas is written whole on every edit, and flattening five thousand strokes
 *  that have not changed since the last one is most of the cost of doing so.
 *  Weak and keyed on the stroke, like every other cache in this codebase: a
 *  stroke that changed is a new object, so the answers cannot go stale. */
const flattened = new WeakMap<InkStroke, number[]>()

/** The points of a stroke as they go into a file: flattened, six numbers each,
 *  and rounded to a tenth of a unit, which is finer than any pen is steady.
 *
 *  Flat rather than a list of objects because a page of handwriting is tens of
 *  thousands of points, and `[12.4,88.1,0.6,3,-2,17]` is a third of the bytes of
 *  the same point spelled out. */
export function packed(points: readonly InkPoint[]): number[] {
  const out: number[] = []

  for (const point of points) {
    out.push(
      Math.round(point.x * 10) / 10,
      Math.round(point.y * 10) / 10,
      Math.round(point.pressure * 100) / 100,
      Math.round(point.tiltX),
      Math.round(point.tiltY),
      Math.round(point.t),
    )
  }

  return out
}

/** The points back out of a file or a message. Every field is held to what a
 *  digitiser could have said: a pen that reported a pressure of four hundred is a
 *  file making a claim, and the nib it would draw with is not a nib. */
export function unpacked(values: readonly number[]): InkPoint[] {
  const out: InkPoint[] = []

  for (let index = 0; index + 5 < values.length; index += 6) {
    out.push({
      x: held(values[index] ?? 0),
      y: held(values[index + 1] ?? 0),
      pressure: Math.min(1, Math.max(0, values[index + 2] ?? 0.5)),
      tiltX: Math.min(90, Math.max(-90, values[index + 3] ?? 0)),
      tiltY: Math.min(90, Math.max(-90, values[index + 4] ?? 0)),
      t: Math.max(0, held(values[index + 5] ?? 0)),
    })
  }

  return out
}

/** What a pen may name rather than state: the ink the words on the page are set
 *  in, which is a token and not a value, so a stroke drawn in it follows the
 *  theme. Written into files, so reading has to allow it. */
export const DEFAULT_INK = 'ink'

/** The colour a stroke writes in. Unlike a card's it is never absent, so a
 *  colour nothing can draw becomes the ink of the page rather than dropping the
 *  stroke: the drawing is the point, and its colour is the least of it. */
function inkColourOf(value: unknown): CanvasColour {
  if (value === DEFAULT_INK) return DEFAULT_INK
  return colourOf(value) ?? DEFAULT_INK
}

function readStroke(value: unknown): InkStroke | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null
  if (!isInkTool(value.tool) || !isString(value.color)) return null
  if (!Array.isArray(value.points)) return null

  // One point is a dot, which is what a pen tapped once on the plane leaves. None
  // at all is a stroke with nothing in it, and that is not a stroke.
  const points = unpacked(value.points.filter(isNumber))
  if (points.length === 0) return null

  return {
    id: value.id,
    tool: value.tool,
    color: inkColourOf(value.color),
    size: Math.min(FURTHEST, Math.max(0.1, isNumber(value.size) ? value.size : 3)),
    ...(isNumber(value.opacity) ? { opacity: clampOpacity(value.opacity) } : {}),
    points,
  }
}

/** An alpha the paint can use. Nought would be a stroke nobody can see or find
 *  again, so the dial and the file agree on a floor. */
export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0.05, Math.round(value * 100) / 100))
}

function readShape(value: unknown): ShapeNode | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null
  const shape = one(value.shape, SHAPES)
  if (!shape) return null

  return {
    id: value.id,
    type: 'shape',
    shape,
    x: pixels(value.x, 0),
    y: pixels(value.y, 0),
    width: Math.max(1, pixels(value.width, DEFAULT_WIDTH)),
    height: Math.max(1, pixels(value.height, DEFAULT_HEIGHT)),
    ...colour(value.color),
    ...(value.fill === true ? { fill: true } : {}),
    ...(value.up === true ? { up: true } : {}),
    ...(isString(value.text) && value.text ? { text: value.text } : {}),
  }
}

/** The record a page keeps under `nib.pages`: which id it is about, and the two
 *  things the spec has no word for. */
function readPageRecord(value: unknown): { id: string; paper: Paper; pattern: Pattern } | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null

  return {
    id: value.id,
    paper: isPaper(value.paper) ? value.paper : 'a4',
    pattern: isPattern(value.pattern) ? value.pattern : 'blank',
  }
}

/** A node the file called a page, as the page it is.
 *
 *  The geometry and the PDF come off the spec node, which is where they were
 *  written; the size and the ruling come off the record. A `file` node's own path
 *  and `#page=` fragment are the paper behind the page, so nothing is written
 *  twice and Obsidian reads the same two values this does.
 *
 *  Only a `file` or a `group` node becomes a page. A record under `nib.pages`
 *  naming a text card is a file somebody edited by hand into something that is not
 *  a page note, and the card stays a card. */
function asPage(node: CanvasNode, record: { paper: Paper; pattern: Pattern }): PageNode | null {
  if (node.type !== 'file' && node.type !== 'group') return null

  const page = node.type === 'file' ? pageOfSubpath(node.subpath) : null

  return {
    id: node.id,
    type: 'page',
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    ...(node.color === undefined ? {} : { color: node.color }),
    paper: record.paper,
    pattern: record.pattern,
    ...(node.type === 'file' && page !== null ? { file: node.file, page } : {}),
  }
}

/** Which page of a PDF a `#page=3` names, or null. The spelling Obsidian writes
 *  and a browser's own viewer reads; `pageFragment` in links.ts asks the same of a
 *  wikilink, and the two agree on purpose. */
function pageOfSubpath(subpath: string | undefined): number | null {
  const digits = /^#page=(\d+)$/i.exec((subpath ?? '').trim())?.[1]
  if (digits === undefined) return null

  const page = Number(digits)
  return Number.isInteger(page) && page > 0 ? page : null
}

/** One page out of the fields a record holds, which is how a room holds one: a
 *  single object saying everything about the page, `page` and all.
 *
 *  What a room reads a stored page back through, the way `nodeOf` does for a card;
 *  see plane.ts in @nib/rooms. A file writes a page in two halves instead, and
 *  `readCanvas` puts those together before anything else sees them. */
function readPage(value: unknown): PageNode | null {
  if (!isRecord(value) || !isString(value.id) || !value.id) return null

  const page = isNumber(value.page) ? Math.floor(value.page) : 0
  const file = isString(value.file) ? value.file : ''

  return {
    id: value.id,
    type: 'page',
    x: pixels(value.x, 0),
    y: pixels(value.y, 0),
    width: Math.max(1, pixels(value.width, PAPERS.a4.width)),
    height: Math.max(1, pixels(value.height, PAPERS.a4.height)),
    ...colour(value.color),
    paper: isPaper(value.paper) ? value.paper : 'a4',
    pattern: isPattern(value.pattern) ? value.pattern : 'blank',
    ...(file && page > 0 ? { file, page } : {}),
  }
}

/** A page as the spec node it is written as: the PDF page it shows, or a labelled
 *  frame. What Obsidian sees, and the only shape of a page that ever reaches
 *  `nodes`. */
function asSpecNode(page: PageNode, at: number): CanvasNode {
  const base = {
    id: page.id,
    x: page.x,
    y: page.y,
    width: page.width,
    height: page.height,
    ...(page.color === undefined ? {} : { color: page.color }),
  }

  if (page.file && page.page) {
    return { ...base, type: 'file', file: page.file, subpath: `#page=${page.page}` }
  }

  return { ...base, type: 'group', label: `Page ${at + 1}` }
}

/** The record a page carries beside its node. */
function writtenPage(page: PageNode): Record<string, unknown> {
  return { id: page.id, paper: page.paper, pattern: page.pattern }
}

/** A map of id to a number, with anything that is not one left out. What `at`
 *  and `gone` both are. */
function readTimes(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {}

  const out: Record<string, number> = {}
  for (const [id, when] of Object.entries(value)) {
    if (id && isNumber(when) && when > 0) out[id] = Math.round(when)
  }

  return out
}

/** The nodes back in the order the file remembered, which is the order they
 *  stack in. A node the order does not name keeps its place among the ones it
 *  came with and goes after everything that is named: a canvas Obsidian added a
 *  card to still opens, with the new card on top. */
function inOrder(nodes: readonly CanvasNode[], order: readonly string[]): CanvasNode[] {
  if (!order.length) return [...nodes]

  const places = new Map(order.map((id, index) => [id, index]))
  return nodes
    .map((node, index) => ({ node, at: places.get(node.id) ?? Infinity, index }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at - b.at))
    .map((one) => one.node)
}

/** Anything on a canvas that carries an id: a node of any of the five kinds, an
 *  edge, or a stroke of ink. */
export type Thing = CanvasNode | CanvasEdge | InkStroke

/** One node out of the fields a record holds, whichever of the five kinds it is.
 *
 *  A file keeps the four the spec names in `nodes` and the shapes under `nib`, so
 *  reading a whole file knows which reader to use from where the record was. A
 *  reader handed one record on its own does not, and asks this. What a room reads
 *  a stored object back through; see plane.ts in @nib/rooms. */
export function nodeOf(value: unknown): CanvasNode | null {
  if (isRecord(value) && value.type === 'shape') return readShape(value)
  if (isRecord(value) && value.type === 'page') return readPage(value)
  return readNode(value)
}

/** One edge out of a record, given the nodes there are to end on. */
export function edgeOf(value: unknown, nodes: ReadonlySet<string>): CanvasEdge | null {
  return readEdge(value, nodes)
}

/** One stroke of ink out of a record. */
export function strokeOf(value: unknown): InkStroke | null {
  return readStroke(value)
}

/** A canvas out of the text of a file. An empty one for a file that is not JSON
 *  at all, which is what a new or a truncated file looks like: an empty plane is
 *  something to draw on, and an error message is not. */
export function readCanvas(text: string): Canvas {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    // Not JSON, or nothing at all. Either way there is no canvas in it.
    return emptyCanvas()
  }

  if (!isRecord(parsed)) return emptyCanvas()

  const nodes: CanvasNode[] = []
  const ids = new Set<string>()

  if (Array.isArray(parsed.nodes)) {
    for (const entry of parsed.nodes) {
      const node = readNode(entry)
      // Two nodes cannot share an id: an edge names its ends by id, and the
      // first of a pair is the one every edge already meant.
      if (!node || ids.has(node.id)) continue

      ids.add(node.id)
      nodes.push(node)
    }
  }

  const nib = isRecord(parsed.nib) ? parsed.nib : {}

  if (Array.isArray(nib.shapes)) {
    for (const entry of nib.shapes) {
      const shape = readShape(entry)
      if (!shape || ids.has(shape.id)) continue

      ids.add(shape.id)
      nodes.push(shape)
    }
  }

  const ink: InkStroke[] = []
  const inked = new Set<string>()

  if (Array.isArray(nib.ink)) {
    for (const entry of nib.ink) {
      const stroke = readStroke(entry)
      if (!stroke || inked.has(stroke.id)) continue

      inked.add(stroke.id)
      ink.push(stroke)
    }
  }

  const edges: CanvasEdge[] = []
  const seen = new Set<string>()

  if (Array.isArray(parsed.edges)) {
    for (const entry of parsed.edges) {
      const edge = readEdge(entry, ids)
      if (!edge || seen.has(edge.id)) continue

      seen.add(edge.id)
      edges.push(edge)
    }
  }

  const order = Array.isArray(nib.order)
    ? nib.order.filter((id): id is string => isString(id) && !!id)
    : []

  // The pages last, because a page is a spec node that has already been read as
  // one: this is the record beside it saying that is what it was. Swapped in place
  // rather than appended, so a page keeps where it sat in `nodes` and the stacking
  // order the file wrote is the order it comes back in.
  if (Array.isArray(nib.pages)) {
    const paged = new Map<string, { paper: Paper; pattern: Pattern }>()
    for (const entry of nib.pages) {
      const record = readPageRecord(entry)
      if (record && !paged.has(record.id)) paged.set(record.id, record)
    }

    for (const [at, node] of nodes.entries()) {
      const record = paged.get(node.id)
      const page = record ? asPage(node, record) : null
      if (page) nodes[at] = page
    }
  }

  return {
    nodes: inOrder(nodes, order),
    edges,
    ink,
    at: readTimes(nib.at),
    gone: readTimes(nib.gone),
    icon: iconWritten(nib.icon),
    iconColor: iconWritten(nib.iconColor),
  }
}

/** What a canvas says it wears, or null where it says nothing this app could
 *  draw from. A value that is not a string is not an icon; the words themselves
 *  are read in icons.ts, which knows the two conventions. */
function iconWritten(value: unknown): string | null {
  if (!isString(value)) return null
  return value.trim() || null
}

/** A node with its fields in the order the spec lists them, and nothing else in
 *  it. Written out longhand rather than filtered, so what goes into a file is
 *  read off this module rather than off whatever happened to be in memory. */
function writtenNode(node: CanvasNode): Record<string, unknown> {
  const base = {
    id: node.id,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    ...(node.color === undefined ? {} : { color: node.color }),
  }

  switch (node.type) {
    case 'text':
      return { ...base, text: node.text }
    case 'file':
      return { ...base, file: node.file, ...(node.subpath ? { subpath: node.subpath } : {}) }
    case 'link':
      return { ...base, url: node.url }
    case 'group':
      return {
        ...base,
        ...(node.label === undefined ? {} : { label: node.label }),
        ...(node.background === undefined ? {} : { background: node.background }),
        ...(node.backgroundStyle === undefined ? {} : { backgroundStyle: node.backgroundStyle }),
      }
    case 'shape':
      // Never reached: shapes are taken out before this is called and written
      // under `nib` instead. Here so the switch covers every kind.
      return base
    case 'page':
      // Never reached either, and for the opposite reason: a page is turned into
      // the spec node it is written as before it gets here. See `asSpecNode`.
      return base
  }
}

function writtenShape(node: ShapeNode): Record<string, unknown> {
  return {
    id: node.id,
    shape: node.shape,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    ...(node.color === undefined ? {} : { color: node.color }),
    ...(node.fill ? { fill: true } : {}),
    ...(node.up ? { up: true } : {}),
    ...(node.text === undefined ? {} : { text: node.text }),
  }
}

function writtenStroke(stroke: InkStroke): Record<string, unknown> {
  let points = flattened.get(stroke)
  if (!points) {
    points = packed(stroke.points)
    flattened.set(stroke, points)
  }

  return {
    id: stroke.id,
    tool: stroke.tool,
    color: stroke.color,
    size: Math.round(stroke.size * 100) / 100,
    ...(stroke.opacity === undefined ? {} : { opacity: clampOpacity(stroke.opacity) }),
    points,
  }
}

function writtenEdge(edge: CanvasEdge): Record<string, unknown> {
  return {
    id: edge.id,
    fromNode: edge.fromNode,
    ...(edge.fromSide === undefined ? {} : { fromSide: edge.fromSide }),
    ...(edge.fromEnd === undefined ? {} : { fromEnd: edge.fromEnd }),
    toNode: edge.toNode,
    ...(edge.toSide === undefined ? {} : { toSide: edge.toSide }),
    ...(edge.toEnd === undefined ? {} : { toEnd: edge.toEnd }),
    ...(edge.color === undefined ? {} : { color: edge.color }),
    ...(edge.label === undefined ? {} : { label: edge.label }),
  }
}

/** The same map with its keys in order, so a canvas that has not changed is
 *  written back byte for byte however the map was built. */
function sortedTimes(times: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(times).sort(([a], [b]) => (a < b ? -1 : 1)))
}

/** How the parts of a canvas that are not the spec's are written. Bumped only
 *  when an older Nib could no longer read a newer file, which so far it can. */
const NIB_VERSION = 1

/** The canvas as a file. Tabs and a closing newline, which is how Obsidian
 *  writes one, so a canvas that travels between the two apps and back shows no
 *  diff at all beyond what somebody actually changed.
 *
 *  Nothing of ours is written into a canvas that has none: a plane of plain
 *  cards is exactly the file the spec describes, with no key of Nib's in it. */
export function writeCanvas(canvas: Canvas): string {
  const shapes = canvas.nodes.filter((node): node is ShapeNode => node.type === 'shape')
  const pages = canvas.nodes.filter(isPage)
  // Worth writing only when something is not where the spec would put it: a
  // canvas of nothing but cards stacks in the order `nodes` already gives, and
  // a second list saying so again is noise in the file.
  const ink = canvas.ink.map(writtenStroke)
  const order = shapes.length ? canvas.nodes.map((node) => node.id) : []

  const nib = {
    // First, because it is the one key in here a person would ever open the file
    // to read: what the row in the file list wears.
    ...(canvas.icon ? { icon: canvas.icon } : {}),
    ...(canvas.icon && canvas.iconColor ? { iconColor: canvas.iconColor } : {}),
    // Before the ink, because the pages are what the ink is written on, and the
    // list's own order is the order they turn in.
    ...(pages.length ? { pages: pages.map(writtenPage) } : {}),
    ...(ink.length ? { ink } : {}),
    ...(shapes.length ? { shapes: shapes.map(writtenShape) } : {}),
    ...(order.length ? { order } : {}),
    ...(Object.keys(canvas.at).length ? { at: sortedTimes(canvas.at) } : {}),
    ...(Object.keys(canvas.gone).length ? { gone: sortedTimes(canvas.gone) } : {}),
  }

  // A page goes into `nodes` as the spec node it is - a PDF page, or a labelled
  // frame - so a page note is a JSON Canvas file and nothing in it is an invention
  // of ours. Numbered as they are written, which is the order they are in.
  let numbered = -1
  const written = {
    nodes: canvas.nodes
      .filter((node) => node.type !== 'shape')
      .map((node) =>
        isPage(node) ? writtenNode(asSpecNode(node, ++numbered)) : writtenNode(node),
      ),
    edges: canvas.edges.map(writtenEdge),
    ...(Object.keys(nib).length ? { nib: { version: NIB_VERSION, ...nib } } : {}),
  }

  return `${JSON.stringify(written, null, '\t')}\n`
}

/** What a canvas file says before anybody has drawn on it. */
export function blankCanvas(): string {
  return writeCanvas(emptyCanvas())
}

/** One edit that sets what a canvas wears, or takes it away when `name` is null.
 *  Null when the file already says that, so a caller writes no file.
 *
 *  An edit and not a new file, so giving a canvas an icon is the same three lines
 *  as giving a note one: the characters that moved are what is written, what is
 *  snapshotted and what one undo puts back. `frontMatterEdit` answers exactly this
 *  question for a note; this is its twin for the format that has no front matter.
 *
 *  The file is read and written back, because `nib.icon` sits in JSON rather than
 *  on a line of its own. That costs nothing for a canvas Nib wrote - writing one
 *  is exact, so the only characters that differ are the key - and for a canvas
 *  written by hand it comes out as the file reformatted, which is what any change
 *  to it would have been anyway.
 *
 *  Nothing at all for a file that is not JSON: an empty canvas standing in for
 *  something unreadable is what lets a truncated file be drawn on, and it must
 *  never be what gets written back over it. */
export function canvasIconEdit(
  text: string,
  name: string | null,
  tint: string | null = null,
): TextEdit | null {
  if (text.trim() && !isCanvasJson(text)) return null

  const canvas = readCanvas(text)
  const wanted = tint === null || name === null ? null : tint
  if (canvas.icon === name && (canvas.iconColor ?? null) === wanted) return null

  return oneEdit(text, writeCanvas({ ...canvas, icon: name, iconColor: wanted }))
}

function isCanvasJson(text: string): boolean {
  try {
    return isRecord(JSON.parse(text))
  } catch {
    return false
  }
}

/** How long an id is. Sixteen hex characters is what Obsidian writes, so a
 *  canvas Nib made looks native there rather than obviously foreign. */
const ID_LENGTH = 16

/** A fresh id for anything on a canvas. Random rather than counted, because two
 *  devices edit one canvas and a counter would have them both hand out `7`.
 *
 *  Stable once written: nothing ever renumbers a node, since every edge names
 *  its ends by id and every merge of two copies of a file relies on the same
 *  card carrying the same name on both. */
export function freshId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH / 2))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
