import { api, BASE } from './api'
import { account } from './account.svelte'
import { attachmentFolder } from './attachments'
import { sha256 } from './bytes'
import { modes } from './modes.svelte'
import { invoke } from './tauri'
import { workspace } from './workspace.svelte'

/** The extension to give a stored image, from what the clipboard said it is. */
function extensionFor(type: string, name: string): string {
  const fromName = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  if (fromName && fromName.length <= 5) return fromName

  const fromType = type.split('/')[1]?.replace('+xml', '')
  return fromType && /^[a-z0-9]+$/.test(fromType) ? fromType : 'png'
}

/** Where a pasted image goes, and what to write in the note.
 *
 *  With an account the picture goes to the server, addressed by its hash: one
 *  copy however many notes use it, and every machine can already see it. The
 *  note carries a plain URL, so it still renders in an export or a published
 *  blog with nothing else to resolve.
 *
 *  Without one it lands in the folder the Attachments setting names, near the
 *  note and named by the same hash, so the space stays portable and a repeated
 *  paste still costs nothing. */
export async function storeImage(file: File, notePath: string | null): Promise<string | null> {
  const bytes = await file.arrayBuffer()
  // The picture's name is its contents, so the same image pasted twice is stored
  // once wherever it ends up.
  const hash = await sha256(bytes)
  const extension = extensionFor(file.type, file.name)

  const token = account.accountToken
  if (token) {
    try {
      await api.putBlob(token, hash, file.type || 'image/png', bytes)
      return `${BASE}/i/${hash}.${extension}`
    } catch (error) {
      // Out of space is the one worth saying out loud; anything else falls
      // back to keeping the image locally rather than losing the paste.
      if (error instanceof Error && /out of space/i.test(error.message)) throw error
    }
  }

  if (!notePath) return null

  return storeBeside(bytes, notePath, `${hash.slice(0, 16)}.${extension}`)
}

/** Bytes written beside a note under a name the caller chose, and the relative path
 *  to put in the note.
 *
 *  The second half of `storeImage`, on its own so that a recording takes the same
 *  road as a pasted picture: the same Attachments setting, the same folder, the same
 *  command, and the same refusal to write anywhere outside the space. A recording
 *  brings its own name rather than a hash of its bytes - two recordings are never the
 *  same bytes, and a name with the date in it is one somebody can find in a folder -
 *  and it never goes to the account instead, because a note names it as
 *  `![[recording-….weba]]` and a wikilink resolves against the files of the space.
 *
 *  Null when it could not be written, which the caller says out loud: a recording
 *  that was made and not kept is the one failure here worth interrupting somebody
 *  for. */
export function storeBeside(
  bytes: ArrayBuffer,
  notePath: string,
  name: string,
): Promise<string | null> {
  // The folder is decided here and checked there: the command joins it onto the
  // note's own folder and refuses one that would leave the space.
  const folder = attachmentFolder(modes.attachments, notePath, workspace.activeSpace?.root ?? null)

  return invoke<string>('save_asset', {
    notePath,
    folder,
    name,
    bytes: [...new Uint8Array(bytes)],
  }).catch(() => null)
}
