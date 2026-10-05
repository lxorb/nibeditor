/** The AI panel's three modes (docs/ai-sidebar.md 4.4): what each is called, the order
 *  Shift+Tab steps through them, and how a stored one is read. The one place the panel,
 *  the commands and the thread store take them from.
 *
 *  - **Approve**: every tool the grant reaches; each change waits for the reader's
 *    Approve, a read never does. The safe one, so a first thread starts in it.
 *  - **Plan**: reads, and writes the plan as a note.
 *  - **Agent**: every tool, nothing asked; every change can be kept or undone after. */

import { key } from '../i18n.svelte'

export type Mode = 'approve' | 'plan' | 'agent'

/** Shift+Tab's order: Agent is one press from Approve, as Claude Code's accept-edits is
 *  one from its default. */
export const MODES: readonly Mode[] = ['approve', 'agent', 'plan']

/** A thread's mode before anybody picked one. */
export const FIRST_MODE: Mode = 'approve'

const WORDS: Record<Mode, string> = {
  approve: key('Approve'),
  plan: key('Plan'),
  agent: key('Agent'),
}

/** The mode's name, as the catalogues key it: translate where it is drawn. */
export function modeWord(mode: Mode): string {
  return WORDS[mode]
}

/** A mode as it was written down, or null for anything else. Ask, which Approve replaced,
 *  reads as Approve: the mode that changes nothing the reader did not say yes to. */
export function modeIn(value: unknown): Mode | null {
  if (value === 'ask') return 'approve'
  return MODES.find((one) => one === value) ?? null
}

/** The mode after this one. */
export function nextMode(mode: Mode): Mode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length] ?? FIRST_MODE
}
