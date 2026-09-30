/** The shells this machine has, and the three things Settings says about terminals: which
 *  shell a new one opens, how large its type is, and whether a restart puts back what
 *  was on its screen.
 *
 *  The list is the crate's (see src-tauri/src/terminal/shells.rs) and is asked for the
 *  first time something needs it - a chooser opening, the settings pane, a terminal
 *  being made - and never at launch: finding the WSL distributions costs a process. Every
 *  later ask is the same promise.
 *
 *  Both settings belong to this machine and are never sent to the account: a shell is a
 *  program on one computer, and the one a laptop has may not be on the desktop. */

import { t } from '../i18n.svelte'
import { keep, storedText } from '../stored'
import { invoke, isDesktop } from '../tauri'

export interface Shell {
  id: string
  name: string
}

/** Where the three settings are kept. */
const SHELL_KEY = 'nib:terminal-shell'
const SIZE_KEY = 'nib:terminal-size'
const RESTORE_KEY = 'nib:terminal-restore'

/** The type sizes Settings offers, and where a terminal starts: the size a code block is
 *  read at, a little under the note's own. */
export const SIZES = { least: 9, most: 28, initial: 13 } as const

/** A size as a size, whatever storage handed back. */
function sizeOf(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(number)) return SIZES.initial
  return Math.min(SIZES.most, Math.max(SIZES.least, Math.round(number)))
}

/** What a shell the crate offered is called here. Product names stay as they are;
 *  Command Prompt is the one Windows translates itself, so it is translated here too. */
export function shellName(shell: Shell): string {
  return shell.id === 'cmd' ? t('Command Prompt') : shell.name
}

/** What the crate said, read rather than trusted. */
function readShells(value: unknown): Shell[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((one: unknown) => {
    if (typeof one !== 'object' || one === null) return []
    const { id, name } = one as { id?: unknown; name?: unknown }
    return typeof id === 'string' && typeof name === 'string' ? [{ id, name }] : []
  })
}

class Shells {
  /** The shells, the platform's default first. Empty until somebody has asked. */
  list = $state.raw<Shell[]>([])
  /** The one Settings chose, by id, or empty for the platform's default. */
  preferred = $state(storedText(SHELL_KEY) ?? '')
  /** How large a terminal's type is, in pixels. */
  size = $state(sizeOf(storedText(SIZE_KEY)))
  /** Whether a terminal's last lines are kept for the next launch: on, as VS Code,
   *  Windows Terminal and Warp all start. See history.ts. */
  restoring = $state(storedText(RESTORE_KEY) !== 'no')

  private asked: Promise<Shell[]> | null = null

  /** The list, found once. Nothing where there is no crate to find it: a browser and a
   *  phone offer no terminal at all. */
  ask(): Promise<Shell[]> {
    if (!isDesktop) return Promise.resolve([])

    this.asked ??= invoke<unknown>('terminal_shells')
      .then((found) => {
        this.list = readShells(found)
        return this.list
      })
      .catch(() => {
        // Asked again next time: a refusal here is a crate that could not look, and a
        // chooser with no shells in it is a chooser worth another try.
        this.asked = null
        return []
      })

    return this.asked
  }

  /** The shell a new terminal opens: the one Settings chose, while this machine still
   *  has it, and the platform's own otherwise. */
  get chosen(): Shell | undefined {
    return this.list.find((one) => one.id === this.preferred) ?? this.list[0]
  }

  choose(id: string) {
    this.preferred = id
    keep(SHELL_KEY, id)
  }

  setSize(size: number) {
    this.size = sizeOf(String(size))
    keep(SIZE_KEY, String(this.size))
  }

  /** Off forgets every terminal's lines at once, rather than only writing no more of
   *  them: what somebody turns this off for is what is already written. */
  setRestoring(on: boolean) {
    this.restoring = on
    keep(RESTORE_KEY, on ? 'yes' : 'no')
    if (!on) void import('./history').then((one) => one.forgetHistories())
  }
}

export const shells = new Shells()
