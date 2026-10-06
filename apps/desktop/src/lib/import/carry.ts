/** What an app's habits say about nib's own settings, for an import that makes a
 *  new space.
 *
 *  Chrome's first run, which brings the search engine and the bookmarks bar over
 *  from the browser somebody came from without asking about either: a reader who
 *  spent four years in Obsidian has already said how a link is spelled, whether a
 *  newline breaks the line and where a pasted picture goes, and asking again would
 *  be asking them to remember what their old app did for them. So the answers come
 *  with the notes, silently, and Settings is where they change.
 *
 *  Only when the import makes a space of its own (David, 2026-10-06). An import into
 *  a space somebody already writes in is their notes arriving, not their habits, and
 *  these settings are the account's rather than the space's.
 *
 *  Pure: a list of answers. The store that applies them is carry-over.ts. */

import type { PropertiesMode } from '@nib/markdown/properties'
import type { AttachmentFolder } from '../attachments'
import type { LinkFormat } from '../link-format'
import type { FormatId } from './plan'
import type { Source } from './sources'

/** The settings an app's habits decide. Missing means the app has no opinion and
 *  the reader keeps whatever they had. */
export interface Carried {
  linkFormat?: LinkFormat
  hardBreaks?: boolean
  attachments?: AttachmentFolder
  properties?: PropertiesMode
  vim?: boolean
  /** Whether the markdown marks stay hidden while writing; see `quietMarks` in
   *  modes.svelte.ts. */
  quietMarks?: boolean
  /** The keyboard the hands already know; see shortcuts/presets.ts. */
  keys?: 'obsidian' | 'notion'
}

/** Notion never shows a mark: what was typed is what is drawn, a page's properties
 *  sit in a panel at its top, Enter inside a block is a new line, and the keys are
 *  Notion's. Its export carries none of this, because it is the app's and not the
 *  workspace's, so it is the same for everybody. */
export const NOTION: Carried = {
  quietMarks: true,
  properties: 'properties',
  hardBreaks: true,
  keys: 'notion',
}

/** What an import of this format carries, or null for an app with no habits worth
 *  bringing. */
export async function carriedBy(
  format: FormatId,
  sources: readonly Source[],
): Promise<Carried | null> {
  if (format === 'obsidian') {
    const { obsidianCarries } = await import('./obsidian')
    return obsidianCarries(sources)
  }

  return format === 'notion' ? NOTION : null
}
