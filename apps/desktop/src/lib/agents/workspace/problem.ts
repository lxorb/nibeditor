/** Why an agent's workspace verb did not happen, said so the agent can act on it.
 *
 *  The same idea as the notes' `DocError` (../docs/problem.ts), for everything else in
 *  the workspace: a code a model can branch on, and a sentence naming what it asked
 *  for. Both come back through `answerOf` in the contract's error shape. */

import { type AgentAnswer, refusal } from '../../automation/caller'
import { DocError } from '../docs/problem'
import type { Code as CrateCode } from '../verbs'

export type Code =
  /** A code the crate answered with, passed on as it said it: a page read through the
   *  crate refuses the way every browser verb does (`paused_by_reader`,
   *  `password_field` and the rest), and the audit log files it by that word. */
  | CrateCode
  /** The call's arguments do not say what they need to. */
  | 'bad_arguments'
  /** A scope the grant does not hold, beyond the one the verb's row checked. */
  | 'not_granted'
  /** A space that is not there, or that this agent may not reach; the two are one
   *  answer, because a space the grant does not reach does not exist to it (9.6). */
  | 'no_such_space'
  /** No note, file or folder at that path. */
  | 'no_such_file'
  /** Something is already there, and nothing is ever written over. */
  | 'exists'
  /** Archived, and so kept: nothing archived is deleted or moved away. */
  | 'archived'
  /** A space shared with this account to read. */
  | 'read_only'
  /** No tab with that id. */
  | 'no_such_tab'
  /** Something only the reader's own hands may do. */
  | 'by_hand'
  /** What it names is in a space the reader is not in, and doing it would move them. */
  | 'other_space'
  /** The words changed since the agent read them (`if_rev`). */
  | 'rev_changed'
  | 'no_such_command'
  | 'no_such_setting'
  | 'no_such_version'
  | 'not_found'
  | 'unsupported_on_this_engine'
  | 'timeout'
  | 'failed'

export class Refused extends Error {
  constructor(
    readonly code: Code,
    message: string,
  ) {
    super(message)
    this.name = 'Refused'
  }
}

/** Anything a verb threw, as the answer it is. */
export function answerOf(error: unknown): AgentAnswer {
  if (error instanceof Refused || error instanceof DocError) {
    return refusal(error.code, error.message)
  }

  return refusal('failed', error instanceof Error ? error.message : String(error))
}
