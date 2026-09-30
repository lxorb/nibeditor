/** One row of the palette: `run_command` (docs/agent-native.md 5.4).
 *
 *  The registry's own row, run the way `nib commands run` runs it (automation/acts.ts):
 *  a row greyed out is refused, a row only the window's hands may press (`ownWindow`:
 *  a shell) is refused, and so is a row only somebody at the keyboard may press
 *  (`byHand`: the microphone, the camera, signing out), which a link cannot press
 *  either. Past those, three kinds of row are more than an agent's to press alone:
 *
 *  - the rows that put words where somebody else can read them - sharing a space or a
 *    note, publishing a blog - ask the reader first (9.3, publishing and sharing);
 *  - the rows that change a setting ask the same way `write_setting` does (9.3);
 *  - the rows that take the reader somewhere else - another space, another window, a
 *    presentation - move what they are looking at, and need `workspace.focus` (7.2),
 *    with the window itself never an agent's to open, close or quit. */

import { appCommands, type Command } from '../../commands'
import type { AgentAnswer } from '../../automation/caller'
import { views } from '../../views.svelte'
import { workspace } from '../../workspace.svelte'
import type { Category } from '../verbs'
import { asked } from './asks'
import { type Call, done, need, needScope } from './call'
import { Refused } from './problem'
import { placeFor } from './spaces'

/** What asks, by the row's id. */
const ASKS: Record<string, Category> = {
  share: 'publishing',
  'share-note': 'publishing',
  publish: 'publishing',
  'window-frame': 'settings',
  'custom-css': 'settings',
  snippets: 'settings',
  source: 'settings',
  focus: 'settings',
  typewriter: 'settings',
  punctuation: 'settings',
  numbers: 'settings',
  'line-numbers': 'settings',
  rtl: 'settings',
  strict: 'settings',
  'equation-numbers': 'settings',
  wider: 'settings',
  narrower: 'settings',
  looser: 'settings',
  tighter: 'settings',
  'zoom-in': 'settings',
  'zoom-out': 'settings',
  'zoom-reset': 'settings',
}

/** The rows about the window itself, which no agent opens, closes, updates or quits. */
const WINDOW = new Set(['new-window', 'close-window', 'update', 'logs', 'themes-folder'])

/** The rows that take the reader somewhere: another space, a presentation. */
function moves(id: string): boolean {
  return (
    id.startsWith('space:') || ['space-next', 'space-previous', 'present', 'new-space'].includes(id)
  )
}

export async function runCommand(call: Call): Promise<AgentAnswer> {
  // The palette's rows are the space in the window's; an agent that may not reach it
  // has no business pressing them.
  placeFor(call, null)

  const id = need(call, 'id')
  const found: Command | undefined = appCommands(views.of(workspace.panes.focusedId)).find(
    (one) => one.id === id,
  )
  if (!found) throw new Refused('no_such_command', `there is no command called ${id}`)
  if (found.disabled === true) throw new Refused('failed', `${id} cannot run just now`)
  if (found.ownWindow === true || found.byHand === true || WINDOW.has(id)) {
    throw new Refused('by_hand', `${id} is the reader's to press`)
  }
  if (moves(id)) needScope(call, 'workspace.focus', id)

  const category = ASKS[id] ?? null
  const question = await asked(call, category, found.label)
  if (question) return question

  found.run()
  return done({ id, label: found.label })
}
