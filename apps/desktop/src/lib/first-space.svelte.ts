/** What the space chooser's own rows do: make the first space, or open the sign-in.
 *  Obsidian's ways out of its vault chooser; the rows that bring notes over from
 *  another app are migrating.svelte.ts, which Settings and the palette share.
 *
 *  Fetched with the card rather than carried by the window; whether the card is up
 *  at all is space-chooser.svelte.ts. */

import { account } from './account.svelte'
import { markSeeded, wasSeeded } from './seeded'
import { joinPath } from './tauri'
import { viewport } from './viewport.svelte'
import { WELCOME, WELCOME_NAME } from './welcome'
import { writeFile } from './workspace/write-file'
import { type Space, workspace } from './workspace.svelte'

class FirstSpace {
  /** Set while a row's work is under way, so a second press does not make a second
   *  space. */
  working = $state(false)

  /** Create: a name, then the space, then the welcome note in it, open, with the file
   *  list beside it - which is where Obsidian lands after creating a vault. */
  async create() {
    await this.while(async () => {
      const { newSpace } = await import('./space-actions')
      const space = await newSpace()
      if (space) await this.arrive(space, await this.welcome(space))
    })
  }

  /** Both doors lead to the same emailed code; the sheet only says which was taken. */
  signIn(mode: 'sign-in' | 'create') {
    account.ask(mode)
  }

  private async while(work: () => Promise<void>) {
    if (this.working) return
    this.working = true
    try {
      await work()
    } finally {
      this.working = false
    }
  }

  /** The welcome note, into the first space this device makes: once per device, the
   *  same rule the browser build keeps, so somebody who deleted it is not handed it
   *  again with their next space. Answers where it was written, or null. */
  private async welcome(space: Space): Promise<string | null> {
    if (await wasSeeded()) return null

    const path = joinPath(space.root, WELCOME_NAME)
    await writeFile(path, WELCOME)
    await markSeeded()
    await workspace.loadTree()
    return path
  }

  /** In the new space: the note open where there is one, and the file list beside it
   *  where there is room. On a phone the list is a drawer over the note, and opening
   *  it would hide the very note the space opened on. */
  private async arrive(space: Space, note: string | null) {
    if (workspace.activeSpaceId !== space.id) await workspace.showSpace(space.id)
    if (note) await workspace.openEntry(note, { activate: true })
    if (!viewport.drawer) workspace.showPanel('tree')
  }
}

export const firstSpace = new FirstSpace()
