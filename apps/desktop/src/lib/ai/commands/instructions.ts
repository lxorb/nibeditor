/** What the commands add to what a thread's model is told (docs/ai-sidebar.md 4.6, 3.2,
 *  3.3): the output style `/output-style` chose, the agent profile `/agents` chose, and
 *  how remembering works while memory is on.
 *
 *  The panel's engine setup appends `instructionsFor(thread)` to the space's own
 *  instructions (6.5), so every road gets the same lines: nib's own loop as part of the
 *  system prompt, Claude Code and Codex as the fixed style slot the crate appends.
 *  Nothing here is text from a page: a style or a profile is a note of the reader's,
 *  and the rest is nib's own. Not translated: nobody reads it but the model. */

import { isBoolean, keep, stored } from '../../stored'
import type { Thread } from '../chat/types'
import { foundNamed } from './found'

/** The fields the commands keep on a thread, beside lane 1's. Written down with it:
 *  the thread store keeps every field it does not check (chat/threads.ts). */
interface Kept {
  /** `/output-style`: a built-in style's id, or a style note's name. */
  style?: string
  /** `/agents`: the profile note's name. */
  agent?: string
}

export type Held = Thread & Kept

/** The styles every reader has, Claude Code's and Codex's between them. `default` is
 *  no line at all. */
export const STYLES: Readonly<Record<string, string>> = {
  default: '',
  concise:
    'Answer as briefly as the question allows: no preamble, no recap, no lists where a sentence will do.',
  explanatory:
    'Explain your reasoning as you go: why each step, what you considered and left out, in plain words.',
  teaching:
    'Teach rather than do: explain the idea, show one small step, and leave the next one for the reader to try.',
}

const MEMORY_KEY = 'nib:ai-memory'

/** Whether the model may remember (`/memory on|off`). On unless turned off. */
function remembers(): boolean {
  const value = stored(MEMORY_KEY)
  return isBoolean(value) ? value : true
}

export function setRemembers(on: boolean): void {
  keep(MEMORY_KEY, JSON.stringify(on))
}

/** How remembering is done: an edit to a note the reader can read, never a hidden
 *  store (4.6). */
const REMEMBERING = [
  'When the reader asks you to remember something, or you learn a lasting preference of theirs,',
  'append it as one line under a `## Memory` heading in AGENTS.md at the root of the space',
  '(make the heading, or the note, if there is none), with edit_note. Never keep it anywhere else.',
].join(' ')

/** A style's line: a built-in's, or a style note's body. */
async function styleLine(style: string | undefined): Promise<string> {
  if (!style) return ''
  if (style in STYLES) return STYLES[style] ?? ''
  return (await foundNamed('output-style', style))?.body ?? ''
}

/** Everything the commands add for this thread, or nothing. */
export async function instructionsFor(thread: Thread): Promise<string> {
  const held = thread as Held
  const profile = held.agent ? await foundNamed('agent', held.agent) : null
  const lines = [
    profile?.body ?? '',
    await styleLine(held.style),
    remembers() && thread.mode === 'agent' ? REMEMBERING : '',
  ]
  return lines.filter(Boolean).join('\n\n')
}
