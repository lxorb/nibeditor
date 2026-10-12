/** One shell session: its holder (hold.ts), which owns the pty and outlives `nibd`; the
 *  headless screen it draws on; and the output it printed, numbered by offset
 *  (docs/online-terminal.md 4.6, 4.16).
 *
 *  Output is read as bytes, never decoded, so an offset counts what the shell wrote and
 *  a character split across two reads is the screen's to join. Each coalesced frame
 *  goes to the ring and to the screen at the same moment, so the ring's end and what
 *  the screen has been handed are always the same offset - which is what lets a screen
 *  be sent with the `seq` everything after it continues from. The holder numbers what it
 *  read the same way, so a `nibd` started after another goes on at the same offsets.
 *
 *  A session starts by looking for its holder. Found, `nibd` restarted under a program
 *  that went on: the screen comes back from the last save with what the holder kept
 *  after it, and nothing a person sees says anything happened. Not found, a new session
 *  or one whose machine slept or rebooted: a holder is started for a fresh shell, above
 *  the saved screen if there is one. Whatever is asked of the session meanwhile waits. */

import { existsSync } from 'node:fs'
import type { NibdFrame, Restored, SessionNow } from '@nib/online/wire'
import { Coalescer } from './coalesce'
import { Held, socketOf } from './held'
import type { Hello } from './hold-wire'
import { type Cgroups, shellCommand, type User } from './limits'
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
  /** The holder program, `hold.cjs`, and the folder its sockets are in, root's alone. */
  holder: string
  holds: string
  send(frame: NibdFrame): void
}

/** How often the program in front is asked, at most. */
const PROGRAM_EVERY = 1000

export class Session {
  readonly id: string
  private readonly machine: Machine
  private readonly screen: Screen
  private ring = new Ring()
  private readonly coalescer: Coalescer
  /** The holder of the shell running now; null once that shell ended. */
  private held: Held | null
  /** The shell's process, once its holder said. */
  private shell: number | undefined
  /** Set when this session was drawn back from a save above a fresh shell. */
  private restoredFrom: Restored | undefined
  /** Settled once the holder was found again or a new one started. */
  private readonly ready: Promise<void>
  private settled = false
  /** A size asked for before then, made once it is. */
  private wanted: { cols: number; rows: number } | null = null
  /** Bytes printed since `taken` last asked: the activity of 4.4. */
  private printed = 0
  private program: string | null = null
  private sentProgram = ''
  private asking: ReturnType<typeof setTimeout> | null = null
  private askedAt = 0
  /** Output held back while a screen is written out; see `want`. */
  private holding: NibdFrame[] | null = null
  /** Ended for good, or let go of: nothing more is drawn or said. */
  private over = false
  private answering: Promise<void> = Promise.resolve()
  /** Where a screen may be taken; see scan.ts. Its offsets count from `scanned`. */
  private scanner = new Scanner()
  private scanned = 0
  /** The offset after the last byte the holder sent: where the next one goes on. */
  private heard = 0
  /** When the shell last printed anything, by this `nibd`'s clock. */
  private printedAt: number | null = null

  constructor(id: string, cols: number, rows: number, machine: Machine, saved?: Saved) {
    this.id = id
    this.machine = machine
    this.screen = new Screen(saved?.cols ?? cols, saved?.rows ?? rows)
    this.coalescer = new Coalescer((bytes) => {
      this.sent(bytes)
    })
    this.screen.term.onTitleChange(() => {
      this.ask()
    })
    const held = this.hold()
    this.held = held
    this.ready = this.begin(held, cols, rows, saved)
      .catch(() => {
        this.died(held)
      })
      .finally(() => {
        this.settled = true
        const wanted = this.wanted
        this.wanted = null
        if (wanted) this.resize(wanted.cols, wanted.rows)
      })
  }

  get alive(): boolean {
    return this.held !== null
  }

  /** What a restored screen is from, while this session was drawn back above a fresh
   *  shell. */
  get restored(): Restored | undefined {
    return this.restoredFrom
  }

  /** The shell's process, once its holder said. */
  get pid(): number | undefined {
    return this.shell
  }

  /** A new shell in a session whose shell ended, on the same screen and stream. */
  restart(): void {
    if (this.held || this.over) return
    const held = this.hold()
    this.held = held
    this.spawn(held, this.machine.home).catch(() => {
      this.died(held)
    })
  }

  private hold(): Held {
    const held: Held = new Held(socketOf(this.machine.holds, this.id), {
      out: (seq, data) => {
        if (this.held === held) this.read(seq, data)
      },
      exit: (code) => {
        this.ended(held, code)
      },
    })
    return held
  }

