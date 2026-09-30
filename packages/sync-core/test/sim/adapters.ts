/** Where real code plugs into the simulator.
 *
 *  The simulator drives an account and some devices and then judges what they hold.
 *  It knows them only through these two interfaces, so the reference implementations
 *  in this folder (built from nothing but this package's rules) and the real ones -
 *  the Worker's routes and rooms, lane `sync-server-docs`, and the app's engine, lane
 *  `sync-client-engine` - are interchangeable: an adapter wraps the real thing, and the
 *  same seeds and the same checks run against it.
 *
 *  Requests travel as bytes in the package's own envelope (`frame` in wire.ts), so an
 *  adapter over the Worker hands them to its routes unchanged. */

import type { Times } from '../../src/diverge'
import type { EntryKind } from '../../src/wire'

/** The routes a device reaches, section 7 of docs/sync-v2.md. `feed` carries `{ since }`
 *  in its body rather than a query string, so every route is one shape. */
export type Route = 'ops' | 'feed' | 'pull' | 'push' | 'keep'

/** One entry of a tree as the checks compare it. */
export interface EntryView {
  id: string
  kind: EntryKind
  parent: string | null
  name: string
}

/** What a side holds: its live tree, and the text of every live note in it. A device
 *  also lists the text of any note it holds words for that its tree no longer shows
 *  (deleted elsewhere, with this device's edits still to send), so the checks can
 *  follow those words; the comparison with the account reads only the account's ids. */
export interface View {
  entries: EntryView[]
  texts: Record<string, string>
}

export interface AccountView extends View {
  /** Every text the account keeps as a version: the losing sides of answers and of
   *  minor overlaps. */
  versions: string[]
}

/** The account as the simulator reaches it: one call per request that arrives, bytes
 *  in and bytes out. The network decides whether a request arrives at all and whether
 *  its answer gets back. */
export interface AccountAdapter {
  handle(device: string, route: Route, body: Uint8Array): Promise<Uint8Array>
  view(): Promise<AccountView>
}

/** How a device sends a request: the answer, or null when it never came. */
export type Link = (route: Route, body: Uint8Array) => Promise<Uint8Array | null>

/** Which of a device's things an action means: a fraction into its list of live notes
 *  (or folders), sorted by id, so one action means something on any device. */
export type Pick = number

/** What a person does on a device. Every piece of text the simulator hands a device
 *  carries marker words, so the checks can follow each one to where it ends up. */
export type Action =
  | { t: 'type'; note: Pick; at: number; words: string }
  | { t: 'cut'; note: Pick; at: number; length: number }
  | { t: 'drop-paragraph'; note: Pick; at: number }
  | { t: 'create'; folder: Pick | null; name: string; words: string }
  | { t: 'mkdir'; folder: Pick | null; name: string }
  | { t: 'rename'; target: Pick; name: string }
  | { t: 'move'; target: Pick; folder: Pick | null }
  | { t: 'delete'; target: Pick }
  | { t: 'append-day'; name: string; words: string }
  | { t: 'edit-file'; note: Pick; at: number; words: string; cut: number }
  | { t: 'save' }

/** A note a device is holding for its person to answer (section 5.4). */
export interface Held {
  id: string
  base: string
  local: string
  remote: string
  times: Times
}

/** One time a device classified a merge, and whether it held the note. The checks run
 *  the classifier again and hold the device to it: the modal exactly when `diverge`
 *  says so. */
export interface Classification {
  id: string
  base: string
  local: string
  remote: string
  times: Times
  merged?: string
  held: boolean
}

export type Answer = 'mine' | 'theirs' | 'both'

export interface DeviceAdapter {
  readonly id: string
  /** Whether it is running: not quit, not crashed. */
  readonly running: boolean
  act(action: Action): Promise<void>
  /** One pass: whatever it has to send and to fetch, over `link`. */
  pass(link: Link): Promise<void>
  held(): readonly Held[]
  answer(id: string, choice: Answer): Promise<void>
  /** Quits cleanly: everything written down. */
  quit(): Promise<void>
  /** Stops at once: everything not in its store is gone. */
  crash(): Promise<void>
  launch(): Promise<void>
  view(): Promise<View>
  /** Every classification since the last time this was asked. */
  classified(): Classification[]
}
