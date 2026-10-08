/** Bringing notes over from another app as a space of their own: the rows of the
 *  first screen, of Settings' Import pane and of the palette's two commands.
 *
 *  The iPhone's "Transfer Your Apps & Data", which is one screen inside setup with a
 *  row per place the data could come from, the same function under Settings
 *  afterwards. Here the rows are Obsidian, Notion and every other app, and each ends
 *  in the same place: a new space, named after what came in, holding it, open, with
 *  the habits of the app it came from carried into the settings (import/carry.ts).
 *
 *  An import into a space that already exists is the import sheet's, and carries no
 *  settings: it is notes arriving, not somebody arriving. See importing.svelte.ts.
 *
 *  Fetched with the card, the pane or the command that asks for it; nothing here is
 *  in front of the first paint. */

import { busy } from './busy.svelte'
import { firstVisit } from './first-visit.svelte'
import { message, t } from './i18n.svelte'
import type { FormatId } from './import/plan'
import { insideFolder, pickedFolder, sourcesFrom, type Picked, type Source } from './import/sources'
import type { Vault } from './import/vaults'
import { isDesktop } from './tauri'
import { viewport } from './viewport.svelte'
import { type Space, workspace } from './workspace.svelte'

class Migrating {
  /** Set while an import is under way, so a second press does not make a second
   *  space. */
  working = $state(false)

  /** Obsidian's own list of vaults, while the reader is choosing one. Null when the
   *  list is not up. */
  vaults = $state<Vault[] | null>(null)

  /** Obsidian: the vaults this machine has, by name, the way Arc lists the browsers
   *  it found. Where Obsidian lists none, or off the desktop, straight to the
   *  folder dialog, which is Obsidian's own "Open folder as vault". */
  async obsidian() {
    if (this.working) return
    const { vaults } = await import('./import/vaults')
    const found = isDesktop ? await vaults() : []
    if (found.length) this.vaults = found
    else await this.folder()
  }

  /** Back from the vault list to the rows. */
  back() {
    this.vaults = null
  }

  /** One of the vaults Obsidian listed, read where it is. */
  async vault(vault: Vault) {
    await this.bringing(async () => {
      const { vaultSources } = await import('./import/vaults')
      return { name: vault.name, sources: await vaultSources(vault) }
    })
  }

  /** A folder off the disk: a vault, a Logseq graph, an unzipped export. */
  async folder() {
    const { pickFolder } = await import('./import/picking')
    const picked = await pickFolder()
    const name = pickedFolder(picked)
    if (!name) return

    await this.bringing(async () => ({ name, sources: await sourcesFrom(insideFolder(picked)) }))
  }

  /** A file or a zip: Notion's export, an `.enex`, a Takeout. */
  async files() {
    const { pickFiles } = await import('./import/picking')
    const picked = await pickFiles()
    if (!picked.length) return

    await this.bringing(async () => ({
      name: (format) => namedFor(picked, format),
      sources: await sourcesFrom(picked),
    }))
  }

  private async bringing(
    read: () => Promise<{
      name: string | ((format: FormatId) => Promise<string>)
      sources: Source[]
    }>,
  ) {
    if (this.working) return
    this.working = true

    try {
      await busy.run(t('Importing'), async () => {
        try {
          const { name, sources } = await read()
          const space = await importAsSpace(name, sources)
          this.vaults = null
          if (space) await arrive(space)
        } catch (error) {
          busy.failed(message(error, t('That import could not be written.')))
        }
      })
    } finally {
      this.working = false
    }
  }
}

/** The name an export's own file suggests, or the app's when it suggests none. */
async function namedFor(picked: readonly Picked[], format: FormatId): Promise<string> {
  const { folderNameFor } = await import('./importing.svelte')
  return folderNameFor(picked, format)
}

/** Reads what was picked before anything is made, so a folder that holds no notes
 *  leaves no empty space behind it. Then the space, the notes in it, and the habits
 *  of the app they came from. */
export async function importAsSpace(
  name: string | ((format: FormatId) => Promise<string>),
  sources: readonly Source[],
): Promise<Space | null> {
  const [{ detect, readAs }, { applyImport }, { carriedBy }] = await Promise.all([
    import('./import/read'),
    import('./import/apply'),
    import('./import/carry'),
  ])

  const format = await detect(sources)
  if (!format) throw new Error(t('Nothing in there can be read as notes.'))

  const plan = await readAs(format, sources)
  const space = await workspace.addSpace(typeof name === 'string' ? name : await name(format))
  if (!space) return null

  await applyImport(plan, { root: space.root, folder: '' })

  const carried = await carriedBy(format, sources)
  if (carried) {
    const { carryOver } = await import('./carry-over')
    await carryOver(carried)
  }

  await workspace.loadTree()
  return space
}

/** In the new space, on its first note, with the file list beside it where there
 *  is room - which is where Obsidian lands after opening a folder as a vault. On a
 *  phone the list is a drawer over the note, and opening it would hide the note. */
export async function arrive(space: Space) {
  // The browser's first visit has had its question answered; see first-visit.svelte.ts.
  if (firstVisit.asking) firstVisit.answered()
  // From Settings' Import pane, the new space is what there is to look at.
  const { settings } = await import('./settings.svelte')
  settings.open = false
  if (workspace.activeSpaceId !== space.id) await workspace.showSpace(space.id)
  const note = firstNote()
  if (note) await workspace.openEntry(note, { activate: true })
  if (!viewport.drawer) workspace.showPanel('tree')
}

/** The first note of the space as the file list shows it, to open on. */
function firstNote(): string | null {
  return workspace.files[0]?.path ?? null
}

export const migrating = new Migrating()
