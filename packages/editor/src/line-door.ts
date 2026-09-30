/** The line, case and grow-the-selection commands, fetched rather than carried.
 *
 *  Deleting, joining, sorting and reversing lines, a line above, the three cases, the
 *  selection a step outwards and back, a block duplicated or moved from a key, and the
 *  link an address pasted over words makes: twenty-two kilobytes of source that a window has no use for until somebody
 *  presses one of them, and most of them have no key at all. So they are not in front
 *  of the first paint. The app asks for them at the
 *  launch's last turn - see `warmDoors` in the app - and a key pressed before that
 *  runs its command as soon as it lands, which is the next few milliseconds.
 *
 *  The keys are bound from the first frame either way, and each spends its press
 *  whether the commands are here or not: a key that returned false would fall through
 *  to whatever is bound under it. The same shape as find.ts, which is the door the
 *  search engine comes through. */

import { door as fetched } from '@nib/markdown/door'

type Commands = typeof import('./line-commands')

let loaded: Commands | null = null

/** Fetches the commands, once. The promise is kept, so every caller after the first
 *  is answered by the same fetch, unless it failed; see door.ts in @nib/markdown. */
export const loadLineCommands: () => Promise<Commands> = fetched(() =>
  import('./line-commands').then((module) => (loaded = module)),
)

/** One of them, run now if it is here and as it lands if not. Handed the target
 *  itself rather than its state, so a command that runs a moment late reads the
 *  editor as it is then: a view's `state` is always the current one.
 *
 *  Whatever the command takes, the door takes: a state and a dispatch for the line
 *  commands, the view itself for the block ones, which scroll and focus it. */
function door<Target>(
  pick: (commands: Commands) => (target: Target) => boolean,
): (target: Target) => boolean {
  return (target) => {
    if (loaded) return pick(loaded)(target)
    void loadLineCommands().then((commands) => pick(commands)(target))

    return true
  }
}

export const deleteLine = door((commands) => commands.deleteLine)
export const joinLines = door((commands) => commands.joinLines)
export const sortLines = door((commands) => commands.sortLines)
export const reverseLines = door((commands) => commands.reverseLines)
export const insertLineAbove = door((commands) => commands.insertLineAbove)
export const upperCase = door((commands) => commands.upperCase)
export const lowerCase = door((commands) => commands.lowerCase)
export const titleCase = door((commands) => commands.titleCase)
export const expandSelection = door((commands) => commands.expandSelection)
export const shrinkSelection = door((commands) => commands.shrinkSelection)
export const duplicateBlock = door((commands) => commands.duplicateBlock)
export const moveBlockUp = door((commands) => commands.moveBlockUp)
export const moveBlockDown = door((commands) => commands.moveBlockDown)
