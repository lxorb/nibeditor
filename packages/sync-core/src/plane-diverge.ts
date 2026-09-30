/** The classifier for canvases and page notes.
 *
 *  A plane is a map of objects by id, merged object by object and field by field
 *  (packages/rooms/src/plane.ts), so most of what two devices do to one canvas while
 *  apart never meets: one moved a card, the other recoloured it, and both stand. What
 *  can meet is one field of one object changed on both sides, and an object deleted
 *  on one side and edited on the other. The rules (docs/sync-v2.md section 5.6):
 *
 *  - geometry, colour and every other plain field changed on both sides: the newer
 *    side's value, silently;
 *  - a card's text (and a label) changed on both sides: the note classifier on that
 *    text, so a word changed on both merges and a sentence written two ways asks;
 *  - an object deleted on one side whose text the other side edited by more than
 *    `REWRITTEN` characters asks; a smaller edit, or a move, is settled by the newer
 *    side, deleting or keeping.
 *
 *  Pure and on `Canvas` values: the three planes as `readPlane` reads them, whatever
 *  a card's text is held as inside the document. */

import type { Canvas, Thing } from '@nib/markdown/canvas'
import { diverge, REWRITTEN, type Times, type Verdict } from './diverge'
import { edits } from './diff'
import type { Whose } from './merge3'

/** One object both sides changed. */
export interface PlaneOverlap {
  id: string
  /** The field both changed, or `deleted` for an object one side threw away and the
   *  other changed. */
  field: string
  newer: Whose
  asks: boolean
}

export interface PlaneDivergence {
  verdict: Verdict
  overlaps: readonly PlaneOverlap[]
  /** The plane as it reads once merged, null when the verdict is `diverged`. */
  resolution: Canvas | null
}

/** The fields whose words are merged like a note's rather than taken whole. */
const WORDS: readonly string[] = ['text', 'label']

type Fields = Record<string, unknown>

function thingsOf(canvas: Canvas): Map<string, Thing> {
  const out = new Map<string, Thing>()
  for (const thing of [...canvas.nodes, ...canvas.edges, ...canvas.ink]) out.set(thing.id, thing)
  return out
}

function fieldsOf(thing: Thing | undefined): Fields {
  return thing ? { ...thing } : {}
}

/** Whether two field values say the same thing: every field is a string, a number, a
 *  boolean, or a stroke's points, and JSON says each of those exactly. */
function same(one: unknown, other: unknown): boolean {
  return one === other || JSON.stringify(one) === JSON.stringify(other)
}

/** How much one side wrote in a text: what it inserted and what it took away. */
function written(before: string, after: string): number {
  return edits(before, after, 'semantic').reduce(
    (sum, edit) => sum + edit.insert.length + (edit.to - edit.from),
    0,
  )
}

/** A thing with some of its fields taken from the other side's copy of it, and a
 *  field one side took away absent rather than undefined, as a file would read it. */
function withFields(thing: Thing, taken: Fields): Thing {
  const fields = Object.entries({ ...thing, ...taken }).filter(([, value]) => value !== undefined)
  // The same object's own fields, some from another side's copy of the same object,
  // so the result is an object of the same kind.
  return Object.fromEntries(fields) as unknown as Thing
}

/** What one object comes to, and whether that needed anybody. */
interface Outcome {
  thing: Thing | null
  overlaps: PlaneOverlap[]
}

/** One object present on both sides and in the ancestor: field by field. */
function mergedObject(
  id: string,
  base: Thing,
  local: Thing,
  remote: Thing,
  times: Times,
  newer: Whose,
): Outcome {
  const [b, l, r] = [fieldsOf(base), fieldsOf(local), fieldsOf(remote)]
  const winner = newer === 'local' ? local : remote
  const overlaps: PlaneOverlap[] = []
  const taken: Fields = {}

  for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    const mine = !same(b[key], l[key])
    const theirs = !same(b[key], r[key])
    if (!mine && !theirs) continue
    if (mine && !theirs) {
      taken[key] = l[key]
      continue
    }
    if (!mine && theirs) {
      taken[key] = r[key]
      continue
    }
    if (same(l[key], r[key])) continue

    const [was, ours, other] = [b[key], l[key], r[key]]
    if (WORDS.includes(key) && typeof ours === 'string' && typeof other === 'string') {
      const text = diverge(typeof was === 'string' ? was : '', ours, other, times)
      overlaps.push({ id, field: key, newer, asks: text.verdict === 'diverged' })
      if (text.resolution !== null) taken[key] = text.resolution
      continue
    }

    overlaps.push({ id, field: key, newer, asks: false })
    taken[key] = newer === 'local' ? ours : other
  }

  return { thing: withFields(winner, taken), overlaps }
}

