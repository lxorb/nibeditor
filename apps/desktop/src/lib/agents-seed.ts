/** The `AGENTS.md` a new space starts with: what an assistant working in it has to
 *  know and the app does not already tell it, and nothing else.
 *
 *  Read by the AI sidebar as the space's instructions (ai/sidebar/setup.ts), the same
 *  file Claude Code, Codex and the rest read in a folder. Remembering is nib's own line
 *  (ai/commands/instructions.ts) and writes under the `## Memory` heading, so the
 *  heading is here already, as `/memory` makes it. Not translated: the model reads it,
 *  and the writer's own language is the first thing it says to use.
 *
 *  Made with the space from the switcher and the first screen, not with an import,
 *  which brings what the folder had. */

export const AGENTS_NAME = 'AGENTS.md'

export const AGENTS_SEED = `# AGENTS

These are my notes. Write in the language and style they are written in, and ask before deleting, moving or renaming any of them.

## Memory
`

/** Whether a note is the seed exactly as the app wrote it, so an untouched one is not
 *  somebody's writing; see `isUntouchedWelcome`, which is the same question. */
export function isUntouchedAgents(path: string, content: string): boolean {
  const name = path.split(/[\\/]/u).at(-1) ?? ''
  return name === AGENTS_NAME && content === AGENTS_SEED
}
