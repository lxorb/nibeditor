/** What a message is sent with: its chips made into the engine's attachments
 *  (docs/ai-sidebar.md 4.2).
 *
 *  Read at the moment of sending rather than when a chip is added, so a note edited
 *  after it was mentioned goes as it is on screen, unsaved words included. Nothing in
 *  the space goes that no chip names: the two the panel offers on its own (the note in
 *  front and its selection) are chips too, and one taken off stays off.
 *
 *  Ask mode keeps the Ask panel's behaviour: the space is searched for the passages the
 *  question is about, the note in front gives its own passages first, and the answer
 *  cites them by number (citations.ts, ai/retrieve.ts). */

import { searchSpace } from '../../search/space'
import { parseQuery } from '../../search/query'
import { scratchpad } from '../../scratchpad/pad'
import { relativeTo, within, withinSpace } from '../../space-paths'
import { pages } from '../../web-tab/pages.svelte'
import { workspace } from '../../workspace.svelte'
import { readThread } from '../chat/threads'
import type { Attachment, Draft, Mode } from '../chat/types'
import { fitted, retrieve } from '../retrieve'
import { passageAttachments } from './citations'
import type { Mention } from './mentions'

/** How much of each kind of thing goes, in tokens: a note whole as far as a long
 *  chapter, a page's article, a selection, another thread's gist. */
const NOTE = 12_000
const PAGE = 8_000
const SELECTION = 4_000
const THREAD = 3_000
/** How many notes a folder or a tag lists by name. */
const LISTED = 200

/** The note in front, as the panel offers it. */
export interface Front {
  path: string
  name: string
  text: string
}

async function noteAttachment(root: string, path: string): Promise<Attachment | null> {
  const text = await workspace.noteText(path)
  return text === null ? null : { label: relativeTo(root, path), text: fitted(text, NOTE) }
}

function listed(root: string, paths: readonly string[]): string {
  return paths
    .slice(0, LISTED)
    .map((one) => `- ${relativeTo(root, one)}`)
    .join('\n')
}

/** The notes with a tag, through the same search the `tag:` operator is. */
async function tagged(root: string, tag: string): Promise<string[]> {
  const found = new Set<string>()
  await searchSpace(
    root,
    parseQuery(`tag:${tag}`),
    [],
    LISTED,
    (batch) => {
      for (const hit of batch.hits) found.add(hit.path)
    },
    workspace.leftOutOf(root),
  ).catch(() => undefined)
  return [...found]
}

async function pageAttachment(tabId: string, label: string): Promise<Attachment | null> {
  const read = await pages.read(tabId, true).catch(() => null)
  if (!read?.html.trim()) return null
  const { htmlToMarkdown } = await import('@nib/markdown/from-html')
  return {
    label: read.title || label,
    text: fitted(htmlToMarkdown(read.html).trim(), PAGE),
    untrusted: true,
  }
}

async function threadAttachment(
  space: string,
  id: string,
  label: string,
): Promise<Attachment | null> {
  const thread = await readThread(space, id).catch(() => null)
  if (!thread) return null
  const words =
    thread.compaction?.summary ??
    thread.turns
      .map((turn) =>
        turn.role === 'you'
          ? `> ${turn.draft?.text ?? ''}`
          : turn.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join(''),
      )
      .join('\n\n')
  return { label, text: fitted(words, THREAD) }
}

/** One chip, read. */
async function attachmentOf(
  chip: Mention,
  space: { id: string; root: string },
  selection: string,
): Promise<Attachment | null> {
  const { root } = space
  switch (chip.kind) {
    case 'note':
      return await noteAttachment(root, chip.id)
    case 'folder': {
      const paths = workspace.notes
        .map((one) => one.path)
        .filter((one) => within(chip.id, one, root))
      return { label: `${relativeTo(root, chip.id)}/`, text: listed(root, paths) }
    }
    case 'tag':
      return { label: `#${chip.id}`, text: listed(root, await tagged(root, chip.id)) }
    case 'tab':
      return await pageAttachment(chip.id, chip.label)
    case 'selection':
      return selection.trim() ? { label: 'selection', text: fitted(selection, SELECTION) } : null
    case 'scratchpad': {
      const path = await scratchpad.where().catch(() => '')
      const text = path ? await workspace.noteText(path) : null
      return text ? { label: 'scratchpad', text: fitted(text, NOTE) } : null
    }
    case 'thread':
      return await threadAttachment(space.id, chip.id, chip.label)
    case 'picture':
      return chip.image ? { label: chip.label, image: chip.image } : null
    case 'words':
      return chip.text ? { label: chip.label, text: fitted(chip.text, NOTE) } : null
    case 'web':
      return null
  }
}

/** The message, with everything its chips name read. */
export async function draftOf(
  text: string,
  chips: readonly Mention[],
  mode: Mode,
  front: Front | null,
  selection: string,
): Promise<Draft> {
  const space = workspace.activeSpace
  const attachments: Attachment[] = []
  if (space) {
    if (mode === 'ask') {
      // Ask's own reading: the note in front's passages first, then the space's.
      const root = space.root
      const passages = await retrieve(
        text,
        {
          root,
          excluded: [...workspace.leftOutOf(root), ...(front ? [] : frontPath(root))],
          relative: (path) => withinSpace(root, path),
          read: (path) => workspace.noteText(path),
        },
        front,
      ).catch(() => [])
      attachments.push(...passageAttachments(passages))
    } else if (front) {
      attachments.push({ label: front.path, text: fitted(front.text, NOTE) })
    }
    const read = await Promise.all(chips.map((chip) => attachmentOf(chip, space, selection)))
    attachments.push(...read.filter((one): one is Attachment => one !== null))
  }
  return { text, attachments, ...(chips.some((one) => one.kind === 'web') ? { web: true } : {}) }
}

/** The note in front's own path, relative to the space, so a note whose chip was taken
 *  off is taken out of Ask's search as well: taking it off says not to send it. */
function frontPath(root: string): string[] {
  const tab = workspace.panelTab
  const path = tab?.kind === 'note' && tab.path ? withinSpace(root, tab.path) : null
  return path === null ? [] : [path]
}
