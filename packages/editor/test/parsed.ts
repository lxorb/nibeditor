import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

/** A state whose syntax tree covers the whole document.
 *
 *  Creating a state parses for twenty milliseconds and no longer; what is not
 *  parsed by then arrives later, in the editor's idle time. A test has no
 *  idle time, and a cold worker on a busy machine can miss the budget on a
 *  few lines, so it would read a partial tree and fail for no reason of its
 *  own. This parses to the end, or to `upTo`, and hands back a state that holds that
 *  tree. */
export function parsed(state: EditorState, upTo = state.doc.length): EditorState {
  ensureSyntaxTree(state, upTo, 10_000)
  return state.update({}).state
}
