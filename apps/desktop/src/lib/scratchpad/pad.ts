/** The scratchpad: one note that belongs to no space, for pasting something in and
 *  jotting something down before deciding where it goes.
 *
 *  Drafts opens on a blank page and asks where a thought goes afterwards; Apple's Quick
 *  Note and Raycast's notes are one key away from anywhere and that same key puts them
 *  away. So this is a switch in the bar and a card docked at the window's edge, never a
 *  tab: it is not in a strip, a tab cycle, the closed tabs or the session's tabs, and
 *  opening its file from anywhere shows the card (see `open` in the workspace). Docked
 *  rather than floating, because a web tab's page is a native view that would draw over
 *  a floating card; docked, the page is narrowed instead.
 *
 *  It lives beside `custom.css` in the app's own folder (`scratchpad_path` in the
 *  crate's themes.rs, which `openable` admits); the browser build keeps it in a dot
 *  folder of its own store. Its words answer the Search panel from every space, and the
 *  quick question puts an answer on its end when no note is in front; see
 *  search/scratchpad.ts and ai/quick.svelte.ts. Whether the card is up is shown.svelte.ts,
 *  the card ScratchpadCard.svelte. */

import type { EditorView } from '@nib/editor'
import { applied, type Edit } from '../search/replace'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { shown } from './is.svelte'
import { difference, joined } from './words'

class Scratchpad {
  private asked: Promise<string> | null = null
  /** The card's editor while it is up, which holds the words before the file does. */
  live: EditorView | null = null
  /** The line a search hit asked the card to land on; the card takes it. */
  line: number | null = null

  /** Where it is, made the first time. One question per run; a failed one is asked
   *  again next time. */
  where(): Promise<string> {
    this.asked ??= invoke<string>('scratchpad_path').catch((error: unknown) => {
      this.asked = null
      throw error
    })
    return this.asked
  }

  /** The card up, with the keyboard in it unless asked not to, at a line when one is
   *  given. */
  show(line: number | null = null, take = true) {
    this.line = line
    shown.show(take)
  }

  /** What it says now: the card's words while it is up, else the file's. */
  async text(): Promise<string> {
    if (this.live) return this.live.state.doc.toString()
    return (await workspace.noteText(await this.where())) ?? ''
  }

  /** Puts words on the end of it, with a blank line before them, without showing it.
   *  A card that is up takes them as an edit - its caret stays put - and the file is
   *  written in the same breath. */
  async append(words: string): Promise<void> {
    await this.write((before) => joined(before, words))
  }

  /** An agent's edits, worked out against `before`, put in the same way: through the
   *  card while it is up, so the reader's caret is carried, and into the file. False
   *  when the words are no longer `before` - the reader wrote meanwhile - and the
   *  edits have to be worked out again. See agents/docs. */
  async replace(before: string, edits: readonly Edit[]): Promise<boolean> {
    const path = await this.where()
    const live = this.live
    const now = live ? live.state.doc.toString() : ((await workspace.noteText(path)) ?? '')
    if (now.replace(/\r\n?/g, '\n') !== before) return false

    live?.dispatch({ changes: [...edits] })
    await writeFile(path, applied(before, edits))
    return true
  }

  private async write(change: (before: string) => string): Promise<void> {
    const path = await this.where()
    const before = await this.text()
    const after = change(before)
    if (after === before) return

    this.live?.dispatch({ changes: difference(before, after) })
    await writeFile(path, after)
  }

  /** Makes it a real note in a space: written at the space's root under the name its
   *  first line gives it, opened, and the scratchpad emptied and put away. Nothing for
   *  an empty scratchpad, which has no note in it. The space is shown first, so the
   *  note lands in the listing on screen and in that space's own tabs. */
  async moveTo(spaceId: string): Promise<void> {
    const space = workspace.spaces.find((one) => one.id === spaceId)
    const words = await this.text()
    if (!space || !words.trim()) return

    if (space.id !== workspace.activeSpaceId) await workspace.selectSpace(space.id)
    const made = await workspace.noteFrom(words, space.root)
    if (!made) return
    await this.write(() => '')
    if (shown.on) shown.hide()
    await workspace.open(made)
  }
}

export const scratchpad = new Scratchpad()
