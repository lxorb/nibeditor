/** The maps a space keeps about its tree, one entry at a time (docs/sync-v2.md 5.11).
 *
 *  Bookmarks, folder icons and their colours, the manual order, the graph's settings
 *  and what search leaves out were each one value a v1 app writes whole, so two
 *  devices changing different entries lost one of them (road 9). Here each entry is a
 *  row of `space_entries` with the cursor it arrived at: a device sends the entries it
 *  changed, the account keeps, per entry, the one that arrived last, and a device asks
 *  for what changed since the last time it asked.
 *
 *  Keyed so a rename orphans nothing. A folder's icon is keyed by the folder's id, and
 *  a place in the manual order by the id of the thing placed, with a number for its
 *  position among its siblings - Figma's fractional positions, so two devices moving
 *  different rows both keep their moves. Something the tree does not hold (a folder
 *  with nothing synced in it yet) is keyed by its path, `path:<path>`, which is what
 *  the v1 column said.
 *
 *  The v1 columns stay, as what a v1 app reads: they are written from these rows, and
 *  a v1 app's whole value is read as "every entry changed" - what it names is set, and
 *  what it leaves out is taken away. */

import { Hono } from 'hono'
import { byteLength, newId, now } from '../crypto'
import { laterOf, pokeSpace } from '../hub/poke'
import { NOT_AN_OBJECT } from '../refused'
import { readBookmarks } from '../spaces/bookmarks'
import { MOST_BYTES } from '../spaces/columns'
import { readExcluded } from '../spaces/excluded'
import { readGraph } from '../spaces/graph'
import { readIcons, readTints } from '../spaces/icons'
import { readArranged } from '../spaces/arranged'
import { atLeast, spaceOf } from '../spaces/space'
import type { Env, Space, Variables } from '../types'
import { deviceOf } from './device'
import { readTree, type Tree } from './tree'

export type MapName = 'bookmark' | 'icon' | 'order' | 'graph' | 'excluded'
const MAPS: readonly MapName[] = ['bookmark', 'icon', 'order', 'graph', 'excluded']

/** One entry as a device sends it: `value` null takes it away. */
export interface Entry {
  map: MapName
  key: string
  value: unknown
}

/** And as the account keeps it. */
interface Kept extends Entry {
  seq: number
  at: number
}

/** The longest key an entry may have: an id, or a path. */
const LONGEST_KEY = 512
/** The most entries one request changes, and one page of the feed carries. */
const MOST_CHANGED = 200
const PAGE = 1000

const PATH = 'path:'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A bookmark as the v1 list holds it: its place in the list is where it is, not a
 *  field of it. */
function unplaced(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([field]) => field !== 'at'))
}

/** Whether a value is one this map may hold, judged by the same reader the v1 column
 *  is read through: what that reader would drop, a device may not send either. */
function holds(map: MapName, key: string, value: unknown): boolean {
  if (value === null) return true
  switch (map) {
    case 'bookmark':
      if (!isRecord(value) || !isPosition(value.at)) return false
      return readBookmarks(JSON.stringify([unplaced(value)])).length === 1
    case 'icon': {
      if (!isRecord(value) || typeof value.icon !== 'string') return false
      const icon = readIcons(JSON.stringify({ x: value.icon }))
      if (!('x' in icon)) return false
      if (value.tint === undefined) return true
      return typeof value.tint === 'string' && 'x' in readTints(JSON.stringify({ x: value.tint }))
    }
    case 'order':
      return isPosition(value)
    case 'graph':
      return key in readGraph(JSON.stringify({ [key]: value }))
    case 'excluded':
      return value === true && readExcluded(JSON.stringify([key])).includes(key)
  }
}

/** An entry off the wire, or null. */
function entryOf(value: unknown): Entry | null {
  if (!isRecord(value)) return null
  const { map, key } = value
  const name = MAPS.find((one) => one === map)
  if (!name || typeof key !== 'string' || !key || key.length > LONGEST_KEY) return null
  const held = value.value === undefined ? null : value.value
  return holds(name, key, held) ? { map: name, key, value: held } : null
}

/* ── What a v1 app reads ─────────────────────────────────────────────────── */

/** The live folder a path names, as the file list would find it. */
function folderAt(tree: Tree, path: string): string | null {
  let parent: string | null = null
  for (const name of path.split('/')) {
    const found = tree.child(parent, name)
    if (found?.kind !== 'folder') return null
    parent = found.id
  }
  return parent
}

/** Where a key points, as a path: an id's entry where it is now, or the path it names. */
function pathOfKey(tree: Tree, key: string): string | null {
  if (key.startsWith(PATH)) return key.slice(PATH.length)
  const entry = tree.entry(key)
  return entry && !entry.deleted ? tree.pathOf(key) : null
}

