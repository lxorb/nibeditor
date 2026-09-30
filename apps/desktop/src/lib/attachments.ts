/** Where a pasted or dropped picture is written.
 *
 *  Three choices, and one rule behind all of them: what goes into the note is a
 *  relative path that resolves from the note's own folder. That is what keeps a
 *  space portable - the same folder opens in Nib, in Obsidian or in a text
 *  editor - and it is why this returns a folder relative to the note rather
 *  than a place on disk. The command that writes the file joins it on and
 *  checks the result is still inside the space. */

import { noteName } from './space-paths'

/** The folder today's notes already point at, and the name Obsidian uses for
 *  the same thing. */
const ASSETS = 'assets'

export const ATTACHMENT_FOLDERS = ['space', 'note', 'named'] as const
export type AttachmentFolder = (typeof ATTACHMENT_FOLDERS)[number]

export function isAttachmentFolder(value: unknown): value is AttachmentFolder {
  return ATTACHMENT_FOLDERS.some((one) => one === value)
}

/** Every separator as a slash, so one piece of arithmetic serves a Windows path
 *  and the browser's virtual one alike. */
function slashed(path: string): string {
  return path.replace(/\\/g, '/')
}

/** The folder a picture from `notePath` goes in, relative to the note's own
 *  folder. The empty string means the note's folder itself.
 *
 *  A note no space holds has no space to keep an assets folder in, so it falls back
 *  to one of its own. */
export function attachmentFolder(
  choice: AttachmentFolder,
  notePath: string,
  spaceRoot: string | null,
): string {
  switch (choice) {
    case 'note':
      return ''
    case 'named':
      return noteName(slashed(notePath))
    case 'space': {
      const depth = foldersBelow(spaceRoot, notePath)
      return depth === null ? ASSETS : `${'../'.repeat(depth)}${ASSETS}`
    }
  }
}

/** How many folders down from the space the note sits, or null when it is not in
 *  the space at all. */
function foldersBelow(spaceRoot: string | null, notePath: string): number | null {
  const root = slashed(spaceRoot ?? '').replace(/\/+$/, '')
  const note = slashed(notePath)
  if (!root || !note.startsWith(`${root}/`)) return null

  return note.slice(root.length + 1).split('/').length - 1
}
