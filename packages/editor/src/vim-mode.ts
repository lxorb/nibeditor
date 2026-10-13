/** Everything modal editing needs out of @replit/codemirror-vim, and the only module
 *  that touches the library.
 *
 *  Its own module so that vim.ts - which every editor carries, because the
 *  compartment has to be in the state whether or not anybody uses it - does not carry
 *  the library with it. That is 324 kilobytes of source for a mode that is off unless
 *  somebody turned it on, and it was in front of the app's first paint. vim.ts loads
 *  this the first time modal editing is asked for and puts it into the views that
 *  asked; everything below runs as this module is evaluated, which is exactly when
 *  the library itself arrives.
 *
 *  Why each key is taken back, and what that costs, is vim.ts - the rules are the
 *  app's rather than the library's, and they belong beside the mode rather than
 *  beside the import. */

import { type Extension, Prec } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { CodeMirror, getCM, Vim, vim } from '@replit/codemirror-vim'
import { once } from './once'
import { redoEdit, undoEdit } from './shared'
import { modeOf, vimCommands, vimReport } from './vim'

/** `unmap` is declared as needing a context, and a binding that names none -
 *  which is most of them - is matched by passing none. */
const unmap = Vim.unmap as (keys: string, context?: string) => boolean | undefined

const CONTEXTS = [undefined, 'normal', 'insert', 'visual']

/** Takes a key off Vim's keymap in every mode. A key can be bound more than
 *  once in one mode, and `unmap` answers true while it is still finding one.
 *  Answers whether there was anything there to take. */
function takeBack(keys: string): boolean {
  let found = false
  for (const context of CONTEXTS) {
    while (unmap(keys, context)) found = true
  }

  return found
}

/** Every letter but `q`, which is Vim's own way out of a taken Ctrl chord. */
const CTRL_LETTERS = 'abcdefghijklmnoprstuvwxyz'

/** The Ctrl chords Vim binds that are not letters, and the one that waits for
 *  a register after it, which is a prefix rather than a key. */
const CTRL_OTHERS = ['<C-[>', '<C-Space>', '<C-BS>', '<C-Esc>', '<C-r><register>']

/** The keys that move the caret and nothing else. */
const CARET_KEYS = [
  '<Left>',
  '<Right>',
  '<Up>',
  '<Down>',
  '<Home>',
  '<End>',
  '<PageUp>',
  '<PageDown>',
]

/** Everything Orden keeps for itself, taken off Vim's keymap, and which of them
 *  were actually there. Run once as this module loads, because the keymap is the
 *  library's own table and there is one of it; run again by the test, which is how a
 *  chord the library adds in a later version is caught rather than quietly
 *  swallowing somebody's Ctrl+P.
 *
 *  A key with a name longer than one character that Vim does not answer to is
 *  a key Vim leaves alone entirely - it neither runs anything nor stops the
 *  keystroke - so every one of these arrives at the editor and the app exactly
 *  as it does with modal editing off.
 *
 *  What this costs: the library counts its own keymap from the length it
 *  started at, so `:noremap` and `:mapclear` typed into the command line no
 *  longer work. Neither is much use in an editor with no vimrc to read them
 *  from, and `:map` is unaffected. */
export function takeBackNibKeys(): string[] {
  const taken: string[] = []
  const sweep = (keys: string) => {
    if (takeBack(keys)) taken.push(keys)
  }

  for (const letter of CTRL_LETTERS) sweep(`<C-${letter}>`)
  for (const keys of CTRL_OTHERS) sweep(keys)
  for (const keys of CARET_KEYS) sweep(keys)

  return taken
}

takeBackNibKeys()

