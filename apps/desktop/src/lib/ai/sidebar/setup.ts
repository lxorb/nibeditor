/** The engine as the panel asks it: which provider an id is, and what the model is told
 *  beyond its mode's own lines (docs/ai-sidebar.md 4.6) - the space's `AGENTS.md` and a
 *  `CLAUDE.md` beside it, which are notes the reader can read and change, the commands'
 *  own lines (lib/ai/commands/instructions.ts), and Ask's rule for citing the passages a
 *  message carries.
 *
 *  One setup for the whole panel, so every thread shares one engine and words steered
 *  into a running turn reach it, Claude Code's and Codex's included (chat/engine.ts). */

import type { ProviderKind } from '../providers'
import { ai } from '../store.svelte'
import { engineFor, type Setup } from '../chat/engine'
import type { Engine, Thread } from '../chat/types'
import { workspace } from '../../workspace.svelte'
import { instructionsFor } from '../commands/instructions'
import { CITING, cites } from './citations'

/** The files the space's instructions are read from, at the space's root. */
const INSTRUCTIONS = ['AGENTS.md', 'CLAUDE.md']

/** What the instructions came to for each thread the last time they were asked, for
 *  the ring's band. */
const told = new Map<string, string>()

async function instructionsOf(thread: Thread): Promise<string> {
  const space = workspace.spaces.find((one) => one.id === thread.space)
  const read = space
    ? await Promise.all(
        INSTRUCTIONS.map((name) => workspace.noteText(`${space.root}/${name}`).catch(() => null)),
      )
    : []
  // The commands' own lines after the space's: the profile `/agents` chose, the style
  // `/output-style` chose, and how remembering works while memory is on.
  const commands = await instructionsFor(thread).catch(() => '')
  const said = [
    ...read.filter((one): one is string => !!one?.trim()),
    ...(commands.trim() ? [commands] : []),
    ...(cites(thread.turns) ? [CITING] : []),
  ]
  const words = said.join('\n\n')
  told.set(thread.id, words)
  return words
}

const setup: Setup = {
  provider: (id) => ai.providers.find((one) => one.id === id) ?? null,
  instructions: instructionsOf,
}

/** The instructions last sent with a thread. */
export function instructionsSent(thread: string): string {
  return told.get(thread) ?? ''
}

/** The engine a provider's threads are answered by. */
export async function engineOf(kind: ProviderKind): Promise<Engine> {
  return await engineFor(kind, setup)
}
