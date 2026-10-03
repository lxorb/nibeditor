/** What a terminal tab is called, and what it wears, while nobody has named it.
 *
 *  VS Code's rule, and Windows Terminal's, in one order:
 *
 *  1. a name the reader gave it, until they clear it (see rename.ts);
 *  2. a title the program running in it set - Claude Code says its conversation's topic
 *     that way (OSC 0), vim says the file it is in;
 *  3. the program in front, and the folder: `node · quaestur`;
 *  4. at the prompt, the shell and the folder: `PowerShell · quaestur`, and the shell
 *     alone where no folder is known.
 *
 *  A title is a program's and never the shell's. A shell sets one too - Command Prompt
 *  its own path, bash `user@host: ~` at every prompt, the console the program's path as
 *  it starts - and PowerShell never takes a program's back, so Windows Terminal's tabs
 *  say `✳ Claude Code` for the rest of the day. So a title counts only once a program is
 *  known to be in front, and goes when the program does: at the next prompt mark, when
 *  the shell is found in front again, or when the program blanks it on its way out, as
 *  Claude Code does. See `Front`.
 *
 *  Pure, and light: the session drives it (sessions.svelte.ts), and the tests read it
 *  without a screen. */

import { nameOf } from '../space-paths'

/** Between the program and its folder. */
const BETWEEN = ' · '

/** The longest a title is taken at: past this it is a log line, not a name. */
const TITLE_MOST = 120

/** What a title starts with that is not words: Claude Code's ✳, and the dot it turns
 *  every second while it works - kept, the name would flicker. */
const DECORATION = /^[^\p{L}\p{N}"'([{<]+/u

/** A console's own title, which Windows sets to the program's path as it starts and
 *  Command Prompt to its own path and the command line: the program's file, not a
 *  name anybody chose. */
const CONSOLE_TITLE = /^(?:administrator:\s*)?[a-z]:\\.*\.(?:exe|com|bat|cmd)\b/i

/** A title as a tab would say it, or null for one that is no program's name. */
export function programTitle(raw: string): string | null {
  const plain = raw.replace(/\p{Cc}/gu, '').trim()
  if (CONSOLE_TITLE.test(plain)) return null

  const words = plain.replace(DECORATION, '').trim() || plain
  if (!words) return null
  return words.length > TITLE_MOST ? `${words.slice(0, TITLE_MOST - 1)}…` : words
}

/** The last part of a folder, whichever separator wrote it: `quaestur` for
 *  `C:\Users\me\quaestur` and `/home/me/quaestur`; a drive or the root as itself. */
export function folderName(folder: string | null): string | null {
  if (!folder) return null

  const trimmed = folder.replace(/[\\/]+$/, '')
  if (!trimmed) return '/'
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed
  return nameOf(trimmed) || trimmed
}

/** What the tab says, out of what is known; see the top of this file. */
export function terminalName(parts: {
  /** The name the reader gave, or null. */
  given: string | null
  title: string | null
  program: string | null
  /** The shell's own name: `PowerShell`, `Ubuntu`. */
  shell: string
  folder: string | null
}): string {
  if (parts.given) return parts.given
  if (parts.title) return parts.title

  const what = parts.program ?? parts.shell
  const where = folderName(parts.folder)
  return where ? `${what}${BETWEEN}${where}` : what
}

/** What is in front of a terminal's shell, as far as a title is concerned: which
 *  program, and the title it set.
 *
 *  `blind` is a shell whose programs the system cannot list - a WSL distribution's are
 *  in the Linux kernel - and there a title counts from Enter to the next prompt mark,
 *  which the shells nib starts all make (see shells.rs). */
export class Front {
  /** The program in front, by name, or null for the shell. */
  program: string | null = null
  /** The title the program set, once it is known to be the program's. */
  title: string | null = null
  /** Whether the shell is at its prompt: from its start until Enter, and from each
   *  prompt mark until the next Enter. A title said then is the shell's. */
  private prompting = true
  /** A title said while it is not yet known whose it is, which a look decides. */
  private waiting: string | null = null

  constructor(private readonly blind: boolean) {}

  /** Enter: whatever was typed runs now. */
  entered() {
    this.prompting = false
  }

  /** A prompt mark: the shell is in front again, and what ran has gone. */
  prompted() {
    this.prompting = true
    this.program = null
    this.title = null
    this.waiting = null
  }

  /** A title said. Answers whether a look at what is in front would decide it. */
  titled(raw: string): boolean {
    const title = programTitle(raw)
    // Blank, which is how Claude Code leaves: the title goes with it.
    if (!raw.trim()) {
      this.title = null
      this.waiting = null
      return false
    }
    if (title === null || this.prompting) return false

    if (this.program !== null || this.blind) {
      this.title = title
      return false
    }
    this.waiting = title
    return true
  }

  /** What a look found in front: a program, or null for the shell itself. */
  looked(program: string | null) {
    if (program !== this.program) this.title = null
    this.program = program
    if (program !== null && this.waiting !== null) this.title = this.waiting
    this.waiting = null
  }

  /** Whether a look is worth asking for when the output rests: a program was in front,
   *  and may have gone. A shell at its prompt is never looked at. */
  get worthLooking(): boolean {
    return !this.blind && !this.prompting && (this.program !== null || this.waiting !== null)
  }
}

/** Which mark a terminal wears: the program in front where there is one with a mark
 *  of its own, else its shell's. See marks.ts for the drawings. */
export type TerminalMark =
  | 'claude'
  | 'codex'
  | 'node'
  | 'python'
  | 'git'
  | 'ssh'
  | 'docker'
  | 'vim'
  | 'powershell'
  | 'cmd'
  | 'shell'

/** The programs with a mark of their own, by the name the system gives them. */
const PROGRAMS: readonly [RegExp, TerminalMark][] = [
  [/^claude$/, 'claude'],
  [/^codex$/, 'codex'],
  [/^node(js)?$/, 'node'],
  [/^(python(\d+(\.\d+)?)?w?|py|pyw|ipython\d*)$/, 'python'],
  [/^git$/, 'git'],
  [/^(ssh|mosh|mosh-client)$/, 'ssh'],
  [/^(docker|docker-compose|podman)$/, 'docker'],
  [/^(vim?|nvim|gvim|vimx)$/, 'vim'],
]

/** The mark a program wears, or null for one with none of its own. */
export function programMark(program: string | null): TerminalMark | null {
  if (!program) return null
  const name = program.toLowerCase()
  return PROGRAMS.find(([pattern]) => pattern.test(name))?.[1] ?? null
}

/** The mark a shell wears, by the id the crate gave it: PowerShell's own, Command
 *  Prompt's, and a terminal's for the rest - bash, zsh, fish, a WSL distribution. */
export function shellMark(shell: string): TerminalMark {
  if (/^(pwsh|powershell|vs-pwsh:)/.test(shell)) return 'powershell'
  if (/^(cmd|vs-cmd:)/.test(shell)) return 'cmd'
  return 'shell'
}

/** What a terminal tab wears. */
export function terminalMark(shell: string, program: string | null): TerminalMark {
  return programMark(program) ?? shellMark(shell)
}
