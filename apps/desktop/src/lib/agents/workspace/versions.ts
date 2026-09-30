/** A note's versions: `list_versions` and `restore_version` (docs/agent-native.md 5.3,
 *  8.5).
 *
 *  The versions sheet's own list (lib/versions.ts): this device's and the account's,
 *  newest first, each saying who it was kept for. Putting one back asks the reader
 *  first, since it replaces what the note says now (9.3, deleting for good), and is then
 *  a write like any other of an agent's: the words it replaces are kept as a version
 *  of their own first, and it lands as the smallest edit, one step the reader can undo,
 *  around whatever they are typing. */

import type { AgentAnswer } from '../../automation/caller'
import { invoke } from '../../tauri'
import { type Version, versionsOf, versionText } from '../../versions'
import { workspace } from '../../workspace.svelte'
import { notes } from '../docs'
import { asked } from './asks'
import { type Call, done, maybe, need, writerOf } from './call'
import { Refused } from './problem'
import { judged, onDisk, type Place, placeFor, sharedSource } from './spaces'
import { nameOf } from '../../space-paths'

/** A version's name as an agent hands it back: where it is kept and when. */
function idOf(version: Version): string {
  return `${version.path === null ? 'account' : 'device'}:${version.at}`
}

function noteOf(call: Call): { place: Place; relative: string; path: string } {
  const place = placeFor(call, maybe(call, 'space'))
  const asked = judged(need(call, 'path'))
  const relative = nameOf(asked).includes('.') ? asked : `${asked}.md`
  return { place, relative, path: onDisk(place, relative) }
}

export async function listVersions(call: Call): Promise<AgentAnswer> {
  const { place, path } = noteOf(call)
  const versions = await versionsOf(path)

  return done(
    versions.map((one) => ({
      version: idOf(one),
      at: new Date(one.at).toISOString(),
      size: one.size,
      by: one.by || (one.path === null ? 'account' : 'this device'),
    })),
    sharedSource(place),
  )
}

export async function restoreVersion(call: Call): Promise<AgentAnswer> {
  const { place, relative, path } = noteOf(call)
  const wanted = need(call, 'version')
  const version = (await versionsOf(path)).find((one) => idOf(one) === wanted)
  if (!version) {
    throw new Refused('no_such_version', `${relative} has no version ${wanted}: list_versions`)
  }

  const words = await versionText(version, path)
  const now = await workspace.noteText(path)
  if (now === null) throw new Refused('no_such_file', `there is no note at ${relative}`)

  const when = new Date(version.at).toISOString().slice(0, 16).replace('T', ' ')
  const question = await asked(call, 'deleting', `Put back ${relative} as it was at ${when}`)
  if (question) return question

  // The words about to be replaced, kept first and said to be the agent's doing.
  const agent = call.caller.agent
  await invoke('snapshot_note', { path, content: now, source: agent?.name }).catch(() => undefined)

  const wrote = await notes.writeNote(
    writerOf(call),
    { path: relative, space: place.space.id },
    words,
  )
  return done({ ...wrote, restored: wanted })
}
