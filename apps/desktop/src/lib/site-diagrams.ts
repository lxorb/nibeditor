/** The diagrams of a published space, drawn here and sent up as pictures.
 *
 *  A ` ```mermaid ` fence used to stay a code block on a published page: mermaid
 *  measures its text before it lays a box out, so it needs a DOM, and the Worker
 *  that serves a page has none. Carrying mermaid into the Worker would be a
 *  megabyte of drawing library on every cold start of every site, for the pages
 *  that have no diagram at all, and a CDN is what the KaTeX round deliberately
 *  removed.
 *
 *  So the side that has a DOM does the drawing, which is this side - exactly as
 *  the favicon the site wears and the theme it is dressed in are drawn by the app
 *  and sent up as blobs. Each diagram goes up as an SVG named by the fence's own
 *  contents (see @nib/markdown/diagrams), and the page writes an `<img>` where the
 *  fence stood. A fence nothing has drawn yet stays the code block it was, so a
 *  space published from a device that has never seen the note still reads.
 *
 *  What it costs, and what it does not:
 *
 *  An unchanged diagram is the same name, so the second publish of a space draws
 *  nothing and sends nothing - the names this device has already sent are written
 *  down. A note with no fence in it is a substring search and no more; a space with
 *  no diagram anywhere pays one listing of its own files.
 *
 *  A diagram mermaid refuses is skipped and counted, not reported: what the reader
 *  gets is the fence as code, which is what the editor shows for the same diagram
 *  and is the honest answer either way.
 *
 *  An edited diagram leaves its old picture in the account's storage, the way a
 *  replaced theme and a deleted picture do. Nothing here sweeps blobs, and this is
 *  not the batch that starts. */

import { codeBlocks } from '@nib/markdown'
import { DIAGRAM_SCHEMES, type DiagramScheme, diagramKey, isDiagram } from '@nib/markdown/diagrams'
import { api } from './api'
import { drawDiagram } from './diagrams'
import { keep, stored } from './stored'
import { shapesOnly } from './svg-file'
import { invoke } from './tauri'
import type { Entry } from './workspace.svelte'

/** How many diagrams one publish draws. A publish is a gesture somebody is
 *  waiting on, and a space with more pictures than this in it has a first publish
 *  that draws the first hundred and a second that finishes the job. */
const MOST = 100

/** What a drawing may weigh. The store refuses more, and a picture this big is a
 *  diagram nobody can read anyway. */
const BIGGEST = 512 * 1024

/** One fence, as both sides name it. */
export interface DiagramFence {
  language: string
  code: string
}

/** Every diagram in a body of text, in order and without repeats: two notes that
 *  carry the same diagram are one picture, because the name is the fence. */
export function diagramFences(sources: Iterable<string>): DiagramFence[] {
  const found = new Map<string, DiagramFence>()

  for (const source of sources) {
    for (const block of codeBlocks(source)) {
      if (!isDiagram(block.language)) continue

      const language = block.language.toLowerCase()
      found.set(`${language}\n${block.code}`, { language, code: block.code })
    }
  }

  return [...found.values()]
}

/** An SVG as a file rather than as part of a document.
 *
 *  Three things have to be true of it, and mermaid's output is true of none:
 *
 *  It has to be safe to open on its own. An SVG is a document, and this one is
 *  built by a drawing library out of text somebody wrote; on a published page it is
 *  only ever an `<img>`, where nothing runs, but its address is a link like any
 *  other. So what it may hold is the shapes and the text and nothing else; see
 *  `shapesOnly`, which reads the tags rather than sweeping the markup. The store
 *  sandboxes it on the way out as well, which is the half that does not depend on
 *  which version of this app drew it; see services/sync/src/blobs.ts.
 *
 *  It has to have a size. Mermaid writes `width="100%"` and a `max-width` in a
 *  style attribute, which is a drawing that fills whatever box it is put in - and
 *  an `<img>` with no intrinsic size is 300 by 150 pixels, which would squash every
 *  diagram on every page. So the viewBox becomes the width and the height, and the
 *  stylesheet scales it down from there.
 *
 *  It has to say it is an SVG. A file's first job is to be recognised. */
