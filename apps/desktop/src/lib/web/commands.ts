/** The desktop app's command surface, served from the browser's own storage.
 *  Same names, same shapes - so every call site works on both. */

import { SIDECAR } from '../pdf/highlights'
import { staleSnapshots } from '../recovery'
import { markedPlane, type PlaneMarks, planeMarks } from '../scan-canvas'
import { scanNote, scanShortcut, type SpaceLinks } from '../scan-note'
import { isNumber, isRecord, isString, parsed } from '../stored'
import { tagsIn } from '../search/tags'
import {
  basename,
  isCanvas,
  isMarkdown,
  isPages,
  isPdf,
  join,
  normalise,
  parent,
  safeName,
  spaceOf,
  within,
} from './paths'
import { isWebTarget } from '@nib/markdown/links'
import { assetType } from './asset-route'
import { assets, files, KEEP, meta, snapshots, stats } from './store'
import { markSeeded, wasSeeded } from '../seeded'
import { breathe } from '../breathe'
import { WELCOME, WELCOME_PATH } from '../welcome'

interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
}

interface TreeOptions {
  showHidden?: boolean
}

const now = () => Date.now()

/** How much of a space one chunk of the link scan reads and reads through before
 *  letting go of the thread, in characters of the files themselves.
 *
 *  Characters rather than notes, because reading the links out of a note costs what
 *  the note is long. A chunk was 128 notes, which for notes of four kilobytes is
 *  half a megabyte and fifty to seventy milliseconds of a task, and for a chunk that
 *  held a canvas of seven megabytes was a third of a second. A quarter of a megabyte
 *  is twenty to thirty. A file longer than this is a chunk on its own: what it costs
 *  is its own, and nothing else waits behind it. */
export const SCANNED_AT_ONCE = 256 * 1024

/** What a file counts for where the listing does not say how long it is: the share
 *  of a chunk each note had when a chunk was 128 notes, so a listing written before
 *  it kept sizes is read the way it always was. See `StatRow` in store.ts. */
const UNSIZED = SCANNED_AT_ONCE / 128

/** The paths whose words are read, in order, in runs of about `SCANNED_AT_ONCE`
 *  characters each. A run is one stretch of the store, so a file between two of its
 *  paths is read with them: one whose words are not wanted ends the run before it
 *  unless it is small enough not to matter, and is in none. */
function chunksOf(
  paths: readonly string[],
  sizes: ReadonlyMap<string, number>,
  wanted: (path: string) => boolean,
): string[][] {
  const out: string[][] = []
  let chunk: string[] = []
  let held = 0

  for (const path of paths) {
    if (!wanted(path)) {
      if (chunk.length && (sizes.get(path) ?? Infinity) > UNSIZED) {
        out.push(chunk)
        chunk = []
        held = 0
      }
      continue
    }

    const size = sizes.get(path) ?? UNSIZED
    if (chunk.length && held + size > SCANNED_AT_ONCE) {
      out.push(chunk)
      chunk = []
      held = 0
    }

    chunk.push(path)
    held += size
  }

  if (chunk.length) out.push(chunk)
  return out
}

/** Whether a file is one the tree shows: a note, a PDF beside one, a canvas, a page
 *  note, or a website. The same kinds the desktop's `read_tree` lists, and for the
 *  same reason - they are the things a tab can hold. A page note was left out of
 *  both lists, which left one drawn in a tab and nowhere else: no row in the file
 *  list, nothing for a search to read, and nothing for the mirror to send up, since
 *  the mirror walks this tree. */
function listed(path: string): boolean {
  return isMarkdown(path) || isPdf(path) || isCanvas(path) || isPages(path) || isWebTarget(path)
}

/** Where a PDF's highlights are kept. The desktop's command derives this on the
 *  Rust side; here the store is a flat map of paths, so it is derived in front of
 *  it. */
function sidecarOf(path: string): string {
  return `${normalise(path)}${SIDECAR}`
}

/** Builds the folder tree from the flat list of paths.
 *
 *  From the listing rather than from the notes, which is the whole of why the file
 *  list is on screen before anything has been read: a space of three thousand
 *  notes answers this in one small read instead of handing back three thousand
 *  bodies to have their names taken off them. Notes and pictures alike, since a
 *  path has one stat wherever the file itself lives. See web/store.ts. */
