/** What the engine needs from the world around it, and nothing else: a disk, the
 *  account, a clock and some randomness.
 *
 *  The app hands in its own (app-world.ts: the crate's file commands, which tell the
 *  workspace what moved so every store kept by path follows, and `fetch` to the v2
 *  routes); the simulator hands in a map of files and its network. So the engine that
 *  runs in the window is the engine the simulator's seeds judge, line for line. */

import type { Framed } from '@nib/sync-core/wire'

/** The routes a pass reaches (docs/sync-v2.md section 7). The feed carries `{ since }`
 *  in its body, as the simulator's routes do; the app's transport makes it a query. */
export type Route = 'prepare' | 'ops' | 'feed' | 'pull' | 'push' | 'keep'

export type FileKind = 'file' | 'folder'

/** Files by their path on this device. Every path is absolute: the space's root joined
 *  with the entry's local path. */
export interface Disk {
  /** The words of a file, or null when there is none or it will not read. */
  read(path: string): Promise<string | null>
  /** Writes words to a file, making its folder, keeping the line endings it had. */
  write(path: string, text: string): Promise<void>
  /** Keeps the words a file held as a version on this device: what is about to be
   *  replaced by words from elsewhere, or what lost an answer. */
  keep(path: string, text: string): Promise<void>
  move(from: string, to: string, kind: FileKind): Promise<void>
  /** Takes a file or a folder into this device's trash. */
  remove(path: string, kind: FileKind): Promise<void>
  mkdir(path: string): Promise<void>
  exists(path: string): Promise<boolean>
}

/** The account: one request, answered with the envelope read back (still unknown until a
 *  check has looked at it), or null when no answer came - offline, or lost. A refusal
 *  the engine cannot act on throws. */
export interface Account {
  ask(route: Route, body: Framed, space: string): Promise<unknown>
}

export interface World {
  disk: Disk
  account: Account
  /** What this device calls itself: the name a version it keeps is written under. */
  name: string
  /** This device's clock, in milliseconds: only ever what a pending edit is stamped
   *  with, which a minor overlap compares with the account's. */
  now(): number
  /** A number in [0, 1): client ids and op ids. */
  random(): number
  /** A digest of a file's words: what tells nib's own last write from another
   *  program's. */
  digest(text: string): Promise<string>
  /** Joins a space's root and a local path. */
  join(root: string, path: string): string
  /** Whether names are compared without case on this disk (Windows and a Mac). */
  foldsCase: boolean
  /** Which platform's rules a name has to keep to on this disk. */
  platform: 'windows' | 'mac' | 'other'
  /** Everything in a space's folder, relative to its root with `/` between folders:
   *  what a first v2 pass of a space matches against the account. */
  list?(root: string): Promise<{ path: string; dir: boolean }[]>
  /** The words a note had when they hashed to `hash`, from the account's versions, or
   *  null: the ancestor a v1 device's offline edits are merged against (section 11). */
  ancestor?(id: string, hash: string): Promise<string | null>
}
