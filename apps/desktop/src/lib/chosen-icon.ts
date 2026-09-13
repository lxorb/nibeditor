/** The icon a row in the file list wears, wherever that icon is kept.
 *
 *  Three kinds of thing can wear one and each keeps it in the only place it has: a
 *  note in its front matter, a canvas under its `nib` key, a folder in the space's
 *  own map, because a folder is not a file. Which of the three a path is matters to
 *  whoever writes the icon and to nobody who draws it, so it is answered here once
 *  and every mark in the app asks this instead of asking three stores in three
 *  different ways.
 *
 *  A path as the app holds one or as the space speaks it, since both stores read
 *  both. See file-icon.ts and workspace/folder-icons.svelte.ts for the writing, and
 *  icons.ts for what the value says. */

import { isFolderNote } from './folder-notes'
import { links } from './link-index.svelte'
import { folderOf } from './space-paths'
import { workspace } from './workspace.svelte'

/** Which key the space's map is asked under. For `A/A.md` that is `A/`, because
 *  the row wearing the mark is the folder and the note in one.
 *
 *  So an icon chosen on a folder that came out of somebody's vault, before that
 *  folder had a note at all, still dresses the row once somebody writes in it. The
 *  file wins wherever it says anything, and choosing an icon on such a row writes
 *  the file and takes the map's word away; see `setFileIcon`. */
function mapKey(path: string): string {
  return isFolderNote(path) ? folderOf(path) : path
}

export function chosenIcon(path: string): string | null {
  return links.iconOf(path) ?? workspace.folderIcons.iconOf(mapKey(path))
}

/** A website's own mark, as an address, or null for anything that is not one or has
 *  no mark cached yet. The favicon out of the `.url`'s `Nib-Icon`, drawn as a picture
 *  in front of the row rather than the plain globe - the same mark the tab strip and
 *  the address bar show. Here beside the chosen icon so a row asks one façade for
 *  what it draws and never the index by name; see link-index `faviconOf`. */
export function faviconFor(path: string): string | null {
  return links.faviconOf(path)
}

/** The colour a stroked icon is drawn in, or null for the plain foreground.
 *
 *  A second value rather than part of the first, because the first is what other
 *  apps read: a note says `icon: rocket` and `icon-color: violet` on two lines, so
 *  Obsidian's Iconize still finds the icon and simply ignores the colour. A tint
 *  folded into the one value would have made every tinted icon a word Iconize does
 *  not know.
 *
 *  Only a stroked icon takes one; an emoji and a coloured drawing have their own
 *  colours. See `readTint` in icons.ts for which names count. */
export function chosenTint(path: string): string | null {
  return links.tintOf(path) ?? workspace.folderIcons.tintOf(mapKey(path))
}
