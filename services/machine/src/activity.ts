/** What the machine did in the last stretch, for the awake rule (docs/online-terminal.md
 *  4.4): bytes the sessions printed, the share of its CPU it used, the bytes it moved over
 *  the network, and how big the home is.
 *
 *  CPU is read from the machine's own cgroup where there is one (`cpu.stat`), which in a
 *  container is the container and in a microVM the whole VM, and from `/proc/stat`
 *  otherwise; the network from `/proc/net/dev`, which is the machine's own namespace,
 *  loopback left out. The home's size is `du`'s, run at a low priority, since it walks
 *  every file and is asked once an hour. */

import { execFile } from 'node:child_process'
import { readFileSync, statfsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import type { Disk } from '@nib/online/types'

/** Microseconds of CPU used so far, by the machine's cgroup or the kernel's count. */
export function cpuMicros(
  read: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): number | null {
  try {
    const used = /^usage_usec (\d+)$/m.exec(read('/sys/fs/cgroup/cpu.stat'))?.[1]
    if (used) return Number(used)
  } catch {
    // No cgroup v2 here; the kernel's own count below.
  }
  try {
    const line = read('/proc/stat').split('\n')[0] ?? ''
    // user nice system idle iowait irq softirq steal, in ticks of 1/100 s.
    const [, user = 0, nice = 0, system = 0, , , irq = 0, softirq = 0, steal = 0] = line
      .trim()
      .split(/\s+/)
      .map(Number)
    return (user + nice + system + irq + softirq + steal) * 10_000
  } catch {
    return null
  }
}

/** Bytes received and sent so far over every interface but loopback. */
export function netBytes(
  read: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): number | null {
  try {
    let total = 0
    for (const line of read('/proc/net/dev').split('\n').slice(2)) {
      const [name, rest] = line.split(':')
      if (!rest || name?.trim() === 'lo') continue
      const fields = rest.trim().split(/\s+/).map(Number)
      total += (fields[0] ?? 0) + (fields[8] ?? 0)
    }
    return total
  } catch {
    return null
  }
}

/** The home's size on the disk, in bytes; null where `du` could not say. */
export function homeSize(home: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      'nice',
      ['-n', '19', 'du', '-sxB1', home],
      { timeout: 10 * 60_000 },
      (_error, stdout) => {
        // `du` says what it could read even when it fails on a file it could not.
        const bytes = Number(stdout.split('\t')[0])
        resolve(stdout && Number.isSafeInteger(bytes) ? bytes : null)
      },
    )
  })
}

/** The filesystem the home is on, used and whole, in bytes: what filled up and froze a
 *  machine on 2026-10-06 (docs/online-terminal.md 4.15). One `statfs`, so it is asked
 *  with every report. Used counts what is reserved for root too, as `df` does not, so a
 *  disk reads full when the user can write no more. */
export function diskOf(path: string, statfs = statfsSync): Disk | null {
  try {
    const stats = statfs(path)
    const total = stats.blocks * stats.bsize
    const used = (stats.blocks - stats.bavail) * stats.bsize
    return Number.isSafeInteger(total) && total > 0 ? { used, total } : null
  } catch {
    return null
  }
}

/** The counters as they stood at the last report, and the differences since. */
export class Meter {
  private cpu: number | null
  private net: number | null
  private at: number
  private readonly cores: number

  constructor(now: number, cores = availableParallelism()) {
    this.cpu = cpuMicros()
    this.net = netBytes()
    this.at = now
    this.cores = Math.max(1, cores)
  }

  /** The CPU share (0 to 1 of every core) and the bytes moved since the last call. */
  since(now: number): { cpu: number; net: number } {
    const cpu = cpuMicros()
    const net = netBytes()
    const elapsed = Math.max(1, now - this.at) * 1000
    const share =
      cpu !== null && this.cpu !== null
        ? Math.min(1, Math.max(0, (cpu - this.cpu) / (elapsed * this.cores)))
        : 0
    const moved = net !== null && this.net !== null ? Math.max(0, net - this.net) : 0
    this.cpu = cpu
    this.net = net
    this.at = now
    return { cpu: share, net: moved }
  }
}
