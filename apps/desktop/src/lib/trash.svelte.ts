/** Recently deleted: what was deleted in the last 14 days, and the way back.
 *
 *  Signed in, the account holds it (services/sync/src/trash.ts) so every
 *  device sees the same list. Signed out, this device holds it in its own
 *  trash folder (src-tauri/src/trash.rs, or the browser's stand-in). Both can
 *  be listed at once: what went into the device trash before signing in stays
 *  there, marked as this device's, until it is restored or ages out. */

import { account } from './account.svelte'
import { api } from './api'
import { message, plural, t } from './i18n.svelte'
import { prompt } from './prompt.svelte'
import { sync } from './sync.svelte'
import { folderOf } from './space-paths'
import { invoke } from './tauri'
import { workspace } from './workspace.svelte'

const KEEP_FOR = 14 * 24 * 60 * 60 * 1000

export interface TrashItem {
  /** Unique across both sources, so a list can key on it. */
  id: string
  kind: 'note' | 'folder' | 'space'
  name: string
  /** Where it was: the folder of a note, the note count of a space. */
  detail: string
  deletedAt: number
  purgeAt: number
  source: 'account' | 'device'
  /** The id the source knows it by. */
  ref: string
}

/** What the device's trash commands return. */
interface DeviceEntry {
  id: string
  kind: string
  name: string
  from: string
  trashedAt: number
}

function kindOf(kind: string): TrashItem['kind'] {
  return kind === 'space' || kind === 'folder' ? kind : 'note'
}

class Trash {
  items = $state<TrashItem[]>([])
  busy = $state(false)
  error = $state<string | null>(null)
  loaded = $state(false)

  async load() {
    this.error = null
    const [device, remote] = await Promise.all([
      this.fromDevice(),
      account.accountToken ? this.fromAccount(account.accountToken) : Promise.resolve([]),
    ])
    this.items = [...remote, ...device].sort((a, b) => b.deletedAt - a.deletedAt)
    this.loaded = true
  }

  private async fromDevice(): Promise<TrashItem[]> {
    const entries = await invoke<DeviceEntry[]>('list_trash').catch(() => [] as DeviceEntry[])
    return entries.map((entry) => ({
      id: `device:${entry.id}`,
      ref: entry.id,
      kind: kindOf(entry.kind),
      name: entry.name,
      detail: folderOf(entry.from),
      deletedAt: entry.trashedAt,
      purgeAt: entry.trashedAt + KEEP_FOR,
      source: 'device' as const,
    }))
  }

  private async fromAccount(token: string): Promise<TrashItem[]> {
    let listing: Awaited<ReturnType<typeof api.trash>>
    try {
      listing = await api.trash(token)
    } catch (error) {
      this.error = message(error, t('could not reach the server'))
      return []
    }

    const spaces = listing.spaces.map((space) => ({
      id: `space:${space.id}`,
      ref: space.id,
      kind: 'space' as const,
      name: space.name,
      detail: plural(space.notes, { one: '{count} note', other: '{count} notes' }),
      deletedAt: space.deletedAt,
      purgeAt: space.purgeAt,
      source: 'account' as const,
    }))

    const notes = listing.notes.map((note) => ({
      id: `note:${note.id}`,
      ref: note.id,
      kind: 'note' as const,
      name: note.path.split('/').pop() ?? note.path,
      detail: [note.spaceName, folderOf(note.path)].filter(Boolean).join(' / '),
      deletedAt: note.deletedAt,
      purgeAt: note.purgeAt,
      source: 'account' as const,
    }))

    return [...spaces, ...notes]
  }

  /** Puts one thing back. From the account, the next sync pass brings it down;
   *  from the device, the tree is re-read at once. */
  async restore(item: TrashItem) {
    await this.act(async () => {
      if (item.source === 'device') {
        const at = await invoke<string>('restore_trash', { id: item.ref })
        // The undo entry that would have done the same has nothing left to do.
        workspace.undone.forget(item.ref)
        await workspace.loadSpaces()
        await workspace.loadTree()
        // And what came back is said like any file that came to be, so the links to
        // it resolve again at once. A space is read whole when it is opened, like
        // any other.
        if (item.kind !== 'space') {
          await workspace.fileCame(at, item.kind === 'folder' ? 'folder' : 'file')
        }
        return
      }

      const token = account.accountToken
      if (!token) return
      if (item.kind === 'space') {
        await api.restoreSpace(token, item.ref)
        await account.loadSpaces()
      } else {
        await api.restoreNote(token, item.ref)
      }
      sync.nudge()
    })
  }

  /** Takes one thing away for good, ahead of its day. */
  /** One thing, gone for good, after one question - as a Mac's Finder and an
   *  iPhone's Files both ask it. The button sat a thumb's slip from Restore, and a
   *  note it took could not be had back from anywhere. */
  async purge(item: TrashItem) {
    const sure = await prompt.confirm({
      title: t('Delete {name}?', { name: item.name }),
      confirmLabel: t('Delete now'),
      danger: true,
    })
    if (!sure) return

    await this.act(async () => {
      if (item.source === 'device') {
        await invoke('purge_trash', { id: item.ref })
        return
      }

      const token = account.accountToken
      if (!token) return
      if (item.kind === 'space') await api.purgeSpace(token, item.ref)
      else await api.purgeNote(token, item.ref)
    })
  }

  /** Everything, after one question. */
  async empty() {
    const sure = await prompt.confirm({
      title: t('Empty Recently deleted?'),
      detail: t('Everything in it is gone for good.'),
      confirmLabel: t('Empty'),
      danger: true,
    })
    if (!sure) return

    await this.act(async () => {
      for (const item of this.items.filter((one) => one.source === 'device')) {
        await invoke('purge_trash', { id: item.ref }).catch(() => undefined)
      }
      if (account.accountToken) await api.emptyTrash(account.accountToken)
    })
  }

  /** The device's own sweep: what has waited its 14 days goes. The account's
   *  sweep runs on the server. */
  async sweep() {
    await invoke<number>('purge_trash_older_than', { age: KEEP_FOR }).catch(() => 0)
    if (this.loaded) await this.load()
  }

  /** Does one thing to the list and reads it again, whether or not it worked.
   *
   *  What went wrong is said after the list is read, not before: reading starts from
   *  no error, and saying it first had the reload wipe it - a restore the disk refused
   *  left the row where it was and the sheet saying nothing at all. */
  private async act(work: () => Promise<void>) {
    this.busy = true
    this.error = null
    let failed: string | null = null
    try {
      await work()
    } catch (error) {
      failed = message(error, t('that did not work'))
    }

    this.busy = false
    await this.load()
    if (failed !== null) this.error = failed
  }
}

export const trash = new Trash()
