/** Every session's screen, written as the machine goes to sleep and read at the next
 *  boot (docs/online-terminal.md 4.4, 4.6).
 *
 *  A sleep keeps the disk and loses every process, so what a person sees after a wake
 *  is the screen they left, above a fresh prompt, in the folder they were in - the
 *  local terminal's restore. One file a session under `/var/lib/nibd/sessions`, written
 *  whole and renamed into place, so a machine stopped mid-write keeps the last good one. */

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Saved {
  v: 1
  session: string
  /** When it was saved. */
  at: number
  /** The offset the saved screen shows everything before. */
  seq: number
  cols: number
  rows: number
  /** The serialised screen, normal buffer only. */
  screen: string
  /** The program that was in front, by name. */
  program: string | null
  /** The folder the shell was in. */
  folder: string | null
}

/** A session id safe to be a file name: what Machine's ids are made of. */
export function isSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,200}$/.test(id)
}

export class Saves {
  private readonly dir: string

  constructor(state: string) {
    this.dir = join(state, 'sessions')
  }

  write(saved: Saved): void {
    mkdirSync(this.dir, { recursive: true })
    const file = join(this.dir, `${saved.session}.json`)
    writeFileSync(`${file}.tmp`, JSON.stringify(saved))
    renameSync(`${file}.tmp`, file)
  }

  /** Every saved session, oldest first; a file that does not read is skipped. */
  all(): Saved[] {
    let names: string[]
    try {
      names = readdirSync(this.dir).filter((name) => name.endsWith('.json'))
    } catch {
      return []
    }
    const out: Saved[] = []
    for (const name of names) {
      const saved = savedOf(readJson(join(this.dir, name)))
      if (saved) out.push(saved)
    }
    return out.sort((a, b) => a.at - b.at)
  }

  /** A session ended for good: nothing to draw back. */
  forget(session: string): void {
    rmSync(join(this.dir, `${session}.json`), { force: true })
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function savedOf(value: unknown): Saved | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Partial<Saved>
  if (one.v !== 1 || typeof one.session !== 'string' || !isSessionId(one.session)) return null
  if (typeof one.at !== 'number' || typeof one.seq !== 'number') return null
  if (typeof one.cols !== 'number' || typeof one.rows !== 'number') return null
  if (typeof one.screen !== 'string') return null
  return {
    v: 1,
    session: one.session,
    at: one.at,
    seq: one.seq,
    cols: one.cols,
    rows: one.rows,
    screen: one.screen,
    program: typeof one.program === 'string' ? one.program : null,
    folder: typeof one.folder === 'string' ? one.folder : null,
  }
}
