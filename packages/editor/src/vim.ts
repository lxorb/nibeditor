/** Modal editing, through @replit/codemirror-vim.
 *
 *  A compartment like every other mode, so it goes on and off while the editor
 *  is open; what is particular to this one is that Vim wants the whole
 *  keyboard, and the keyboard is already spoken for. Two rules settle that,
 *  and both of them are Nib's rules rather than Vim's:
 *
 *  Every chord held with Ctrl or Cmd belongs to the app. Ctrl+P still opens
 *  the palette in normal mode and Ctrl+B still bolds, which is what makes
 *  modal editing something a reader can turn on without learning the app
 *  again. Vim's own answer to a taken Ctrl chord is Ctrl+Q - it exists
 *  because a terminal eats Ctrl+V - so that one is left alone and visual
 *  block lives there.
 *
 *  And the caret keys belong to the text, which is what the shortcut list has
 *  said about them all along. So an arrow key still walks into a rendered
 *  table and still steps off a selected picture, in normal mode as in insert.
 *  Backspace and Delete are not caret keys and stay Vim's: in normal mode
 *  they are motions there, and an edit would be a surprise.
 *
 *  Both rules are kept by taking the keys off Vim's own keymap once, in
 *  vim-mode.ts, rather than by racing it for them. A key Vim does not answer to is
 *  a key Vim does not swallow, and everything underneath sees it exactly as it does
 *  with modal editing off.
 *
 *  This module is what every editor carries: the compartment has to be in the state
 *  whether or not anybody uses the mode. The library is not - it is vim-mode.ts,
 *  loaded the first time modal editing is asked for, because it is 324 kilobytes for
 *  a mode that is off unless somebody turned it on and the alternative is paying for
 *  it before the window is on screen.
 *
 *  Which is the shape every lazy extension in this package has: an empty compartment, a
 *  fetch, and a transaction per open editor when it lands. The list of open editors is
 *  open-views.ts, shared with the completion menus. */

import { Compartment, type StateEffect } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { door } from '@nib/markdown/door'
import { enrolled, openViews } from './open-views'
import { flushTableEdits } from './table/widget'

export type VimMode = 'normal' | 'insert' | 'visual' | 'replace'

/** What `:w`, `:q` and `:e` do. All three act on the app around the editor -
 *  a note, a tab, the palette - which this package knows nothing about, so the
 *  app says what they mean, the way it hands over its labels. */
export interface VimCommands {
  write(): void
  quit(): void
  edit(): void
}

let commands: VimCommands | null = null

export function setVimCommands(next: VimCommands) {
  commands = next
}

/** What `:w`, `:q` and `:e` were told to mean. Read by vim-mode.ts, which is where
 *  they are bound - the app hands them over long before the library is here. */
export function vimCommands(): VimCommands | null {
  return commands
}

/** Told the mode a view is in whenever it changes, and null when that view
 *  leaves modal editing behind. The app shows it in the status bar. */
export type VimReport = (view: EditorView, mode: VimMode | null) => void

let report: VimReport | null = null

export function onVimMode(next: VimReport) {
  report = next
}

export function vimReport(): VimReport | null {
  return report
}

/** The mode as a word, from what the plugin has just written down. Vim names
 *  a visual submode in the same string - `visual line` - and the label has
 *  room for one word. */
export function modeOf(mode: string | undefined): VimMode {
  const first = (mode ?? '').split(' ')[0]
  if (first === 'insert' || first === 'visual' || first === 'replace') return first
  return 'normal'
}

const modal = new Compartment()

/** The library, once it is here. */
let loaded: typeof import('./vim-mode') | null = null

/** Whether modal editing is wanted. One answer for the whole app rather than one per
 *  view, because that is what the setting is: the app turns it on and applies it to
 *  every editor open. What it is for is the moment the library lands - the views that
 *  asked for the mode before it was here are every view, and this says whether they
 *  still want it. */
let wanted = false

/** Fetches the library, and turns the mode on in whatever is open if it is still
 *  wanted by the time it arrives. Idempotent.
 *
 *  Exported for the tests, which turn the mode on and then read the state in the same
 *  breath: in the app the reader has pressed a key or opened the settings, and a
 *  keymap that lands in the next frame is a keymap that landed at once. */
export const loadVim: () => Promise<void> = door(async () => {
  loaded = await import('./vim-mode')
  if (!wanted) return

  for (const view of openViews()) view.dispatch({ effects: vimEffect(true) })
})

export function vimExtensions() {
  return [modal.of([]), enrolled]
}

/** Modal editing as an effect, so a pane taking another note on can put it in
 *  the same transaction as everything else it changes.
 *
 *  Turning it on with the library still on its way reconfigures to nothing and starts
 *  the fetch; `loadVim` puts it into every open view when it lands. */
export function vimEffect(on: boolean): StateEffect<unknown> {
  wanted = on
  if (on && !loaded) void loadVim()

  return modal.reconfigure(on && loaded ? loaded.modalEditing(true) : [])
}

/** Modal editing on or off, in a view that is already open. */
export function setVim(view: EditorView, on: boolean) {
  // A cell may be holding an edit that has not reached the document yet, and
  // the keyboard is about to mean something else.
  flushTableEdits()
  view.dispatch({ effects: vimEffect(on) })
}