async function tree(root: string, options: TreeOptions = {}): Promise<Entry> {
  const base = normalise(root)
  const rows = (await stats.all()).filter((row) => within(base, row.path))

  const folders = new Map<string, Entry>()
  const make = (path: string): Entry => {
    const existing = folders.get(path)
    if (existing) return existing

    const entry: Entry = {
      name: basename(path) || 'Nib',
      path,
      is_dir: true,
      modified: 0,
      created: 0,
      children: [],
    }

    folders.set(path, entry)
    if (path !== base) make(parent(path)).children.push(entry)
    return entry
  }

  const top = make(base)

  for (const row of rows) {
    if (basename(row.path) === KEEP) {
      // The marker only exists to keep its folder on the tree.
      make(parent(row.path))
      continue
    }

    if (!listed(row.path)) continue
    if (!options.showHidden && basename(row.path).startsWith('.')) continue

    make(parent(row.path)).children.push({
      name: basename(row.path),
      path: row.path,
      is_dir: false,
      modified: row.modified,
      created: row.created,
      children: [],
    })
  }

  // Folders first, then the names, and nothing about which order the reader chose:
  // that is decided over the listing, once, in the app's own tree-order.ts, the same
  // way it is decided over the one the Rust crate answers with. What this owes is an
  // answer that is the same twice, since a map is walked in whatever order it was
  // filled in.
  const sort = (entry: Entry) => {
    entry.children.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1
    })
    entry.children.forEach(sort)
  }

  sort(top)
  return top
}

async function writeNote(path: string, content: string) {
  // A plane's marks go into its listing with it, so the scan of the space never has
  // to read the plane for them; see `scanLinks`. Read to its icon and no further,
  // for a plane this app wrote; see scan-canvas.ts.
  await files.write(
    normalise(path),
    content,
    now(),
    isCanvas(path) ? planeMarks(content) : undefined,
  )
}

/** Everything under `from` moves, so renaming a folder takes its notes along -
 *  and the files beside them, which is how a PDF's own highlights follow it. */
async function renameNote(from: string, to: string) {
  const source = normalise(from)
  const target = normalise(to)
  if (source === target) return

  await moveAssets(source, target)

  // `occupied` and not `files.get`: a folder has no row of its own, so asking
  // only about an exact path would let a note be renamed onto a folder and
  // land inside it, taking the folder's name and hiding what was in it.
  if (await occupied(target)) throw new Error('something already lives there')

  const rows = (await files.all()).filter(
    (row) => row.path === source || row.path.startsWith(`${source}/`),
  )

  if (!rows.length) throw new Error('nothing to rename')

  // One transaction for the lot. Row by row, a browser closed halfway through
  // renaming a folder would leave half its notes under the old name and half
  // under the new, with no way to tell which.
  await files.move(
    rows.map((row) => ({ ...row, path: target + row.path.slice(source.length), modified: now() })),
    rows.map((row) => row.path),
  )
}

/** The desktop's `copy_path`: a note, a file or a folder and everything under it,
 *  copied, from both stores - a PDF is a row in the asset store and its highlights a
 *  row in the note store beside it. Never over anything, and never into itself,
 *  which is what the desktop refuses too. */
async function copyPath(from: string, to: string) {
  const source = normalise(from)
  const target = normalise(to)

  if (target === source || target.startsWith(`${source}/`)) {
    throw new Error(`${source} cannot be copied into itself`)
  }
  if ((await occupied(target)) || (await assets.get(target))) {
    throw new Error('something already lives there')
  }

  const under = (one: string) => one === source || one.startsWith(`${source}/`)
  const copied = (one: string) => target + one.slice(source.length)
  const notes = (await files.all()).filter((row) => under(row.path))
  const pictures = (await assets.all()).filter((row) => under(row.path))
  if (!notes.length && !pictures.length) throw new Error('nothing to copy')

  for (const row of notes) {
    await files.put({ ...row, path: copied(row.path), created: now(), modified: now() })
  }
  for (const row of pictures) await assets.put({ ...row, path: copied(row.path), modified: now() })

  const side = isPdf(source) ? await files.get(sidecarOf(source)) : undefined
  if (side) await files.put({ ...side, path: sidecarOf(target), created: now(), modified: now() })
}

