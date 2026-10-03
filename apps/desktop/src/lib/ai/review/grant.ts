/** Ask before edits, or apply and review (docs/ai-sidebar.md 4.4): the one choice the
 *  sidebar makes about its agent, which is its built-in grant's mode. `confirm` makes
 *  every write ask first, with the change it would make (Asked.svelte); the other
 *  lets writes land and puts them on the changes bar. The same switch as Settings >
 *  Agents' own, written the way that pane writes: read, the one grant changed, the
 *  whole list written back. */

import { tauriCrate } from '../../agents/settings/crate'
import { withMode } from '../../agents/settings/grant'
import { agentOf } from './changes'

/** Whether a provider's agent asks before every edit. */
export async function askFirst(provider: string): Promise<boolean> {
  const grants = await tauriCrate.read()
  return grants.find((one) => one.id === agentOf(provider))?.mode === 'confirm'
}

/** Sets it. False where the agent has no grant yet: one is made, with the default
 *  (lib/ai/chat/choices.ts), the first time a thread on that provider sends. */
export async function setAskFirst(provider: string, on: boolean): Promise<boolean> {
  const id = agentOf(provider)
  const grants = await tauriCrate.read()
  if (!grants.some((one) => one.id === id)) return false
  await tauriCrate.write(grants.map((one) => (one.id === id ? withMode(one, on) : one)))
  return true
}
