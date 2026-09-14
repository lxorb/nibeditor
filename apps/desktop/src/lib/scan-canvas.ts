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
import type { ScannedNote } from './scan-note'

export function scanCanvas(path: string, content: string): ScannedNote {
  const canvas = readCanvas(content)

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
    // Under the `nib` key that already carries the ink, since a JSON file has no
    // front matter: the same value a note keeps under `icon:`, read by the same
    // icons.ts. See canvas.ts for why it lives in the file rather than beside it.
    icon: canvas.icon ?? null,
    iconColor: canvas.iconColor ?? null,
    // No other name for itself, though: an alias is something a link is written
    // with, and nothing writes `[[Board]]` for a canvas.
    aliases: [],
    // And a plane of cards is never a website: there is no front matter in JSON to
    // say so, and JSON Canvas has no key for one.
    url: null,
    // A favicon is a website's; a canvas draws its own icon above.
    favicon: null,
    // Nor a cover: the whole of a plane is a picture already.
    cover: null,
    // Under the same `nib` key as the icon, because it is the same kind of fact about
    // the file rather than about the plane. See canvas.ts and docs/archive.md.
    archived: canvas.archived ?? null,
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