/** The v1 columns a set of entries says, each through its own reader, so what a v1 app
 *  is handed is exactly what its own write would have kept. */
function projected(entries: readonly Kept[], tree: Tree): Record<string, string> {
  const of = (map: MapName) => entries.filter((one) => one.map === map && one.value !== null)

  const bookmarks = of('bookmark')
    .map((one) => one.value as Record<string, unknown>)
    .sort((a, b) => Number(a.at) - Number(b.at))
    .map(unplaced)

  const icons: Record<string, string> = {}
  const tints: Record<string, string> = {}
  for (const one of of('icon')) {
    const path = pathOfKey(tree, one.key)
    const value = one.value as { icon: string; tint?: string }
    if (path === null) continue
    icons[path] = value.icon
    if (value.tint !== undefined) tints[path] = value.tint
  }

  const places = new Map<string, { name: string; at: number }[]>()
  for (const one of of('order')) {
    const placed = placeOf(tree, one.key)
    if (!placed) continue
    const list = places.get(placed.folder) ?? []
    list.push({ name: placed.name, at: one.value as number })
    places.set(placed.folder, list)
  }
  const arranged: Record<string, string[]> = {}
  for (const [folder, list] of places) {
    arranged[folder] = list.sort((a, b) => a.at - b.at).map((one) => one.name)
  }

  const graph: Record<string, unknown> = {}
  for (const one of of('graph')) graph[one.key] = one.value

  const excluded = of('excluded')
    .map((one) => one.key)
    .sort()

  return {
    bookmarks: JSON.stringify(readBookmarks(JSON.stringify(bookmarks))),
    icons: JSON.stringify(readIcons(JSON.stringify(icons))),
    tints: JSON.stringify(readTints(JSON.stringify(tints))),
    arranged: JSON.stringify(readArranged(JSON.stringify(arranged))),
    graph: JSON.stringify(readGraph(JSON.stringify(graph))),
    excluded: JSON.stringify(readExcluded(JSON.stringify(excluded))),
  }
}

/** Which folder an order entry is a place in, by path, and the name placed there. */
function placeOf(tree: Tree, key: string): { folder: string; name: string } | null {
  if (key.startsWith(PATH)) {
    const path = key.slice(PATH.length)
    const cut = path.lastIndexOf('/')
    return { folder: path.slice(0, Math.max(cut, 0)), name: path.slice(cut + 1) }
  }
  const entry = tree.entry(key)
  if (!entry || entry.deleted) return null
  return { folder: entry.parent === null ? '' : tree.pathOf(entry.parent), name: entry.name }
}

/** Whether the columns fit where a space keeps them; see spaces/columns.ts. */
function fitting(columns: Record<string, string>): boolean {
  return (
    byteLength(columns.bookmarks ?? '') <= MOST_BYTES.bookmarks &&
    byteLength(columns.icons ?? '') + byteLength(columns.tints ?? '') <= MOST_BYTES.icons &&
    byteLength(columns.arranged ?? '') <= MOST_BYTES.arranged &&
    byteLength(columns.graph ?? '') <= MOST_BYTES.graph &&
    byteLength(columns.excluded ?? '') <= MOST_BYTES.excluded
  )
}

async function keptIn(env: Env, spaceId: string): Promise<Kept[]> {
  const { results } = await env.DB.prepare(
    'select map, key, value, seq, at from space_entries where space_id = ?',
  )
    .bind(spaceId)
    .all<{ map: MapName; key: string; value: string | null; seq: number; at: number }>()
  return results.map((row) => ({
    map: row.map,
    key: row.key,
    value: row.value === null ? null : (JSON.parse(row.value) as unknown),
    seq: row.seq,
    at: row.at,
  }))
}

/** The entries with these laid over them, the later one of a key standing. */
function overlaid(
  kept: readonly Kept[],
  changes: readonly Entry[],
  seq: number,
  at: number,
): Kept[] {
  const byKey = new Map(kept.map((one) => [`${one.map}\u0000${one.key}`, one]))
  changes.forEach((one, index) => {
    byKey.set(`${one.map}\u0000${one.key}`, { ...one, seq: seq + index, at })
  })
  return [...byKey.values()]
}

/** Takes this many numbers off the space's cursor, answering the first. */
async function cursorBlock(env: Env, spaceId: string, many: number): Promise<number> {
  const row = await env.DB.prepare(
    `insert into space_cursor (space_id, next) values (?1, ?2 + 1)
     on conflict(space_id) do update set next = next + ?2
     returning next - ?2 as first`,
  )
    .bind(spaceId, many)
    .first<{ first: number }>()
  return row?.first ?? 1
}