/** One object in the ancestor that one side deleted. */
function deletedOnOneSide(
  id: string,
  base: Thing,
  kept: Thing,
  keptBy: Whose,
  newer: Whose,
): Outcome {
  if (same(fieldsOf(base), fieldsOf(kept))) return { thing: null, overlaps: [] }

  const b = fieldsOf(base)
  const k = fieldsOf(kept)
  const rewritten = WORDS.reduce((sum, key) => {
    const was = b[key]
    const now = k[key]
    return typeof was === 'string' && typeof now === 'string' ? sum + written(was, now) : sum
  }, 0)

  const asks = rewritten > REWRITTEN
  return {
    thing: newer === keptBy ? kept : null,
    overlaps: [{ id, field: 'deleted', newer, asks }],
  }
}

/** Classifies what merging two edited planes against their ancestor would do. */
export function divergePlane(
  base: Canvas,
  local: Canvas,
  remote: Canvas,
  times: Times,
): PlaneDivergence {
  const newer: Whose = times.local > times.remote ? 'local' : 'remote'
  const [b, l, r] = [thingsOf(base), thingsOf(local), thingsOf(remote)]
  const overlaps: PlaneOverlap[] = []
  const settled = new Map<string, Thing | null>()

  const outcomeOf = (id: string): Outcome => {
    const [was, mine, theirs] = [b.get(id), l.get(id), r.get(id)]
    // Made while apart: ids are random, so only one side has it.
    if (!was) return { thing: mine ?? theirs ?? null, overlaps: [] }
    if (mine && theirs) return mergedObject(id, was, mine, theirs, times, newer)
    if (mine) return deletedOnOneSide(id, was, mine, 'local', newer)
    if (theirs) return deletedOnOneSide(id, was, theirs, 'remote', newer)
    return { thing: null, overlaps: [] }
  }

  for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const outcome = outcomeOf(id)
    settled.set(id, outcome.thing)
    overlaps.push(...outcome.overlaps)
  }

  const asks = overlaps.some((overlap) => overlap.asks)
  const verdict: Verdict = asks ? 'diverged' : overlaps.length ? 'minor' : 'clean'
  return {
    verdict,
    overlaps,
    resolution: asks ? null : resolvedPlane(base, local, remote, settled, newer),
  }
}

/** The merged plane: every object that stands, in the local stacking order with what
 *  only the other side added after it; the newest time and tombstone of each id; and
 *  the icon as the side that changed it left it. */
function resolvedPlane(
  base: Canvas,
  local: Canvas,
  remote: Canvas,
  settled: ReadonlyMap<string, Thing | null>,
  newer: Whose,
): Canvas {
  const order = [
    ...[...local.nodes, ...local.edges, ...local.ink].map((thing) => thing.id),
    ...[...remote.nodes, ...remote.edges, ...remote.ink].map((thing) => thing.id),
  ]
  const nodes: Canvas['nodes'] = []
  const edgeList: Canvas['edges'] = []
  const ink: Canvas['ink'] = []
  const placed = new Set<string>()

  for (const id of order) {
    const thing = settled.get(id)
    if (!thing || placed.has(id)) continue
    placed.add(id)
    if ('points' in thing) ink.push(thing)
    else if ('fromNode' in thing) edgeList.push(thing)
    else nodes.push(thing)
  }

  // An edge whose end did not survive the merge goes with it, as it would in a file.
  const ends = new Set(nodes.map((node) => node.id))
  const edgesKept = edgeList.filter((edge) => ends.has(edge.fromNode) && ends.has(edge.toNode))

  const at: Record<string, number> = {}
  for (const times of [local.at, remote.at]) {
    for (const [id, when] of Object.entries(times)) {
      if (placed.has(id)) at[id] = Math.max(at[id] ?? 0, when)
    }
  }

  const gone: Record<string, number> = {}
  for (const tombstones of [base.gone, local.gone, remote.gone]) {
    for (const [id, when] of Object.entries(tombstones)) {
      if (!placed.has(id)) gone[id] = Math.max(gone[id] ?? 0, when)
    }
  }

  const iconSide = (key: 'icon' | 'iconColor') => {
    const mine = !same(base[key], local[key])
    const theirs = !same(base[key], remote[key])
    if (mine && theirs) return newer === 'local' ? local[key] : remote[key]
    return mine ? local[key] : remote[key]
  }

  const out: Canvas = { nodes, edges: edgesKept, ink, at, gone }
  const icon = iconSide('icon')
  const iconColor = iconSide('iconColor')
  if (icon !== undefined) out.icon = icon
  if (iconColor !== undefined) out.iconColor = iconColor
  return out
}
