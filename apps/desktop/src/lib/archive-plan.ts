/** Which entries of a space's archive one gesture touches.
 *
 *  Pure, and apart from the gestures themselves, because the two questions here are
 *  the ones the archive's promises rest on. Archiving a selection has to archive each
 *  row once and never a row already put away with its folder. And taking one note back
 *  out of an archived folder has to bring back that note, and only that note, exactly
 *  where it was: its folder comes back around it, and everything else the folder held
 *  stays put away. Every path here is relative to the space, the way the archive keeps
 *  them; see workspace/archive.svelte.ts. */

import { coveredBy } from './workspace/archive.svelte'

/** Whether `path` is `folder` or inside it. */
function under(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

/** The paths of a selection that archiving would actually put away: each once, never
 *  one inside another that is being put away with it, and never one the archive
 *  already hides. In the order they were given. */
export function toArchive(paths: readonly string[], keys: ReadonlySet<string>): string[] {
  const fresh = [...new Set(paths)].filter((path) => path && coveredBy(keys, path) === null)
  return fresh.filter((path) => !fresh.some((other) => other !== path && under(path, other)))
}

/** The archived rows that stand on their own: every archived path that is not inside
 *  another archived folder. What the archive lists; a note put away inside a folder
 *  that was put away later is found by opening the folder. */
export function standing(keys: ReadonlySet<string>): string[] {
  return [...keys].filter((path) => {
    const cut = path.lastIndexOf('/')
    return cut === -1 || coveredBy(keys, path.slice(0, cut)) === null
  })
}

/** What taking `at` back touches: the archived paths hiding it, which are taken back,
 *  and every row those were also hiding that is not on the way down to `at`, which
 *  stays put away on its own. `childrenOf` lists a folder's rows as paths, whether or
 *  not they are archived. Nothing at all for a path nothing hides. */
export function toRestore(
  keys: ReadonlySet<string>,
  at: string,
  childrenOf: (folder: string) => readonly string[],
): { restore: string[]; archive: string[] } {
  const chain: string[] = []
  for (let path = at; ;) {
    chain.unshift(path)
    const cut = path.lastIndexOf('/')
    if (cut === -1) break
    path = path.slice(0, cut)
  }

  const restore = chain.filter((path) => keys.has(path))
  const outer = restore[0]
  if (outer === undefined) return { restore: [], archive: [] }

  // Every folder from the outermost archived one down to the one holding `at`: what
  // those held besides the way down was hidden by what is now coming back.
  const archive: string[] = []
  for (const folder of chain.slice(chain.indexOf(outer), -1)) {
    for (const child of childrenOf(folder)) {
      if (!chain.includes(child) && !keys.has(child)) archive.push(child)
    }
  }

  return { restore, archive }
}
