/** A folder of notes, which is what most apps write when asked for one.
 *
 *  Craft, Ulysses, iA Writer, Obsidian, a Bear markdown export and a OneNote or
 *  Google Docs HTML export are all this: files in folders, some of them notes and
 *  the rest the pictures those notes point at. So they are all read here, and the
 *  only difference between them is what the sheet calls the import afterwards.
 *
 *  A TextBundle is a folder too, and it is unwrapped on the way past: the bundle's
 *  `text.md` becomes a note named after the bundle, and its assets come with it.
 *  That is Bear's and Craft's usual answer, and a folder called `Trip.textbundle`
 *  sitting in a space would be a folder nothing opens. */

import { htmlToMarkdown } from '@nib/markdown/from-html'

import { key } from '../i18n.svelte'
import { folderPlan, isJunk, isNoteFile } from './folder'
import { keptName, Names, safeName, safeParts, withoutNotionId } from './names'
import type { FormatId, ImportPlan } from './plan'
import type { Source } from './sources'

const HTML = /\.(html?|xhtml)$/i

/** Where a bundle's own text file sits, whichever of the two names it uses. */
const BUNDLE_TEXT = /\.textbundle\/text\.(md|markdown|txt)$/i

export interface PlainOptions {
  format?: FormatId
  /** Names the format does not want carried over. */
  skip?: (path: string) => boolean
  /** A last look at a note's words: Bear rewrites its tags here, Logseq its
   *  properties. */
  words?: (text: string, source: Source) => string
  /** Files an app keeps for itself rather than an export it wrote: an Obsidian
   *  vault. Their names are the reader's own, so no exporter's id is taken off
   *  them and none is shortened or respaced, since the vault's canvases name them
   *  too, a note's words are kept to the byte, and an HTML file is a page
   *  somebody saved, copied as it is rather than read as a note. */
  asTheyAre?: boolean
}

export async function readPlain(
  sources: readonly Source[],
  options: PlainOptions = {},
): Promise<ImportPlan> {
  const names = new Names()
  let html = 0

  const plan = await folderPlan(sources, {
    format: options.format ?? 'markdown',
    place: (source) => {
      if (isJunk(source.path) || options.skip?.(source.path)) return { to: null }

      // A space in front of the whole path, which a vault uses to sort a note
      // first, is one the space trims off when the file is written (see
      // automation/inside.ts), so it comes off here, where a name it then shares
      // with another file still steps aside and the links follow it.
      const path = options.asTheyAre
        ? (placedPath(source.path, undefined, keptName)?.trimStart() ?? null)
        : placedPath(source.path, withoutNotionId)
      if (path === null) return { to: null }

      if (HTML.test(path) && !options.asTheyAre) {
        html += 1
        return {
          to: names.free(path.replace(HTML, '.md')),
          read: (text) => ({
            text: htmlToMarkdown(text, { fileTargets: true, appTargets: true }),
            title: null,
          }),
        }
      }

      if (!isNoteFile(path)) return { to: names.free(path) }

      return {
        to: names.free(path.replace(/\.txt$/i, '.md')),
        read: (text, at) => ({
          text: options.words?.(text, at) ?? text,
          title: null,
          kept: options.asTheyAre === true,
        }),
      }
    },
  })

  // Said out loud because it is the one thing a reader of an HTML export has to
  // know: what the HTML did not hold was not in the export either.
  if (html) {
    plan.lost.push({
      text: key('{count} pages came as HTML, so their words are kept and their look is not'),
      values: { count: html },
    })
  }

  return plan
}

/** Where a file in the export goes, or null for one that is only packaging.
 *
 *  The folders are kept as they are, since somebody arranged them, and a name
 *  that no file may have is argued with one part at a time so a folder full of
 *  notes stays one folder. `each` is done to every part first: for an export, the
 *  id Notion leaves on the end of names is taken off wherever it appears, since a
 *  folder of markdown might have come from there through some other tool. */
function placedPath(
  path: string,
  each?: (part: string) => string,
  named: (part: string) => string = safeName,
): string | null {
  if (BUNDLE_TEXT.test(path)) {
    // `Trips/Iceland.textbundle/text.md` is the note `Trips/Iceland.md`.
    const bundle = path.replace(/\/text\.(md|markdown|txt)$/i, '')
    return `${safeParts(bundle.replace(/\.textbundle$/i, ''), each, named)}.md`
  }

  const inside = /\.textbundle\/(.*)$/i.exec(path)
  if (inside) {
    const rest = inside[1] ?? ''
    // A bundle's own metadata says what wrote it, which the note does not need.
    if (/^info\.json$/i.test(rest)) return null
    return safeParts(rest, each, named)
  }

  return safeParts(path, each, named)
}
