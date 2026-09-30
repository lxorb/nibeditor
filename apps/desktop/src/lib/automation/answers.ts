/** The verbs that only answer a question.
 *
 *  Every one of them reads what the app already holds: the file list, the link
 *  index, the tag list, the front matter reader, the command registry. Nothing
 *  here walks a space or parses a note on its own - a second walk would be a
 *  second answer to the same question, and the answers would drift.
 *
 *  What each answers is a plain object, because that is what goes over the wire
 *  to `nib --json` and what a shortcut reads. See verbs.ts for the table these
 *  are reached through. */

import { readProperties } from '@nib/markdown/properties'
import { appCommands } from '../commands'
import { countText } from '../counts'
import { links } from '../link-index.svelte'
import { scanHeadings } from '../outline'
import { relativeTo } from '../space-paths'
import { currentWindow } from '../tauri'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import type { Said } from './args'
import { noteFor, spaceFor } from './space'

/** Every file in the space, as the space speaks of them. The same flattened list
 *  quick open shows, so what a caller sees is what the reader sees. */
export async function listFiles(args: Said): Promise<unknown> {
  const space = await spaceFor(args)

  return {
    space: space.name,
    files: workspace.files.map((one) => ({
      path: relativeTo(space.root, one.path),
      name: one.name,
      modified: one.modified,
      created: one.created,
    })),
  }
}

/** One note, as it stands. What is open counts as what it stands at: an unwritten
 *  keystroke is still what the reader is looking at. */
export async function readFile(args: Said): Promise<unknown> {
  const note = await noteFor(args)
  return { path: note.relative, text: note.text }
}

/** Every link out of a note, resolved to what it points at. */
export async function listLinks(args: Said): Promise<unknown> {
  const note = await noteFor(args)
  return { path: note.relative, links: links.outgoing(note.path) }
}

/** Every link in the space that points at a note. */
export async function listBacklinks(args: Said): Promise<unknown> {
  const note = await noteFor(args)
  return { path: note.relative, backlinks: links.backlinks(note.path) }
}

/** The notes nothing links to and which link to nothing.
 *
 *  Out of the graph the picture of the space is drawn from, which is where a
 *  degree of zero already means this; see graph.ts. Only the notes the space
 *  actually holds, because a name a link invented has no note to be alone. */
export async function listOrphans(args: Said): Promise<unknown> {
  await spaceFor(args)

  return {
    orphans: links.graph.nodes
      .filter((node) => node.path !== null && node.degree === 0)
      .map((node) => ({ path: node.path, name: node.name })),
  }
}

/** Every tag in the space, most used first. */
export async function listTags(args: Said): Promise<unknown> {
  await spaceFor(args)
  await workspace.loadTags()

  return { tags: workspace.tags }
}

/** What a note's front matter says, read the way the rows above the note read
 *  it: a kind per key, and a list is a list. */
export async function readNoteProperties(args: Said): Promise<unknown> {
  const note = await noteFor(args)

  return { path: note.relative, properties: readProperties(note.text) ?? [] }
}

/** A note's headings, in order. */
export async function readOutline(args: Said): Promise<unknown> {
  const note = await noteFor(args)
  return { path: note.relative, headings: scanHeadings(note.text) }
}

/** The bookmarks of the space, in the order they are drawn in. */
export async function listBookmarks(args: Said): Promise<unknown> {
  const space = await spaceFor(args)
  return { bookmarks: workspace.bookmarks.of(space.root) }
}

/** What the status bar counts, for a note or for what is open. */
export async function countWords(args: Said): Promise<unknown> {
  const note = await noteFor(args)
  return { path: note.relative, ...countText(note.text) }
}

/** Every command the palette would offer right now, with the key that runs it and
 *  whether it can run at all.
 *
 *  The registry itself, asked the same way the palette asks it, which is what
 *  makes `nib commands run` and pressing the row the same act. */
export function listCommands(): unknown {
  return {
    // Not the rows the command line may not run, which it has no use for knowing.
    commands: appCommands(views.of(workspace.panes.focusedId))
      .filter((one) => one.ownWindow !== true)
      .map((one) => ({
        id: one.id,
        label: one.label,
        hint: one.hint ?? null,
        disabled: one.disabled === true,
        checked: one.checked === true,
      })),
  }
}

/** Where syncing has got to: the light in the corner, as words. */
export async function syncStatus(): Promise<unknown> {
  const { sync } = await import('../sync.svelte')

  return {
    status: sync.status,
    lastError: sync.lastError,
    lastSyncedAt: sync.lastSyncedAt,
  }
}

/** Whether the space is on the web, and at which address.
 *
 *  Read off the account's own copy of the space, paired to this folder the way the
 *  publishing sheet pairs it: through the mirror, which is the one thing that
 *  knows which remote space a folder is. A space with no mirror is a space that has
 *  never synced, and a space that has never synced has no blog. */
export async function publishStatus(args: Said): Promise<unknown> {
  const space = await spaceFor(args)
  const [{ account }, { sync }] = await Promise.all([
    import('../account.svelte'),
    import('../sync.svelte'),
  ])

  const id = sync.remoteIdFor(space.root)
  const blog = id === null ? undefined : account.spaces.find((one) => one.id === id)?.blog

  return {
    space: space.name,
    published: blog?.enabled === true,
    subdomain: blog?.subdomain ?? null,
    domain: blog?.domain ?? null,
    note: blog?.note ?? null,
  }
}

/** Where the window is and how big it is, in the coordinates the system uses.
 *
 *  The one verb that is about the window rather than about the notes, and it
 *  exists for one caller: `nib screenshot`, which has to know what rectangle to
 *  photograph. Taking the picture is not something a webview can do, so the
 *  command line does it with the platform's own tool; see apps/cli/nib.mjs. */
export async function windowRect(): Promise<unknown> {
  const window = await currentWindow()
  const [position, size, scale] = await Promise.all([
    window.outerPosition(),
    window.outerSize(),
    window.scaleFactor(),
  ])

  return { x: position.x, y: position.y, width: size.width, height: size.height, scale }
}
