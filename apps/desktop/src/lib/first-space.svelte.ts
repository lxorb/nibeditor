/** What the space chooser's rows do: make the first space, bring a folder in as one,
 *  or open the sign-in. Obsidian's three ways out of its vault chooser.
 *
 *  Fetched with the card rather than carried by the window; whether the card is up
 *  at all is space-chooser.svelte.ts. */

import { account } from './account.svelte'
import { busy } from './busy.svelte'
import { message, t } from './i18n.svelte'
import { insideFolder, pickedFolder, sourcesFrom, type Picked } from './import/sources'
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

  /** Import: a folder off the disk, as a space of its own named after it. What
   *  Obsidian's "Open folder as vault" does, except that nib copies rather than
   *  points, because its spaces live in the one folder the app owns; see paths.rs.
   *  The import's own readers do the work, so an Obsidian vault, a Bear export and a
   *  plain folder of markdown all arrive the way the import sheet brings them. */
  async importFolder() {
    const { pickFolder } = await import('./import/picking')
    const picked = await pickFolder()
    const name = pickedFolder(picked)
    if (!name) return

    await this.while(() =>
      busy.run(t('Importing'), async () => {
        try {
          const space = await importAsSpace(name, picked)
          if (space) await this.arrive(space, firstNote())
        } catch (error) {
          busy.failed(message(error, t('That import could not be written.')))
        }
      }),
    )
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

/** Reads what was picked before anything is made, so a folder that holds no notes
 *  leaves no empty space behind it. */
async function importAsSpace(name: string, picked: readonly Picked[]): Promise<Space | null> {
  const [{ detect, readAs }, { applyImport }] = await Promise.all([
    import('./import/read'),
    import('./import/apply'),
  ])

  const sources = await sourcesFrom(insideFolder(picked))
  const format = await detect(sources)
  if (!format) throw new Error(t('Nothing in there can be read as notes.'))

  const plan = await readAs(format, sources)
  const space = await workspace.addSpace(name)
  if (!space) return null

  await applyImport(plan, { root: space.root, folder: '' })
  await workspace.loadTree()
  return space
}

/** The first note of the space as the file list shows it, to open on. */
function firstNote(): string | null {
  return workspace.files[0]?.path ?? null
}

export const firstSpace = new FirstSpace()