async function removeFolder(path: string) {
  const base = normalise(path)
  const under = (one: string) => one === base || one.startsWith(`${base}/`)

  for (const one of (await files.paths()).filter(under)) await files.remove(one)
  for (const one of (await assets.paths()).filter(under)) await assets.remove(one)
}

/** The desktop's `remove_empty_folder`: gone only if nothing whatever is left
 *  inside it. Here a folder is only the paths under it plus the marker that keeps
 *  an empty one on the tree, so "empty" means the marker and nothing else - and a
 *  picture or a PDF still under it leaves the folder standing, which is the
 *  refusal the desktop's `fs::remove_dir` makes for the same reason. */
async function removeEmptyFolder(path: string) {
  const base = normalise(path)
  const inside = (one: string) => one.startsWith(`${base}/`)
  const held = [...(await files.paths()), ...(await assets.paths())].filter(inside)

  if (held.some((one) => basename(one) !== KEEP)) return
  for (const one of held) await files.remove(one)
}

/** The files beside the notes, moved with them. A PDF is a row in the asset store
 *  rather than in the note store, so a rename that only walked the notes would
 *  leave the paper behind under a folder that no longer exists. */
async function moveAssets(source: string, target: string) {
  const rows = (await assets.all()).filter(
    (row) => row.path === source || row.path.startsWith(`${source}/`),
  )

  for (const row of rows) {
    await assets.put({ ...row, path: target + row.path.slice(source.length), modified: now() })
    await assets.remove(row.path)
  }
}

/** Recently deleted, the browser's way: rows move under `/.trash/<id>/` and a
 *  manifest in the meta store says what each was and where it came from.
 *  The same commands as the desktop's trash.rs, so the app never branches. */
const TRASH = '/.trash'

interface TrashEntry {
  id: string
  kind: string
  name: string
  from: string
  trashedAt: number
}

let trashCounter = 0

/** One row of the manifest, or nothing when it is not one.
 *
 *  The manifest is a string in the browser's own storage: written by some version
 *  of this app, possibly by one interrupted halfway. Read as the shape the code
 *  wants, half an entry is a throw on the way into Recently deleted - which is
 *  the one place somebody goes to get a note back. So a bad row costs itself and
 *  the rest of the list still opens; see stored.ts, which says the same thing
 *  about the same problem. */
function entryOf(value: unknown): TrashEntry | null {
  if (!isRecord(value)) return null

  const { id, kind, name, from, trashedAt } = value
  if (!isString(id) || !isString(kind) || !isString(name)) return null
  if (!isString(from) || !isNumber(trashedAt)) return null

  return { id, kind, name, from, trashedAt }
}

async function trashEntries(): Promise<TrashEntry[]> {
  const held = parsed((await meta.get('trash')) ?? null)
  if (!Array.isArray(held)) return []

  return held.map(entryOf).filter((one): one is TrashEntry => one !== null)
}

async function saveTrash(entries: TrashEntry[]) {
  await meta.put('trash', JSON.stringify(entries))
}

async function occupied(path: string): Promise<boolean> {
  if (await files.get(path)) return true
  return (await files.paths()).some((one) => one.startsWith(`${path}/`))
}

/** `path` if nothing is there, else `name 2`, `name 3`... - before the
 *  extension for a note, after the name for a folder or a space. */
async function freeSpot(path: string, isFile: boolean): Promise<string> {
  if (!(await occupied(path))) return path

  const folder = parent(path)
  const file = basename(path)
  const dot = file.lastIndexOf('.')
  const stem = isFile && dot > 0 ? file.slice(0, dot) : file
  const extension = isFile && dot > 0 ? file.slice(dot) : ''

  for (let counter = 2; ; counter++) {
    const candidate = join(folder, `${stem} ${counter}${extension}`)
    if (!(await occupied(candidate))) return candidate
  }
}

async function trashItem(path: string, kind: string): Promise<TrashEntry> {
  const source = normalise(path)
  if (source === '/' || source.startsWith(TRASH)) throw new Error('that cannot be deleted')
  if (!(await occupied(source))) throw new Error('nothing is there')

  const id = `${now()}-${trashCounter++}`
  const name = basename(source)
  await renameNote(source, `${TRASH}/${id}/${name}`)

  const entry = { id, kind, name, from: source, trashedAt: now() }
  await saveTrash([...(await trashEntries()), entry])
  return entry
}

