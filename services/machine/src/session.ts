/** One shell session: a pty, the headless screen it draws on, and the output it printed,
 *  numbered by offset (docs/online-terminal.md 4.6).
 *
 *  Output is read as bytes, never decoded, so an offset counts what the shell wrote and
 *  a character split across two reads is the screen's to join. Each coalesced frame
 *  goes to the ring and to the screen at the same moment, so the ring's end and what
 *  the screen has been handed are always the same offset - which is what lets a screen
 *  be sent with the `seq` everything after it continues from. */

import { existsSync } from 'node:fs'
import { spawn, type IPty } from 'node-pty'
import type { NibdFrame, Restored } from '@nib/online/wire'
import { Coalescer } from './coalesce'
import { Cgroups, killSession, shellCommand, type User } from './limits'
import { folderOf, programOf } from './proc'
import { Ring } from './ring'
import type { Saved } from './saves'
import { Scanner } from './scan'
import { Screen } from './screen'

/** What a session needs from the machine it runs on. */
export interface Machine {
  shell: string
  home: string
  user: User | null
  env: Record<string, string>
  pidsMax: number
  cgroups: Cgroups | null
  send(frame: NibdFrame): void
}

/** How often the program in front is asked, at most. */
const PROGRAM_EVERY = 1000

export class Session {
  readonly id: string
  private readonly machine: Machine
  private readonly screen: Screen
  private readonly ring: Ring
  private readonly coalescer: Coalescer
  private pty: IPty | null = null
  /** Set when this session was drawn back from a save after a boot. */
  readonly restored: Restored | undefined
  /** Bytes printed since `taken` last asked: the activity of 4.4. */
  private printed = 0
  private program: string | null = null
  private sentProgram = ''
  private asking: ReturnType<typeof setTimeout> | null = null
  private askedAt = 0
  /** Output held back while a screen is written out; see `want`. */
  private held: NibdFrame[] | null = null
  private answering: Promise<void> = Promise.resolve()
  /** Where a screen may be taken; see scan.ts. Its offsets count from `base`. */
  private readonly scanner = new Scanner()
  private readonly base: number

  constructor(id: string, cols: number, rows: number, machine: Machine, saved?: Saved) {
    this.id = id
    this.machine = machine
    this.screen = new Screen(saved?.cols ?? cols, saved?.rows ?? rows)
    // A restored session's offsets start past the saved ones, so a device that drew
    // the old stream is sent the screen rather than bytes from a stream that is gone.
    this.base = saved ? saved.seq + 1 : 0
    this.ring = new Ring(this.base)
    this.coalescer = new Coalescer((bytes) => {
      this.sent(bytes)
    })
    this.screen.term.onTitleChange(() => {
      this.ask()
    })

    let folder = machine.home
    if (saved) {
      this.restored = { at: saved.at, program: saved.program }
      this.screen.write(saved.screen)
      this.screen.write(restoredLine(saved.at))
      if (saved.cols !== cols || saved.rows !== rows) this.screen.resize(cols, rows)
      if (saved.folder && existsSync(saved.folder)) folder = saved.folder
    }
    this.spawn(folder)
  }

  get alive(): boolean {
    return this.pty !== null
  }

  /** A new shell in a session whose shell ended, on the same screen and stream. */
  restart(): void {
    if (!this.pty) this.spawn(this.machine.home)
  }

  private spawn(folder: string): void {
    const { file, args } = shellCommand(this.machine.shell, this.machine.user, this.machine.pidsMax)
    const pty = spawn(file, args, {
      name: 'xterm-256color',
      cols: this.screen.cols,
      rows: this.screen.rows,
      cwd: folder,
      env: this.machine.env,
      encoding: null,
    })
    this.pty = pty
    this.machine.cgroups?.add(this.id, pty.pid)
    pty.onData((data: string | Buffer) => {
      const bytes = typeof data === 'string' ? Buffer.from(data) : data
      const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      this.printed += view.length
      this.scanner.feed(view)
      this.coalescer.push(view)
      this.ask()
    })
    pty.onExit(({ exitCode, signal }) => {
      if (this.pty !== pty) return
      this.coalescer.flush()
      this.pty = null
      this.emit({ t: 'ended', session: this.id, code: signal ? null : exitCode })
    })
  }

