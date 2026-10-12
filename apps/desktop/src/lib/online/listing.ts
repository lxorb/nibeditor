/** A session on the account's machine as a row of Settings › Online terminal: what it is
 *  called, what is said under that, which file Open opens, and what End is said with
 *  (docs/online-terminal.md 4.10).
 *
 *  Called as its tab would be, by the same order (lib/terminal/naming.ts): the title the
 *  program in front set, the program, the file's name, and `Terminal` for a session no
 *  file names any more. Under it the file's name where the row is not already called by
 *  it, and when the session last printed, or else when it was made. Pure. */

import { nameOf } from '../space-paths'
import { programTitle } from '../terminal/naming'
import type { Listed } from './calls'
import { termName } from './path'

export interface SessionRow {
  /** The session's own id: one row each. */
  key: string
  /** Null for a session nothing names: the pane says `Terminal`. */
  name: string | null
  /** The file's name, where the row is called something else. */
  file: string | null
  /** When it last printed, or was made; null where neither is known. */
  at: number | null
  /** What the account said of it. */
  listed: Listed
}

export function rowOf(one: Listed): SessionRow {
  const file = one.path === null ? null : termName(nameOf(one.path))
  const title = one.program !== null && one.title !== null ? programTitle(one.title) : null
  const name = title ?? one.program ?? file
  return {
    key: one.session,
    name,
    file: file !== null && file !== name ? file : null,
    at: one.at ?? one.createdAt,
    listed: one,
  }
}

/** The rows, the one that printed last first; a session nobody heard from since the
 *  machine started after those that printed, newest made first. */
export function rowsOf(listed: readonly Listed[]): SessionRow[] {
  const heard = (one: Listed) => one.at ?? -1
  return [...listed]
    .sort((a, b) => heard(b) - heard(a) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .map(rowOf)
}

/** Whether Open has somewhere to go: a file that names the session, not in the trash. */
export function opens(one: Listed): boolean {
  return one.term !== null && one.path !== null && !one.trashed
}
