/** Why an agent's read or edit of a note did not happen, said so it can act on it.
 *
 *  Every answer an agent gets back is read by a model deciding what to do next, so
 *  each refusal is a code it can branch on and a sentence that names what it asked
 *  for: "the heading Plan/Later is in the note 2 times" is something to read again
 *  about, where "invalid anchor" is not. The endpoint turns one of these into the
 *  error the tool call answers with. */

export type Problem =
  /** An anchor that names nothing in the words as they are. */
  | 'not_found'
  /** An anchor that names more than one place; `count` says how many. */
  | 'ambiguous'
  /** `{selection: true}` for a note that is not in front of the reader. */
  | 'no_selection'
  | 'bad_anchor'
  | 'bad_edit'
  /** A part of a note `include` asked for that a read does not have. */
  | 'bad_include'
  /** Two edits of one call that would change the same characters. */
  | 'overlapping'
  /** `if_rev` said which words the edit was for, and they have changed since. */
  | 'rev_changed'
  /** The reader was writing where the edit goes, and once they paused its anchor
   *  was gone. See docs/agent-native.md 8.3. */
  | 'reader_edited_here'
  /** The reader kept writing where the edit goes for longer than an edit waits. */
  | 'reader_typing'
  | 'no_such_note'
  /** A path that is not a markdown note: a canvas, a PDF, a web note. */
  | 'not_a_note'
  | 'no_such_space'

export class DocError extends Error {
  constructor(
    readonly code: Problem,
    /** What the agent asked for that this is about: an anchor, an edit, a path. */
    readonly about: unknown,
    message: string,
    readonly count = 0,
  ) {
    super(message)
    this.name = 'DocError'
  }
}
