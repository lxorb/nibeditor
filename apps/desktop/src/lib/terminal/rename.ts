/** A terminal tab given a name of its own, or given back the one it is called by.
 *
 *  Windows Terminal's rename: the name typed is the tab's until it is cleared, and an
 *  empty one gives the tab back to whatever runs in it (naming.ts). It is kept in the
 *  tab's words (spec.ts), which is what carries it through a restart, Reopen closed tab
 *  and Move to space with no field of its own, and what Open another and a split leave
 *  behind: a new terminal beside a named one is not that one.
 *
 *  Light: the strip's field and the tab's menu fetch it, and nothing of xterm.js is in
 *  it. */

import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'
import { shellName, shells } from './shells.svelte'
import { readSpec, writeSpec } from './spec'

/** The longest name a tab is given: a sentence is not a name, and the strip fades it
 *  long before. */
const NAME_MOST = 120

export async function renameTerminal(tab: Tab, typed: string): Promise<void> {
  const before = readSpec(tab.doc)
  if (tab.kind !== 'terminal' || !before) return

  const name = typed.trim().slice(0, NAME_MOST) || null
  if (name === before.name) return
  const called = name ?? (await shellCalled(before.shell))

  // Read again: the shell may have said another folder while the list was asked for.
  const spec = readSpec(tab.doc) ?? before
  tab.name = called
  tab.note.replace(writeSpec({ ...spec, name }), false)
  workspace.scheduleSession()
}

/** What the tab's shell is called, for a name given back: the shell's own, as a new
 *  terminal of it is named (open.ts), or its id where this machine has it no more. */
async function shellCalled(id: string): Promise<string> {
  const found = (await shells.ask()).find((one) => one.id === id)
  return found ? shellName(found) : id
}
