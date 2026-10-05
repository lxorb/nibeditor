/** The session an online terminal's file names on a device with no file id the account
 *  knows - one on sync v1 (docs/online-terminal.md 4.5): the session its words say, or a
 *  new one of the asker's own, made now and written into it, so a restart and the asker's
 *  other devices find the same. The session's own id names its socket. */

import type { Term } from '@nib/online'
import { termOf, termText } from '@nib/online/term'

/** What it reads and writes: the file's words, and the account's new session. */
export interface OwnFile {
  read(): Promise<string | null>
  write(text: string): Promise<void>
  make(): Promise<Term>
}

/** The session's id, for the socket. A refusal to make one is thrown as the account
 *  gave it. */
export async function ownSession(file: OwnFile): Promise<string> {
  const said = termOf((await file.read()) ?? '')
  if (said) return said.session
  const made = await file.make()
  await file.write(termText(made))
  return made.session
}
