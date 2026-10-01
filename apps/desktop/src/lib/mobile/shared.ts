/** What another app shared with nib, as a note.
 *
 *  A share is the phone's version of the clipper: somebody found something
 *  somewhere else and wants a note about it. So it lands the way a clip and an
 *  import land - front matter saying where it came from and when, the words under
 *  a heading, and anything that is not words written as a file beside the note -
 *  and it goes through `applyImport`, which is the one road every imported file
 *  in the app already travels: `write_note` and `write_bytes`, a name that steps
 *  aside rather than overwriting, one undo for the lot, the file list reloaded and
 *  the sync nudged. Nothing here writes to disk itself.
 *
 *  Two shapes it can take, and the sheet asks which when both are possible:
 *
 *  A new note, which is everything - the words, the pictures and the files.
 *
 *  Or into the note already open, which takes the words and the pictures: the
 *  words at the caret, and each picture through `storeImage`, exactly as a paste
 *  of the same two things would. A file that is neither is not offered there,
 *  because a file needs a name of its own in the space and the plan is what gives
 *  it one; a share carrying one always makes its own note.
 *
 *  A markdown file is its own note, under its own name and with its own bytes:
 *  that is a note arriving, not a note being written about.
 *
 *  The reading is separated from the writing on purpose. Everything above the
 *  line is a pure answer to "what would this share become", which is the part
 *  worth testing, and the Kotlin side is in Shared.kt. */

import { dayOf, noteText } from '../import/meta'
import { safeName, titleFrom } from '../import/names'
import { isPicturePath } from '../space-paths'
import type { ImportPlan, Planned } from '../import/plan'

/** One thing that arrived. Exactly one of `text` and `size` is the whole of it:
 *  words came over with the payload, anything else is bytes to ask for. */
export interface SharedItem {
  name: string
  mime: string
  size: number
  text: string | null
}

/** A whole share as the activity describes it. */
export interface Arrived {
  action: string
  subject: string
  items: SharedItem[]
}

/** Text that is a note rather than a file: markdown, and a plain text file, which
 *  is a note somebody has not called one yet. */
const NOTES = /\.(md|markdown|mdown|mkd|txt|text)$/i

/** The first address in what was shared. A link shared from a browser arrives as
 *  the address alone; a paragraph shared from a page often carries one at the
 *  end. Either way it is where this came from, which is what the front matter
 *  says. */
const ADDRESS = /https?:\/\/[^\s<>"')]+/

/** What the activity said, read into something the page can trust. Answers null
 *  for anything that is not a share with something in it, which is what a launch
 *  from the launcher looks like. */
export function arrivedFrom(json: string): Arrived | null {
  if (!json) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const held = parsed as Record<string, unknown>
  const listed = Array.isArray(held.items) ? held.items : []

  const items: SharedItem[] = []
  for (const one of listed) {
    if (typeof one !== 'object' || one === null) continue
    const item = one as Record<string, unknown>
    const text = typeof item.text === 'string' ? item.text : null
    const size = typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : 0
    if (text === null && size <= 0) continue

    items.push({
      name: typeof item.name === 'string' ? item.name : '',
      mime: typeof item.mime === 'string' ? item.mime : '',
      size,
      text,
    })
  }

  if (!items.length) return null

  return {
    action: typeof held.action === 'string' ? held.action : '',
    subject: typeof held.subject === 'string' ? held.subject : '',
    items,
  }
}

/** Whether this is a picture, by what the sender said or by what it is called. */
export function isPicture(item: SharedItem): boolean {
  if (item.text !== null) return false
  return item.mime.startsWith('image/') || isPicturePath(item.name)
}

/** Whether this is a note in its own right rather than something to write about. */
export function isNote(item: SharedItem): boolean {
  if (item.text !== null) return false
  return item.mime.includes('markdown') || NOTES.test(item.name)
}

/** The words that came over, as one block. */
export function sharedWords(arrived: Arrived): string {
  return arrived.items
    .map((one) => one.text)
    .filter((one): one is string => one !== null)
    .join('\n\n')
    .trim()
}

/** What the note about this share is called, without its extension.
 *
 *  The subject first, which is the page title a browser shares alongside a link,
 *  then the first line of the words, then the name of the first file. A share is
 *  usually one of those three and never none of them. */
export function sharedTitle(arrived: Arrived): string {
  const subject = arrived.subject.trim()
  if (subject) return safeName(subject)

  const words = sharedWords(arrived)
  const address = ADDRESS.exec(words)?.[0]
  // A link on its own is a poor title, so the address is only used when there is
  // nothing else at all - and then only its host, which is at least legible.
  if (words && words !== address) {
    const found = titleFrom(words)
    if (found) return found
  }

  const first = arrived.items.find((one) => one.text === null)
  if (first?.name) return safeName(first.name.replace(/\.[^.]+$/, ''))
  if (address) return safeName(hostOf(address))

  return 'Shared'
}

/** The host of an address, for a share that is nothing but a link. */
function hostOf(address: string): string {
  const found = /^https?:\/\/([^/?#]+)/.exec(address)
  return found?.[1]?.replace(/^www\./, '') ?? 'Shared'
}

/** The markdown for one thing that came over: a picture is drawn, anything else
 *  is a link wearing its own name. */
export function embedFor(item: SharedItem, src: string): string {
  const at = encodeURI(src)
  if (isPicture(item)) return `![](${at})`

  return `[${item.name.replace(/[[\]]/g, '')}](${at})`
}

/** The whole share as an import: the note it becomes, the notes that arrived as
 *  notes, and the files that go beside them.
 *
 *  `folder` is where the files land, relative to the note, which is what the
 *  Attachments setting says; `on` is the day, which the front matter carries. The
 *  note is first in the plan, so the path it was written under is the first one
 *  `applyImport` answers with. */
export function sharedPlan(
  arrived: Arrived,
  bytes: ReadonlyMap<number, Uint8Array>,
  on: Date,
  folder: string,
): ImportPlan {
  const words = sharedWords(arrived)
  const address = ADDRESS.exec(words)?.[0] ?? null

  const about: Planned[] = []
  const embeds: string[] = []
  const notes: Planned[] = []
  const beside: Planned[] = []
  const under = folder.replace(/^\/+|\/+$/g, '')

  arrived.items.forEach((item, at) => {
    const held = bytes.get(at)
    if (item.text !== null || !held?.length) return

    if (isNote(item)) {
      const name = `${safeName(item.name.replace(/\.[^.]+$/, ''))}.md`
      notes.push({ kind: 'note', path: name, text: new TextDecoder().decode(held) })
      return
    }

    const name = safeName(item.name) || 'shared'
    const path = under ? `${under}/${name}` : name
    beside.push({ kind: 'file', path, bytes: held })
    embeds.push(embedFor(item, path))
  })

  const body = [words, ...embeds].filter(Boolean).join('\n\n')
  if (body) {
    const title = sharedTitle(arrived)
    about.push({
      kind: 'note',
      path: `${title}.md`,
      text: noteText(title, body, {
        date: dayOf(on.getTime()),
        ...(address ? { extra: [['source', address]] as const } : {}),
      }),
    })
  }

  return { format: 'markdown', files: [...about, ...notes, ...beside], lost: [] }
}
