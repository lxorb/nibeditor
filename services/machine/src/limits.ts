/** The fence around the sessions: who their shells run as, how many processes they may
 *  have, and how a session's every process is ended.
 *
 *  4.8's process limit, so a fork bomb ends in its own machine's sessions and never
 *  takes `nibd` - which answers the owner's End - with it. Two layers, because what
 *  a machine allows differs by host:
 *
 *  - **a cgroup**, `nibd`'s own under the cgroup filesystem, with `pids.max` on the
 *    sessions' parent and one child per session, so ending a session is the kernel's
 *    `cgroup.kill` and nothing it started survives. Where the filesystem is read-only
 *    (a container that was not given its cgroup), there is none;
 *  - **memory**: the same cgroup's `memory.max`, the machine's memory less what `nibd`
 *    needs to keep answering, so a build or an agent that eats it all is ended by the
 *    kernel inside the sessions, and the machine never thrashes to a halt around a
 *    `nibd` that can no longer say so. Best effort: a kernel without the controller
 *    has the pids fence alone;
 *  - **`RLIMIT_NPROC`** on every shell, set by `prlimit` before the shell starts, so
 *    the limit holds even where the cgroup could not be made. It counts the user's
 *    processes across sessions, which on a machine with one user is the same thing.
 *
 *  Shells run as the machine's user, `nib`, through `setpriv` with that user's groups,
 *  when `nibd` is root; as `nibd`'s own user otherwise (a developer's machine, CI). */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { sessionProcesses } from './proc'

export const PIDS_MAX = 4096

/** What the sessions leave of the machine's memory: `nibd` itself, its screens, and the
 *  kernel's own room to work. */
const KEPT_FOR_NIBD = 512 * 1024 * 1024

/** The sessions' memory ceiling for a machine whose `/proc/meminfo` says `meminfo`, or
 *  null where it does not say or is too small to fence. */
export function memoryMax(meminfo: string): number | null {
  const kib = Number(/^MemTotal:\s+(\d+) kB$/m.exec(meminfo)?.[1])
  if (!Number.isSafeInteger(kib) || kib <= 0) return null
  const most = kib * 1024 - KEPT_FOR_NIBD
  return most >= KEPT_FOR_NIBD ? most : null
}

/** The machine's one user, as `/etc/passwd` has them. */
export interface User {
  name: string
  uid: number
  gid: number
  home: string
  shell: string
}

export function userOf(name: string, passwd = '/etc/passwd'): User | null {
  let lines: string[]
  try {
    lines = readFileSync(passwd, 'utf8').split('\n')
  } catch {
    return null
  }
  for (const line of lines) {
    const [user, , uid, gid, , home, shell] = line.split(':')
    if (user !== name || !home || !shell) continue
    return { name, uid: Number(uid), gid: Number(gid), home, shell }
  }
  return null
}

const PRLIMIT = '/usr/bin/prlimit'
export const SETPRIV = '/usr/bin/setpriv'

/** `command`, run as `user` with that user's groups rather than as `nibd`: what every
 *  shell is started through, and anything else `nibd` does in the user's home. */
export function asUser(user: User, command: string[]): string[] {
  return [
    SETPRIV,
    `--reuid=${String(user.uid)}`,
    `--regid=${String(user.gid)}`,
    '--init-groups',
    '--',
    ...command,
  ]
}

/** The command a session's pty runs: the login shell, fenced, as the user. */
export function shellCommand(
  shell: string,
  user: User | null,
  pidsMax: number,
  has: (path: string) => boolean = existsSync,
): { file: string; args: string[] } {
  let command = [shell, '-l']
  // Best effort: a host that refuses the limit (a container without the capability)
  // still gets its shell, with the cgroup as the fence.
  if (has(PRLIMIT)) {
    const fence = `${PRLIMIT} --nproc=${String(pidsMax)} --pid $$ 2>/dev/null; exec "$@"`
    command = ['/bin/sh', '-c', fence, 'nib-shell', ...command]
  }
  if (user && has(SETPRIV)) command = asUser(user, command)
  const [file = shell, ...args] = command
  return { file, args }
}

/** `nibd`'s cgroup, or null where the host gives it none to write. */
export class Cgroups {
  private readonly base: string

  private constructor(base: string) {
    this.base = base
  }

  static open(pidsMax: number, root = '/sys/fs/cgroup'): Cgroups | null {
    if (!existsSync(join(root, 'cgroup.controllers'))) return null
    const base = join(root, 'nibd')
    try {
      mkdirSync(base, { recursive: true })
      enable(root, '+pids')
      appendFileSync(join(base, 'cgroup.subtree_control'), '+pids')
      writeFileSync(join(base, 'pids.max'), String(pidsMax))
      fenceMemory(root, base)
      return new Cgroups(base)
    } catch {
      // Read-only, or a kernel without the pids controller: the rlimit fences alone.
      return null
    }
  }

  /** The session's own cgroup, with its shell in it. Done the moment the shell is
   *  spawned: nothing typed can have forked yet. */
  add(session: string, pid: number): void {
    const dir = join(this.base, session)
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'cgroup.procs'), String(pid))
    } catch {
      // The shell is gone already; `end` has nothing to do.
    }
  }

  /** Every process of the session, ended by the kernel; false where it could not. */
  kill(session: string): boolean {
    const dir = join(this.base, session)
    try {
      writeFileSync(join(dir, 'cgroup.kill'), '1')
    } catch {
      return false
    }
    // A cgroup can only go once it is empty, which the kill makes it a moment later.
    setTimeout(() => {
      try {
        rmdirSync(dir)
      } catch {
        // Still emptying, or gone: the next boot starts from a fresh filesystem.
      }
    }, 500).unref()
    return true
  }
}

/** The sessions' memory ceiling, where the kernel offers the controller. */
function fenceMemory(root: string, base: string): void {
  try {
    const most = memoryMax(readFileSync('/proc/meminfo', 'utf8'))
    if (most === null) return
    enable(root, '+memory')
    writeFileSync(join(base, 'memory.max'), String(most))
  } catch {
    // No memory controller here: the machine's own limit is the only one.
  }
}

/** A controller handed down from the cgroup root. A root that is a container's
 *  namespace, not the machine's, may not hand controllers down while processes sit in
 *  it, so they are moved into a cgroup of their own first. */
function enable(root: string, controller: string): void {
  try {
    appendFileSync(join(root, 'cgroup.subtree_control'), controller)
    return
  } catch {
    // EBUSY: processes in the root. Move them and try again.
  }
  const daemon = join(root, 'daemon')
  mkdirSync(daemon, { recursive: true })
  for (const pid of readFileSync(join(root, 'cgroup.procs'), 'utf8').split('\n')) {
    if (!pid) continue
    try {
      writeFileSync(join(daemon, 'cgroup.procs'), pid)
    } catch {
      // A kernel thread, or gone.
    }
  }
  appendFileSync(join(root, 'cgroup.subtree_control'), controller)
}

/** Every process in the shell's kernel session, killed until none is left: the end of a
 *  session where there is no cgroup. A fork bomb forks while it is being killed, so
 *  this goes round until a pass finds nothing, for a few seconds at most. */
export function killSession(shell: number): void {
  const until = Date.now() + 5000
  while (Date.now() < until) {
    const pids = sessionProcesses(shell)
    if (pids.length === 0) return
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }
}
