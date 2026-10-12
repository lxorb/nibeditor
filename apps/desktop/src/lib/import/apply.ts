/** Writing an import, through the same road every other file in the app takes.
 *
 *  `writeFile` for a note and `writeBytes` for anything else: the one write path
 *  every other file the app makes takes, so sync sees the files, the link index
 *  sees them, version history has them, and the file list has the rows before
 *  the sheet is closed. Nothing here writes to disk itself and nothing here knows
 *  whether the app is on a desktop, in a browser or on a phone.
 *
 *  Every path is judged here before any of them is written, by the same
 *  `insideOnly` a `nib://` link's path goes through. Each format reader already
 *  puts every part of a name through `safeName` or `keptName`, so this catches nothing an
 *  honest reader does: what it catches is a new reader that forwards a zip
 *  entry's own name, which is a path somebody else wrote and which nothing
 *  further along would refuse - `write_note` and `write_bytes` take whatever path
 *  they are handed. Judged in one pass in front of the loop, so a plan holding
 *  one such name writes none of its thousand other files rather than half of
 *  them. See the Security section of docs/conventions.md.
 *
 *  Two rules about names, both of which the sheet has already said out loud:
 *
 *  Nothing is written over. A name that is taken steps aside the way a new note's
 *  does - `Plan 2.md` - and the links inside the import follow it, so an import
 *  that landed beside notes of the same name still points at its own notes rather
 *  than at the ones that were already there.
 *
 *  The whole import is one thing to undo. However many thousand files it wrote,
 *  what somebody did was import once. */

import { freePath } from '@nib/markdown/paths'

import { insideOnly } from '../automation/inside'
import { key } from '../i18n.svelte'
import { log } from '../log'
import { folderOf, relativePath } from '../space-paths'
import { joinPath } from '../tauri'
import { toBase64 } from '../bytes'
import { workspace } from '../workspace.svelte'
import { writeBytes, writeFile } from '../workspace/write-file'

import { nameKey } from './names'
import type { ImportPlan, Planned } from './plan'
import { canvasFollowed, codeRanges, inCode, isCanvas } from './rewrite'

/** Where an import lands: a space, and a folder inside it. */
export interface ImportTarget {
  /** The space's root, as the platform spells paths. */
  root: string
  /** The folder inside the space, `/`-separated, or the empty string for the
   *  space itself. */
  folder: string
}

export interface Landed {
  /** What was written, as the platform spells paths. */
  paths: string[]
  /** How many names had to step aside because something was already there. */
  stepped: number
}

export interface Writing {
  /** Called after each file, so the sheet can say how far along it is. */
  onWritten?: (done: number, total: number) => void
}

export async function applyImport(
  plan: ImportPlan,
  target: ImportTarget,
  options: Writing = {},
): Promise<Landed> {
  const stamped = restamped(plan, takenIn(target), target.folder)
  const files = judged(stamped.files)
  const paths: string[] = []
  let done = 0

  try {
    for (const file of files) {
      const path = joinPath(target.root, file.path)

      if (file.kind === 'note') await writeFile(path, file.text)
      else await writeBytes(path, toBase64(file.bytes))

      paths.push(path)
      done += 1
      options.onWritten?.(done, files.length)
    }
  } finally {
    // Whatever was written is one import to undo, and in the file list, even when a
    // write partway through failed. The failure still reaches the sheet, which says
    // so; before, the half that had landed was on the disk with no undo that could
    // take it back, and trying again put a `Plan 2.md` beside every one of them.
    if (paths.length) await landed(paths)
  }

  return { paths, stepped: stamped.stepped }
}

/** What an import that wrote something owes the rest of the app. */
async function landed(paths: string[]) {
  workspace.undone.record({ kind: 'import', paths })
  await workspace.loadTree()
  const { sync } = await import('../sync.svelte')
  sync.nudge()
}

/** The plan's files with every path judged, and the judge's own answer as the
 *  path: the string that is joined to the space root is the one `insideOnly`
 *  handed back, so nothing but a judged path can reach a write.
 *
 *  Throws for the first path that is not one, before anything is written. The
 *  sentence is the reader's rather than a log line because the sheet shows it;
 *  it says nothing about which file, since a name that escapes is a bug in a
 *  format reader and the name itself is the least of what somebody would want to
 *  know about it. The log has the path. */
