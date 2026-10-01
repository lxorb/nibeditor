/** Which keys a terminal hands to the app, and which to the shell.
 *
 *  A shell reads nearly every chord there is: Ctrl+W deletes a word, Ctrl+N and Ctrl+P
 *  walk the history, Ctrl+R searches it, Ctrl+T swaps two letters, Ctrl+O runs a line
 *  again, Ctrl+D ends the input. A terminal that let the app have those would be a
 *  terminal nobody could type in. So everything goes to the shell except a short list - the one VS Code
 *  keeps for its workbench, checked against its own `DEFAULT_COMMANDS_TO_SKIP_SHELL`:
 *
 *  - the tab and window keys: Ctrl+T (and its held chooser), Ctrl+Shift+T,
 *    Ctrl+Tab, Ctrl+PageUp and PageDown with and without Shift, the numbered tabs;
 *  - the palette on Ctrl+Shift+P, and on whichever keys a keyboard gives it
 *    instead, the settings on Ctrl+comma, full screen, and the tab filling the window;
 *  - F6 and Shift+F6, which is how a keyboard leaves the terminal for the rest of the
 *    window - Tab cannot be, the shell completes with it;
 *  - the panes, on Ctrl+Alt and an arrow;
 *  - every other app command on Ctrl+Shift, since a terminal cannot tell Ctrl+Shift+E
 *    from Ctrl+E and no shell has one on it - except Ctrl+Shift+W, which is Close
 *    window here and Close tab in every terminal there is: sent to neither, it deletes
 *    a word, which loses nothing;
 *  - on a Mac, every app command on Cmd, which no shell ever sees.
 *
 *  **Ctrl+W goes to the shell** on Windows and Linux, as it does in VS Code, Windows
 *  Terminal and every emulator: a half-typed command losing its whole tab to a word
 *  deleted is the worst trade there is. Cmd+W closes the tab on a Mac.
 *
 *  The terminal's own: copying with Ctrl+Shift+C (Cmd+C on a Mac; Ctrl+C is always the
 *  interrupt), pasting with Ctrl+Shift+V, Shift+Insert, Ctrl+V on Windows as Windows
 *  Terminal does, Cmd+V on a Mac; Ctrl+F to find, as VS Code does; the zoom keys, which
 *  size the terminal's type the way they size a note's; and on a Mac Cmd+A and Cmd+K,
 *  Terminal's own select all and clear.
 *
 *  AltGr is never a chord. Windows says it as Ctrl and Alt, and it is how half of
 *  Europe types `@`, `{` and `\` - so Ctrl and Alt with a key that came out as anything
 *  but its own letter or digit is typing.
 *
 *  Pure: the keystroke, the platform and the app command it matched, if any, which the
 *  caller asks the registry for. See docs/keyboard.md for the list as a reader sees it. */

import type { Platform } from '../keys'

/** Where a keystroke goes. */
export type Route =
  | 'shell'
  | 'app'
  | 'copy'
  | 'paste'
  | 'find'
  | 'select-all'
  | 'clear'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'

/** The keystroke, as much of it as the answer needs. */
export interface Keystroke {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** The app's commands a terminal gives way to on any platform. */
const APP_KEYS = new Set([
  'app.new-kind',
  'app.reopen',
  'app.new-window',
  'app.next-note',
  'app.previous-note',
  'app.next-note.alt',
  'app.previous-note.alt',
  'app.move-tab-left',
  'app.move-tab-right',
  'app.palette',
  'app.palette.alt',
  'app.commands',
  'app.commands.alt',
  'app.settings',
  'app.fullscreen',
  'app.fill-tab',
  'app.region-next',
  'app.region-previous',
])

/** Sent to nobody: see the top of this file. */
const NEITHER = new Set(['app.close-window'])

const ZOOM: Record<string, Route> = {
  'app.zoom-in': 'zoom-in',
  'app.zoom-out': 'zoom-out',
  'app.zoom-reset': 'zoom-reset',
}

/** Where a key pressed in a terminal goes. `command` is the app command the keystroke
 *  matches, if any; `finds` whether it is the find key. */
export function routeKey(
  event: Keystroke,
  platform: Platform,
  command: string | null,
  finds: boolean,
): Route {
  const mac = platform === 'mac'
  const only = (ctrl: boolean, shift: boolean, meta = false) =>
    event.ctrlKey === ctrl && event.shiftKey === shift && event.metaKey === meta && !event.altKey
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

  // AltGr, whatever it types. A letter or a digit that comes out as itself was not
  // typed with AltGr but chorded with Ctrl and Alt: the numbered tabs, a pane.
  if (!mac && event.ctrlKey && event.altKey && /^[^a-z0-9]$/i.test(event.key)) return 'shell'

  if (mac) {
    if (only(false, false, true) && key === 'c') return 'copy'
    if (only(false, false, true) && key === 'v') return 'paste'
    if (only(false, false, true) && key === 'a') return 'select-all'
    if (only(false, false, true) && key === 'k') return 'clear'
  } else {
    if (only(true, true) && key === 'c') return 'copy'
    if (only(true, true) && key === 'v') return 'paste'
    if (only(false, true) && key === 'Insert') return 'paste'
    if (platform === 'win' && only(true, false) && key === 'v') return 'paste'
    if (only(true, true) && key === 'a') return 'select-all'
  }

  if (finds) return 'find'
  if (command === null) return 'shell'

  const zoom = ZOOM[command]
  if (zoom) return zoom
  if (NEITHER.has(command)) return 'shell'
  if (APP_KEYS.has(command) || command.startsWith('app.note-')) return 'app'
  // The panes, on Ctrl+Alt and an arrow: a named key, so never AltGr typing anything.
  if (!mac && event.ctrlKey && event.altKey) return 'app'
  if (mac && event.metaKey) return 'app'
  if (!mac && event.ctrlKey && event.shiftKey) return 'app'

  return 'shell'
}