export function asFile(svg: string): string | null {
  const opens = svg.indexOf('<svg')
  if (opens === -1) return null

  let out = shapesOnly(svg.slice(opens))
  if (!out.startsWith('<svg')) return null

  const box = /\bviewBox="([\d.\-+eE]+)\s+([\d.\-+eE]+)\s+([\d.\-+eE]+)\s+([\d.\-+eE]+)"/.exec(out)
  const width = Number(box?.[3])
  const height = Number(box?.[4])
  if (!box || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  const root = out.slice(0, out.indexOf('>') + 1)
  const sized = root
    .replace(/\swidth="[^"]*"/i, '')
    .replace(/\sheight="[^"]*"/i, '')
    // The `max-width` mermaid writes here is a rule for a document, and this is a
    // file. Whatever else the attribute held is kept.
    .replace(/\sstyle="[^"]*"/i, '')
    .replace(/>$/, ` width="${Math.round(width)}" height="${Math.round(height)}">`)

  out = sized + out.slice(root.length)
  if (!out.includes('xmlns=')) {
    out = out.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }

  return out.length > BIGGEST ? null : `<?xml version="1.0" encoding="UTF-8"?>\n${out}`
}

/** What draws a diagram bound for a page, which is the reading view's own drawer
 *  told which scheme to use and that this one is going into a file. */
const drawer = (code: string, language: string, scheme: DiagramScheme) =>
  drawDiagram(code, language, scheme, 'page')

/** One diagram, drawn both ways round and named.
 *
 *  Drawn one after the other rather than at once: mermaid is configured globally
 *  and the scheme is part of that configuration, so two renders in flight would be
 *  a race over which colours either of them comes out in.
 *
 *  Both schemes or neither. A diagram that draws in one and refuses in the other is
 *  a diagram nobody has drawn: half of it on a page would be a reader in the dark
 *  looking at a light picture, or at nothing. */
export async function drawnBoth(
  spaceId: string,
  fence: DiagramFence,
  draw = drawer,
): Promise<{ hash: string; svg: string }[]> {
  const out: { hash: string; svg: string }[] = []

  for (const scheme of DIAGRAM_SCHEMES) {
    const drawn = await draw(fence.code, fence.language, scheme).catch(() => null)
    const svg = drawn === null ? null : asFile(drawn)
    if (svg === null) return []

    out.push({ hash: await diagramKey(spaceId, fence.language, fence.code, scheme), svg })
  }

  return out
}

/** What this device has already sent for one space, so a publish that changes
 *  nothing draws nothing.
 *
 *  Per device rather than on the account, because it is a note about work already
 *  done rather than a fact about the site: a device that has forgotten simply does
 *  the drawing again and the store answers that it already holds those bytes. */
const remembered = (spaceId: string) => `nib:diagrams:${spaceId}`

function alreadySent(spaceId: string): Set<string> {
  const held = stored(remembered(spaceId))

  return new Set(
    Array.isArray(held) ? held.filter((one): one is string => typeof one === 'string') : [],
  )
}

/** Every note of a space, as the text of each. The listing the mirror uses, so
 *  this sees the space the account sees; a file that will not open is skipped. */
async function notesIn(root: string): Promise<string[]> {
  const tree = await invoke<Entry>('read_tree', { root }).catch(() => null)
  if (!tree) return []

  const paths: string[] = []
  const walk = (entry: Entry) => {
    if (entry.is_dir) for (const child of entry.children) walk(child)
    else if (/\.(md|markdown|mdown|mkd)$/i.test(entry.name)) paths.push(entry.path)
  }
  walk(tree)

  const sources: string[] = []
  for (const path of paths) {
    const text = await invoke<string>('read_note', { path }).catch(() => null)
    // Only a file that has a fence in it at all is worth parsing; every other
    // note in the space costs one substring search.
    if (text !== null && (text.includes('```') || text.includes('~~~'))) sources.push(text)
  }

  return sources
}

/** The diagrams of a space, drawn and sent, so its published pages can show them.
 *
 *  Answers how many pictures went up and how many diagrams would not draw, which
 *  is for the log and for the tests: a publish says nothing about this on screen.
 *  Every failure is swallowed - a diagram that will not draw, a store that will not
 *  take it, a note that will not open - because none of them is a reason for a
 *  publish to have failed. What the reader gets in each case is the fence as code. */
export async function pushDiagrams(
  token: string,
  spaceId: string,
  root: string,
): Promise<{ sent: number; refused: number }> {
  const fences = diagramFences(await notesIn(root))
  if (!fences.length) return { sent: 0, refused: 0 }

  const sent = alreadySent(spaceId)
  let put = 0
  let refused = 0

  for (const fence of fences.slice(0, MOST)) {
    // The names before the drawings, because the names are what says there is
    // nothing to do: a diagram this device has already sent costs two hashes of a
    // few hundred bytes and no mermaid at all.
    const names = await Promise.all(
      DIAGRAM_SCHEMES.map((scheme) => diagramKey(spaceId, fence.language, fence.code, scheme)),
    )
    if (names.every((hash) => sent.has(hash))) continue

    const drawn = await drawnBoth(spaceId, fence)
    if (!drawn.length) {
      refused += 1
      continue
    }

    for (const { hash, svg } of drawn) {
      const bytes = new TextEncoder().encode(svg)
      const ok = await api
        .putBlob(token, hash, 'image/svg+xml', bytes.buffer)
        .then(() => true)
        .catch(() => false)

      if (ok) {
        sent.add(hash)
        put += 1
      } else {
        refused += 1
      }
    }
  }

  keep(remembered(spaceId), JSON.stringify([...sent].slice(-MOST * 4)))
  return { sent: put, refused }
}
