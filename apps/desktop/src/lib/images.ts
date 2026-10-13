import { frontMatter } from '@nib/markdown'
import { folderOf } from './space-paths'
import { assetUrl, joinPath } from './tauri'

/** True for anything the browser can already fetch on its own. */
function isRemote(src: string): boolean {
  return /^([a-z]+:)?\/\//i.test(src) || src.startsWith('data:')
}

/** The path as the note means it. What a note writes in a link is a URL, so a
 *  folder with a space in its name arrives as `%20` - from Orden itself, from
 *  Typora, from Obsidian. The file on disk is named with the space. */
function written(src: string): string {
  try {
    return decodeURI(src)
  } catch {
    // Not valid encoding at all, so it is already the name it stands for.
    return src
  }
}

/** The same path with `.` and `..` folded away, so what is handed on points
 *  where it points rather than describing the way there. A note one folder down
 *  writes the space's own assets folder as `../assets/x.png`, and neither the
 *  webview's asset protocol nor a reader looking at the path should have to
 *  work that out. */
function foldedPath(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/'
  const out: string[] = []

  for (const part of path.split(/[\\/]/)) {
    if (part === '.') continue
    // The first part is the root or the drive, and nothing is above it; a `..`
    // that has nothing to climb over stays as it is.
    if (part === '..' && out.length > 1 && out.at(-1) !== '..') out.pop()
    else out.push(part)
  }

  return out.join(separator)
}

/** Where an image written in a note actually lives on disk.
 *
 *  `typora-root-url` re-bases absolute-looking paths, which is how Typora keeps
 *  a note working both inside a vault and on a site. Returns null when the path
 *  is not local, or when the note has no home yet. */
export function imagePath(src: string, notePath?: string | null, source = ''): string | null {
  if (isRemote(src) || !notePath) return null

  const path = written(src)
  const root = /^\s*typora-root-url\s*:\s*(.+)$/m.exec(frontMatter(source) ?? '')?.[1]
  if (root && path.startsWith('/')) {
    return foldedPath(joinPath(root.trim().replace(/["']/g, ''), path.slice(1)))
  }

  return foldedPath(joinPath(folderOf(notePath), path))
}

/** The same path, as something the webview will load. */
export function imageUrl(src: string, notePath?: string | null, source = ''): string {
  const path = imagePath(src, notePath, source)
  return path ? assetUrl(path) : src
}