/** A paragraph in a prose editor is one long wrapped line, so Vim's own `j`
 *  would jump the whole of it. `gj` moves down the screen instead, which is
 *  what a writer means by down, and it is the line every prose vimrc has in
 *  it. Only in normal and visual mode: an operator matches in Vim's
 *  operator-pending context, so `dj` still deletes two whole lines.
 *
 *  Bound to the motion itself rather than written as `j` standing for `gj`.
 *  A key that stands for another key is expanded through Vim's own keymap,
 *  and the keymap is no longer the one Vim shipped; see takeBackNibKeys. */
function moveByScreenLine(keys: string, forward: boolean, context: string) {
  Vim.mapCommand(keys, 'motion', 'moveByDisplayLines', { forward }, { context })
}

for (const context of ['normal', 'visual']) {
  moveByScreenLine('j', true, context)
  moveByScreenLine('k', false, context)
}

Vim.defineEx('write', 'w', () => vimCommands()?.write())
Vim.defineEx('quit', 'q', () => vimCommands()?.quit())
Vim.defineEx('edit', 'e', () => vimCommands()?.edit())

// `u` and `:undo` go to the document's history rather than the view's. A note
// open in two panes is one note with one history, which lives beside the text
// and not in either view - and a joined view's own history is deliberately
// empty, so Vim asking it would find nothing to undo. See shared.ts.
CodeMirror.commands.undo = (cm) => void undoEdit(cm.cm6)
CodeMirror.commands.redo = (cm) => void redoEdit(cm.cm6)

/** Tells the app which mode its view is in. Its own plugin rather than the
 *  library's status bar, because the bar the app already has is where this
 *  belongs; installed after `vim()` so the adapter it reads exists. */
const modeReporter = ViewPlugin.define((view: EditorView) => {
  const cm = getCM(view)
  const told = () => vimReport()?.(view, modeOf(cm?.state.vim?.mode))

  cm?.on('vim-mode-change', told)
  told()

  return {
    destroy() {
      cm?.off('vim-mode-change', told)
      vimReport()?.(view, null)
    },
  }
})

/** The two things modal editing puts on screen, in Orden's own colours.
 *
 *  The library paints its block cursor pink and its command line in whatever
 *  the browser's default monospace is, neither of which belongs to any theme
 *  here. Written against `.nib-vim`, which the compartment puts on the editor,
 *  so each selector carries one class more than the library's own and wins on
 *  its own terms rather than on the order the stylesheets happen to load in. */
const vimTheme = EditorView.theme({
  // The caret becomes a block over the character it is on, which is how a
  // reader tells normal mode from insert at a glance. The character stays
  // legible: the accent behind it, the page colour on top.
  '&.nib-vim .cm-fat-cursor': {
    background: 'var(--accent)',
    color: 'var(--bg)',
    borderRadius: '1px',
  },
  // An editor nobody is typing in shows the block as an outline, the way an
  // unfocused caret stops blinking.
  '&.nib-vim:not(.cm-focused) .cm-fat-cursor': {
    background: 'none',
    outline: '1px solid var(--accent-line)',
    color: 'inherit',
  },
  // The `:` and `/` line, which is the only chrome modal editing adds.
  '&.nib-vim .cm-vim-panel': {
    padding: '4px var(--space-4)',
    borderTop: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
  },
  '&.nib-vim .cm-vim-panel input': {
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
    caretColor: 'var(--accent)',
  },
})

/** Above every keymap. All of CodeMirror's keymaps are dispatched by one
 *  handler at the default precedence, so this is the only way to say that Vim
 *  reads a keystroke first - and it has to, or Enter in normal mode would
 *  carry a list on instead of moving down a line. What Vim must not read is
 *  settled by the keymap it was left with, above.
 *
 *  Built once, for the same reason the other modes are: turning it on again
 *  when it is already on must not tear the keymap down and build it back. See
 *  once.ts. */
export const modalEditing = once((on: boolean): Extension =>
  on
    ? Prec.high([
        vim(),
        modeReporter,
        vimTheme,
        EditorView.editorAttributes.of({ class: 'nib-vim' }),
      ])
    : [],
)
