import { isAudioTarget, isImageTarget, isVideoTarget } from '@nib/markdown/links'
import { about } from './complete'
import type { LinkWrite, NoteIndex } from './notes'

/** Links to notes of the space, a line each: what a row dropped on the words writes,
 *  and a row's Copy link. A picture, a sound or a film is embedded, as `![[pic.png]]`
 *  shows one. Fetched by the first of those; see `noteLinksCode` in drop.ts. */
export function noteLinks(
  index: NoteIndex,
  paths: readonly string[],
  write: (target: LinkWrite) => string,
): string {
  return paths.map((path) => linkFor(index, path, write)).join('\n')
}

function linkFor(index: NoteIndex, path: string, write: (target: LinkWrite) => string): string {
  const note = index.notes.find((one) => one.path === path)
  if (note) return write(about(index, note))

  // A file, named with its extension as `[[paper.pdf]]` is, or a folder's own note
  // nobody has written yet, which its name finds once somebody does.
  const file = index.files.includes(path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const link = write({ name: file ? name : name.replace(/\.[^.]+$/, ''), path, from: index.path })
  const shown = isImageTarget(path) || isAudioTarget(path) || isVideoTarget(path)

  return file && shown ? `!${link}` : link
}