  private sent(bytes: Uint8Array): void {
    const seq = this.ring.append(bytes)
    this.screen.write(bytes)
    this.emit({ t: 'out', session: this.id, seq, data: bytes })
  }

  /** A frame on the link, in order behind any output held for a screen. */
  private emit(frame: NibdFrame): void {
    if (this.held) this.held.push(frame)
    else this.machine.send(frame)
  }

  input(data: Uint8Array): void {
    this.pty?.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    if (data.includes(13)) this.ask()
  }

  pause(paused: boolean): void {
    if (paused) this.pty?.pause()
    else this.pty?.resume()
  }

  resize(cols: number, rows: number): void {
    if (cols === this.screen.cols && rows === this.screen.rows) return
    this.coalescer.flush()
    this.screen.resize(cols, rows)
    this.pty?.resize(cols, rows)
  }

  /** Sends what a device that drew everything before `since` needs: the bytes after
   *  it, if they are all still kept, or else the whole screen.
   *
   *  The answer always goes on the link before any output after it: output printed
   *  while a screen is being written out is held and sent behind it. So `Machine`
   *  forwards a joiner everything that follows its answer, and nothing needs sorting.
   *  Two joiners at once are answered one after the other, for the same reason. */
  want(since: number): Promise<void> {
    this.answering = this.answering.then(
      () => this.answer(since),
      () => this.answer(since),
    )
    return this.answering
  }

  private async answer(since: number): Promise<void> {
    // Everything up to the last point between two whole sequences now, the rest at the
    // next frame, so a screen taken here is never cut through an escape.
    this.coalescer.flush(Math.max(0, this.base + this.scanner.safe - this.ring.end))
    const data = this.ring.since(since)
    if (data) {
      this.machine.send({ t: 'out', session: this.id, seq: since, data })
      return
    }
    const seq = this.ring.end
    const held: NibdFrame[] = []
    this.held = held
    const screen = await this.screen.serialized()
    this.machine.send({
      t: 'screen',
      session: this.id,
      seq,
      cols: this.screen.cols,
      rows: this.screen.rows,
      data: screen,
      ...(this.restored ? { restored: this.restored } : {}),
    })
    this.held = null
    for (const frame of held) this.machine.send(frame)
  }

  /** The bytes printed since the last time this was asked. */
  taken(): number {
    const printed = this.printed
    this.printed = 0
    return printed
  }

  async save(at: number): Promise<Saved> {
    this.coalescer.flush()
    const seq = this.ring.end
    const shell = this.pty?.pid
    return {
      v: 1,
      session: this.id,
      at,
      seq,
      cols: this.screen.cols,
      rows: this.screen.rows,
      screen: await this.screen.saved(),
      program: shell === undefined ? this.program : programOf(shell),
      folder: shell === undefined ? null : folderOf(shell),
    }
  }

  /** The session ended for good: every process it started, its screen, its timers. */
  end(): void {
    const pty = this.pty
    this.pty = null
    if (this.asking) clearTimeout(this.asking)
    if (pty && !this.machine.cgroups?.kill(this.id)) killSession(pty.pid)
    try {
      pty?.kill("SIGKILL")
    } catch {
      // Gone with the rest of the session.
    }
    this.screen.dispose()
  }

  /** The program in front and its title, asked at most once a second and said only
   *  when it changed. */
  private ask(): void {
    if (this.asking) return
    const wait = Math.max(0, this.askedAt + PROGRAM_EVERY - Date.now())
    this.asking = setTimeout(() => {
      this.asking = null
      this.askedAt = Date.now()
      const shell = this.pty?.pid
      this.program = shell === undefined ? null : programOf(shell)
      const title = this.screen.title
      const said = JSON.stringify([this.program, title])
      if (said === this.sentProgram) return
      this.sentProgram = said
      // The mark is the app's to give, by `terminalMark` in lib/terminal/naming.ts,
      // which reads the name; a second table of marks here would drift from it.
      this.emit({ t: 'program', session: this.id, name: this.program, title, mark: null })
    }, wait)
  }
}

/** The dim line under a screen drawn back after a boot, saying when it is from: the
 *  local terminal's `restoredLine` (lib/terminal/history.ts), in the machine's time
 *  zone, and without words, which the machine has no language for. */
export function restoredLine(at: number): string {
  const when = new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `\x1b[0m\r\n\x1b[2m${when}\x1b[22m\r\n`
}
