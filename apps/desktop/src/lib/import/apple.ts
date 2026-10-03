/** Apple Notes read straight off the Mac it is on.
 *
 *  Notes has no export. It offers a PDF per note, which is a picture of a note
 *  rather than a note, and everything else somebody has ever written to get notes
 *  out of it reads the database Notes keeps:
 *  `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`. So that is
 *  what the crate reads, on the one platform that has it, and this is the half
 *  that turns what it found into an import like any other.
 *
 *  Which is why the crate hands over notes rather than markdown files: the words
 *  are its business, and where a note goes, what its front matter says and how its
 *  links are rewritten are the import's, the same as for a Notion zip. So a note
 *  arrives with the path it had in Notes, its own title and the two days Notes
 *  knew, and everything after that is `folderPlan` and `meta`.
 *
 *  A link from one note to another comes over as a markdown link to where that
 *  note went, so the import's own rewriting turns it into a wikilink along with
 *  every other export's links. */

import { fromBase64 } from '../bytes'
import { key } from '../i18n.svelte'
import { folderPlan } from './folder'
import { dayOf, type Meta } from './meta'
import { Names, safeParts } from './names'
import type { ImportPlan } from './plan'
import { sourceOf, type Source } from './sources'

/** One note, as the crate answers it. */
interface AppleNote {
  /** The folders it sat in, its own name, and `.md`. Which is also what a link
   *  from another note points at, so the two line up without either side having
   *  to guess. */
  path: string
  /** What Notes listed it as, for a note whose words do not open with a title. */
  title: string
  text: string
  /** Seconds since 1970, or zero for a note whose row said nothing. */
  created: number
  modified: number
}

/** One attachment, with its bytes as base64. */
interface AppleMedia {
  path: string
  bytes: string
}

/** Everything one read of the database found, counts and all. */
export interface AppleNotes {
  notes: readonly AppleNote[]
  media: readonly AppleMedia[]
  locked: number
  binned: number
  drawn: number
  tables: number
  missing: number
}

/** What the crate says when macOS refuses the folder, which is what it does
 *  until the app has Full Disk Access. Read rather than shown: the sheet has its
 *  own words for it, and a button that opens the setting. */
export const NO_ACCESS = 'no access'

/** And what it says where Notes has never been used on this Mac. */
export const NO_DATABASE = 'no database'

/** The notes on this Mac, as a plan. */
export async function readMacNotes(): Promise<ImportPlan> {
  const { invoke } = await import('../tauri')
  return planFor(await invoke<AppleNotes>('read_apple_notes'))
}

/** What the crate handed over, as the plan the sheet counts and writes. */
export async function planFor(read: AppleNotes): Promise<ImportPlan> {
  const names = new Names()
  const notes = new Map<string, { title: string; meta: Meta }>()
  const sources: Source[] = []
  const encoder = new TextEncoder()

  for (const note of read.notes) {
    sources.push(sourceOf(note.path, encoder.encode(note.text)))
    notes.set(note.path, {
      title: note.title,
      meta: { date: dayOf(note.created), updated: dayOf(note.modified) },
    })
  }

  for (const one of read.media) sources.push(sourceOf(one.path, fromBase64(one.bytes)))

  const plan = await folderPlan(sources, {
    format: 'apple-notes',
    place: (source) => {
      const said = notes.get(source.path)
      const to = names.free(safeParts(source.path))
      if (!said) return { to }

      // The heading is `noteText`'s to add, and it only adds one where the note
      // does not open with its own: a note whose first line Notes styled as the
      // title arrives with that line as a heading already.
      return { to, read: (text) => ({ text, title: said.title, meta: said.meta }) }
    },
  })

  plan.lost.push(...lost(read))

  return plan
}

/** What Notes keeps and this cannot bring, one line each.
 *
 *  A locked note is the honest one: it is encrypted with a passphrase nib does
 *  not have, exactly like Evernote's `<en-crypt>`. The bin is the Keep rule: what
 *  somebody threw away stays thrown away, and the count is said out loud. */
function lost(read: AppleNotes): ImportPlan['lost'] {
  const lines: ImportPlan['lost'] = []

  if (read.locked) {
    lines.push({
      text: key('{count} notes are behind a password, which nothing but Notes can open'),
      values: { count: read.locked },
    })
  }

  if (read.binned) {
    lines.push({
      text: key('{count} notes are in Recently Deleted, and stay there'),
      values: { count: read.binned },
    })
  }

  if (read.drawn) {
    lines.push({
      text: key('{count} drawings and scans have no picture on this Mac'),
      values: { count: read.drawn },
    })
  }

  if (read.tables) {
    lines.push({
      text: key('{count} tables inside notes do not come over'),
      values: { count: read.tables },
    })
  }

  if (read.missing) {
    lines.push({
      text: key('{count} attachments are in iCloud rather than on this Mac'),
      values: { count: read.missing },
    })
  }

  return lines
}