  private async begin(held: Held, cols: number, rows: number, saved?: Saved): Promise<void> {
    const hello = await held.find()
    if (this.over) return
    if (hello) {
      await this.rejoin(held, hello, saved)
      return
    }
    const folder = saved ? await this.drawBack(saved, cols, rows) : this.machine.home
    if (folder !== null) await this.spawn(held, folder)
  }

  /** The holder found again: `nibd` restarted under a program that went on. Where the
   *  holder kept everything since the last save, the screen is that save's and goes on
   *  from it as though nothing happened. Otherwise it is what the holder kept, over the
   *  save where there is one, and the program is asked to draw itself again: its window
   *  changes size and back, which every full-screen program answers by drawing all of it,
   *  as tmux makes it do on an attach. */
  private async rejoin(held: Held, hello: Hello, saved?: Saved): Promise<void> {
    this.shell = hello.shell
    const kept = saved?.v === 2 && saved.seq >= hello.from && saved.seq <= hello.end ? saved : null
    if (saved && saved.seq < hello.base) {
      // A save of the shell before this one, which this holder was started above: drawn
      // as that restore drew it.
      const first = await firstScreen(saved)
      if (this.over) return
      this.screen.write(first)
      this.screen.write(restoredLine(saved.at))
    } else if (saved?.v === 2) {
      this.screen.write(saved.screen)
    }
    if (this.screen.cols !== hello.cols || this.screen.rows !== hello.rows) {
      this.screen.resize(hello.cols, hello.rows)
    }
    const since = kept ? kept.seq : hello.from
    this.from(since)
    held.attach(since)
    if (!kept && hello.from > hello.base && hello.rows > 1) {
      held.resize(hello.cols, hello.rows - 1)
      held.resize(hello.cols, hello.rows)
    }
    this.ask()
  }

  /** A saved session whose program is gone, drawn back above the fresh shell about to
   *  start: the local terminal's restore. Answers the folder the shell starts in, or
   *  null where the session ended meanwhile. */
  private async drawBack(saved: Saved, cols: number, rows: number): Promise<string | null> {
    const first = await firstScreen(saved)
    if (this.over) return null
    this.restoredFrom = { at: saved.at, program: saved.program }
    // Offsets past the saved ones, so a device that drew the old stream is sent the
    // screen rather than bytes from a stream that is gone.
    this.from(saved.seq + 1)
    this.screen.write(first)
    this.screen.write(restoredLine(saved.at))
    if (saved.cols !== cols || saved.rows !== rows) this.screen.resize(cols, rows)
    return saved.folder && existsSync(saved.folder) ? saved.folder : this.machine.home
  }

  /** A holder for a new shell in `folder`, its offsets going on from the stream's end. */
  private async spawn(held: Held, folder: string): Promise<void> {
    const { file, args } = shellCommand(this.machine.shell, this.machine.user, this.machine.pidsMax)
    const base = this.ring.end
    const hello = await held.start(
      this.machine.holder,
      {
        socket: held.path,
        cgroup: this.machine.cgroups?.dirOf(this.id) ?? null,
        file,
        args,
        cwd: folder,
        cols: this.screen.cols,
        rows: this.screen.rows,
        base,
      },
      // Which session a program asked a browser in, for `nib-open` to say; see opener.ts.
      { ...this.machine.env, NIB_SESSION: this.id },
    )
    if (this.over) return
    this.shell = hello.shell
    this.heard = base
    held.attach(base)
  }

  /** The stream goes on from `seq`: what the ring, the scanner and the holder's next
   *  byte count from. */
  private from(seq: number): void {
    this.ring = new Ring(seq)
    this.scanner = new Scanner()
    this.scanned = seq
    this.heard = seq
  }

  /** Output from the holder: only what follows what the screen has been handed. */
  private read(seq: number, data: Uint8Array): void {
    if (this.over || seq + data.length <= this.heard) return
    if (seq > this.heard) {
      // Bytes the holder no longer had: the stream goes on past them.
      this.coalescer.flush()
      this.ring.skip(seq)
      this.scanner = new Scanner()
      this.scanned = seq
      this.heard = seq
    }
    const fresh = data.subarray(this.heard - seq)
    this.heard = seq + data.length
    this.printed += fresh.length
    this.printedAt = Date.now()
    this.scanner.feed(fresh)
    this.coalescer.push(fresh)
    this.ask()
  }

  private ended(held: Held, code: number | null): void {
    if (this.over || this.held !== held) return
    this.coalescer.flush()
    this.held = null
    this.shell = undefined
    this.emit({ t: 'ended', session: this.id, code })
  }

  /** A holder that could not be started: the session ended, and Enter tries again. */
  private died(held: Held): void {
    if (this.over || this.held !== held) return
    this.held = null
    this.emit({ t: 'ended', session: this.id, code: null })
  }

