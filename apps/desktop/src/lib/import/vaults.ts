/** The vaults Obsidian lists on this machine, and one of them as the import's
 *  sources.
 *
 *  Arc's first run lists the browsers already on the machine by name; this lists
 *  the vaults the same way, out of Obsidian's own list, so nobody hunts for a folder
 *  they last saw when they made it. The crate does the reading, and only of a vault
 *  Obsidian lists; see obsidian_vaults.rs. Desktop only: everywhere else the folder
 *  dialog is the way in. */

import { fromBase64 } from '../bytes'
import { t } from '../i18n.svelte'
import { invoke, isDesktop } from '../tauri'
import type { Source } from './sources'
import { tooMuch } from './sources'

export interface Vault {
  name: string
  path: string
}

interface VaultFile {
  path: string
  size: number
}

/** Newest first, the order Obsidian's own chooser has them in. None off the
 *  desktop, and none where Obsidian has never run. */
export async function vaults(): Promise<Vault[]> {
  if (!isDesktop) return []
  try {
    return await invoke<Vault[]>('obsidian_vaults')
  } catch {
    return []
  }
}

/** Every file of the vault, read when a reader asks for it rather than all at
 *  once: detecting and counting opens a handful, and the rest are read as they
 *  are written. Refused before anything is read when the vault is past the ceiling
 *  every import has; see `tooMuch`. */
export async function vaultSources(vault: Vault): Promise<Source[]> {
  const files = await invoke<VaultFile[]>('obsidian_vault_files', { vault: vault.path })
  const bytes = files.reduce((sum, one) => sum + one.size, 0)
  if (tooMuch(bytes)) throw new Error(t('That export is too big to read in one go.'))

  return files.map((file) => {
    let held: Promise<Uint8Array> | null = null
    const once = () =>
      (held ??= invoke<string>('read_obsidian_file', { vault: vault.path, path: file.path }).then(
        fromBase64,
      ))

    return {
      path: file.path,
      text: async () => new TextDecoder().decode(await once()),
      bytes: once,
    }
  })
}
