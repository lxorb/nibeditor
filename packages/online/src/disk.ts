/** How full a machine's disk is, and when that is worth saying (docs/online-terminal.md
 *  4.15). A disk that filled froze Emil's machine on 2026-10-06 - the home at 17 GB on an
 *  8 GB container - and nothing said so until it had. So Settings turns its bar amber at
 *  `DISK_NEAR`, and every online terminal says one quiet line at `DISK_FULL` or when less
 *  than a gigabyte is left, whichever comes first. */

import type { Disk } from './types'

/** The share past which Settings' disk bar turns amber. */
const DISK_NEAR = 0.8
/** The share past which a terminal says so under its screen. */
const DISK_FULL = 0.9
/** What is left that counts as full on any disk, however large. */
const LEFT = 1_000_000_000

/** The disk's share used, 0 to 1; 0 for a disk that says no size. */
export function diskShare(disk: Disk): number {
  return disk.total > 0 ? Math.min(1, Math.max(0, disk.used / disk.total)) : 0
}

export function diskNear(disk: Disk): boolean {
  return disk.total > 0 && diskShare(disk) >= DISK_NEAR
}

export function diskFull(disk: Disk): boolean {
  return disk.total > 0 && (diskShare(disk) >= DISK_FULL || disk.total - disk.used < LEFT)
}