async function restoreTrash(id: string): Promise<string> {
  const entries = await trashEntries()
  const entry = entries.find((one) => one.id === id)
  if (!entry) throw new Error('nothing to restore')

  const held = `${TRASH}/${entry.id}/${entry.name}`
  const rest = entries.filter((one) => one.id !== id)
  if (!(await occupied(held))) {
    await saveTrash(rest)
    throw new Error('it is already gone')
  }

  const target = await freeSpot(entry.from, entry.kind === 'note')
  await renameNote(held, target)
  await saveTrash(rest)
  return target
}

async function purgeTrash(id: string) {
  await removeFolder(`${TRASH}/${id}`)
  await saveTrash((await trashEntries()).filter((one) => one.id !== id))
}

async function spaceList() {
  const names = new Set<string>()

  // Paths, because a space is a folder name: this is the first thing the app asks
  // for on the way up and it used to hand back every note in the browser to find
  // out how many folders there were.
  for (const path of await files.paths()) {
    const space = spaceOf(path)
    // A dot folder is the app's own, not a space: Recently deleted lives in one.
    if (space !== '/' && !basename(space).startsWith('.')) names.add(space)
  }

  return [...names]
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
    .map((path) => ({ name: basename(path), path }))
}

/** Every tag in a space and how many times it is written, as the command has always
 *  answered.
 *
 *  Nothing in the app asks any more. The tag tree is built from the link index,
 *  which already holds each note's tags from the one pass that reads the space, and
 *  the number beside a tag there is the notes carrying it rather than the uses of it;
 *  see `tagCounts` in link-index.svelte.ts. This stays because the command exists on
 *  both platforms and the crate still answers it this way - and reading every body in
 *  a space to count them is exactly what the index was there to stop, so a new caller
 *  should reach for the index instead. */
async function spaceTags(root: string) {
  const rows = (await files.all()).filter(
    (row) => within(normalise(root), row.path) && isMarkdown(row.path),
  )

  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const tag of tagsIn(row.content)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1))
}

/** The browser's answer to the desktop's `scan_links`, which reads a whole space
 *  in one pass. Here the space is a store of rows rather than a folder of files;
 *  each note is read by `scanNote`, which is also what the index uses for a note
 *  that has just been saved.
 *
 *  A stretch of the space at a time, with the thread let go of between them. The
 *  whole store at once was one task of two thirds of a second on a space of three
 *  thousand notes, which is two thirds of a second of somebody's keystrokes
 *  appearing all at once when it ended - and it happens on the launch, while they
 *  are reading the note it opened. In chunks it is the same work in short tasks
 *  with room for a keystroke between them, and nothing is held twice: the names
 *  and their sizes come first, cheaply, and only a chunk's bodies are in hand. See
 *  `SCANNED_AT_ONCE` for how much a chunk is.
 *
 *  Off the launch's critical path as well; see `build` in link-index.svelte.ts and
 *  startup.svelte.ts. */
