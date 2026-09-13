/** How one space's graph is drawn: what the picture is filtered to, which queries
 *  are coloured, how far apart the arrangement sits, and whether a link wears an
 *  arrowhead.
 *
 *  On the space rather than on the account, because every one of these is a fact
 *  about that space's notes: a filter reading `tag:work` means nothing in a space
 *  with no such tag. So it travels with the space, and every device signed in draws
 *  the same picture.
 *
 *  Written whole, the way the bookmarks and the folder icons are: it is one small
 *  object, and one PUT of the lot is the only shape in which turning a switch and
 *  clearing a filter in the same gesture is a single request.
 *
 *  Read from what was checked rather than from what arrived, and a field this
 *  version has never heard of is dropped rather than the request refused - a newer
 *  app writing a setting this build does not know must not lose the rest along
 *  with it. See spaces/icons.ts, whose shape this is. */

import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody, objectIn } from '../body'
import { fits, writeColumn } from './columns'
import type { Env, Variables } from '../types'
import { atLeast, spaceOf } from './space'

/** How many colour groups a space may have: one per colour the app's theme names.
 *  The app holds itself to the same six, so a set that fits there fits here. */
const MOST_GROUPS = 6
/** How long one query may be, in the field and in a group. */
const LONGEST_QUERY = 200
/** How far apart the arrangement may be pushed, as a multiple of what it does on
 *  its own. */
const LEAST_SPREAD = 0.25
const MOST_SPREAD = 4
/** How many links out the picture beside one note may reach; the app's slider goes
 *  exactly this far. */
const SHALLOWEST = 1
const DEEPEST = 5
/** The three widths a link may be drawn at; the app offers the same three. */
const LEAST_LINES = 1
const MOST_LINES = 3
/** How much sooner or later the names may be asked to fade in, as a multiple of the
 *  zoom the picture shows them at unasked. */
const LEAST_FADE = 0.25
const MOST_FADE = 4

interface ColourGroup {
  query: string
  colour: number
}

/** What the column holds. Every field optional on the way in: a client sends what
 *  it knows about, and one that knows about less is not wrong. */
interface GraphSettings {
  filter?: string
  orphans?: boolean
  attachments?: boolean
  groups?: ColourGroup[]
  spread?: number
  gather?: boolean
  arrows?: boolean
  sized?: boolean
  lines?: number
  fade?: number
  depth?: number
}

/** What is wrong with the object that arrived, as one sentence the app can show,
 *  or null when nothing is.
 *
 *  Only the object itself and the size of what is in it. A field that does not read
 *  as a setting is dropped rather than refused, for the reason the folder icons give:
 *  the object is written whole, so refusing over one field the app and this version
 *  disagree about would be losing every setting in it. */
function wrong(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'graph must be an object'

  const sent = value as Record<string, unknown>
  if (typeof sent.filter === 'string' && sent.filter.length > LONGEST_QUERY) {
    return `a filter is at most ${LONGEST_QUERY} characters`
  }
  if (Array.isArray(sent.groups) && sent.groups.length > MOST_GROUPS) {
    return `a space colours at most ${MOST_GROUPS} groups`
  }

  return null
}

function held(value: unknown, least: number, most: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(most, Math.max(least, value))
}

function switched(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** A group with no query yet is kept rather than dropped: it is the row the app
 *  has just added and is about to be typed into, and it colours nothing until it
 *  says something. The app keeps it for the same reason. */
function groupsOf(value: unknown): ColourGroup[] | undefined {
  if (!Array.isArray(value)) return undefined

  const out: ColourGroup[] = []
  for (const one of value) {
    if (out.length >= MOST_GROUPS) break
    if (!one || typeof one !== 'object' || Array.isArray(one)) continue

    const sent = one as Record<string, unknown>
    if (typeof sent.query !== 'string') continue

    out.push({
      query: sent.query.slice(0, LONGEST_QUERY),
      colour: Math.round(held(sent.colour, 1, MOST_GROUPS) ?? 1),
    })
  }

  return out
}

/** The fields that read as settings, and nothing else. The one place the two
 *  directions agree: what a PUT keeps is what a read gives back. */
function settingsOf(value: object): GraphSettings {
  const sent = value as Record<string, unknown>
  const out: GraphSettings = {}

  if (typeof sent.filter === 'string') out.filter = sent.filter.slice(0, LONGEST_QUERY)

  const orphans = switched(sent.orphans)
  if (orphans !== undefined) out.orphans = orphans

  const attachments = switched(sent.attachments)
  if (attachments !== undefined) out.attachments = attachments

  const groups = groupsOf(sent.groups)
  if (groups !== undefined) out.groups = groups

  const spread = held(sent.spread, LEAST_SPREAD, MOST_SPREAD)
  if (spread !== undefined) out.spread = spread

  const gather = switched(sent.gather)
  if (gather !== undefined) out.gather = gather

  const arrows = switched(sent.arrows)
  if (arrows !== undefined) out.arrows = arrows

  const sized = switched(sent.sized)
  if (sized !== undefined) out.sized = sized

  const lines = held(sent.lines, LEAST_LINES, MOST_LINES)
  if (lines !== undefined) out.lines = Math.round(lines)

  const fade = held(sent.fade, LEAST_FADE, MOST_FADE)
  if (fade !== undefined) out.fade = fade

  const depth = held(sent.depth, SHALLOWEST, DEEPEST)
  if (depth !== undefined) out.depth = Math.round(depth)

  return out
}

/** The column, as the app reads it back. Anything in it that is not a setting is
 *  left out: the column is written whole by clients, and a newer one may keep a
 *  setting this version has never heard of. */
export function readGraph(raw: string): GraphSettings {
  const held = objectIn(raw)
  return held ? settingsOf(held) : {}
}

export const spaceGraph = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The settings, whole. Reading them needs no route of its own: the space listing
 *  carries them, so one request brings every space's picture along with its name.
 */
// The picture is the space's rather than the reader's: everyone in it looks at the
// same notes, so filtering it is writing in the space.
spaceGraph.put('/:id/graph', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body.graph
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  // Written from the fields that were checked rather than from what arrived, so
  // nothing else a client sent along ends up in the column.
  const kept = settingsOf(sent as object)
  const written = JSON.stringify(kept)
  if (!fits(written, 'graph')) {
    return context.json({ error: 'that is more than a space keeps about its graph' }, 413)
  }

  // The space is touched as well, so a device that watches for spaces that
  // changed learns that this one did.
  await writeColumn(context.env, 'graph', space.id, written)

  return context.json({ graph: kept })
})
