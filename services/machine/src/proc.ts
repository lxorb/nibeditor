/** What Linux's `/proc` says about a session's processes: which program is in front,
 *  which folder the shell is in, and every process the session started.
 *
 *  The program in front is the local crate's rule (`pty_program`,
 *  apps/desktop/src-tauri/src/terminal/process.rs): the terminal's foreground process
 *  group, named by its leader's `comm`, and nothing while the shell itself is in front.
 *  One rule added for a machine: a script run by node is named by its script, so
 *  npm's `codex` - node starting `codex.js` - is `codex`, which is what Resume reads. */

import { readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { basename } from 'node:path'

/** A process's `stat` fields after its name, which may itself hold spaces and
 *  brackets: state, parent, group, session, tty, foreground group. */
function statOf(pid: number): string[] | null {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  } catch {
    // Gone between the listing and the read, or not Linux.
    return null
  }
}

function field(pid: number, at: number): number | null {
  const value = Number(statOf(pid)?.[at])
  return Number.isSafeInteger(value) ? value : null
}

/** The terminal's foreground process group, as the shell's `stat` says it. */
function frontOf(shell: number): number | null {
  const front = field(shell, 5)
  return front !== null && front > 0 ? front : null
}

/** Interpreters whose program is the script they were handed. */
const RUNNERS = new Set(['node', 'nodejs'])

function nameOf(pid: number): string | null {
  try {
    const comm = readFileSync(`/proc/${String(pid)}/comm`, 'utf8').trim()
    if (!RUNNERS.has(comm)) return comm || null
    const script = readFileSync(`/proc/${String(pid)}/cmdline`, 'utf8').split('\0')[1]
    if (!script || script.startsWith('-')) return comm
    return basename(script).replace(/\.[cm]?js$/, '') || comm
  } catch {
    // The program ended a moment ago: the shell is in front again.
    return null
  }
}

/** The program in front of the shell, by name, or null while the shell is. */
export function programOf(shell: number): string | null {
  const front = frontOf(shell)
  if (front === null || front === shell) return null
  return nameOf(front)
}

/** The folder the shell is in, where the kernel can say. */
export function folderOf(shell: number): string | null {
  try {
    return readlinkSync(`/proc/${String(shell)}/cwd`)
  } catch {
    // Not ours to read, or gone.
    return null
  }
}

/** Every process in the kernel session the shell leads: everything typed into this
 *  terminal started, background jobs and a fork bomb's children included, unless one
 *  of them left with `setsid`. */
export function sessionProcesses(shell: number): number[] {
  let pids: string[]
  try {
    pids = readdirSync('/proc').filter((name) => /^\d+$/.test(name))
  } catch {
    return []
  }
  return pids.map(Number).filter((pid) => field(pid, 3) === shell)
}