/** The statements that write entries, and the v1 columns they come to. */
function writing(
  env: Env,
  spaceId: string,
  changes: readonly Kept[],
  columns: Record<string, string> | null,
  by: string,
): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = []
  for (let from = 0; from < changes.length; from += 200) {
    const piece = changes.slice(from, from + 200).map((one) => ({
      map: one.map,
      key: one.key,
      value: one.value === null ? null : JSON.stringify(one.value),
      seq: one.seq,
      at: one.at,
    }))
    out.push(
      env.DB.prepare(
        `insert into space_entries (space_id, map, key, value, seq, at, by)
         select ?1, json_extract(value, '$.map'), json_extract(value, '$.key'),
                json_extract(value, '$.value'), json_extract(value, '$.seq'),
                json_extract(value, '$.at'), ?2
           from json_each(?3) where true
         on conflict(space_id, map, key) do update
           set value = excluded.value, seq = excluded.seq, at = excluded.at, by = excluded.by`,
      ).bind(spaceId, by, JSON.stringify(piece)),
    )
  }
  if (columns) {
    out.push(
      env.DB.prepare(
        `update spaces set bookmarks = ?1, icons = ?2, tints = ?3, arranged = ?4, graph = ?5,
                           excluded = ?6, updated_at = ?7
          where id = ?8`,
      ).bind(
        columns.bookmarks,
        columns.icons,
        columns.tints,
        columns.arranged,
        columns.graph,
        columns.excluded,
        now(),
        spaceId,
      ),
    )
  }
  return out
}

/** A device's changed entries, each standing until a later one of its key arrives, and
 *  the v1 columns written from all of them. Answers the cursor, or null when the
 *  columns would be past what a space keeps. */
async function writeEntries(
  env: Env,
  spaceId: string,
  changes: readonly Entry[],
  by: string,
): Promise<number | null> {
  const [kept, tree] = [await keptIn(env, spaceId), await readTree(env, spaceId)]
  const at = now()
  const provisional = overlaid(kept, changes, 0, at)
  const columns = projected(provisional, tree)
  if (!fitting(columns)) return null

  const first = await cursorBlock(env, spaceId, changes.length)
  const stamped = changes.map((one, index) => ({ ...one, seq: first + index, at }))
  await env.DB.batch(writing(env, spaceId, stamped, columns, by))
  return first + changes.length - 1
}

/** A v1 app's whole value for one map, read as every entry changed: what it names is
 *  set, keyed as the tree now knows it, and what it leaves out is taken away. The
 *  column itself the v1 route has written already. */
export async function v1Wrote(env: Env, space: Space, map: MapName, value: unknown, by: string) {
  if (!space.prepared_at) return
  const [kept, tree] = [await keptIn(env, space.id), await readTree(env, space.id)]
  const mine = kept.filter((one) => one.map === map && one.value !== null)
  const said = entriesFromV1(map, value, tree, mine)

  const named = new Set(said.map((one) => one.key))
  const gone = mine
    .filter((one) => !named.has(one.key))
    .map((one) => ({ map, key: one.key, value: null }))
  const changes = [...said, ...gone]
  if (!changes.length) return

  const first = await cursorBlock(env, space.id, changes.length)
  const at = now()
  const stamped = changes.map((one, index) => ({ ...one, seq: first + index, at }))
  await env.DB.batch(writing(env, space.id, stamped, null, by))
}

/** What one v1 column says, as entries of its map. */
function entriesFromV1(map: MapName, value: unknown, tree: Tree, mine: readonly Kept[]): Entry[] {
  switch (map) {
    case 'bookmark': {
      // A bookmark has no id of its own in a v1 list, so one that says what a kept
      // entry says is that entry, and keeps its key; the rest are new.
      const left = [...mine]
      return (Array.isArray(value) ? value : []).map((bookmark: unknown, index) => {
        const same = left.findIndex((one) => sameBookmark(one.value, bookmark))
        const key = same >= 0 ? (left.splice(same, 1)[0]?.key ?? newId()) : newId()
        return { map, key, value: { ...(bookmark as object), at: index + 1 } }
      })
    }
    case 'icon': {
      const { icons, tints } = (isRecord(value) ? value : {}) as {
        icons?: Record<string, string>
        tints?: Record<string, string>
      }
      return Object.entries(icons ?? {}).map(([path, icon]) => {
        const folder = folderAt(tree, path)
        const tint = tints?.[path]
        return {
          map,
          key: folder ?? `${PATH}${path}`,
          value: { icon, ...(tint === undefined ? {} : { tint }) },
        }
      })
    }
    case 'order': {
      const out: Entry[] = []
      for (const [folder, names] of Object.entries(isRecord(value) ? value : {})) {
        const parent = folder === '' ? null : folderAt(tree, folder)
        ;(Array.isArray(names) ? names : []).forEach((name: unknown, index) => {
          if (typeof name !== 'string') return
          const child = folder === '' || parent !== null ? tree.child(parent, name) : undefined
          out.push({ map, key: child?.id ?? `${PATH}${folder}/${name}`, value: index + 1 })
        })
      }
      return out
    }
    case 'graph':
      return Object.entries(isRecord(value) ? value : {}).map(([key, one]) => ({
        map,
        key,
        value: one,
      }))
    case 'excluded':
      return (Array.isArray(value) ? value : [])
        .filter((path): path is string => typeof path === 'string')
        .map((path) => ({ map, key: path, value: true }))
  }
}

