/** A picture pasted into a session, written to a file on the machine (docs/online-terminal.md
 *  4.13).
 *
 *  A coding agent pastes an image by reading the clipboard - Claude Code's Alt+V on Windows
 *  and Ctrl+V elsewhere, through PowerShell, `xclip` or `wl-paste` - and the clipboard is
 *  on the person's computer, not here. So the app carries the picture up in parts, and
 *  the agent is handed its path here as a paste, which it takes as an image the way it
 *  takes one dragged onto a terminal.
 *
 *  The file is the machine's user's, in their own cache, `~/.cache/nib/images`, never
 *  read by anything of nib's again; a day later the next picture clears it away. Each
 *  part is held in memory until the last, a picture at most `MOST_IMAGE`, four on their
 *  way at once, and one that stops arriving is forgotten after a minute. */

import {
  chownSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { type ImageKind, MOST_IMAGE } from '@nib/online/wire'
import type { User } from './limits'

/** Pictures on their way at once; a fifth forgets the oldest. */
const MOST_COMING = 4
/** How long a picture may take between two of its parts. */
const STALLED = 60_000
/** How long a written picture is kept. */
const KEPT = 24 * 60 * 60_000

/** The end of a picture's file name, by its kind. */
const ENDS: Record<ImageKind, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' }

interface Coming {
  kind: ImageKind
  parts: Uint8Array[]
  size: number
  at: number
}

export class Images {
  private readonly coming = new Map<string, Coming>()

  /** `home` is the user's, whose cache the pictures go in; `user` who owns what is made
   *  there, null where `nibd` runs as that user already. */
  constructor(
    private readonly home: string,
    private readonly user: User | null,
    private readonly now: () => number = Date.now,
  ) {}

  /** One part of the picture `id`. Undefined while more is to come; at the last, where it
   *  was written, or null where it could not be - too large, or the disk refused. */
  part(id: string, kind: ImageKind, data: Uint8Array, last: boolean): string | null | undefined {
    const now = this.now()
    this.forgetStalled(now)

    let coming = this.coming.get(id)
    if (!coming) {
      if (this.coming.size >= MOST_COMING) {
        const oldest = this.coming.keys().next().value
        if (oldest !== undefined) this.coming.delete(oldest)
      }
      coming = { kind, parts: [], size: 0, at: now }
      this.coming.set(id, coming)
    }
    coming.parts.push(data)
    coming.size += data.length
    coming.at = now

    if (coming.size > MOST_IMAGE) {
      this.coming.delete(id)
      return null
    }
    if (!last) return undefined

    this.coming.delete(id)
    try {
      return this.write(`${id}.${ENDS[coming.kind]}`, coming.parts)
    } catch {
      return null
    }
  }

  /** The folder pictures are written to: made, a step at a time, as the user's. */
  private folder(): string {
    let at = this.home
    for (const step of ['.cache', 'nib', 'images']) {
      at = join(at, step)
      if (existsSync(at)) continue
      mkdirSync(at, { mode: 0o700 })
      if (this.user) chownSync(at, this.user.uid, this.user.gid)
    }
    return at
  }

  private write(name: string, parts: Uint8Array[]): string {
    const folder = this.folder()
    this.clear(folder)
    const path = join(folder, name)
    // `wx`: a file of that name already there is never written through.
    writeFileSync(path, Buffer.concat(parts), { mode: 0o600, flag: 'wx' })
    if (this.user) chownSync(path, this.user.uid, this.user.gid)
    return path
  }

  /** Pictures older than a day, gone. */
  private clear(folder: string): void {
    const before = this.now() - KEPT
    for (const name of readdirSync(folder)) {
      const path = join(folder, name)
      try {
        if (statSync(path).mtimeMs < before) rmSync(path, { force: true })
      } catch {
        // Gone already, or not ours to stat: the next picture tries again.
      }
    }
  }

  private forgetStalled(now: number): void {
    for (const [id, coming] of this.coming) {
      if (now - coming.at > STALLED) this.coming.delete(id)
    }
  }
}
