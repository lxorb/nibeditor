/** The door the Run button's sandbox comes through.
 *
 *  A fence of JavaScript draws a Run button, and pressing it runs the code in a frame
 *  of its own and prints what it says in a panel under the fence. The button is part
 *  of how the fence is drawn, so it is here from the first frame; the sandbox, the
 *  panels and the protocol between them are thirty-seven kilobytes of source that
 *  nothing needs until somebody presses it, and most notes have no such fence at all.
 *  So every editor that draws buttons carries a compartment that starts empty, and the
 *  first press fetches the runner, puts it into every one of them and then runs.
 *
 *  The same shape as completion.ts and vim.ts; see open-views.ts. A press is answered
 *  either way: the fetch is from beside the page, and the run it was for starts as it
 *  lands. */

import { syntaxTree } from '@codemirror/language'
import { Compartment, type EditorState, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { door } from '@nib/markdown/door'
import { fenceCode, fenceLanguage } from '../fence'
import { enclosingNamed } from '../nodes'
import { openViews } from '../open-views'

/** Fence languages the Run button appears on. Four spellings of the same
 *  language. `ts` is left out because nothing here compiles, and `node` because
 *  a note that says node means `require` and `fs`, which a browser sandbox
 *  cannot honestly offer. */
const RUNNABLE = new Set(['js', 'javascript', 'mjs', 'cjs'])

export function isRunnableLanguage(language: string): boolean {
  return RUNNABLE.has(language.trim().toLowerCase())
}

export interface RunnableFence {
  /** Start of the opening fence's line. */
  from: number
  /** End of the closing fence's line. */
  to: number
  code: string
}

/** The runnable fence the caret is in, if it is in one. Used by Ctrl+Enter;
 *  the Run button already knows which block it belongs to. */
export function runnableFenceAt(state: EditorState, pos: number): RunnableFence | null {
  const node = enclosingNamed(syntaxTree(state).resolveInner(pos, -1), 'FencedCode')
  if (!node || !isRunnableLanguage(fenceLanguage(state, node))) return null

  return {
    from: state.doc.lineAt(node.from).from,
    to: state.doc.lineAt(Math.min(node.to, state.doc.length)).to,
    code: fenceCode(state, node),
  }
}

type Runner = typeof import('./run')

const runs = new Compartment()

let loaded: Runner | null = null

/** Fetches the runner, once, and puts its panels into every editor that draws
 *  buttons. A view in source mode has no compartment to put them in, and the
 *  reconfiguration passes it by. */
const loadRunner = door(() =>
  import('./run').then((module) => {
    loaded = module
    const effects = runs.reconfigure(module.runExtension)
    for (const view of openViews()) view.dispatch({ effects })

    return module
  }),
)

/** What live preview carries in place of the runner: the compartment, empty until
 *  the first press, and the runner itself in an editor built after that. */
export function runExtension(): Extension {
  return runs.of(loaded ? loaded.runExtension : [])
}

/** Starts the code of one fence in a fresh sandbox, replacing whatever that fence was
 *  running before. False when the editor has no panels to show the output in, which is
 *  what source mode looks like from here: the compartment is live preview's. */
export function runFence(view: EditorView, fence: RunnableFence): boolean {
  if (runs.get(view.state) === undefined) return false
  if (loaded) return loaded.runFence(view, fence)

  void loadRunner().then((module) => module.runFence(view, fence))

  return true
}

/** Ctrl+Enter, or Cmd+Enter: run the fence the caret is in. Gives the key back
 *  when the caret is somewhere else, so the default binding still works. */
export function runFenceAtCursor(view: EditorView): boolean {
  const fence = runnableFenceAt(view.state, view.state.selection.main.head)
  if (!fence) return false

  return runFence(view, fence)
}
