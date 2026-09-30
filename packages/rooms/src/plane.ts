/** A canvas as a Yjs document, so several devices can draw on one plane.
 *
 *  A note is one `Y.Text`, and that is the right shape for prose: two people
 *  typing in one paragraph want their letters interleaved. A canvas is not prose.
 *  Everything on it already has an id of its own, and two people drawing on one
 *  plane want both drawings whole, never one line woven through another. So the
 *  shared value here is a **map of objects by id**: a card moved on one device and
 *  the same card recoloured on another both survive, because they are different
 *  keys of one object's map, and two strokes drawn at the same moment are two
 *  entries that never meet.
 *
 *  Two maps, at the root of the document.
 *
 *  `canvas` holds everything on the plane, keyed by id. Each value is a map of
 *  that object's own fields, the very fields a file would carry for it, plus three
 *  the room needs: `kind`, which of the file's three lists it belongs to; `at`,
 *  when it was last touched; and `z`, where it sits in the stack, since a map has
 *  no order and a file's order does matter.
 *
 *  `gone` holds what has been thrown away, by id, with the time it went. The same
 *  tombstones a file carries under `nib.gone`, and for the same reason: a device
 *  that was away and comes back with a card in its file must not put back a card
 *  somebody deleted while it was gone.
 *
 *  A stroke's points are one value rather than a list of their own. A page of
 *  handwriting is tens of thousands of points and none of them is ever edited: the
 *  pen lifts and the stroke is finished. So the points go in flat and packed,
 *  exactly as a file writes them, and a stroke of any length is one item in the
 *  document rather than one per sample.
 *
 *  Read and written in one place, because three parts of Nib do it: the surface
 *  somebody draws on, the room in the Worker that settles the file, and the tests
 *  that hold both to the same rule. Nothing here draws, saves, or talks over a
 *  socket. */

import {
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  edgeOf,
  type InkStroke,
  nodeOf,
  packed,
  strokeOf,
  type Thing,
} from '@nib/markdown/canvas'
import * as Y from 'yjs'
import { fold } from './fold'

/** The two shared maps, under names both ends ask for. */
export const PLANE = 'canvas'
export const BURIED = 'gone'

/** Which of a file's three lists an object belongs to. Kept on the object rather
 *  than worked out from its fields, so reading one back is a lookup and not a
 *  guess. */
type ThingKind = 'node' | 'edge' | 'ink'

/** The three keys a room adds to an object. Never written into a file: a record
 *  is read back through the format's own readers, which keep the fields they know
 *  and drop everything else. */
const KIND = 'kind'
const AT = 'at'
const Z = 'z'
const ADDED: readonly string[] = [KIND, AT, Z]

export function planeOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(PLANE)
}

export function buriedOf(doc: Y.Doc): Y.Map<number> {
  return doc.getMap(BURIED)
}

/** Both of them, as things to watch or to undo rather than to read. Together,
 *  because one gesture may touch both: deleting a card takes it off the plane and
 *  puts a tombstone in its place, and that is one thing somebody did. */
export function rootsOf(doc: Y.Doc): Y.Map<unknown>[] {
  return [doc.getMap(PLANE), doc.getMap(BURIED)]
}

function isInk(thing: Thing): thing is InkStroke {
  return 'points' in thing
}

function isEdge(thing: Thing): thing is CanvasEdge {
  return 'fromNode' in thing
}

function kindOf(thing: Thing): ThingKind {
  if (isInk(thing)) return 'ink'
  return isEdge(thing) ? 'edge' : 'node'
}

/** The fields of one object as they go into the room: its own, with a stroke's
 *  points packed the way a file packs them, and nothing of the room's. */
function fieldsOf(thing: Thing): Record<string, unknown> {
  if (!isInk(thing)) return { ...thing }
  return { ...thing, points: packed(thing.points) }
}

/** Whether two field values say the same thing.
 *
 *  Deep only as far as the format goes: every field is a string, a number, a
 *  boolean, or a stroke's flat array of numbers. Compared rather than overwritten,
 *  because a write nobody needed is bytes on the wire and a step in everybody
 *  else's history. */
function same(one: unknown, other: unknown): boolean {
  if (one === other) return true
  if (!Array.isArray(one) || !Array.isArray(other)) return false

  return one.length === other.length && one.every((value, at) => value === other[at])
}

/** One object written into the room, or brought up to date where it is already
 *  there.
 *
 *  Brought up to date field by field, which is what makes two devices editing one
 *  card keep both edits: moving it writes `x` and `y`, colouring it writes
 *  `color`, and neither touches the other's key. */
