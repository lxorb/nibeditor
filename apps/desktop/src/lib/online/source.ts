/** An online terminal's source: the socket to its session, as the terminal's one seam
 *  reads a source (lib/terminal/source.ts). Fetched with the first online terminal.
 *
 *  A session is named by the `.term` file's id on the account, never by what the file says
 *  (docs/online-terminal.md 4.5). So as it starts, the terminal asks sync for the file's id
 *  - made the moment the file was - and the account for the session that id names, which
 *  the account makes on the asker's own machine the first time. A file still on its way to
 *  the account is waited for; the session it names is written into it, so another device
 *  and a restart read it. Then the socket.
 *
 *  A device on sync v1 has no file id the account knows, so there the file's words are the
 *  name: the session it says, or a new one of the asker's own, written into it. Shared
 *  with nobody until the account moves to v2 (services/sync/src/machines/routes.ts). */

import { termOf, termText } from '@nib/online/term'
import type { ServerFrame } from '@nib/online/wire'
import { account } from '../account.svelte'
import { ApiError, BASE } from '../api'
import type { Said, Source } from '../terminal/source'
import { writeFile } from '../workspace/write-file'
import { refusedOf, termSession } from './calls'
import { Link, pageWorld } from './link'
import { machine } from './machine.svelte'
import { ownSession } from './own'
import { refusalWords } from './words'

/** How long a new file is waited for, by sync and then by the account, and how often. */
const WAIT = 20_000
const EVERY = 500

const pause = (ms: number) => new Promise((settle) => setTimeout(settle, ms))

/** The id sync gave the file at `path`, waited for while a new one is taken in; null
 *  where it never is. */
async function termIdOf(path: string, until: number): Promise<string | null> {
  const { runner } = await import('../sync2/runner.svelte')
  for (;;) {
    const id = runner.engine?.entryAt(path)?.id ?? null
    if (id || Date.now() >= until) return id
    await pause(EVERY)
  }
}

/** The file's session, asked of the account, and written into the file where it does not
 *  say it yet. Answers the refusal's words instead where there is one; null otherwise -
 *  including somebody else's terminal, which the account names no session of this
 *  person's for, and whose socket decides what they may do. */
async function sessionOf(id: string, path: string, until: number): Promise<string | null> {
  const { runner } = await import('../sync2/runner.svelte')
  for (;;) {
    try {
      const term = await termSession(id)
      const { invoke } = await import('../tauri')
      const words = await invoke<string>('read_note', { path }).catch(() => null)
      if (words !== null && termOf(words) === null) {
        const text = termText(term)
        await writeFile(path, text)
        void runner.wrote(path, text)
      }
      return null
    } catch (error) {
      // Not on the account yet: sync is asked to send it, and the account asked again.
      if (error instanceof ApiError && error.status === 404 && Date.now() < until) {
        runner.kick()
        await pause(EVERY)
        continue
      }
      return refusalOf(error)
    }
  }
}

/** The words a refusal from the account is shown with, where it has any worth showing
 *  before the socket would say its own. */
function refusalOf(error: unknown): string | null {
  const why = refusedOf(error)
  return why === 'list' || why === 'sessions' || why === 'signed-out' ? refusalWords(why) : null
}

/** The name the socket goes to, or the words it is refused with: on v2 the file's id,
 *  once the account has it and named its session; on v1 the session's own. */
async function socketName(
  path: string,
  until: number,
): Promise<{ name: string } | { refused: string }> {
  const { sync } = await import('../sync.svelte')
  if (sync.version === 1) {
    const { invoke } = await import('../tauri')
    try {
      const name = await ownSession({
        read: () => invoke<string>('read_note', { path }).catch(() => null),
        write: (text) => writeFile(path, text),
        make: () => termSession(null),
      })
      return { name }
    } catch (error) {
      return { refused: refusalWords(refusedOf(error)) ?? refusalWords('other') ?? '' }
    }
  }
  const id = await termIdOf(path, until)
  if (id === null) return { refused: refusalWords('other') ?? '' }
  const refused = await sessionOf(id, path, until)
  return refused === null ? { name: id } : { refused }
}

