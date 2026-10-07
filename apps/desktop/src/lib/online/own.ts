/** The session an online terminal's file names in its words (docs/online-terminal.md 4.5).
 *
 *  On a device with no file id the account knows - one on sync v1 - the words are the
 *  name: the session they say, or a new one of the asker's own, made now and written into
 *  them, so a restart and the asker's other devices find the same. The session's own id
 *  names its socket.
 *
 *  On v2 the file's id names it, and the words only say which session the file had: the
 *  account adopts one its owner made on v1 rather than making another beside it, and the
 *  words are brought up to the session it answers. */

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

/** The session the words name, for the account to adopt; none for words that name none. */
export function namedSession(words: string | null): string | undefined {
  return termOf(words ?? '')?.session
}

/** The words a file is written with so that it names `term`, or null where it already
 *  does, or could not be read and so is left as it is. */
export function wordsFor(words: string | null, term: Term): string | null {
  return words === null || namedSession(words) === term.session ? null : termText(term)
}