async function scanLinks(root: string): Promise<SpaceLinks> {
  const base = normalise(root)
  const relative = (path: string) => path.slice(base === '/' ? 1 : base.length + 1)

  const notes: SpaceLinks['notes'] = []
  const beside: string[] = []
  const paths = (await files.paths()).filter((path) => within(base, path))
  const sizes = new Map<string, number>()
  const marked = new Map<string, PlaneMarks>()
  for (const row of await stats.all()) {
    if (!within(base, row.path)) continue
    if (row.size !== undefined) sizes.set(row.path, row.size)
    if (row.plane) marked.set(row.path, row.plane)
  }
  // A plane or a page note nobody has sized yet may be megabytes; see `chunksOf`.
  for (const path of paths) {
    if (!sizes.has(path) && (isCanvas(path) || isPages(path))) sizes.set(path, Infinity)
  }

  // Whose words are read: a note's and a website's, and a canvas's only where its
  // listing does not say yet what the index wants of it - its icon, for a row of the
  // tree, and the notes its cards are. The desktop's `scan_links` reads a canvas for
  // the same two on the same pass. Everything else is a name beside the notes.
  const read = (path: string) =>
    isMarkdown(path) || isWebTarget(path) || (isCanvas(path) && !marked.has(path))

  for (const path of paths) {
    if (read(path)) continue

    const marks = marked.get(path)
    // A `.keep` is scaffolding rather than a file somebody put in the space, and a
    // PDF's highlights are part of the PDF.
    if (marks) notes.push(markedPlane(relative(path), marks))
    else if (basename(path) !== KEEP && !path.endsWith(SIDECAR)) beside.push(path)
  }

  // What the listing did not know and this pass found out, so the next pass knows.
  const learnt: { path: string; modified: number; size: number; plane?: PlaneMarks }[] = []

  for (const chunk of chunksOf(paths, sizes, read)) {
    // Every path in the space sorts together, so the stretch between the first and
    // the last of a chunk is that chunk and whatever small file lies between.
    for (const row of await files.between(chunk[0] ?? '', chunk.at(-1) ?? '')) {
      const found = { path: row.path, modified: row.modified, size: row.content.length }

      if (isCanvas(row.path) && read(row.path)) {
        const marks = planeMarks(row.content)
        notes.push(markedPlane(relative(row.path), marks))
        learnt.push({ ...found, plane: marks })
        continue
      }

      if (!sizes.has(row.path)) learnt.push(found)
      if (!read(row.path)) continue

      if (isMarkdown(row.path)) {
        notes.push(scanNote(relative(row.path), row.content))
        continue
      }

      // A website is both: a file beside the notes, so `[[Svelte docs.url]]`
      // resolves, and a row in the index, so `[[Svelte docs]]` does and the graph
      // has a node for it. Its one line worth reading is the favicon the file list
      // draws in front of the row; see scanShortcut.
      notes.push(scanShortcut(relative(row.path), row.content))
      beside.push(row.path)
    }

    await breathe()
  }

  // A size that is not written down is a chunk of the old length next time, which
  // is how every chunk was read before sizes were kept: nothing to report.
  if (learnt.length) await stats.learn(learnt).catch(() => undefined)

  // Pictures live in their own store here, and only their names are wanted.
  const pictures = (await assets.paths()).filter((path) => within(base, path))

  return {
    notes: notes.sort((a, b) => (a.path < b.path ? -1 : 1)),
    files: [...beside, ...pictures].map(relative).sort(),
  }
}

const KEEP_SNAPSHOTS = 40

async function snapshot(path: string, content: string, source: string | undefined) {
  const notePath = normalise(path)
  const said = source ? { source: source.trim().slice(0, 64) } : {}
  // Nothing to keep when the words have not moved since the last version, which
  // is what the disk side does too; see src-tauri/src/history.rs. That version is
  // then the one kept, and says who for.
  const last = await snapshots.newest(notePath)
  if (last?.content === content) {
    if (source) await snapshots.put({ ...last, ...said })
    return
  }

  await snapshots.put({ notePath, content, taken_at: now(), size: content.length, ...said })

  const ids = await snapshots.idsOf(notePath)
  for (const id of ids.slice(0, Math.max(0, ids.length - KEEP_SNAPSHOTS))) {
    await snapshots.remove(id)
  }
}

/** The retention sweep, by the same policy the desktop sweeps by: see
 *  recovery.ts, which both sides read it from. */
async function purgeSnapshots(days: number): Promise<number> {
  const all = await snapshots.all()
  const byNote = new Map<string, { id?: number; taken_at: number }[]>()
  for (const row of all) {
    const note = byNote.get(row.notePath) ?? []
    note.push(row)
    byNote.set(row.notePath, note)
  }

  let dropped = 0
  for (const rows of byNote.values()) {
    const stale = new Set(
      staleSnapshots(
        rows.map((row) => row.taken_at),
        now(),
        days,
      ),
    )

    for (const row of rows) {
      if (row.id === undefined || !stale.has(row.taken_at)) continue

      await snapshots.remove(row.id)
      dropped++
    }
  }

  return dropped
}

/* ── Themes ───────────────────────────────────────────────────────── */

/** Installed themes live under a shared prefix, which is this storage's version
 *  of the folder the desktop keeps them in. */
const THEMES = 'themes/'

/** The same shape the crate insists an id has, for the same reason: here it
 *  becomes a key rather than a path, and a key that could be anything would
 *  let a theme write over `custom.css`. */
