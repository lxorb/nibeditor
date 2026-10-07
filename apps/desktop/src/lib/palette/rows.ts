/** One row of the palette, whatever it is: the vocabulary the list, the ranking and
 *  the choosing share. What a row draws is Palette.svelte's; which rows there are
 *  and in what order is kinds.ts and rank.ts. */

import type { Command } from '../commands'
import type { FileMark } from '../file-mark'
import type { Destination, Host } from '../remote/hosts'
import type { Bookmark } from '../workspace/bookmarks.svelte'
import type { TabKind } from '../workspace/documents.svelte'
import type { Entry } from '../workspace.svelte'
import type { NoteToMake } from './new-note'
import type { Setting } from './settings'

/** What the palette needs of an open tab. */
export interface OpenTab {
  id: string
  kind: TabKind
  path: string | null
  shown: string
  /** The page a web tab is on, for telling it from the same page in the history. */
  url: string | null
}

export type Row =
  /** A file in the space that is not open: a note, a canvas, a paper, a website. */
  | { kind: 'note'; entry: Entry; folder: string | null; shared: boolean }
  /** An open tab, which is switched to: Chrome's "switch to this tab". A tab holding a
   *  file stands in for that file's row, so a note is one row whether or not it is open. */
  | { kind: 'tab'; tab: OpenTab; folder: string | null; shared: boolean }
  | { kind: 'command'; command: Command }
  | {
      kind: 'bookmark'
      mark: Bookmark
      label: string
      /** The note a heading or a block is in, said after it. */
      note: string | null
      /** The file it opens or the folder it shows; null for a search or a view. */
      path: string | null
      /** The mark the row wears where it points at a file. */
      file: FileMark | null
    }
  /** A page from this device's history, opened in a tab of its own. */
  | { kind: 'page'; url: string; title: string; address: string }
  | { kind: 'setting'; setting: Setting }
  /** A heading or a line of the note in front, gone to. */
  | { kind: 'place'; line: number; text: string; depth: number; hint: string | null }
  /** The note a name typed would make. */
  | { kind: 'make'; make: NoteToMake }
  /** An address typed, gone to: Chrome's what-you-typed row. */
  | { kind: 'address'; url: string; address: string }
  /** Another machine, a terminal on it opened: `pi`, or `ssh pi`. */
  | { kind: 'host'; host: Host }
  /** A destination typed after `ssh` that no host has yet, kept and connected to. */
  | { kind: 'connect'; wanted: Destination; said: string }
  /** A message in one of the reader's chats, found by its words (docs/chats.md 4.12):
   *  its first line, and where it is - the chat and who wrote it. */
  | { kind: 'message'; chat: string; id: string; path: string; line: string; where: string }