  private sent(bytes: Uint8Array): void {
    if (this.over) return
    const seq = this.ring.append(bytes)
    this.screen.write(bytes)
    this.emit({ t: 'out', session: this.id, seq, data: bytes })
  }

  /** A frame on the link, in order behind any output held for a screen. */
  private emit(frame: NibdFrame): void {
    if (this.holding) this.holding.push(frame)
    else this.machine.send(frame)
  }

  input(data: Uint8Array): void {
    // Its echo goes the moment the pty prints it; see coalesce.ts.
    this.coalescer.typed()
    this.held?.write(data)
    if (data.includes(13)) this.ask()
  }

  pause(paused: boolean): void {
    this.held?.pause(paused)
  }

  resize(cols: number, rows: number): void {
    if (!this.settled) {
      this.wanted = { cols, rows }
      return
    }
    if (this.over || (cols === this.screen.cols && rows === this.screen.rows)) return
    this.coalescer.flush()
    this.screen.resize(cols, rows)
    this.held?.resize(cols, rows)
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
    await this.ready
    if (this.over) return
    this.toSafePoint()
    const data = this.ring.since(since)
    if (data) {
      this.machine.send({ t: 'out', session: this.id, seq: since, data })
      return
    }
    const seq = this.ring.end
    const holding: NibdFrame[] = []
    this.holding = holding
    const screen = await this.screen.serialized()
    this.machine.send({
      t: 'screen',
      session: this.id,
      seq,
      cols: this.screen.cols,
      rows: this.screen.rows,
      data: screen,
      ...(this.restoredFrom ? { restored: this.restoredFrom } : {}),
    })
    this.holding = null
    for (const frame of holding) this.machine.send(frame)
  }

  /** Everything up to the last point between two whole sequences handed on now, the
   *  rest at the next frame, so a screen taken here is never cut through an escape. */
  private toSafePoint(): void {
    this.coalescer.flush(Math.max(0, this.scanned + this.scanner.safe - this.ring.end))
  }

  /** The session as Settings lists it: what is in front, asked now rather than at the
   *  next output, whether a shell runs, and when it last printed. */
  now(): SessionNow {
    const shell = this.shell
    return {
      session: this.id,
      program: shell === undefined ? null : programOf(shell),
      title: this.over ? null : this.screen.title,
      alive: this.held !== null,
      at: this.printedAt,
    }
  }

  /** The bytes printed since the last time this was asked. */
  taken(): number {
    const printed = this.printed
    this.printed = 0
    return printed
  }

  /** The whole screen and the offset it shows everything before. The next `nibd` goes
   *  on from exactly there where the holder still kept what followed; where the program
   *  is gone, its first screen is drawn back above a fresh shell. */
  async save(at: number): Promise<Saved> {
    await this.ready
    if (this.over) throw new Error('this session is no longer here')
    this.toSafePoint()
    const seq = this.ring.end
    const screen = this.screen.serialized()
    const shell = this.shell
    return {
      v: 2,
      session: this.id,
      at,
      seq,
      cols: this.screen.cols,
      rows: this.screen.rows,
      screen: await screen,
      program: shell === undefined ? this.program : programOf(shell),
      folder: shell === undefined ? null : folderOf(shell),
    }
  }

  /** The session ended for good: every process it started, its holder, its screen. */
  end(): void {
    const held = this.held
    this.held = null
    this.letGo()
    this.machine.cgroups?.kill(this.id)
    held?.kill()
  }

  /** Let go of, its program running on in its holder for the `nibd` after this one. */
  detach(): void {
    const held = this.held
    this.held = null
    this.letGo()
    held?.detach()
  }

  private letGo(): void {
    if (this.over) return
    this.over = true
    if (this.asking) clearTimeout(this.asking)
    this.screen.dispose()
  }

  /** The program in front and its title, asked at most once a second and said only
   *  when it changed. */
  private ask(): void {
    if (this.asking || this.over) return
    const wait = Math.max(0, this.askedAt + PROGRAM_EVERY - Date.now())
    this.asking = setTimeout(() => {
      this.asking = null
      this.askedAt = Date.now()
      const shell = this.shell
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

/** A save's first screen alone, as a restore draws it. */
function firstScreen(saved: Saved): Promise<string> {
  return saved.v === 2
    ? Screen.firstOf(saved.screen, saved.cols, saved.rows)
    : Promise.resolve(saved.screen)
}

/** The dim line under a screen drawn back after a boot, saying when it is from: the
 *  local terminal's `restoredLine` (lib/terminal/history.ts), in the machine's time
 *  zone, and without words, which the machine has no language for. */
function restoredLine(at: number): string {
  const when = new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `\x1b[0m\r\n\x1b[2m${when}\x1b[22m\r\n`
}