function sameBookmark(kept: unknown, sent: unknown): boolean {
  if (!isRecord(kept) || !isRecord(sent)) return false
  return (['kind', 'path', 'text', 'parent', 'view'] as const).every(
    (field) => kept[field] === sent[field],
  )
}

/** A space prepared for the first time: every v1 column read in as entries. */
export async function backfillMaps(env: Env, spaceId: string): Promise<void> {
  const space = await env.DB.prepare('select * from spaces where id = ?')
    .bind(spaceId)
    .first<Space>()
  if (!space) return
  const values: [MapName, unknown][] = [
    ['bookmark', readBookmarks(space.bookmarks)],
    ['icon', { icons: readIcons(space.icons), tints: readTints(space.tints) }],
    ['order', readArranged(space.arranged)],
    ['graph', readGraph(space.graph)],
    ['excluded', readExcluded(space.excluded)],
  ]
  for (const [map, value] of values) await v1Wrote(env, space, map, value, '')
}

/** The tree moved: every v1 column keyed by path written again from the entries, so a
 *  folder renamed on a v2 device keeps its icon and its order on a v1 one too. */
export async function reproject(env: Env, spaceId: string): Promise<void> {
  const kept = await keptIn(env, spaceId)
  if (!kept.some((one) => one.map === 'icon' || one.map === 'order')) return
  const columns = projected(kept, await readTree(env, spaceId))
  if (!fitting(columns)) return
  await env.DB.batch(writing(env, spaceId, [], columns, ''))
}

/** What changed since a cursor, a page at a time. */
async function entriesSince(
  env: Env,
  spaceId: string,
  since: number,
): Promise<{ entries: Kept[]; cursor: number; more: boolean }> {
  const { results } = await env.DB.prepare(
    `select map, key, value, seq, at from space_entries
      where space_id = ? and seq > ? order by seq limit ?`,
  )
    .bind(spaceId, since, PAGE + 1)
    .all<{ map: MapName; key: string; value: string | null; seq: number; at: number }>()

  const page = results.slice(0, PAGE)
  return {
    entries: page.map((row) => ({
      map: row.map,
      key: row.key,
      value: row.value === null ? null : (JSON.parse(row.value) as unknown),
      seq: row.seq,
      at: row.at,
    })),
    cursor: page.at(-1)?.seq ?? since,
    more: results.length > PAGE,
  }
}

interface App {
  Bindings: Env
  Variables: Variables
}

/** A request's entries, or null for one that is not a list of them. */
function changesIn(body: unknown): Entry[] | null {
  if (!isRecord(body) || !Array.isArray(body.entries) || body.entries.length > MOST_CHANGED) {
    return null
  }
  const out: Entry[] = []
  for (const one of body.entries as unknown[]) {
    const entry = entryOf(one)
    if (!entry) return null
    out.push(entry)
  }
  return out
}

/** A map entry a correct client never sends. It reaches no reader, so it stays English. */
const NOT_AN_ENTRY = 'that is not an entry this space keeps'

/** Entries that would make one of the columns past what a space keeps; see
 *  spaces/columns.ts. A person can arrange and dress their way there, so it has a row
 *  in every catalogue. */
const TOO_MUCH_ABOUT_THE_TREE = 'that is more than a space keeps about its tree'

export const v2Maps = new Hono<App>()

v2Maps.get('/:space/maps', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  const asked = Math.floor(Number(context.req.query('since') ?? 0))
  const since = Number.isFinite(asked) && asked > 0 ? asked : 0
  return context.json(await entriesSince(context.env, space.id, since))
})

// What a space says about its own tree is the space's, so changing it is writing in it.
v2Maps.patch('/:space/maps', atLeast('write', 'space'), async (context) => {
  const space = spaceOf(context)
  const body: unknown = await context.req.json().catch(() => undefined)
  if (!isRecord(body)) return context.json({ error: NOT_AN_OBJECT }, 400)
  const changes = changesIn(body)
  if (!changes) return context.json({ error: NOT_AN_ENTRY }, 400)
  if (!changes.length) return context.json({ cursor: 0 })

  const device = await deviceOf(context)
  const cursor = await writeEntries(context.env, space.id, changes, device)
  if (cursor === null) {
    return context.json({ error: TOO_MUCH_ABOUT_THE_TREE }, 413)
  }
  await pokeSpace(context.env, laterOf(context), space.id, cursor, device)
  return context.json({ cursor })
})