function put(plane: Y.Map<Y.Map<unknown>>, thing: Thing, at: number, z: number) {
  const fields = fieldsOf(thing)
  const held = plane.get(thing.id)

  if (!held) {
    const made = new Y.Map<unknown>()
    for (const [key, value] of Object.entries(fields)) made.set(key, shared(key, value))
    made.set(KIND, kindOf(thing))
    made.set(AT, at)
    made.set(Z, z)
    plane.set(thing.id, made)
    return
  }

  for (const [key, value] of Object.entries(fields)) {
    const current = held.get(key)
    if (key === WORDS && typeof value === 'string' && current instanceof Y.Text) {
      rewrite(current, value)
      continue
    }
    if (!same(current, value)) held.set(key, shared(key, value))
  }

  // A field that has gone, such as a card that lost its colour, goes from the
  // record too, or the colour would come back the next time it was read.
  for (const key of [...held.keys()]) {
    if (ADDED.includes(key) || key in fields) continue
    held.delete(key)
  }

  if (held.get(AT) !== at) held.set(AT, at)
}

/** The one field of an object that is prose: a card's words. */
const WORDS = 'text'

/** A field's value as the room keeps it. A card's words are a `Y.Text` of their own
 *  rather than one value, so two devices editing one card while apart merge like prose
 *  instead of one of them losing (docs/sync-v2.md section 5.6); every other field is
 *  one value, and the newer one stands. Read back, a `Y.Text` is its string, so the
 *  file a plane settles into is byte for byte what it was. */
function shared(key: string, value: unknown): unknown {
  return key === WORDS && typeof value === 'string' ? new Y.Text(value) : value
}

/** A card's words brought to `wanted` as the one replacement they differ by, so a
 *  device typing in the card and another editing it elsewhere both keep theirs. */
function rewrite(text: Y.Text, wanted: string) {
  const change = fold(text.toJSON(), wanted)
  if (!change) return
  if (change.to > change.from) text.delete(change.from, change.to - change.from)
  if (change.insert) text.insert(change.from, change.insert)
}

/** Where the next thing to arrive sits in the stack: after everything already
 *  here. Two devices adding at the same moment both pick this number and are then
 *  ordered by id, which is the rule a file's merge already uses. */
function nextPlace(plane: Y.Map<Y.Map<unknown>>): number {
  let highest = -1
  for (const record of plane.values()) {
    const z = record.get(Z)
    if (typeof z === 'number' && z > highest) highest = z
  }

  return highest + 1
}

function placeIn(plane: Y.Map<Y.Map<unknown>>, id: string): number | null {
  const z = plane.get(id)?.get(Z)
  return typeof z === 'number' ? z : null
}

function things(canvas: Canvas): Map<string, Thing> {
  const out = new Map<string, Thing>()
  for (const thing of [...canvas.nodes, ...canvas.edges, ...canvas.ink]) out.set(thing.id, thing)
  return out
}

/** A whole canvas into an empty document: the room's first content, from the file
 *  as it was stored. Stacked in the order the file listed them, so a plane seeded
 *  here looks exactly like the file it came from. */
export function seedPlane(doc: Y.Doc, canvas: Canvas) {
  const plane = planeOf(doc)
  const buried = buriedOf(doc)
  let place = 0

  for (const thing of [...canvas.nodes, ...canvas.edges, ...canvas.ink]) {
    put(plane, thing, canvas.at[thing.id] ?? 0, place++)
  }

  for (const [id, when] of Object.entries(canvas.gone)) buried.set(id, when)
}

/** What a canvas edit changed, written into the room.
 *
 *  Every operation on a canvas hands back the very same objects for what it did
 *  not touch, which is what `stamped` in canvas-merge.ts relies on and what this
 *  relies on too: telling what changed is a handful of identity comparisons, so a
 *  stroke a pen has just finished costs one entry and never a walk of the plane.
 *
 *  `after` is already stamped, so its times are the ones to write down. */
export function pushPlane(doc: Y.Doc, before: Canvas, after: Canvas) {
  const plane = planeOf(doc)
  const buried = buriedOf(doc)
  const was = things(before)
  const is = things(after)

  // Where the next new thing goes, worked out at most once and only for an edit
  // that adds something. Moving a card, colouring it or rubbing out a stroke needs
  // no place at all, and asking for one walks the plane.
  let place: number | null = null
  const placeFor = (id: string): number => {
    const held = placeIn(plane, id)
    if (held !== null) return held

    place = place === null ? nextPlace(plane) : place + 1
    return place
  }

  for (const [id, thing] of is) {
    if (was.get(id) === thing && plane.has(id)) continue
    put(plane, thing, after.at[id] ?? 0, placeFor(id))
  }

  for (const id of was.keys()) {
    if (!is.has(id)) plane.delete(id)
  }

  // Every tombstone the edit ended up with, whether it came from a delete here or
  // from a merge that dropped something.
  for (const [id, when] of Object.entries(after.gone)) {
    if (!is.has(id) && buried.get(id) !== when) buried.set(id, when)
  }

  // And none at all for something that is on the plane again: putting a card back
  // is the newer word on the matter, and it is what lets an undo bring one back.
  // Walked over the tombstones rather than the objects, because there are few of
  // the first and thousands of the second.
  if (buried.size) {
    for (const id of [...buried.keys()]) {
      if (is.has(id)) buried.delete(id)
    }
  }
}