const THEME_ID = /^[a-z0-9][a-z0-9-]{0,38}$/

const themeKey = (id: string) => `${THEMES}${id}.css`

/** `night-owl` becomes `Night owl`, the way the crate labels a theme file.
 *  Only what a theme with no stamp of its own is called. */
function humanise(stem: string): string {
  const spaced = stem.replace(/[-_]/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

async function listThemes(): Promise<{ id: string; name: string; path: string }[]> {
  const keys = (await meta.keys()).filter(
    (key): key is string => typeof key === 'string' && key.startsWith(THEMES),
  )

  return keys
    .map((key) => {
      const stem = key.slice(THEMES.length).replace(/\.css$/, '')
      return { id: `file:${stem}`, name: humanise(stem), path: key }
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
}

async function writeTheme(id: string, css: string): Promise<string> {
  if (!THEME_ID.test(id)) throw new Error(`${id} is not a theme id`)

  const key = themeKey(id)
  await meta.put(key, css)
  return key
}

async function removeTheme(id: string): Promise<void> {
  if (!THEME_ID.test(id)) throw new Error(`${id} is not a theme id`)
  await meta.remove(themeKey(id))
}

/* ── Papers ───────────────────────────────────────────────────────── */

/** The words taken out of a PDF live under a shared prefix, which is this
 *  storage's version of the folder the desktop keeps them in; see papers.rs.
 *
 *  The size is part of the key. Listing the store is how the app holds it to a
 *  bound, and a listing that had to read every record to find out how big it is
 *  would read the megabytes it exists to avoid reading - so the keys carry it, and
 *  there is no second row to fall out of step with the first. */
const PAPERS = 'papers/'

/** How much of one paper may be kept, the same ceiling the crate holds. */
const PAPER_LIMIT = 4 * 1024 * 1024

const paperKey = (path: string, size: number) => `${PAPERS}${size}:${path}`

/** Every record the store holds, from the keys and nothing else. */
async function paperRecords(): Promise<{ key: string; path: string; size: number }[]> {
  const keys = (await meta.keys()).filter(
    (key): key is string => typeof key === 'string' && key.startsWith(PAPERS),
  )

  return keys.flatMap((key) => {
    const rest = key.slice(PAPERS.length)
    const at = rest.indexOf(':')
    const size = Number(rest.slice(0, at))
    const path = rest.slice(at + 1)
    // A key nobody here wrote is a key nobody here reads.
    if (at < 1 || !Number.isFinite(size) || !path) return []

    return [{ key, path, size }]
  })
}

async function readPaperText(path: string): Promise<string> {
  const wanted = normalise(path)
  const found = (await paperRecords()).find((one) => one.path === wanted)

  return found ? ((await meta.get(found.key)) ?? '') : ''
}

/** One paper's words written down, or taken away again when nothing is sent. */
async function writePaperText(path: string, content: string): Promise<void> {
  if (!isPdf(path)) throw new Error(`${path} is not a PDF`)
  if (content.length > PAPER_LIMIT) throw new Error(`${path} would keep too much`)

  const wanted = normalise(path)
  // Whatever was held for this paper goes first, however large it was: the size is
  // in the key, so writing a record again means writing a new key.
  for (const one of await paperRecords()) {
    if (one.path === wanted) await meta.remove(one.key)
  }

  if (content) await meta.put(paperKey(wanted, content.length), content)
}

/** Commands the browser genuinely cannot serve. Each returns the shape that
 *  makes the interface hide the feature rather than break on it. */
const UNSUPPORTED: Record<string, unknown> = {
  has_pandoc: false,
  // A page's notes come out of its own storage, which has no stamps: a note that
  // would not read is simply not there. See unread.svelte.ts.
  file_stamp: null,
  mcp_config: null,
  new_menu_registered: false,
  write_log: null,
  read_log: '',
  log_dir: '',
  theme_dir: '',
  custom_css_path: '/custom.css',
  snippets_path: '/snippets.json',
}

export async function webInvoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const path = args.path as string
  const root = args.root as string

  switch (command) {
    case 'read_note': {
      const row = await files.get(normalise(path))
      if (!row) throw new Error('no such note')
      return row.content as T
    }

    case 'write_note':
      await writeNote(path, args.content as string)
      return undefined as T

    case 'write_bytes':
      // A file whose path the caller chose, which is what an import's pictures
      // and papers are. `save_asset` below is the same write with the app's own
      // naming rule in front of it, for a picture that was pasted rather than
      // brought along.
      await assets.put({
        path: normalise(path),
        type: assetType(path),
        data: args.base64 as string,
        modified: now(),
      })
      return undefined as T

    case 'delete_note':
      await files.remove(normalise(path))
      await assets.remove(normalise(path))
      // A PDF's highlights are part of it and have nothing left to describe.
      if (isPdf(path)) await files.remove(sidecarOf(path))
      return undefined as T

    case 'rename_note':
      await renameNote(args.from as string, args.to as string)
      return undefined as T

    case 'copy_path':
      await copyPath(args.from as string, args.to as string)
      return undefined as T

    case 'create_folder':
      // A folder is only real once it holds something.
      await writeNote(join(path, KEEP), '')
      return undefined as T

    case 'delete_folder':
      await removeFolder(path)
      return undefined as T

    case 'remove_empty_folder':
      await removeEmptyFolder(path)
      return undefined as T

    case 'read_tree':
      return (await tree(root, args.options ?? {})) as T

    // Searching a space is not here: it runs in a worker, because reading every
    // note and scoring every line of them on this thread is keystrokes that do
    // not appear. See web/search-client.ts, which search/space.ts calls instead.

    case 'space_tags':
      return (await spaceTags(root)) as T

    case 'scan_links':
      return (await scanLinks(root)) as T

    case 'spaces_root':
      return '/' as T

    case 'list_spaces':
      return (await spaceList()) as T

    case 'create_space': {
      const wanted = safeName(args.name as string)
      if (!wanted) throw new Error('that name cannot be used')

      const taken = new Set((await spaceList()).map((space) => space.name))
      let name = wanted
      let counter = 2
      while (taken.has(name)) name = `${wanted} ${counter++}`

      await writeNote(join('/', `${name}/${KEEP}`), '')
      return { name, path: `/${name}` } as T
    }

    case 'rename_space': {
      const wanted = safeName(args.name as string)
      if (!wanted) throw new Error('that name cannot be used')

      const target = `/${wanted}`
      if (normalise(args.from as string) !== target) {
        await renameNote(args.from as string, target)
      }
      return { name: wanted, path: target } as T
    }

    case 'delete_space':
      await removeFolder(path)
      return undefined as T

    case 'trash_item':
      return (await trashItem(path, args.kind as string)) as T

    case 'list_trash':
      return (await trashEntries()).sort((a, b) => b.trashedAt - a.trashedAt) as T

    case 'restore_trash':
      return (await restoreTrash(args.id as string)) as T

    case 'purge_trash':
      await purgeTrash(args.id as string)
      return undefined as T

    case 'purge_trash_older_than': {
      const cutoff = now() - (args.age as number)
      const old = (await trashEntries()).filter((one) => one.trashedAt < cutoff)
      for (const one of old) await purgeTrash(one.id)
      return old.length as T
    }

    case 'save_asset': {
      const bytes = args.bytes as number[]
      const name = (args.name as string) || `pasted-${now()}.png`
      const notePath = args.notePath as string
      // Relative to the note's own folder, as the desktop command takes it; see
      // attachments.ts for which of the three it is.
      const relative = ((args.folder as string | undefined) ?? 'assets').replace(/^\/+|\/+$/g, '')

      const folder = join(parent(notePath), relative)
      // The same limit the desktop command holds a folder to: a picture of this
      // note goes somewhere in this note's space and nowhere else.
      const space = spaceOf(notePath)
      if (folder !== space && !within(space, folder)) {
        throw new Error(`${relative} is not a folder inside the space`)
      }

      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)

      await assets.put({
        path: join(folder, name),
        // What the name says it is rather than the extension with `image/` in
        // front: `image/svg` draws nothing, and the asset worker hands this row
        // straight to an `<img>`. See asset-route.ts.
        type: assetType(name),
        data: btoa(binary),
        modified: now(),
      })

      return (relative ? `${relative}/${name}` : name) as T
    }

    case 'read_highlights': {
      if (!isPdf(path)) throw new Error(`${path} is not a PDF`)
      return ((await files.get(sidecarOf(path)))?.content ?? '') as T
    }

    case 'write_highlights': {
      if (!isPdf(path)) throw new Error(`${path} is not a PDF`)
      const content = args.content as string
      if (content) await writeNote(sidecarOf(path), content)
      else await files.remove(sidecarOf(path))
      return undefined as T
    }

    case 'read_paper_text':
      return (await readPaperText(path)) as T

    case 'write_paper_text': {
      await writePaperText(path, args.content as string)
      return undefined as T
    }

    case 'list_paper_texts':
      return (await paperRecords()).map(({ path: at, size }) => ({ path: at, size })) as T

    case 'read_asset': {
      const row = await assets.get(normalise(path))
      if (!row) throw new Error('no such image')
      // The name first, the row second: a row written before the name was asked
      // says `image/svg`, and an export that inlines that inlines a picture
      // nothing draws.
      return `data:${assetType(path, row.type)};base64,${row.data}` as T
    }

    case 'snapshot_note':
      await snapshot(
        path,
        args.content as string,
        typeof args.source === 'string' ? args.source : undefined,
      )
      return undefined as T

    case 'list_snapshots': {
      const kept = await snapshots.forNote(normalise(path))
      return kept
        .sort((a, b) => b.taken_at - a.taken_at)
        .map((row) => ({
          path: String(row.id),
          taken_at: row.taken_at,
          size: row.size,
          ...(row.source ? { source: row.source } : {}),
        })) as T
    }

    case 'read_snapshot': {
      // Every note's versions rather than one note's: the row is asked for by
      // the id the listing gave out, and the caller has no reason to say which
      // note it belongs to twice.
      const id = Number(path)
      const found = Number.isInteger(id) ? await snapshots.get(id) : undefined
      return (found?.content ?? '') as T
    }

    case 'purge_snapshots':
      return (await purgeSnapshots(args.days as number)) as T

    case 'list_themes':
      return (await listThemes()) as T

    case 'read_theme':
      return ((await meta.get(path)) ?? '') as T

    case 'write_theme':
      return (await writeTheme(args.id as string, args.css as string)) as T

    case 'remove_theme':
      await removeTheme(args.id as string)
      return undefined as T

    case 'read_custom_css':
      return ((await meta.get('custom.css')) ?? '') as T

    case 'read_snippets':
      return ((await meta.get('snippets.json')) ?? '{}') as T

    case 'new_window':
      window.open(location.href, '_blank')
      return undefined as T

    // An AI provider's key. A browser has no keychain and no hardware store, so it
    // goes where everything else the page keeps goes, under a prefix of its own, and
    // the AI pane says plainly that the browser is holding it. See ai/keys.ts, and
    // src-tauri/src/secrets.rs for what the desktop does instead.
    case 'secret_read':
      return ((await meta.get(secretKey(args.name as string))) ?? null) as T

    case 'secret_write':
      await meta.put(secretKey(args.name as string), args.secret as string)
      return undefined as T

    case 'secret_forget':
      await meta.remove(secretKey(args.name as string))
      return undefined as T

    default:
      if (command in UNSUPPORTED) return UNSUPPORTED[command] as T
      throw new Error(`${command} is not available in the browser`)
  }
}

/** Where a provider's key sits among the rows. Prefixed so the themes, the custom
 *  CSS and the snippets that share this store cannot be reached by asking for a
 *  provider, and so a key is recognisable as one to anybody clearing site data. */
function secretKey(name: string): string {
  return `ai-key/${name}`
}

/** True once anything has been written, so a first visit can be seeded. */
async function hasContent(): Promise<boolean> {
  return (await files.paths()).length > 0
}

/** The welcome note, once per device.
 *
 *  Two gates, and the first is the one that was missing. Emptiness says what is
 *  here now; it does not say whether this device has been introduced, and reading
 *  it as though it did is how a reader who deleted every note gets the welcome
 *  note back - and, signed in, gets it in their account. So the answer is written
 *  down, and written down whichever way this went: a device that already had notes
 *  has been introduced too. See seeded.ts and welcome.ts. */
export async function seed() {
  if (await wasSeeded()) return

  if (await hasContent()) {
    await markSeeded()
    return
  }

  await writeNote(WELCOME_PATH, WELCOME)
  await markSeeded()
}
