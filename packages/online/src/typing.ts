/** Who may type in an online terminal (docs/online-terminal.md 4.6, the table).
 *
 *  Typing in a session is typing on somebody's machine, where whoever types can read
 *  every file - a coding agent's login included. So it is the machine's owner's alone
 *  unless they switch `typing` to `writers`, and even then never a link guest's: a
 *  person with no account typing on a machine is a person nobody can hold to the
 *  terms. Reading is the space's business and is decided before a socket gets here. */

import type { SpaceRole, Typing } from './types'

/** Whether a socket may type, paste and resize. `role` is the person's in the space
 *  the `.term` is in (a guest's is the link's), null for none. */
export function mayType(
  role: SpaceRole | null,
  guest: boolean,
  ownsMachine: boolean,
  typing: Typing,
): boolean {
  if (guest) return false
  if (ownsMachine) return true
  return typing === 'writers' && (role === 'write' || role === 'owner')
}
