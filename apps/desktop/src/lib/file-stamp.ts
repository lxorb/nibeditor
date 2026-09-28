/** When a file was last written and how long it is, or null where there is no
 *  file to stamp.
 *
 *  Its own module because two stores ask and they had two answers to what comes
 *  back. The crate answers an object - see `file_stamp` in src-tauri/src/notes.rs -
 *  and the watcher checked for one, while sync typed the same answer as a bare
 *  number and compared it with a time. A number is never greater than an object,
 *  so under the `newest` rule the copy on this machine won every conflict however
 *  much later the other had been written. The shape is checked here, once, and
 *  everything that asks gets a stamp or nothing. */

import { isNumber, isRecord } from './stored'
import { invoke } from './tauri'

export interface Stamp {
  /** Milliseconds since the epoch, as `Date.now()` counts them. */
  modified: number
  /** How many bytes the file holds. */
  len: number
}

function isStamp(value: unknown): value is Stamp {
  return isRecord(value) && isNumber(value.modified) && isNumber(value.len)
}

/** The file's stamp. A file that is not there, a platform that keeps no stamps -
 *  the browser answers null - and a question that failed are all the same answer:
 *  nothing is known about the file. */
export async function fileStamp(path: string): Promise<Stamp | null> {
  const answer: unknown = await invoke('file_stamp', { path }).catch(() => null)
  return isStamp(answer) ? answer : null
}