function judged(files: readonly Planned[]): Planned[] {
  return files.map((file) => {
    const inside = insideOnly(file.path)
    if (inside === null) {
      log('error', `import: ${file.path} is not a path inside a space, so nothing was written`)
      throw new Error(ESCAPING)
    }

    return { ...file, path: inside }
  })
}

const ESCAPING = key('That import would have landed outside the space, so nothing was written.')

/** Every path the space already holds, as the one name it is (see `nameKey`), so a
 *  name that is taken can be recognised however it is spelled. */
function takenIn(target: ImportTarget): Set<string> {
  const taken = new Set<string>()
  const root = target.root

  for (const entry of workspace.files) {
    if (!entry.path.startsWith(root)) continue
    taken.add(
      nameKey(
        entry.path
          .slice(root.length)
          .replace(/^[\\/]+/, '')
          .replace(/\\/g, '/'),
      ),
    )
  }

  return taken
}

/** The plan with its paths inside the target folder, nothing landing on a name
 *  that is taken, and every link inside the import pointing at where its target
 *  actually went. */
export function restamped(
  plan: ImportPlan,
  taken: ReadonlySet<string>,
  folder: string,
): { files: Planned[]; stepped: number } {
  const under = folder.replace(/^\/+|\/+$/g, '')
  // Keyed on the way in, because two names that differ only in case are one name on
  // Windows and on a Mac, and two that differ only in how an accent is composed are
  // one name on a Mac.
  const held = new Set([...taken].map(nameKey))
  const moved = new Map<string, string>()
  const placed: { file: Planned; was: string; now: string }[] = []

  for (const file of plan.files) {
    const wanted = under ? `${under}/${file.path}` : file.path
    const free = freePath(wanted, (candidate) => held.has(nameKey(candidate)))
    held.add(nameKey(free))

    if (free !== wanted) moved.set(file.path, under ? free.slice(under.length + 1) : free)
    placed.push({ file, was: file.path, now: free })
  }

  const files = placed.map(({ file, was, now }) => {
    if (file.kind === 'file') {
      // A canvas's cards follow the same way, since they name the import's files too.
      const bytes = moved.size && isCanvas(was) ? canvasFollowed(file.bytes, moved) : file.bytes
      return { ...file, path: now, bytes }
    }
    const text = moved.size ? followed(file.text, was, moved) : file.text
    return { ...file, path: now, text }
  })

  return { files, stepped: moved.size }
}

/** A note's links, pointing at where the import's own files ended up.
 *
 *  Only what moved is touched, and it is touched in the spellings the import
 *  wrote: anything by its name in a wikilink - a note without its extension, a
 *  picture with it, the way Obsidian embeds one - and a file that is not a note by
 *  the path from this note's own folder as well. */
function followed(text: string, was: string, moved: ReadonlyMap<string, string>): string {
  let said = text

  for (const [from, to] of moved) {
    const before = nameOf(from)
    const after = nameOf(to)
    if (before !== after) {
      said = outsideCode(said, `[[${before}]]`, `[[${after}]]`)
      said = outsideCode(said, `[[${before}|`, `[[${after}|`)
      said = outsideCode(said, `[[${before}#`, `[[${after}#`)
    }
    if (isNote(from)) continue

    const here = folderOf(was)
    const path = relativePath(here, from).replace(/ /g, '%20')
    const now = relativePath(here, to).replace(/ /g, '%20')
    if (path === now) continue

    said = outsideCode(said, `](${path})`, `](${now})`)
  }

  return said
}

/** Every `find` in the text made `put`, except in code. A link written in a code
 *  span or a fence is an example of one, words to copy exactly, which the import
 *  left as it was when it read the note and leaves as it was here too. */
function outsideCode(text: string, find: string, put: string): string {
  if (!text.includes(find)) return text

  const code = codeRanges(text)
  let out = ''
  let from = 0
  for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + find.length)) {
    if (inCode(code, at)) continue
    out += text.slice(from, at) + put
    from = at + find.length
  }

  return out + text.slice(from)
}

function isNote(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/** The name a wikilink calls a file by: a note's without its extension, any
 *  other file's whole. */
function nameOf(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.(md|markdown)$/i, '')
}
