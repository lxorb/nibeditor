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
 *  with nobody until the account moves to v2, where the file's id adopts the session its
 *  words name, and the shell in it goes on (services/sync/src/machines/routes.ts). */

import { termOf } from '@nib/online/term'
import { inputChunks, MOST_INPUT, INPUT_RATE, type ServerFrame } from '@nib/online/wire'
import { account } from '../account.svelte'
import { ApiError, BASE } from '../api'
import { t } from '../i18n.svelte'
import type { Said, Source } from '../terminal/source'
import { isDesktop, isNative } from '../tauri'
import { viewport } from '../viewport.svelte'
import { writeFile } from '../workspace/write-file'
import { refusedOf, termSession } from './calls'
import { Link, pageWorld } from './link'
import { machine } from './machine.svelte'
import { type Build, Opener } from './opening.svelte'
import { namedSession, ownSession, wordsFor } from './own'
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

/** The file's session, asked of the account with the one its words name - which the
 *  account adopts where its owner made it on sync v1 - and written into the file where it
 *  does not say that one. Answers the refusal's words instead where there is one; null
 *  otherwise - including somebody else's terminal, which the account names no session of
 *  this person's for, and whose socket decides what they may do. */
async function sessionOf(id: string, path: string, until: number): Promise<string | null> {
  const { runner } = await import('../sync2/runner.svelte')
  const { invoke } = await import('../tauri')
  const words = await invoke<string>('read_note', { path }).catch(() => null)
  for (;;) {
    try {
      const text = wordsFor(words, await termSession(id, namedSession(words)))
      if (text !== null) {
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

/** What an online terminal's tab tells its source about itself: which tab it is,
 *  whether it is what the person is looking at, and where an address the machine asked
 *  for is offered when this build cannot open it unasked. See opening.svelte.ts. */
export interface Place {
  tab: () => string
  front: () => boolean
  offer: (url: string) => void
}

/** Input frames a second at most, half the `Machine`'s bound per person, so a long paste
 *  never meets it whatever is typed beside it. */
const FRAMES_A_SECOND = INPUT_RATE / 2

export class OnlineSource implements Source {
  readonly remote = true
  private link: Link | null = null
  private ended = false
  private readonly opener: Opener
  /** This second's input frames, for the pace a paste goes at. */
  private sent = { second: 0, count: 0 }
  /** Whether this tab said its machine's disk is nearly full: once a tab is enough. */
  private diskSaid = false

  /** `path` is the `.term` file's, read as it starts: a file renamed or moved keeps its
   *  id, and the socket with it. */
  constructor(
    private readonly path: () => string | null,
    private readonly device: () => Promise<string>,
    private readonly place: Place,
    build: Build,
  ) {
    this.opener = new Opener(
      place.tab,
      build,
      (url) => this.link?.say({ t: 'callback', url }),
      place.offer,
    )
  }

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
        // The session is no more, and the link has stopped: only a new one answers.
        if (words)
          said(frame.error === 'gone' ? { refused: words, gone: true } : { refused: words })
        return
      }
      // A program on the machine asked for a browser: this computer's (4.13).
      case 'browse':
        this.opener.open(frame.url, this.place.front())
        return
      case 'called':
        this.opener.called(frame.url, frame.status)
        return
      // This wake's home is the image's fresh one: its backup could not be put back. Or
      // the machine's disk is nearly full, which is how one froze (4.15).
      case 'note':
        if (frame.note === 'restore') said({ note: t('Your home folder could not be restored') })
        else if (!this.diskSaid) {
          this.diskSaid = true
          said({ note: t('Your machine’s disk is almost full') })
        }
        return
      // Who is here, and whose input came last: the people popover's and the cursor's,
      // which come later (4.6).
      case 'people':
      case 'typed':
        return
    }
  }

  /** Input up the socket in frames the `Machine` takes - none larger than `MOST_INPUT`,
   *  none faster than `FRAMES_A_SECOND` - so a paste of a whole log arrives whole, its
   *  brackets around all of it, rather than being refused as one frame too large. */
  async write(data: string, binary: boolean): Promise<void> {
    if (binary) {
      // A key xterm.js encoded itself comes one character a byte.
      const bytes = Uint8Array.from(data, (char) => char.charCodeAt(0) & 0xff)
      for (let at = 0; at < bytes.length || at === 0; at += MOST_INPUT) {
        await this.paced()
        this.link?.sayBytes(bytes.subarray(at, at + MOST_INPUT))
      }
      return
    }
    for (const chunk of inputChunks(data)) {
      await this.paced()
      this.link?.say({ t: 'in', data: chunk })
    }
  }

  /** Waits for the next second once this one has had its frames. */
  private async paced(): Promise<void> {
    const now = Date.now()
    const second = Math.floor(now / 1000)
    if (second !== this.sent.second) this.sent = { second, count: 0 }
    if (this.sent.count >= FRAMES_A_SECOND) {
      await new Promise((settle) => setTimeout(settle, (second + 1) * 1000 - now))
      this.sent = { second: second + 1, count: 0 }
    }
    this.sent.count += 1
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
    this.opener.end()
    this.link?.close()
    this.link = null
  }
}

/** The source for an online terminal's tab, whose file is at `path` as it starts. */
export function onlineSource(path: () => string | null, place: Place): OnlineSource {
  return new OnlineSource(
    path,
    async () => (await import('../sync2/hub.svelte')).deviceId(),
    place,
    { pages: isDesktop && viewport.device !== 'phone', native: isNative },
  )
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
