/** The AI panel's modes (docs/ai-sidebar.md 4.4): the three permission modes an agent runs
 *  in, and Plan; what each is called, the order Shift+Tab steps through them, and how a
 *  stored one is read. The one place the panel, the commands and the thread store take
 *  them from.
 *
 *  - **Approve**: every tool the grant reaches; each change waits for the reader's
 *    Approve, a read never does. The safe one, so a first thread starts in it.
 *  - **Auto**: every tool; a change is made at once and can be kept or undone after,
 *    and what Settings › AI › Access says asks (sending, deleting, publishing, the
 *    terminal, ...) still waits for the reader.
 *  - **Full permissions**: every tool, nothing asked but paying.
 *  - **Plan**: reads, and writes the plan as a note.
 *
 *  The same for every engine the panel runs - its own loop for a key or a plan, Claude
 *  Code and Codex - because those two are started with none of their own tools and their
 *  own prompts off: every change they can make is one of nib's, asked about by the crate
 *  (`supervised` in ai_agent.rs). A helper (`run_agent`) works in its parent's mode. */

import { key } from '../i18n.svelte'

export type Mode = 'approve' | 'auto' | 'full' | 'plan'

/** The menu's order: the three permission modes, least to most, then Plan. */
export const MODES: readonly Mode[] = ['approve', 'auto', 'full', 'plan']

/** Shift+Tab's order. Full permissions is not in it: asking for nothing is chosen from the
 *  menu, deliberately, as Claude Code leaves bypassing its prompts out of its own cycle. */
const CYCLE: readonly Mode[] = ['approve', 'auto', 'plan']

/** A thread's mode before anybody picked one. */
export const FIRST_MODE: Mode = 'approve'

const WORDS: Record<Mode, string> = {
  approve: key('Approve'),
  auto: key('Auto'),
  full: key('Full permissions'),
  plan: key('Plan'),
}

/** The mode's name, as the catalogues key it: translate where it is drawn. */
export function modeWord(mode: Mode): string {
  return WORDS[mode]
}

/** A mode as it was written down, or null for anything else. Ask, which Approve replaced,
 *  reads as Approve; Agent, which asked for nothing, as Full permissions. */
export function modeIn(value: unknown): Mode | null {
  if (value === 'ask') return 'approve'
  if (value === 'agent') return 'full'
  return MODES.find((one) => one === value) ?? null
}

/** The mode after this one, for Shift+Tab: Full permissions steps on to Plan. */
export function nextMode(mode: Mode): Mode {
  if (mode === 'full') return 'plan'
  return CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length] ?? FIRST_MODE
}

/** Whether a mode makes changes without the reader's Approve first. */
export function actsAlone(mode: Mode): boolean {
  return mode === 'auto' || mode === 'full'
}

/** The mode a grant's supervision is, for a helper an outside agent starts: asking first
 *  where it asks first, never where it does not. */
export function modeOfGrant(supervision: 'unsupervised' | 'confirm' | 'autonomous'): Mode {
  if (supervision === 'confirm') return 'approve'
  return supervision === 'autonomous' ? 'full' : 'auto'
}
