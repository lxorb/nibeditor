/** The space as a graph, and the neighbourhood of one note in it.
 *
 *  A node per note, an edge per link between two notes. An edge answers "these
 *  two are connected", which is the question a picture of a space is looked at
 *  for, and it is what lets one edge stand for a pair of notes that link both
 *  ways. It remembers which end reached for which all the same, because that is
 *  what an arrowhead says and the only thing in the picture that can say it.
 *
 *  Built from what the link index already holds rather than from the notes
 *  again: the index hands over its notes and the resolver it caches, so a graph
 *  of two thousand notes costs one walk over their links and no second index.
 *
 *  Pure, so the shape of a graph is a thing tests can state. Where the nodes end
 *  up is `graph-layout.ts`. */

import { embedKind, type LinkKind } from '@nib/markdown/links'
import type { ScannedNote } from './scan-note'

export interface GraphNode {
  /** A note's path relative to the space, `?name` for a target the space holds no
   *  note for, or `!name` for a file a note embeds. Stable across a rebuild, which
   *  is what lets the view keep saying "this one" while the index changes
   *  underneath it. */
  id: string
  /** What the label says: the note's name, or the target as it was written. */
  name: string
  /** The note to open, or null for a target nothing answers yet. */
  path: string | null
  /** How many edges touch it, which is what its size says. */
  degree: number
  /** The tags the note carries, folded and without the hash, which is what a
   *  filter and a colour group ask about. Empty for a note the space does not
   *  hold, since there is nothing to read them out of. */
  tags: string[]
  /** A picture, a PDF, a sound or a film a note embeds, rather than a note. Absent
   *  for every ordinary node, so the shape on the wire is what it was; the picture
   *  draws one as a square rather than a dot, which is how it says a file is not a
   *  note. See `attachments` in workspace/graph-settings.svelte.ts, which is the
   *  switch that asks for these at all. */
  attachment?: true
}

/** One connection: the note the link was written in, and the note it named.
 *
 *  Undirected for the layout's purposes - a spring pulls both ways - but the two
 *  ends are not interchangeable, and an arrowhead is the only thing in the picture
 *  that says which note reached for which. `both` is a pair that link each way,
 *  drawn with a head at each end. */
interface GraphEdge {
  a: number
  b: number
  both: boolean
}

export interface NoteGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** One id mixed into a signature. FNV-1a over the characters, which is a multiply
 *  and an exclusive-or each and no allocation at all. */
