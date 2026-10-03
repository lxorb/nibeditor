/** The scratchpad: one note that belongs to no space, for pasting something in and
 *  jotting something down before deciding where it goes.
 *
 *  Drafts opens on a blank page and asks where a thought goes afterwards; Apple's Quick
 *  Note is one gesture away from anywhere; VS Code keeps an untitled tab through a
 *  restart without asking. This is those three as one file: the same note from every
 *  space, a key and a glyph away, written down as it changes and there after a restart,
 *  and **Move to space** when it has become a real note.
 *
 *  A tab and not a panel of its own, opened the way Edit custom CSS opens the app's own
 *  file: the whole editor - live preview, find, undo, splits - and the note writer and
 *  the session that puts a tab back come with it, rather than a second editor kept equal
 *  to the first. It lives beside `custom.css` in the app's own folder (`Scratchpad.md`,
 *  `scratchpad_path` in the crate's themes.rs, which `openable` admits); the browser
 *  build keeps it in a dot folder of its own store, which no space lists.
 *
 *  Its words answer the Search panel from every space, and the quick question puts an
 *  answer on its end when no note is in front; see search/scratchpad.ts and
 *  ai/quick.svelte.ts. Which file it is, and its tab's row, are is.ts: all of it that
 *  is in front of the first paint. */

import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { isScratchpad } from './is'
import { difference, joined } from './words'

class Scratchpad {
  private asked: Promise<string> | null = null

  /** Where it is, made the first time. One question per run; a failed one is asked
   *  again next time. */
  where(): Promise<string> {
    this.asked ??= invoke<string>('scratchpad_path').catch((error: unknown) => {
      this.asked = null
      throw error
    })
    return this.asked
  }

  /** Whether the tab in front is it. */
  get inFront(): boolean {
    return isScratchpad(workspace.active?.path)
  }

  /** The key, the glyph and the palette row: the scratchpad in front, and pressed
   *  again while it is, the tab that was in front before it - Quick Note's one gesture
   *  both ways. */
  async toggle(): Promise<void> {
    if (this.inFront) {
      // The tab used before it, else the one beside it: a window put back by the
      // session has used nothing yet.
      const strip = workspace.tabsIn(workspace.panes.focusedId).map((tab) => tab.id)
      const at = strip.indexOf(workspace.activeTabId ?? '')
      const others = strip.filter((id) => id !== workspace.activeTabId)
      const back = workspace.panes.lastOf(others) ?? strip[at - 1] ?? strip[at + 1]
      if (back) workspace.activate(back)
      return
    }

    await workspace.open(await this.where())
  }

  /** What it says now: the words in a tab where one has it open, else the file's. */
  async text(): Promise<string> {
    return (await workspace.noteText(await this.where())) ?? ''
  }

  /** Puts words on the end of it, with a blank line before them, without opening it.
   *  A tab that has it open takes them as an edit from outside - its caret stays put
   *  - and the file is written in the same breath, as a replacement across a space
   *  is; see `edited` in workspace/documents.svelte.ts. */
  async append(words: string): Promise<void> {
    const path = await this.where()
    await this.write(path, (before) => joined(before, words))
  }

  /** Writes it as `change` says, through the tab that has it open where one does. */
  private async write(path: string, change: (before: string) => string): Promise<void> {
    const open = workspace.documentAt(path)
    if (open) {
      open.flush()
      const before = open.text
      const after = change(before)
      if (after === before) return
      open.edited([difference(before, after)], after)
      await writeFile(path, after)
      return
    }

    const before = (await workspace.noteText(path)) ?? ''
    const after = change(before)
    if (after !== before) await writeFile(path, after)
  }

  /** Makes it a real note in a space: written at the space's root under the name its
   *  first line gives it, opened where the scratchpad was, and the scratchpad emptied
   *  for the next thing. Nothing for an empty scratchpad, which has no note in it.
   *
   *  The space is shown first, so the note is written into the listing on screen and
   *  opened in that space's own tabs, where the reader will look for it. */
  async moveTo(spaceId: string): Promise<void> {
    const space = workspace.spaces.find((one) => one.id === spaceId)
    const path = await this.where()
    const words = await this.text()
    if (!space || !words.trim()) return

    if (space.id !== workspace.activeSpaceId) await workspace.selectSpace(space.id)
    const made = await workspace.noteFrom(words, space.root)
    if (!made) return
    await this.write(path, () => '')

    const shown = workspace.active
    await workspace.open(made)
    if (shown && isScratchpad(shown.path)) workspace.close(shown.id, false)
  }
}

export const scratchpad = new Scratchpad()
