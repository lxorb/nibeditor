/** Where a terminal's screen is fed from: a shell in a pty on this machine, or a session
 *  on the reader's online machine over a socket (docs/online-terminal.md). The one seam
 *  between the two.
 *
 *  Everything a terminal does with its screen - the keys, find, copy, paste, links, the
 *  look, the last lines between runs - is the session's (sessions.svelte.ts) and the same
 *  for both. What differs is only where the bytes come from and where the keys go, and a
 *  few things only one side can know: a pty's kernel can be asked what runs in it, while
 *  an online session is told, along with a whole screen to draw and the machine's state.
 *  So a source says everything it knows as one `Said`, and the session draws it.
 *
 *  The pty's source is here; the socket's is lib/online/source.ts, fetched with the
 *  first online terminal and never before. */

import type { DownReason } from '@nib/online/wire'
import { Channel } from '../native'
import { isNumber, isRecord } from '../stored'
import { invoke } from '../tauri'

/** A machine's state as a tab shows it: live, waking, asleep, or out of its allowance
 *  and refused. Null for a terminal on this computer, which has no machine to show. */
export type Machine = 'awake' | 'starting' | 'asleep' | 'stopping' | 'down' | 'near'

/** What a source tells its terminal. */
export type Said =
  /** Output, to draw. `drawn` is called once it is on the screen. */
  | { out: Uint8Array }
  /** The shell ended, with its code; null for one a signal ended. */
  | { exit: number | null }
  /** The whole screen as it stands, serialised, at the session's size: drawn in place
   *  of whatever is there. `restored` is when a machine's restart put it back, and the
   *  program that was in front then. */
  | {
      screen: string
      cols: number
      rows: number
      restored: { at: number; program: string | null } | null
    }
  /** The session's size, which somebody else's typing set. */
  | { size: { cols: number; rows: number } }
  /** What runs in front and the title it set, as the other end saw it. */
  | { program: string | null; title: string | null }
  /** The machine's state, and why it is down where it is. */
  | { machine: Machine; reason?: DownReason }
  /** Whether the socket to the session is open; a drop comes back by itself. */
  | { connected: boolean }
  /** Whether keys typed here reach the session. */
  | { typing: boolean }
  /** The source cannot go on, and why, in words to show under the screen. */
  | { refused: string }
  /** One line worth saying under the session's screen once it is drawn. */
  | { note: string }

export interface Source {
  /** True for a session on another machine, whose programs and folders nothing on this
   *  side can see. */
  readonly remote: boolean
  /** Starts it at a size. Rejects when it cannot start. */
  start(cols: number, rows: number, said: (what: Said) => void): Promise<void>
  write(data: string, binary: boolean): Promise<void>
  resize(cols: number, rows: number): void
  /** That `bytes` of output are drawn, which lets more come. */
  seen(bytes: number): void
  /** Lets go of it: a pty is ended, a socket closed and the session left running. */
  end(): void
  /** A new shell where the last one ended, for a source that keeps its session: an
   *  online one. A pty's is a new source. */
  again?(): void
}

/** A shell in a pty on this machine, under the id given. */
export class PtySource implements Source {
  readonly remote: boolean

  constructor(
    readonly id: string,
    private readonly shell: string,
    private readonly folder: string | null,
    remote: boolean,
  ) {
    this.remote = remote
  }

  async start(cols: number, rows: number, said: (what: Said) => void): Promise<void> {
    const output = new Channel<unknown>()
    output.onmessage = (message) => {
      if (message instanceof ArrayBuffer) said({ out: new Uint8Array(message) })
      else if (isRecord(message) && isNumber(message.exit)) said({ exit: message.exit })
    }
    await invoke('pty_spawn', {
      id: this.id,
      shell: this.shell,
      folder: this.folder,
      cols,
      rows,
      output,
    })
  }

  async write(data: string, binary: boolean): Promise<void> {
    await invoke('pty_write', { id: this.id, data, binary }).catch(() => undefined)
  }

  resize(cols: number, rows: number): void {
    void invoke('pty_resize', { id: this.id, cols, rows }).catch(() => undefined)
  }

  seen(bytes: number): void {
    void invoke('pty_seen', { id: this.id, bytes }).catch(() => undefined)
  }

  end(): void {
    void invoke('pty_kill', { id: this.id }).catch(() => undefined)
  }

  /** What is in front of the shell, by the kernel; undefined where it could not say. */
  async program(): Promise<string | null | undefined> {
    const found = await invoke<unknown>('pty_program', { id: this.id }).catch(() => undefined)
    if (found === undefined) return undefined
    return typeof found === 'string' && found ? found : null
  }

  /** Whether something besides the shell runs; true where it could not say. */
  async busy(): Promise<boolean> {
    return (await invoke<unknown>('pty_busy', { id: this.id }).catch(() => true)) !== false
  }

  /** The folder the shell is in, by the kernel, or null. */
  async where(): Promise<string | null> {
    const folder = await invoke<unknown>('pty_folder', { id: this.id }).catch(() => null)
    return typeof folder === 'string' && folder ? folder : null
  }
}
