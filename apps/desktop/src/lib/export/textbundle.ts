/** A TextBundle: the note and the pictures it names, as one thing that can be
 *  moved between apps without any of them going missing.
 *
 *  The format is a folder with a fixed shape - `info.json`, `text.md`, and an
 *  `assets` folder - written down at textbundle.org. Version 2 of it is what
 *  every reader supports, and `type` names the flavour of markdown inside, which
 *  for a note written here is plain markdown.
 *
 *  A folder cannot be downloaded, so a browser is handed the same thing zipped
 *  up, which the spec calls a TextPack. Same files, same paths, one entry per
 *  file under the bundle's own name. */

import type { Entry } from './zip'
import type { Picture } from './pictures'
import { toMarkdown } from './markdown'
import { type FoundLink } from '@nib/markdown/links'

/** Where the pictures go inside the bundle, as the spec names it. */
const ASSETS = 'assets'

/** What the readers of this format agree a plain markdown bundle is. */
const TYPE = 'net.daringfireball.markdown'

/** The bundle's own metadata. `transient` says a reader may not treat the
 *  bundle as a scratch file it can delete after importing it. */
function info(): string {
  return `${JSON.stringify(
    {
      version: 2,
      type: TYPE,
      transient: false,
      creatorIdentifier: 'so.orden',
    },
    null,
    2,
  )}\n`
}

export interface BundleOptions {
  /** Where a wikilink points, relative to `text.md`. Null leaves it as words. */
  link?: (link: FoundLink) => string | null
}

/** The files a bundle holds, in the order they should be written: the metadata
 *  first, so a reader that stops early still knows what it is looking at. */
export function bundleFiles(
  source: string,
  pictures: readonly Picture[],
  options: BundleOptions = {},
): Entry[] {
  const inside = new Map(pictures.map((picture) => [picture.src, `${ASSETS}/${picture.name}`]))

  const text = toMarkdown(source, {
    ...(options.link ? { link: options.link } : {}),
    picture: (src) => inside.get(src) ?? null,
  })

  return [
    { path: 'info.json', body: info() },
    { path: 'text.md', body: text },
    ...pictures.map((picture) => ({ path: `${ASSETS}/${picture.name}`, body: picture.bytes })),
  ]
}

/** The same files under the bundle folder's own name, which is what a TextPack
 *  is: one zip whose single top-level entry is the bundle. */
export function packEntries(bundle: string, files: readonly Entry[]): Entry[] {
  return files.map((file) => ({ ...file, path: `${bundle}/${file.path}` }))
}
