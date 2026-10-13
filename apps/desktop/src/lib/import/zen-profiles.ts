/** The profiles Zen lists on this machine, and one of them's sidebar.
 *
 *  The crate lists them out of Zen's own `profiles.ini` and hands over the bytes of
 *  a session file it has judged to be one of theirs; see zen_profiles.rs. The
 *  unpacking and the reading are here, so they are pure functions a test holds.
 *  Desktop only: everywhere else there is no Zen to read. */

import { fromBase64 } from '../bytes'
import { t } from '../i18n.svelte'
import { invoke, isDesktop } from '../tauri'
import { unmozLz4 } from './mozlz4'
import { readZenSession, type ZenSession } from './zen'

export interface ZenProfile {
  name: string
  path: string
  /** The session files the profile holds, the one to read first in front. */
  files: string[]
}

/** The one Zen opens first in front. None off the desktop or where Zen never ran. */
export async function zenProfiles(): Promise<ZenProfile[]> {
  if (!isDesktop) return []
  try {
    return await invoke<ZenProfile[]>('zen_profiles')
  } catch {
    return []
  }
}

/** The profile's sidebar, out of the first of its files that holds one: Zen's own
 *  file, then its backups, then Firefox's session, which carries the same lists. A
 *  file Zen was halfway through writing is a file to step past, not a refusal. */
export async function zenSession(profile: ZenProfile): Promise<ZenSession> {
  for (const file of profile.files) {
    const session = await invoke<string>('read_zen_file', { profile: profile.path, file })
      .then((said) => sessionIn(fromBase64(said)))
      .catch(() => null)
    if (session) return session
  }

  throw new Error(t('Zen’s tabs could not be read.'))
}

/** What one `.jsonlz4` holds, or null when it holds no sidebar. */
function sessionIn(bytes: Uint8Array): ZenSession | null {
  try {
    return readZenSession(JSON.parse(new TextDecoder().decode(unmozLz4(bytes))))
  } catch {
    return null
  }
}
