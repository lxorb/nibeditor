/** The space's templates (docs/tasks.md 5.13): the notes in its templates folder,
 *  `Templates` unless the space's Obsidian settings name another, as the core
 *  Templates plugin does, so a space opened in both apps has one folder of them.
 *
 *  A template is found the way a link is, by its path or its name, and its words are
 *  filled (`fillTemplate` in @nib/bases) for the note made from it. */

import { fillTemplate, withoutTemplateKeys } from '@nib/bases'
import { relativeTo, within } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { type Entry, workspace } from '../workspace.svelte'
import { nowHere } from './days'

/** The folder Obsidian's Templates plugin was told, per space root, read once. */
const folders = new Map<string, Promise<string>>()

/** The space's templates folder, relative to it. */
export function templatesFolder(root: string): Promise<string> {
  let found = folders.get(root)
  if (!found) {
    found = invoke<string>('read_note', { path: joinPath(root, '.obsidian/templates.json') })
      .then((text) => {
        const said: unknown = JSON.parse(text)
        const folder =
          said !== null && typeof said === 'object' && 'folder' in said ? said.folder : null
        return typeof folder === 'string' && folder.trim()
          ? folder.trim().replace(/^\/+|\/+$/g, '')
          : 'Templates'
      })
      .catch(() => 'Templates')
    folders.set(root, found)
  }
  return found
}

/** The notes in the open space's templates folder, by name. */
export async function templates(): Promise<Entry[]> {
  const root = workspace.activeSpace?.root
  if (root === undefined) return []
  const folder = joinPath(root, await templatesFolder(root))
  return workspace.notes
    .filter((one) => /\.md$/i.test(one.name) && within(folder, one.path, root) !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The template a link names (`[[Templates/Bug]]`, `Bug`), on this disk; null where the
 *  space has no such note. */
export function templatePath(link: string): string | null {
  const root = workspace.activeSpace?.root
  if (root === undefined) return null
  const wanted = link
    .replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    ?.trim()
    .replace(/\.md$/i, '')
    .toLowerCase()
  if (!wanted) return null
  const notes = workspace.notes
  const byPath = notes.find(
    (one) => relativeTo(root, one.path).replace(/\.md$/i, '').toLowerCase() === wanted,
  )
  const byName = notes.find((one) => one.name.replace(/\.md$/i, '').toLowerCase() === wanted)
  return (byPath ?? byName)?.path ?? null
}

/** A template's words, filled for a note called `title` made now; empty for a template
 *  that cannot be read. */
export async function templateWords(path: string, title: string): Promise<string> {
  const text = await workspace.noteText(path).catch(() => null)
  if (text === null) return ''
  const now = nowHere()
  return withoutTemplateKeys(
    fillTemplate(text, { title, today: now.slice(0, 10), time: now.slice(11, 16) }),
  )
}
