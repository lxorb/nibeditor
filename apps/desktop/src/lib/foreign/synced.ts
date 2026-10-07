/** Another sync tool's copies the account already holds: carried before nib knew to
 *  leave them alone, and on every device since (Emil's seven `(# Name clash … #)`
 *  copies, 2026-10-05).
 *
 *  Nothing takes them off the account by itself. Which of two files is the stray is a
 *  person's call, and a delete on the account reaches every device; so the Sync pane
 *  counts them and offers one press, and that press is the whole of it. What it does
 *  is the account's ordinary delete - Recently deleted, restorable for its days - and
 *  neither engine takes another tool's copy off a disk when the account lets go of one
 *  (`inForeignCopy` in sync/pass.ts, `settle` in sync2/places.ts), so every file stays
 *  exactly where it is. See docs/sync.md "Other sync tools". */

import { inForeignCopy } from '@nib/sync-core/foreign'
import { account } from '../account.svelte'
import { api, ApiError } from '../api'
import { log } from '../log'
import { stored } from '../stored'
import { savedMirrors } from '../sync/saved'
import { STORAGE_KEY, sync } from '../sync.svelte'
import type { Engine, ForeignCopies } from '../sync2/asking.svelte'

/** The copies the account holds, as one engine or the other knows them. */
export interface Synced {
  count: number
  /** Takes them off the account. */
  remove(): Promise<void>
}

/** Under v2, the copies in the engine's tree; under v1, the notes the mirrors track. */
export function syncedCopies(engine: Engine | null): Synced {
  if (!engine) return fromMirrors()
  if (!engine.copies) return { count: 0, remove: () => Promise.resolve() }
  return fromTree(engine.copies)
}

function fromTree(engine: ForeignCopies): Synced {
  return {
    count: engine.foreignCopies().length,
    remove: async () => {
      await engine.unsync()
      sync.nudge()
    },
  }
}

function fromMirrors(): Synced {
  const ids = savedMirrors(stored(STORAGE_KEY), account.user?.id ?? null).flatMap((mirror) =>
    Object.entries(mirror.notes).flatMap(([path, one]) => (inForeignCopy(path) ? [one.id] : [])),
  )
  return {
    count: ids.length,
    remove: async () => {
      const token = account.accountToken
      if (!token) return
      for (const id of ids) await deleted(token, id)
      // The pull that follows hears each delete and forgets the note, file left alone.
      sync.nudge()
    },
  }
}

/** One note off the account; one it no longer has, or will not let go, is no reason to
 *  stop the rest. */
async function deleted(token: string, id: string) {
  try {
    await api.deleteNote(token, id)
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return
    log('warn', `sync: a conflict copy ${id} stayed on the account - ${String(error)}`)
  }
}