function mixed(into: number, word: string): number {
  let hash = into
  for (let at = 0; at < word.length; at++) {
    hash ^= word.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

/** And one number, in two halves, so an edge is mixed without a string being built
 *  for it: ten thousand of those is ten thousand allocations to answer a question
 *  about whether anything changed. */
function counted(into: number, value: number): number {
  let hash = Math.imul(into ^ (value & 0xffff), 0x01000193)
  hash = Math.imul(hash ^ (value >>> 16), 0x01000193)

  return hash >>> 0
}

/** What set of notes and links a graph is, as one number.
 *
 *  The picture is handed a fresh graph object whenever anything in the space is
 *  saved, and laying the arrangement out again then would make it jump every time
 *  the typing pauses - so the view needs to know whether it is really another graph.
 *  It used to ask by joining every id and every pair into one string and comparing
 *  that: three hundred kilobytes built per save over five thousand notes, to find
 *  out that nothing had changed.
 *
 *  A number instead, mixed from the same facts in the same order - the counts as
 *  well as the ids, so a graph that lost one node and gained another of the same
 *  name somewhere else still reads as another graph. Two different sets of notes can
 *  collide in principle; what that would cost is one arrangement not being laid out
 *  again, which is what the view does on purpose for every save that changes
 *  nothing.
 *
 *  Kept per graph, weakly, so it is worked out once for each one the view is handed
 *  and lives exactly as long as it does. */
const signatures = new WeakMap<NoteGraph, number>()

export function signature(graph: NoteGraph): number {
  const held = signatures.get(graph)
  if (held !== undefined) return held

  const { nodes, edges } = graph
  let hash = counted(counted(0x811c9dc5, nodes.length), edges.length)
  for (const node of nodes) hash = mixed(hash, node.id)
  for (const edge of edges) hash = counted(counted(hash, edge.a), edge.b)

  signatures.set(graph, hash)
  return hash
}

/** Which note a link in a given note points at, or null for one that points
 *  nowhere. The link index's own answer, cached there. */
export type Resolve = (from: string, link: { kind: LinkKind; target: string }) => string | null

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i
const CANVAS = /\.canvas$/i
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/

/** What marks an id as a target nothing answers, and what marks one as a file a
 *  note embeds. A path never starts with either, so no two kinds of node collide. */
const MISSING = '?'
const EMBEDDED = '!'

/** Whether a target names something the space draws as a node.
 *
 *  `![[shot.png]]` brings a picture into a note; it is not a link to one, and a
 *  hollow node called `shot.png` would be a lie about the space. A canvas is the
 *  other way round: the index reads one as a note, so it is already a node, and a
 *  note writing `[[Board.canvas]]` is reaching for it exactly as it would reach
 *  for a note. Without this the canvas sat in the picture as an island. */
function namesNote(target: string): boolean {
  const last = target.split('/').pop() ?? target
  return !EXTENSION.test(last) || MARKDOWN.test(last) || CANVAS.test(last)
}

/** Whether an embed names a file the picture can draw as a node of its own: a
 *  picture, a PDF, a sound or a film.
 *
 *  Only an embed. `[[shot.png]]` written without the bang is a link to a file the
 *  app opens, and the index already answers for those; what this is about is the
 *  `![[…]]` and `![](…)` that put a file inside a note, which is how a vault names
 *  its attachments. A canvas is left to `namesNote` above, which has always read one
 *  as the note it is.
 *
 *  `embedKind` is markdown's own reading of a name, so a picture here is a picture
 *  everywhere: the editor drawing an embed, the renderer writing the markup and this
 *  agree by construction. */
function namesFile(link: { target: string; embed?: boolean }): boolean {
  if (!link.embed) return false

  const kind = embedKind(link.target)
  return kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'pdf'
}

/** The node a file a note embeds gets, made once however many notes embed it.
 *
 *  Keyed by the file's own name, folded, so `![[shot.png]]` and `![](assets/shot.png)`
 *  are the one picture rather than two - which is how a vault's attachments are
 *  named, and the same reading `missing` gives a name nothing answers. */
function embedded(nodes: GraphNode[], at: Map<string, number>, target: string): number {
  const name = target.replace(/\\/g, '/').split('/').pop() ?? target
  const id = EMBEDDED + name.toLowerCase()

  const held = at.get(id)
  if (held !== undefined) return held

  at.set(id, nodes.length)
  nodes.push({ id, name, path: null, degree: 0, tags: [], attachment: true })
  return nodes.length - 1
}

/** The node a target with nowhere to go gets, made once however many notes
 *  write it. Keyed by the name it asks for, folded, so `[[plan]]` and `[[Plan]]`
 *  are the one note that is not there rather than two. */
function missing(nodes: GraphNode[], at: Map<string, number>, target: string): number {
  const name = (target.replace(/\\/g, '/').split('/').pop() ?? target).replace(MARKDOWN, '')
  const id = MISSING + name.toLowerCase()

  const held = at.get(id)
  if (held !== undefined) return held

  at.set(id, nodes.length)
  nodes.push({ id, name, path: null, degree: 0, tags: [] })
  return nodes.length - 1
}

/** What a graph is built of besides the notes. */
export interface GraphOptions {
  /** Whether the files the notes embed - pictures, PDFs, sounds, films - are nodes
   *  of their own, each joined to the notes that embed it.
   *
   *  Off unless something asks, and that is the point: an attachment is a node the
   *  arrangement has to make room for, so turning this on is a different picture of
   *  the space rather than the same one with more drawn on it. See `namesFile`. */
  attachments?: boolean
}

/** Every note and every link between two of them. */
export function buildGraph(
  notes: readonly ScannedNote[],
  resolve: Resolve,
  options: GraphOptions = {},
): NoteGraph {
  const nodes: GraphNode[] = notes.map((note) => ({
    id: note.path,
    name: note.name,
    path: note.path,
    degree: 0,
    tags: note.tags,
  }))
  const at = new Map(nodes.map((node, index) => [node.id, index]))
  const edges: GraphEdge[] = []
  // A pair of notes gets one edge however often they link to each other, and
  // which edge that is, so the second direction can add its arrowhead to it.
  const drawn = new Map<string, number>()

  for (const note of notes) {
    const from = at.get(note.path)
    if (from === undefined) continue

    for (const link of note.links) {
      if (!link.target) continue

      // A file a note embeds, when the picture has been asked for them: its own
      // node, joined to the note that put it there. Before the question below,
      // because `namesNote` is what says an attachment is not one.
      const file = options.attachments && namesFile(link)
      if (!file && !namesNote(link.target)) continue

      const found = file ? null : resolve(note.path, link)
      const to = file
        ? embedded(nodes, at, link.target)
        : found === null
          ? missing(nodes, at, link.target)
          : at.get(found)
      // A link into the note it is written in joins nothing.
      if (to === undefined || to === from) continue

      const pair = from < to ? `${from} ${to}` : `${to} ${from}`
      const already = drawn.get(pair)
      if (already !== undefined) {
        // The two notes are already joined. A link the other way adds nothing to
        // the connection and one arrowhead to the drawing of it.
        const edge = edges[already]
        if (edge && edge.a !== from) edge.both = true
        continue
      }

      drawn.set(pair, edges.length)
      edges.push({ a: from, b: to, both: false })
      count(nodes, from)
      count(nodes, to)
    }
  }

  return { nodes, edges }
}

function count(nodes: GraphNode[], index: number) {
  const node = nodes[index]
  if (node) node.degree++
}

/** The graph without the notes a space leaves out, and without the links that
 *  touched them.
 *
 *  A whole graph rather than a mask, because these notes are not hidden: the space
 *  has said they are not part of what it says about itself, so they are not part of
 *  the picture and never were. Degrees are counted again over what is left, the way
 *  `neighbourhood` counts them, so a note's size says how connected it is in the
 *  picture being looked at.
 *
 *  The graph itself when nothing is left out, so a space with no exclusions pays
 *  nothing and the view is handed the same object it was before. */
export function without(graph: NoteGraph, excluded: readonly string[]): NoteGraph {
  if (!excluded.length) return graph

  const left = (id: string) => excluded.some((one) => id === one || id.startsWith(`${one}/`))

  const dropped = new Set<number>()
  for (const [at, node] of graph.nodes.entries()) {
    if (node.path !== null && left(node.id)) dropped.add(at)
  }

  if (!dropped.size) return graph

  // A target the space holds no note for is not a path, so nothing can leave it
  // out. It is only in the picture because something asks for it, so it goes when
  // the last note that asked does.
  const asked = new Set<number>()
  for (const edge of graph.edges) {
    if (dropped.has(edge.a) || dropped.has(edge.b)) continue
    asked.add(edge.a)
    asked.add(edge.b)
  }

  for (const [at, node] of graph.nodes.entries()) {
    if (node.path === null && !asked.has(at)) dropped.add(at)
  }

  const place = new Map<number, number>()
  const nodes: GraphNode[] = []
  for (const [at, node] of graph.nodes.entries()) {
    if (dropped.has(at)) continue

    place.set(at, nodes.length)
    nodes.push({ ...node, degree: 0 })
  }

  const edges: GraphEdge[] = []
  for (const edge of graph.edges) {
    const a = place.get(edge.a)
    const b = place.get(edge.b)
    if (a === undefined || b === undefined) continue

    edges.push({ a, b, both: edge.both })
    count(nodes, a)
    count(nodes, b)
  }

  return { nodes, edges }
}

/** Who each node is joined to, kept per graph.
 *
 *  Weak, and keyed on the graph object, so it lives exactly as long as the picture
 *  it is about and two pictures on screen keep one each. Built the first time
 *  anything asks, because most things never do.
 *
 *  What it is for: lighting up what the pointer is over used to walk every edge in
 *  the space per hover - ten thousand of them, on every pointer move that changed
 *  which node was under it. */
const joined = new WeakMap<NoteGraph, readonly (readonly number[])[]>()

export function neighbours(graph: NoteGraph, node: number): readonly number[] {
  let near = joined.get(graph)
  if (!near) {
    near = adjacency(graph)
    joined.set(graph, near)
  }

  return near[node] ?? []
}

/** Who each node is joined to, as a list per node. */
function adjacency(graph: NoteGraph): number[][] {
  const near: number[][] = graph.nodes.map(() => [])

  for (const edge of graph.edges) {
    near[edge.a]?.push(edge.b)
    near[edge.b]?.push(edge.a)
  }

  return near
}

/** The note at `centre` and everything within `depth` links of it, as a graph of
 *  its own. Empty when the space holds no such note, which is what a window with
 *  no note open shows.
 *
 *  The centre comes first, and the rest in the order they were reached, so a
 *  depth of two lists the immediate neighbours before their neighbours. Degrees
 *  are counted within the slice: a node's size says how connected it is in the
 *  picture being looked at, not elsewhere. */
export function neighbourhood(graph: NoteGraph, centre: string, depth: number): NoteGraph {
  const from = graph.nodes.findIndex((node) => node.id === centre)
  if (from === -1) return { nodes: [], edges: [] }

  const near = adjacency(graph)
  const reached = new Set([from])
  let ring = [from]

  for (let step = 0; step < depth; step++) {
    const next: number[] = []

    for (const one of ring) {
      for (const other of near[one] ?? []) {
        if (reached.has(other)) continue
        reached.add(other)
        next.push(other)
      }
    }

    ring = next
  }

  const kept = [...reached]
  const place = new Map(kept.map((index, order) => [index, order]))
  const nodes = kept
    .map((index) => graph.nodes[index])
    .filter((node): node is GraphNode => node !== undefined)
    .map((node) => ({ ...node, degree: 0 }))

  const edges: GraphEdge[] = []
  for (const edge of graph.edges) {
    const a = place.get(edge.a)
    const b = place.get(edge.b)
    if (a === undefined || b === undefined) continue

    edges.push({ a, b, both: edge.both })
    count(nodes, a)
    count(nodes, b)
  }

  return { nodes, edges }
}
