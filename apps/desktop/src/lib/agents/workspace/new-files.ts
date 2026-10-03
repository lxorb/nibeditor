/** `create_note` for the kinds of file that are not a markdown note: a canvas, a page
 *  note and a web note, each written as the file list's own New row writes one - a blank
 *  plane, a page of the reader's paper, a shortcut to the address - and never over
 *  anything (docs/agent-native.md 5.3). Which kind is the path's ending, or `kind` where
 *  the path has none; a note is notes.ts's. */

import { isCanvasTarget, isPagesTarget, isWebTarget } from '@nib/markdown/links'
import type { AgentAnswer } from '../../automation/caller'
import { shownName } from '../../note-name'
import { canWriteAt } from '../../sharing.svelte'
import { nameOf } from '../../space-paths'
import { isWebAddress } from '../../web-tab/address'
import { workspace } from '../../workspace.svelte'
import { fileNamed } from '../../workspace/drafts'
import { asked } from './asks'
import { type Call, done, flag, maybe, need, text } from './call'
import { Refused } from './problem'
import { judgedForWriting, onDisk, type Place } from './spaces'

/** What `create_note` can make. */
export const FILE_KINDS = ['note', 'canvas', 'pages', 'web'] as const
export type FileKind = (typeof FILE_KINDS)[number]

/** The kind a call asks for: what its path ends in, else what it says, else a note. */
export function fileKindOf(call: Call): FileKind {
  const path = need(call, 'path')
  if (isCanvasTarget(path)) return 'canvas'
  if (isPagesTarget(path)) return 'pages'
  if (isWebTarget(path)) return 'web'

  const kind = maybe(call, 'kind') ?? 'note'
  const found = FILE_KINDS.find((one) => one === kind)
  if (!found) throw new Refused('bad_arguments', `kind is one of ${FILE_KINDS.join(', ')}`)

  return found
}

/** A file's first words: what a new one of its kind holds. */
async function firstWords(call: Call, kind: Exclude<FileKind, 'note'>, name: string) {
  switch (kind) {
    case 'canvas': {
      const { blankCanvas, readCanvas, writeCanvas } = await import('../../canvas/format')
      // JSON Canvas the agent wrote, read and written the app's way, or a blank plane.
      const sent = text(call, 'content')
      return sent?.trim() ? writeCanvas(readCanvas(sent)) : blankCanvas()
    }

    case 'pages': {
      const { blankPages } = await import('@nib/markdown/pages')
      const { modes } = await import('../../modes.svelte')
      return blankPages(modes.pagesPaper)
    }

    case 'web': {
      const url = maybe(call, 'url')
      if (url === null || !isWebAddress(url)) {
        throw new Refused('bad_arguments', 'a web note says its url, a web address')
      }
      const { writeShortcut } = await import('../../web-tab/shortcut')
      return writeShortcut(url, shownName(name), new Date())
    }
  }
}

/** Makes a canvas, a page note or a web note at the path a call names, through `make`,
 *  which writes a file of a space and opens it when asked (notes.ts's `made`). */
export async function createFile(
  call: Call,
  place: Place,
  kind: Exclude<FileKind, 'note'>,
  make: (place: Place, relative: string, words: string, open: boolean) => Promise<unknown>,
): Promise<AgentAnswer> {
  const relative = fileNamed(judgedForWriting(need(call, 'path')), kind)
  const path = onDisk(place, relative)
  if (!canWriteAt(path)) {
    throw new Refused('read_only', `${place.space.name} is shared with you to read`)
  }
  if ((await workspace.noteText(path)) !== null) {
    throw new Refused('exists', `${relative} is already there, and nothing is written over`)
  }

  const words = await firstWords(call, kind, nameOf(relative))
  const question = await asked(call, null, `Make ${relative} in ${place.space.name}`)
  if (question) return question

  return done(await make(place, relative, words, flag(call, 'open')))
}
