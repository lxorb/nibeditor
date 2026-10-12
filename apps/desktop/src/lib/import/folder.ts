/** The shape most of these exports have: a folder of files.
 *
 *  Notion, Bear, Logseq, Craft, OneNote and a plain folder of markdown all arrive
 *  as files in folders, and all of them need the same three things done: decide
 *  where each file goes, turn the notes into nib's markdown, and make the links
 *  between them point at where they went. Only the first two differ per format,
 *  so only those are handed in.
 *
 *  The formats that are not folders - a single `.enex`, Keep's one file per note,
 *  a Roam JSON - build their plans themselves, because there is nothing to map. */

import type { Meta } from './meta'
import { keptText, noteText } from './meta'
import type { FormatId, ImportPlan, Lost, Planned } from './plan'
import { ExportFiles, rewriteLinks } from './rewrite'
import type { Source } from './sources'

/** What a note's file says, once the format has had a look at it. */
interface Written {
  text: string
  /** The title, for a note whose file name is not it. Null leaves the words as
   *  they are, which is right for a format that already writes its own heading. */
  title?: string | null
  meta?: Meta
  /** The words are a file an app kept for itself rather than an export it wrote,
   *  so nothing goes above them and nothing around them is tidied. */
  kept?: boolean
}

interface Placement {
  /** Where it goes inside the import, or null to leave it out. */
  to: string | null
  /** How the file's text becomes a note. Left out for a file that is copied as
   *  it is, which is every picture and every paper. */
  read?: (text: string, source: Source) => Promise<Written> | Written
}

export interface FolderOptions {
  format: FormatId
  place: (source: Source) => Placement
  lost?: readonly Lost[]
}

export async function folderPlan(
  sources: readonly Source[],
  options: FolderOptions,
): Promise<ImportPlan> {
  const placed: { source: Source; to: string; read: Placement['read'] }[] = []
  const files = new ExportFiles()

  // Everything is placed before anything is read, because a link in the first
  // note can point at the last file in the export.
  for (const source of sources) {
    const placement = options.place(source)
    if (!placement.to) continue

    placed.push({ source, to: placement.to, read: placement.read })
    files.add(source.path, { path: placement.to, name: nameFor(placement.to) })
  }

  const written: Planned[] = []

  for (const one of placed) {
    if (!one.read) {
      written.push({ kind: 'file', path: one.to, bytes: await one.source.bytes() })
      continue
    }

    const said = await one.read(await one.source.text(), one.source)
    const body = rewriteLinks(
      said.text,
      { was: one.source.path, now: one.to },
      files.find,
      files.reaches,
    )
    written.push({
      kind: 'note',
      path: one.to,
      text: said.kept ? keptText(body) : noteText(said.title ?? null, body, said.meta ?? {}),
    })
  }

  return { format: options.format, files: written, lost: [...(options.lost ?? [])] }
}

/** The name a wikilink writes for a file: its own, without the extension. */
function nameFor(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '')
}

/** Whether this file is one whose words become a note. `.txt` is in: Tomboy,
 *  Keep and Apple's own exporters all write plain text, and a text file in a
 *  space is a note that happens to have no markdown in it. */
export function isNoteFile(path: string): boolean {
  return /\.(md|markdown|mdown|mkd|txt)$/i.test(path)
}

/** Files no export meant to hand over: a folder's own metadata, the rubbish two
 *  desktops leave in every folder they touch. `Icon\r` is where Finder keeps a
 *  folder's own icon, named with a character Windows cannot write. */
export function isJunk(path: string): boolean {
  const name = path.split('/').pop() ?? path
  return (
    name === '.DS_Store' ||
    name === 'Thumbs.db' ||
    name === 'desktop.ini' ||
    name === 'Icon\r' ||
    name.startsWith('._') ||
    path.startsWith('__MACOSX/') ||
    path.includes('/__MACOSX/')
  )
}
