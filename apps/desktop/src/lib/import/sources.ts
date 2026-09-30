/** The one shape every format reader is handed: a list of named files.
 *
 *  An export arrives in four different ways - one file picked, several picked, a
 *  folder dropped, a zip - and every reader would otherwise have to know which.
 *  So all four become this: a flat list of paths with the bytes behind them. A
 *  zip is opened here rather than in each reader, which is also why a Notion
 *  export that is itself a zip of zips reads the same as one that is not.
 *
 *  Nothing in here touches the DOM, so a test hands over plain objects and the
 *  app hands over the browser's own `File`. */

/** Enough of `File` to read one. */
export interface Picked {
  name: string
  /** Set by the browser when a whole folder was chosen or dropped. */
  webkitRelativePath?: string
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface Source {
  /** Where the file sat in the export, forward slashes, never leading. */
  path: string
  text(): Promise<string>
  bytes(): Promise<Uint8Array>
}

/** How deep a zip inside a zip is followed. Notion splits a large export into
 *  `Part-1.zip` and the rest, and nothing anybody exports nests deeper than
 *  that; a cap is also what stops a zip that holds itself. */
const DEEPEST = 3

/** Anything bigger than this is not read into memory. An import is held whole
 *  so it can be counted and shown before it is written, and a webview that is
 *  asked to hold two gigabytes takes the window down with it. */
const MOST_BYTES = 512 * 1024 * 1024

export function sourceOf(path: string, bytes: Uint8Array): Source {
  return {
    path: tidyPath(path),
    text: () => Promise.resolve(new TextDecoder().decode(bytes)),
    bytes: () => Promise.resolve(bytes),
  }
}

/** The folder the reader chose, when every file came out of one: a folder picked
 *  whole or dropped, whose name the browser writes as the first step of each file's
 *  relative path. Null for loose files, and for nothing picked. */
export function pickedFolder(picked: readonly Picked[]): string | null {
  let folder: string | null = null

  for (const one of picked) {
    const [first, ...rest] = tidyPath((one.webkitRelativePath ?? '').trim()).split('/')
    if (!first || !rest.length || (folder !== null && first !== folder)) return null
    folder = first
  }

  return folder
}

/** The same files with that folder taken off the front of each path. What is brought
 *  in is named after the folder - a space of that name, or the import's own folder -
 *  and the same name again inside it would be a folder holding a folder of its own
 *  name, the way a zip's own name is dropped below. Loose files come back as they
 *  were. */
export function insideFolder(picked: readonly Picked[]): Picked[] {
  const folder = pickedFolder(picked)
  if (folder === null) return [...picked]

  return picked.map((one) => ({
    name: one.name,
    webkitRelativePath: tidyPath((one.webkitRelativePath ?? '').trim()).slice(folder.length + 1),
    arrayBuffer: () => one.arrayBuffer(),
  }))
}

/** Every file behind what the reader picked, zips opened. */
export async function sourcesFrom(picked: readonly Picked[]): Promise<Source[]> {
  const found: Source[] = []

  for (const one of picked) {
    // The relative path when the browser gave one, and the bare name when it
    // gave an empty string, which is what a single picked file has.
    const inside = (one.webkitRelativePath ?? '').trim()
    const path = tidyPath(inside.length ? inside : one.name)
    const bytes = new Uint8Array(await one.arrayBuffer())
    found.push(...(await expand(path, bytes, 0)))
  }

  return found
}

/** A zip becomes the files in it; anything else is itself. The zip's own name
 *  is dropped rather than kept as a folder: what somebody exported is the notes
 *  inside, and `Export-abc123/` in front of every path is the zip's name
 *  showing up in the space. */
async function expand(path: string, bytes: Uint8Array, depth: number): Promise<Source[]> {
  if (depth >= DEEPEST || !isZip(path, bytes)) return [sourceOf(path, bytes)]

  // The glasses plugin offers no import, and this is what keeps the zip library
  // out of its package: said as a throw rather than a guard so the bundler drops
  // the line under it. See vite.even.config.ts and diagrams.ts.
  if (__EVEN_PLUGIN__) throw new Error('no import in the Even Realities plugin')

  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const inside: Source[] = []
  const entries: { path: string; read: () => Promise<Uint8Array> }[] = []

  zip.forEach((entryPath, entry) => {
    if (entry.dir) return
    entries.push({ path: tidyPath(entryPath), read: () => entry.async('uint8array') })
  })

  for (const entry of entries) {
    // A zip inside a zip is read now, because knowing whether one holds notes
    // means reading it, and the sheet counts what it is about to write.
    if (entry.path.toLowerCase().endsWith('.zip')) {
      inside.push(...(await expand(entry.path, await entry.read(), depth + 1)))
      continue
    }

    inside.push(lazily(entry.path, entry.read))
  }

  return inside
}

/** A file whose bytes are only decompressed when a reader asks for them, kept
 *  once it has. Detecting a format reads a handful of names and one or two
 *  files; unpacking all six thousand to find that out would be the slowest part
 *  of the import. */
function lazily(path: string, read: () => Promise<Uint8Array>): Source {
  let held: Promise<Uint8Array> | null = null
  const once = () => (held ??= read())

  return {
    path,
    text: async () => new TextDecoder().decode(await once()),
    bytes: once,
  }
}

/** The two bytes every zip starts with, so a `.enex` somebody renamed is still
 *  read as what it is and a zip with no extension is still opened. */
function isZip(path: string, bytes: Uint8Array): boolean {
  const named = path.toLowerCase().endsWith('.zip')
  const stamped = bytes[0] === 0x50 && bytes[1] === 0x4b
  return stamped || (named && bytes.length === 0)
}

/** Windows separators as slashes, no leading one, and the `./` a few exporters
 *  write in front of everything taken off. */
export function tidyPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

/** Whether a set of files is more than this can hold. */
export function tooMuch(bytes: number): boolean {
  return bytes > MOST_BYTES
}
