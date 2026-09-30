import { invoke } from '../tauri'

/** Writes a note that came from elsewhere, keeping whatever the file said before
 *  it as a version first.
 *
 *  Saving keeps a version of the words it is about to replace; this is the other
 *  half of that. Words arriving from the account replace a file just as thoroughly
 *  as a save does, and they were the one overwrite that left nothing behind - so a
 *  note another device got wrong, or a conflict settled the wrong way round, was
 *  recoverable from every device except the one it landed on. Both platforms keep
 *  these the way a save's are kept, so they are in the same version history and the
 *  same sheet puts them back; see recovery.svelte.ts.
 *
 *  `was` is the body the caller has already read, when it has one. Anything else is
 *  read here, because a version of what is being replaced is the whole point: the
 *  conflict copies are written to a name that is usually free, and a second
 *  conflict in one day would otherwise land on the first without a word.
 *
 *  Nothing is kept for a file that is new, that says nothing, or that already says
 *  exactly this. Both platforms drop a version that repeats the one before it
 *  anyway; this saves them the round trip.
 *
 *  Its own file because three things write words from elsewhere: a pass
 *  (sync/pass.ts), a room settling two copies (rooms/apart.ts), and the answer to a
 *  clash somebody was asked about (sync/record.svelte.ts). */
export async function writeDown(path: string, content: string, was?: string | null) {
  const previous =
    was === undefined ? await invoke<string>('read_note', { path }).catch(() => null) : was

  if (previous !== null && previous !== content && previous.trim()) {
    await invoke('snapshot_note', { path, content: previous }).catch(() => undefined)
  }

  await invoke('write_note', { path, content })
}
