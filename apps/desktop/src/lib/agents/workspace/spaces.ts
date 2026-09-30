/** Which space an agent's verb is about, answered without ever switching to it.
 *
 *  The command line switches to a space it names, "because the result has to be
 *  visible" (docs/automation.md), and it keeps doing so. An agent working while the
 *  reader writes in another space must not change the reader's screen, so an agent's
 *  verbs read and write a space where it is: the space in the window is answered from
 *  what the window already holds, and any other one from the disk and the crate, with
 *  nothing in the window moved. See docs/agent-native.md 8.6.
 *
 *  And a space the grant does not reach does not exist: it is absent from every list
 *  and every lookup of it fails exactly as a name nobody has would (9.6). */

import { insideOnly } from '../../automation/inside'
import { isShared } from '../../sharing.svelte'
import { insideSpace } from '../../space-paths'
import { type Space, workspace } from '../../workspace.svelte'
import type { Call } from './call'
import { Refused } from './problem'

/** A space as a verb works in it. */
export interface Place {
  space: Space
  /** Whether it is the space in the window, whose tree, index and tabs are live. */
  open: boolean
}

/** Whether the caller may reach this space. The reader reaches every one. */
function reaches(call: Call, space: Space): boolean {
  const agent = call.caller.agent
  return agent === null || agent.spaces === 'all' || agent.spaces.includes(space.name)
}

/** The spaces the caller may reach, in the switcher's order. */
export function reachable(call: Call): Space[] {
  return workspace.spaces.filter((space) => reaches(call, space))
}

/** The space a verb names by id or name, or the one in the window when it names none.
 *  Never switches: the answer says whether it is the one open, and the verb decides
 *  what that means for it. */
export function placeFor(call: Call, named: string | null): Place {
  const open = workspace.activeSpace

  if (named === null) {
    if (!open) throw new Refused('no_such_space', 'there is no space open: say which space')
    if (!reaches(call, open)) {
      throw new Refused('no_such_space', 'say which space: list_spaces names the ones you reach')
    }
    return { space: open, open: true }
  }

  const folded = named.trim().toLowerCase()
  const found = reachable(call).find((one) => one.id === named || one.name.toLowerCase() === folded)
  if (!found) throw new Refused('no_such_space', `there is no space called ${named}`)

  return { space: found, open: found.id === open?.id }
}

/** A path an agent named, judged the way every path from outside the app is: relative,
 *  no `..`, nothing a file name cannot hold. See automation/inside.ts. */
export function judged(asked: string): string {
  const safe = insideOnly(asked)
  if (safe === null) throw new Refused('bad_arguments', `${asked} is not a path inside the space`)

  return safe
}

/** The same, for a path the verb is about to change: nothing under a folder whose name
 *  starts with a dot either, which is where a space keeps what is not the reader's
 *  writing (a tool's settings, a repository), and what the file list does not show. */
export function judgedForWriting(asked: string): string {
  const safe = judged(asked)
  if (safe.split('/').some((step) => step.startsWith('.'))) {
    throw new Refused('bad_arguments', `${asked} is hidden, and an agent leaves it alone`)
  }

  return safe
}

/** Where the words of a place came from when somebody else can write them too: a
 *  space shared with others, whose notes an agent reads as data and never as what to
 *  do (docs/agent-native.md 9.6). Null for the reader's own. */
export function sharedSource(place: Place): string | null {
  return isShared(place.space.root) ? `shared space ${place.space.name}` : null
}

/** Where a path of a place is on this disk. */
export function onDisk(place: Place, relative: string): string {
  return insideSpace(place.space.root, relative)
}
