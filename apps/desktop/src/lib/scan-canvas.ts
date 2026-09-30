/** A plane of cards, read into what the link index holds.
 *
 *  Its own module because of what it reaches: reading a canvas means the JSON Canvas
 *  reader, and that is the whole format - every node kind, the ink, the merge - which a
 *  window that opens on a note has nothing to read. So it is fetched by the first plane
 *  that is opened or saved, and a reader who keeps none never has it. See scan-note.ts
 *  for the notes, and link-index.svelte.ts, which is the door.
 *
 *  The same shape `scanNote` answers, and the same shape the desktop's `scan_links`
 *  returns: one index, whatever kind of file went into it. */

import { readCanvas } from './canvas/format'
import { skim } from './json-skim'
import type { ScannedNote } from './scan-note'

/** Where this app writes what the index reads: `nib` after the cards, and the icon
 *  and its colour straight after the version inside it, ahead of the pages and the
 *  ink (see `canvasRuns` in @nib/markdown/canvas, which has written them there since
 *  planes first wore icons). So a plane in that order is read as far as its icon
 *  and no further, and its ink - all but a few hundred characters of it - is never
 *  walked at all: every write of a plane is read here, and the walk was tens of
 *  milliseconds per stroke drawn on one of ten thousand. A plane in any other order,
 *  written by hand or by another program, is walked to its end as before. */
const NIB_LAST = { last: 'nib' }
const ICON_FIRST = { ahead: ['version', 'icon', 'iconColor'] }

/** The part of a plane the index reads, as a plane of its own: the cards, and the
 *  icon and its colour under `nib`. The ink, the shapes and the pages are walked
 *  past rather than read, which on a plane of ten thousand strokes is nearly all of
 *  it; see json-skim.ts. What is kept goes through `readCanvas` all the same, so a
 *  card is judged by the one reader there is. */
function indexed(content: string): string {
  const top = skim(content, ['nodes', 'nib'], undefined, NIB_LAST)
  if (!top) return ''

  const nodes = top.get('nodes')
  const nib = top.get('nib')
  const marks = nib ? skim(content, ['icon', 'iconColor'], nib, ICON_FIRST) : null
  const worn = [...(marks ?? [])].map(([key, at]) => `"${key}":${content.slice(at.from, at.to)}`)

  return `{"nodes":${nodes ? content.slice(nodes.from, nodes.to) : '[]'},"nib":{${worn.join(',')}}}`
}

/** All the index reads off a plane: its icon, the icon's colour, and the notes its
 *  cards are. Small, so the browser's listing keeps it beside each plane and a scan
 *  of the space opens none of them; see `StatRow` in web/store.ts. */
export type PlaneMarks = Pick<ScannedNote, 'icon' | 'iconColor' | 'links'>

export function planeMarks(content: string): PlaneMarks {
  const canvas = readCanvas(indexed(content))

  return {
    // Under the `nib` key that already carries the ink, since a JSON file has no
    // front matter: the same value a note keeps under `icon:`, read by the same
    // icons.ts. See canvas.ts for why it lives in the file rather than beside it.
    icon: canvas.icon ?? null,
    iconColor: canvas.iconColor ?? null,
    links: canvas.nodes
      .filter((node): node is Extract<typeof node, { type: 'file' }> => node.type === 'file')
      .map((node) => ({
        kind: 'wikilink' as const,
        target: node.file,
        // A file node's subpath is a heading or a block, written with the `#` a
        // wikilink writes it with; a link into neither has null for both.
        heading: node.subpath?.startsWith('#^') === false ? node.subpath.slice(1) : null,
        block: node.subpath?.startsWith('#^') === true ? node.subpath.slice(2) : null,
        alias: null,
        embed: false,
        // A canvas has no lines, so every row reads as the card it came from.
        line: 0,
        text: node.file,
      })),
  }
}

export function scanCanvas(path: string, content: string): ScannedNote {
  return markedPlane(path, planeMarks(content))
}

/** A plane as the index holds it, out of what was read off it. */
export function markedPlane(path: string, marks: PlaneMarks): ScannedNote {
  return {
    path,
    // The extension is part of a canvas's name, the way it is for a PDF: a link
    // to one is written `[[Board.canvas]]`.
    name: path.split('/').pop() ?? path,
    headings: [],
    blocks: [],
    // A drawing carries no tags: `#work` written on a card is a word on the plane
    // rather than a tag the space is filed under.
    tags: [],
    icon: marks.icon,
    iconColor: marks.iconColor,
    // No other name for itself, though: an alias is something a link is written
    // with, and nothing writes `[[Board]]` for a canvas.
    aliases: [],
    // And a plane of cards is never a website: there is no front matter in JSON to
    // say so, and JSON Canvas has no key for one.
    url: null,
    // A favicon is a website's; a canvas draws its own icon above.
    favicon: null,
    address: null,
    // Nor a cover: the whole of a plane is a picture already.
    cover: null,
    links: marks.links,
  }
}
