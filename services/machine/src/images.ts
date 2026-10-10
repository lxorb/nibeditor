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
 *  read by anything of nib's again; a day later the next picture clears it away - only
 *  pictures of nib's naming, never anything else that is there. Each part is held in
 *  memory until the last, a picture at most `MOST_IMAGE`, four on their way at once, and
 *  one that stops arriving is forgotten after a minute.
 *
 *  **Written as the user, never as root.** `nibd` runs as root, and the home is the user's:
 *  any folder on the way could be a link they made to `/etc`, and a check before the
 *  write is a race they can win. So where `nibd` is root, the folder, the clearing and the
 *  write are one small `sh` run through the same `setpriv` the shells are (`asUser` in
 *  limits.ts), the bytes on its input and the path said back on its output, and nothing
 *  of root's touches the home at all. Where `nibd` already is the user (a developer's
 *  machine, CI), it writes here itself. */

import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type ImageKind, isImageId, MOST_IMAGE } from '@nib/online/wire'
import { asUser, SETPRIV, type User } from './limits'

/** Pictures on their way at once; a fifth forgets the oldest. */
const MOST_COMING = 4
/** How long a picture may take between two of its parts. */
const STALLED = 60_000
/** How long a written picture is kept. */
const KEPT = 24 * 60 * 60_000
/** How long the user's write may take. */
const WRITE_WITHIN = 15_000

/** The end of a picture's file name, by its kind. */
const ENDS: Record<ImageKind, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' }

/** A picture's file as nib names it, and the only kind of file the clearing removes. */
export const NAMED = /^[a-z0-9]{16,64}\.(png|jpg|gif|webp)$/

/** What runs as the user: the folder made, private; pictures of nib's naming older than a
 *  day gone; the bytes on standard input into `$1`, never through a file already there
 *  (`set -C`); and the path said back. */
export const AS_USER_SCRIPT = [
  'umask 077',
  'd="$HOME/.cache/nib/images"',
  'mkdir -p "$d" || exit 1',
  `find "$d" -maxdepth 1 -type f -mmin +${String(KEPT / 60_000)} -regextype posix-extended -regex '.*/[a-z0-9]{16,64}\\.(png|jpg|gif|webp)' -delete 2>/dev/null`,
  'set -C',
  'cat > "$d/$1" || exit 1',
  'printf %s "$d/$1"',
].join('\n')

/** How a command is run: its file and arguments, its environment, the bytes for its input;
 *  its exit code and what it printed. */
export type Run = (
  file: string,
  args: string[],
  env: Record<string, string>,
  input: Uint8Array,
) => Promise<{ code: number | null; out: string }>

/** A command run for real, given `WRITE_WITHIN` and then ended. */
export const runChild: Run = (file, args, env, input) =>
  new Promise((settle) => {
    const child = spawn(file, args, { env, stdio: ['pipe', 'pipe', 'ignore'] })
    const out: Buffer[] = []
    const timer = setTimeout(() => child.kill('SIGKILL'), WRITE_WITHIN)
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.on('error', () => {
      clearTimeout(timer)
      settle({ code: null, out: '' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      settle({ code, out: Buffer.concat(out).toString() })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })

interface Coming {
  kind: ImageKind
  parts: Uint8Array[]
  size: number
  at: number
}

export interface Options {
  now?: () => number
  run?: Run
  has?: (path: string) => boolean
}

export class Images {
  private readonly coming = new Map<string, Coming>()
  private readonly now: () => number
  private readonly run: Run
  private readonly has: (path: string) => boolean

  /** `home` is the user's, whose cache the pictures go in; `user` who `nibd` writes them
   *  as, null where it runs as that user already. */
  constructor(
    private readonly home: string,
    private readonly user: User | null,
    options: Options = {},
  ) {
    this.now = options.now ?? Date.now
    this.run = options.run ?? runChild
    this.has = options.has ?? existsSync
  }

  /** One part of the picture `id`. Undefined while more is to come; at the last, where it
   *  was written, or null where it could not be - too large, or the disk refused. */
  async part(
    id: string,
    kind: ImageKind,
    data: Uint8Array,
    last: boolean,
  ): Promise<string | null | undefined> {
    if (!isImageId(id)) return null
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
    const name = `${id}.${ENDS[coming.kind]}`
    const bytes = Buffer.concat(coming.parts)
    try {
      return this.user ? await this.writtenAs(this.user, name, bytes) : this.written(name, bytes)
    } catch {
      return null
    }
  }

  /** As the user, in a process of theirs; null where there is no way to be them. */
  private async writtenAs(user: User, name: string, bytes: Uint8Array): Promise<string | null> {
    if (!this.has(SETPRIV)) return null
    const command = asUser(user, ['/bin/sh', '-c', AS_USER_SCRIPT, 'nib-image', name])
    const [file = SETPRIV, ...args] = command
    const env = { HOME: user.home, PATH: '/usr/local/bin:/usr/bin:/bin' }
    const { code, out } = await this.run(file, args, env, bytes)
    const path = join(user.home, '.cache', 'nib', 'images', name)
    return code === 0 && out === path ? path : null
  }

  /** Here, by `nibd` itself, which is the user already. */
  private written(name: string, bytes: Uint8Array): string {
    const folder = join(this.home, '.cache', 'nib', 'images')
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    this.clear(folder)
    const path = join(folder, name)
    // `wx`: a file of that name already there is never written through.
    writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' })
    return path
  }

  /** Pictures of nib's naming older than a day, gone; nothing else. */
  private clear(folder: string): void {
    const before = this.now() - KEPT
    for (const name of readdirSync(folder)) {
      if (!NAMED.test(name)) continue
      const path = join(folder, name)
      try {
        const stat = lstatSync(path)
        if (stat.isFile() && stat.mtimeMs < before) rmSync(path, { force: true })
      } catch {
        // Gone already: the next picture tries again.
      }
    }
  }

  private forgetStalled(now: number): void {
    for (const [id, coming] of this.coming) {
      if (now - coming.at > STALLED) this.coming.delete(id)
    }
  }
}
