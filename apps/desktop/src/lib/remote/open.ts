/** Making a remote terminal: an ordinary terminal tab whose shell is a host, `ssh:pi`,
 *  so the strip, the session, a restart, Reopen closed tab, Duplicate and Move to space
 *  carry it exactly as they carry a local one. See terminal/spec.ts and
 *  docs/terminal.md, _Another machine_.
 *
 *  And which of them connects by itself: one made in this run does, as it opens; one a
 *  restart put back waits for a press on Reconnect, since a window that comes back
 *  should not knock on ten machines before anybody has looked at it. Light: nothing of
 *  xterm.js is here. */

import { identifier } from '../identifier'
import { hostShell, writeSpec } from '../terminal/spec'
import { workspace } from '../workspace.svelte'
import { type Destination, hostFor } from './hosts'
import { remote } from './hosts.svelte'

/** The keys of the remote terminals made in this run, which connect as they open. */
const made = new Set<string>()

/** Whether a terminal under this key was made in this run; see the top of this file. */
export function madeNow(key: string): boolean {
  return made.has(key)
}

/** Noted as made in this run: a duplicate given a key of its own, a split. */
export function markMade(key: string): void {
  made.add(key)
}

interface Where {
  /** The tab it goes beside, rather than at the end of the strip. */
  beside?: string
}

/** A terminal on the host an id names, in the pane that has the keyboard, named for
 *  the host. */
export async function openRemote(id: string, where: Where = {}): Promise<void> {
  await remote.ready()
  const host = remote.byId(id)
  if (!host) return

  const key = identifier()
  made.add(key)
  remote.connected(id)
  const text = writeSpec({ shell: hostShell(id), folder: null, key, name: null })
  workspace.openUnsaved('terminal', text, host.name, where.beside ?? null)
}

/** A terminal on a destination typed: the host it already is, or a host made of it and
 *  kept, as a browser keeps an address typed in its history. */
export async function connectTo(wanted: Destination): Promise<void> {
  await remote.refresh()
  const host = hostFor(remote.hosts, wanted) ?? (await remote.make(wanted))
  if (host) await openRemote(host.id)
}
