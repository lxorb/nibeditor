/** Walking a graph once it is built: whether it is the same set of notes and links as
 *  the last one, who each node is joined to, and what lies within a few links of a
 *  note. What the graph view and the Links panel ask of the picture; building it is
 *  graph.ts's, which the link index needs from the first paint, and none of this is
 *  wanted until one of those two is open. */

import { type NoteGraph, sliced } from './graph'

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

  return sliced(graph, reached)
}