export class OnlineSource implements Source {
  readonly remote = true
  private link: Link | null = null
  private ended = false

  /** `path` is the `.term` file's, read as it starts: a file renamed or moved keeps its
   *  id, and the socket with it. */
  constructor(
    private readonly path: () => string | null,
    private readonly device: () => Promise<string>,
  ) {}

  async start(cols: number, rows: number, said: (what: Said) => void): Promise<void> {
    if (!account.accountToken) {
      said({ refused: refusalWords('signed-out') ?? '' })
      return
    }
    const path = this.path()
    if (path === null) {
      said({ refused: refusalWords('other') ?? '' })
      return
    }
    const found = await socketName(path, Date.now() + WAIT)
    if ('refused' in found) {
      said({ refused: found.refused })
      return
    }
    if (this.ended) return

    this.link = new Link(
      found.name,
      pageWorld(BASE, () => account.accountToken, this.device),
      (heard) => {
        if (heard.t === 'out') said({ out: heard.data })
        else if (heard.t === 'open') {
          said({ connected: true })
          // The month's use, for the amber near its end; once a socket, never polled.
          if (!machine.known) void machine.refresh()
        } else if (heard.t === 'dropped') said({ connected: false })
        else this.heard(heard, said)
      },
      cols,
      rows,
    )
    this.link.open()
  }

  private heard(frame: ServerFrame, said: (what: Said) => void): void {
    switch (frame.t) {
      case 'screen':
        said({
          screen: frame.data,
          cols: frame.cols,
          rows: frame.rows,
          restored: frame.restored ?? null,
        })
        return
      case 'size':
        said({ size: { cols: frame.cols, rows: frame.rows } })
        return
      case 'program':
        // The name, as a local terminal's: its mark is `terminalMark`'s from that name
        // (lib/terminal/naming.ts), here as for every terminal, so `mark` is not read.
        said({ program: frame.name, title: frame.title })
        return
      case 'machine':
        machine.heard(frame.state)
        // Awake with most of the month's hours used is the amber the mark wears (4.9).
        said({
          machine: frame.state === 'awake' && machine.near ? 'near' : frame.state,
          ...(frame.reason ? { reason: frame.reason } : {}),
        })
        return
      case 'role':
        said({ typing: frame.type })
        return
      case 'ended':
        said({ exit: frame.code })
        return
      case 'refused': {
        if (frame.error === 'role') said({ typing: false })
        const words = refusalWords(frame.error)
        if (words) said({ refused: words })
        return
      }
      // Who is here, and whose input came last: the people popover's and the cursor's,
      // which come later (4.6).
      case 'people':
      case 'typed':
        return
    }
  }

  async write(data: string, binary: boolean): Promise<void> {
    // A key xterm.js encoded itself comes one character a byte.
    if (binary) this.link?.sayBytes(Uint8Array.from(data, (char) => char.charCodeAt(0) & 0xff))
    else this.link?.say({ t: 'in', data })
    await Promise.resolve()
  }

  resize(cols: number, rows: number): void {
    this.link?.resize(cols, rows)
  }

  seen(): void {
    // Nothing to acknowledge: the socket is the back pressure (MOST_BEHIND in the wire).
  }

  /** A new shell in the session, after the last one ended. */
  again(): void {
    this.link?.say({ t: 'start' })
  }

  /** The socket closed; the session goes on without this window. */
  end(): void {
    this.ended = true
    this.link?.close()
    this.link = null
  }
}

/** The source for an online terminal's tab, whose file is at `path` as it starts. */
export function onlineSource(path: () => string | null): OnlineSource {
  return new OnlineSource(path, async () => (await import('../sync2/hub.svelte')).deviceId())
}

/** What an online terminal's cached screen is kept under: `online-` and its session, read
 *  from the file's words, or from the file where a restart left the tab without them.
 *  Empty for a file that names no session yet. */
export async function cacheKey(words: string, path: string | null): Promise<string> {
  let term = termOf(words)
  if (!term && path !== null) {
    const { invoke } = await import('../tauri')
    const read = await invoke<string>('read_note', { path }).catch(() => null)
    term = read === null ? null : termOf(read)
  }
  return term ? `online-${term.session}` : ''
}
