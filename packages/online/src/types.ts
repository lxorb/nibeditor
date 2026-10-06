/** The shapes the online terminal's lanes meet at (docs/online-terminal.md, 6.1).
 *
 *  The app, the Worker's `Machine` and the machine's own `nibd` are three programs by
 *  three lanes, and each reads what the others write. So every shape they share is
 *  spelled once, here, and the rules over them - `awake`, `sizeOf`, `mayType` - are
 *  pure functions beside it, so the Worker decides and the app shows by the same code. */

/** Where a machine is in its day: asleep costs only storage; starting is the 1-3 s a
 *  cold start takes; awake is billed; stopping is the save and snapshot on the way
 *  down (4.4). */
export type MachineState = 'asleep' | 'starting' | 'awake' | 'stopping'

/** Who may type in a terminal besides the machine's owner: nobody (the default), or
 *  the space's writers (4.6). Only the machine's owner changes it. */
export type Typing = 'owner' | 'writers'

/** What a `.term` file holds: the machine and the session on it this document names
 *  (4.5). The server keys access by the file's id and its space, never by these. */
export interface Term {
  v: 1
  machine: string
  session: string
}

/** The filesystem the home is on: bytes used and its size. What fills it is what froze
 *  a machine on 2026-10-06, so it is said every 30 seconds, cheaply (`statfs`). */
export interface Disk {
  used: number
  total: number
}

/** What `nibd` says every 30 seconds about the last stretch (4.4): when, how many
 *  bytes the sessions printed, the CPU share used (0 to 1 of the machine's vCPUs), the
 *  bytes moved over the network, the home's size, and the disk, where `nibd` is new
 *  enough to say it. */
export interface Activity {
  at: number
  output: number
  cpu: number
  net: number
  homeBytes: number
  disk?: Disk
}

/** One socket open on a machine's terminal, as the awake rule sees it: whose, from
 *  which device, whether that person is active by the hub's rule (a key or the pointer
 *  in the last 5 minutes), and whether the terminal is on their screen. */
export interface Watcher {
  who: string
  device: string
  active: boolean
  onScreen: boolean
}

/** A month's use, or its ceiling: awake seconds, CPU seconds, the home's bytes and the
 *  bytes sent out (4.9). */
export interface Allowance {
  awakeS: number
  cpuS: number
  homeBytes: number
  egressBytes: number
}

/** Why a machine is put to sleep: nothing in it or at it for 15 minutes; the month's
 *  allowance used; the service's budget spent; the service switched off. */
export type SleepReason = 'idle' | 'allowance' | 'budget' | 'off'

/** The awake rule's answer (`awake` in ./awake). */
export type AwakeAnswer = { stay: true } | { stay: false; reason: SleepReason }

/** One input that reached a pty: who sent it, when, and the size of the screen they
 *  sent it from. `sizeOf` picks the pty's size from these. */
export interface Typed {
  who: string
  at: number
  cols: number
  rows: number
}

/** A person's role in the space a `.term` is in, as the rooms' one query answers it;
 *  null for no role at all (a link guest's socket carries the link's role). */
export type SpaceRole = 'read' | 'write' | 'owner'

/** Where a machine runs (docs/online-terminal.md 4.15): a Cloudflare container that
 *  sleeps, or a Hetzner server of its own that is always on. */
export type HostKind = 'cloudflare' | 'hetzner'

/** The host behind `Machine`: Cloudflare's containers, a Hetzner server, a fake for the
 *  tests - one file each (6.1). */
export interface MachineHost {
  start(id: string, image: string, env: Record<string, string>): Promise<void>
  stop(id: string, grace: number): Promise<void>
  /** Whether an instance runs now: one a sleep cut short by a deploy left behind, which a
   *  wake links to as it is rather than starting another. */
  running(id: string): Promise<boolean>
  /** A socket to the machine's `nibd`. */
  link(id: string): Promise<WebSocket>
  snapshot(id: string): Promise<string>
  backup(id: string, dir: string): Promise<string>
  restore(id: string, from: { snapshot?: string; backup?: string }): Promise<void>
  usage(id: string, since: number): Promise<{ cpuS: number; egressBytes: number }>
  /** A machine of its own that is never put to sleep, snapshotted or backed up: its disk
   *  is kept by being a disk (4.15). */
  readonly alwaysOn?: boolean
  /** Power-cycles the machine: the last step of the health path for one that is always on. */
  reboot?(id: string): Promise<void>
  /** Everything the host made for the machine, gone for good: the account erased. */
  remove?(id: string): Promise<void>
}