/** One record as the thing it describes, or null. The format's own readers, so a
 *  record written by a newer Nib with a field this one has never heard of is read
 *  exactly as such a field in a file would be: kept where it is understood, and
 *  dropped where it is not. */
function read(record: Y.Map<unknown>, nodes: ReadonlySet<string>): Thing | null {
  const fields = record.toJSON()

  switch (fields[KIND]) {
    case 'ink':
      return strokeOf({ ...fields, points: Array.isArray(fields.points) ? fields.points : [] })
    case 'edge':
      return edgeOf(fields, nodes)
    case 'node':
      return nodeOf(fields)
    default:
      return null
  }
}

function placeOf(record: Y.Map<unknown>): number {
  const z = record.get(Z)
  return typeof z === 'number' ? z : Number.MAX_SAFE_INTEGER
}

/** One thing with where it sits, so a list of them can be put in order. */
interface Placed<T extends Thing> {
  thing: T
  z: number
  id: string
}

/** Two things in stacking order: where each sits, and by id where they sit in the
 *  same place, which is what two devices adding at once produce and what makes the
 *  order the same on both of them without either asking. */
function stacked<T extends Thing>(a: Placed<T>, b: Placed<T>): number {
  if (a.z !== b.z) return a.z - b.z
  return a.id < b.id ? -1 : 1
}

const NO_NODES: ReadonlySet<string> = new Set<string>()

/** The room's document as a canvas.
 *
 *  What the settle writes into a file, and what a device reads when it joins.
 *
 *  `previous` is the canvas this reader already had and `changed` names the ids the
 *  room says are new or different. Given both, everything the reader already holds
 *  that the room has not touched comes back as the very same object, so the outline
 *  a stroke was traced into is still cached and a plane of five thousand strokes
 *  does not repaint itself because somebody else drew one. Given neither, every
 *  object is read afresh, which is what joining a room is. */
export function readPlane(doc: Y.Doc, previous?: Canvas, changed?: ReadonlySet<string>): Canvas {
  const plane = planeOf(doc)
  const kept = previous && changed ? things(previous) : null
  const held = (id: string) => (changed?.has(id) ? undefined : kept?.get(id))

  // The nodes first and on their own, because an edge may only end on a node the
  // plane holds, and that is the one thing a record cannot say about itself.
  const nodes: Placed<CanvasNode>[] = []
  const later: { record: Y.Map<unknown>; z: number; id: string }[] = []
  const at: Record<string, number> = {}

  for (const [id, record] of plane) {
    const z = placeOf(record)
    const when = record.get(AT)
    at[id] = typeof when === 'number' ? when : 0

    if (record.get(KIND) !== 'node') {
      later.push({ record, z, id })
      continue
    }

    const already = held(id)
    const node = already && !isInk(already) && !isEdge(already) ? already : read(record, NO_NODES)
    if (node && !isInk(node) && !isEdge(node)) nodes.push({ thing: node, z, id })
  }

  nodes.sort(stacked)
  const there = new Set(nodes.map((one) => one.id))

  const edges: Placed<CanvasEdge>[] = []
  const ink: Placed<InkStroke>[] = []

  for (const { record, z, id } of later) {
    const thing = held(id) ?? read(record, there)
    if (!thing) continue

    if (isInk(thing)) ink.push({ thing, z, id })
    // An edge kept from a previous read may have lost an end since.
    else if (isEdge(thing) && there.has(thing.fromNode) && there.has(thing.toNode)) {
      edges.push({ thing, z, id })
    }
  }

  edges.sort(stacked)
  ink.sort(stacked)

  const gone: Record<string, number> = {}
  for (const [id, when] of buriedOf(doc)) {
    if (typeof when === 'number') gone[id] = when
  }

  return {
    nodes: nodes.map((one) => one.thing),
    edges: edges.map((one) => one.thing),
    ink: ink.map((one) => one.thing),
    at,
    gone,
  }
}

/** Whether the room holds a plane at all. A room nobody has joined yet holds
 *  nothing, and is seeded from the stored file. */
export function planeIsEmpty(doc: Y.Doc): boolean {
  return planeOf(doc).size === 0 && buriedOf(doc).size === 0
}
