/** Bringing notes over from another app as a space of their own: the rows of the
 *  first screen, of Settings' Import pane and of the palette's two commands.
 *
 *  The iPhone's "Transfer Your Apps & Data", which is one screen inside setup with a
 *  row per place the data could come from, the same function under Settings
 *  afterwards. Here the rows are Obsidian, Notion and every other app, and each ends
 *  in the same place: a new space, named after what came in, holding it, open, with
 *  the habits of the app it came from carried into the settings (import/carry.ts).
 *
 *  And Zen, the browser, whose spaces become spaces and whose tabs web notes in
 *  them: one space per Zen space rather than one for the import. See
 *  import/zen-plan.ts.
 *
 *  An import into a space that already exists is the import sheet's, and carries no
 *  settings: it is notes arriving, not somebody arriving. See importing.svelte.ts.
 *
 *  Fetched with the card, the pane or the command that asks for it; nothing here is
 *  in front of the first paint. */

import { busy } from './busy.svelte'
import { firstVisit } from './first-visit.svelte'
import { message, t } from './i18n.svelte'
import { type FormatId, worthKnowing } from './import/plan'
import { type LinkFormat, linkWriting, setLinkWriting } from './link-format'
import { insideFolder, pickedFolder, sourcesFrom, type Picked, type Source } from './import/sources'
import type { Vault } from './import/vaults'
import type { ZenProfile } from './import/zen-profiles'
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

  /** Zen's profiles, while the reader is choosing one. Null when the list is not up. */
  profiles = $state<ZenProfile[] | null>(null)

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

  /** Back from the vault or profile list to the rows. */
  back() {
    this.vaults = null
    this.profiles = null
  }

  /** Zen: its one profile straight away, or the list where it keeps several, the
   *  way its own profile manager lists them. Said in a line where there is none. */
  async zen() {
    if (this.working) return
    const { zenProfiles } = await import('./import/zen-landing')
    const found = await zenProfiles()
    const [only] = found
    if (found.length > 1) this.profiles = found
    else if (only) await this.zenProfile(only)
    else busy.failed(t('Zen’s tabs could not be read.'))
  }

  /** One of Zen's profiles, every space of it. Lands in the first space without
   *  opening a page: what is in it is websites, and none of them was asked for yet. */
  async zenProfile(profile: ZenProfile) {
    await this.running(async () => {
      const { landZen } = await import('./import/zen-landing')
      const space = await landZen(profile)
      this.profiles = null
      await arrive(space, false)
    })
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
    await this.running(async () => {
      const { name, sources } = await read()
      const space = await importAsSpace(name, sources)
      this.vaults = null
      await arrive(space)
    })
  }

  /** One import at a time, under the busy line, its failure said in it. */
  private async running(task: () => Promise<void>) {
    if (this.working) return
    this.working = true

    try {
      await busy.run(t('Importing'), async () => {
        try {
          await task()
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
): Promise<Space> {
  const [{ detect, readAs }, { applyImport }, { carriedBy }] = await Promise.all([
    import('./import/read'),
    import('./import/apply'),
    import('./import/carry'),
  ])

  const format = await detect(sources)
  if (!format) throw new Error(t('Nothing in there can be read as notes.'))

  // The habits are read first, because one of them is how a link is spelled, and the
  // notes are read in that spelling: the space is about to be set to it, and a vault
  // of wikilinks read in whatever the Links setting said before would arrive as a
  // space of markdown links set to write wikilinks.
  const carried = await carriedBy(format, sources)
  const plan = await spelledAs(carried?.linkFormat, () => readAs(format, sources))
  // A vault of nothing but Obsidian's housekeeping is known as a vault and then
  // leaves every file behind, and settings alone are not a space anybody can open a
  // note in.
  // A vault whose notes are all in iCloud says so, rather than only that there is
  // nothing to read.
  const shown = plan.files.some((one) => !one.path.split('/').some((part) => part.startsWith('.')))
  if (!shown) {
    const said = [t('Nothing in there can be read as notes.'), ...plan.lost.map(worthKnowing)]
    throw new Error(said.join(' '))
  }

  const space = await workspace.addSpace(typeof name === 'string' ? name : await name(format))
  // A folder the disk would not make, read-only or full, is an import that was not
  // written, and somebody who picked their vault is told so rather than left
  // looking at the list closing on nothing.
  if (!space) throw new Error(t('That import could not be written.'))

  await applyImport(plan, { root: space.root, folder: '' })

  if (carried) {
    const { carryOver } = await import('./carry-over')
    await carryOver(carried)
  }

  await workspace.loadTree()
  // What did not come along is said once the rest has, the way the import sheet
  // says it before: notes still in iCloud, pages kept as they were. Left unsaid, a
  // link to one of them points at nothing and nobody knows why.
  if (plan.lost.length) busy.failed(plan.lost.map(worthKnowing).join(' '))
  return space
}

/** What `read` makes with every link written in `format`, the setting put back as
 *  it was afterwards: carry-over.ts is what sets it for good, once the space is
 *  there to be set. No format leaves the setting as it is. */
async function spelledAs<T>(format: LinkFormat | undefined, read: () => Promise<T>): Promise<T> {
  if (!format) return read()

  const was = linkWriting()
  setLinkWriting(format)
  try {
    return await read()
  } finally {
    setLinkWriting(was)
  }
}

/** In the new space, on its first note, with the file list beside it where there
 *  is room - which is where Obsidian lands after opening a folder as a vault. On a
 *  phone the list is a drawer over the note, and opening it would hide the note.
 *  `open` false lands on the list alone. */
export async function arrive(space: Space, open = true) {
  // The browser's first visit has had its question answered; see first-visit.svelte.ts.
  if (firstVisit.asking) firstVisit.answered()
  // From Settings' Import pane, the new space is what there is to look at.
  const { settings } = await import('./settings.svelte')
  settings.open = false
  if (workspace.activeSpaceId !== space.id) await workspace.showSpace(space.id)
  const note = open ? firstNote() : null
  if (note) await workspace.openEntry(note, { activate: true })
  if (!viewport.drawer) workspace.showPanel('tree')
}

/** The first note of the space as the file list shows it, to open on. The list
 *  puts folders first and holds PDFs and canvases too, so a vault's `Attachments/`
 *  would otherwise be what it opens on; a space of papers alone opens on its first. */
function firstNote(): string | null {
  return (workspace.notes[0] ?? workspace.files[0])?.path ?? null
}

export const migrating = new Migrating()
