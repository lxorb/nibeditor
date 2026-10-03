/** Finding the notes that are commands, agents and output styles (notes.ts), in the
 *  space in front.
 *
 *  Asked of the space's own search with the front matter question `[command] OR [agent]
 *  OR [output-style]`, which reads every note once, on the crate's side in the app and in
 *  a worker in a browser, and then only the notes that answered are read here. Kept per
 *  space until the link index says a note changed, so the menu is a lookup and a command
 *  written on another device is there once it has synced. Nothing outside the space is
 *  read: nib never opens `~/.claude` or `~/.codex`. */

import { links } from '../../link-index.svelte'
import type { Query } from '../../search/query'
import { workspace } from '../../workspace.svelte'
import { NOTE_KEYS, type NoteCommand, type NoteKind, rolesOf } from './notes'

/** The most notes of each kind worth a menu row. */
const MOST = 500

const ASKED: Query = {
  kind: 'any',
  of: NOTE_KEYS.map((name) => ({ kind: 'property', name, value: null, compare: 'has' })),
}

let held: { root: string; version: number; found: NoteCommand[] } | null = null
let asking: Promise<NoteCommand[]> | null = null

async function ask(root: string, version: number): Promise<NoteCommand[]> {
  const { searchSpace } = await import('../../search/space')
  const paths = new Set<string>()
  await searchSpace(
    root,
    ASKED,
    [],
    MOST,
    (batch) => {
      for (const hit of batch.hits) if (hit.page === undefined && !hit.tab) paths.add(hit.path)
    },
    workspace.leftOutOf(root),
  )
  const read = await Promise.all(
    [...paths].map(async (path) => {
      const text = await workspace.noteText(path).catch(() => null)
      return text ? rolesOf(path, text) : []
    }),
  )
  const found = read.flat().sort((a, b) => a.name.localeCompare(b.name))
  held = { root, version, found }
  return found
}

/** What the space in front holds, as last found; a search is started when that is out
 *  of date, and its answer is what the next call returns. */
export function foundNow(): NoteCommand[] {
  const root = workspace.activeSpace?.root
  if (!root) return []
  const version = links.version
  const fresh = held?.root === root && held.version === version
  if (!fresh && !asking) {
    asking = ask(root, version)
      .catch(() => [])
      .finally(() => (asking = null))
  }
  return held?.root === root ? held.found : []
}

/** The same, waited for: for a command typed whole before the menu was ever opened. */
export async function found(): Promise<NoteCommand[]> {
  foundNow()
  if (asking) await asking
  return foundNow()
}

/** One kind, by name. */
export async function foundNamed(kind: NoteKind, name: string): Promise<NoteCommand | null> {
  const wanted = name.trim().toLowerCase()
  return (await found()).find((one) => one.kind === kind && one.name === wanted) ?? null
}
