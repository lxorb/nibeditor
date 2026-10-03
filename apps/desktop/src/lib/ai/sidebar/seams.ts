/** Where the two lanes that come after the panel plug into it (docs/ai-sidebar.md 6.2),
 *  so neither has to edit the panel to be drawn by it.
 *
 *  - **The commands** (lane 5): `lib/ai/commands/index.ts`, exporting `commands`, a
 *    function from the panel's context to the rows of the `/` menu. Until that file
 *    exists the menu lists the panel's own verbs (verbs-of-panel.ts).
 *  - **The changes bar** (lane 3): `lib/ai/review/ChangesBar.svelte`, drawn over the
 *    field with the open thread, once it exists.
 *
 *  Found by name through `import.meta.glob`, which is empty for a file that is not
 *  there: the build stays whole before either lane lands and needs no line changed
 *  after. Both are fetched the first time the panel needs them. */

import type { Component } from 'svelte'
import type { Command, Effort, Mode, Thread } from '../chat/types'

/** What a command can do to the panel: everything its own controls do. */
export interface PanelActions {
  send(text: string): void
  newThread(): void
  showThreads(query?: string): void
  rename(name?: string): Promise<void>
  branch(name?: string): void
  exportThread(): Promise<void>
  archive(): void
  remove(): Promise<void>
  stop(): void
  setMode(mode: Mode): void
  openModels(): void
  /** Sets the thread's model by a name the reader typed; false where none matched. */
  modelNamed(name: string): boolean
  setEffort(effort: Effort | 'next'): void
  setFast(on?: boolean): void
  compact(focus?: string): void
  openContext(): void
  toggleFolded(): void
}

/** What a command runs with: the words after its name, the open thread, the panel.
 *
 *  @public */
export interface CommandContext {
  args: string
  thread: Thread | null
  panel: PanelActions
}

export type PanelCommand = Command<CommandContext>

interface CommandsModule {
  commands: (panel: PanelActions) => readonly PanelCommand[]
}

const COMMANDS = import.meta.glob<CommandsModule>('../commands/index.ts')
const CHANGES = import.meta.glob<{ default: Component<{ thread: Thread }> }>(
  '../review/ChangesBar.svelte',
)

/** Lane 5's rows, or the panel's own where lane 5 has not landed. */
export async function commandsFor(panel: PanelActions): Promise<readonly PanelCommand[]> {
  const load = Object.values(COMMANDS)[0]
  if (load) return (await load()).commands(panel)
  return (await import('./verbs-of-panel')).panelCommands(panel)
}

/** Lane 3's bar, or null where it has not landed. */
export async function changesBar(): Promise<Component<{ thread: Thread }> | null> {
  const load = Object.values(CHANGES)[0]
  return load ? (await load()).default : null
}

/** The rows a few typed letters after `/` mean: a name or a synonym that starts with
 *  them, hyphens ignored either side (`/adddir` finds `/add-dir`, `/reset` finds
 *  `/new`), names before synonyms, the registry's order within each. */
export function matching(rows: readonly PanelCommand[], typed: string): PanelCommand[] {
  const bare = (word: string) => word.toLowerCase().replace(/-/g, '')
  const want = bare(typed.trim())
  const byName = rows.filter((one) => bare(one.name).startsWith(want))
  const bySynonym = rows.filter(
    (one) => !byName.includes(one) && one.synonyms.some((word) => bare(word).startsWith(want)),
  )
  return [...byName, ...bySynonym]
}

/** A command typed whole, `/name args`, split; null for text that is not one. */
export function commandIn(text: string): { name: string; args: string } | null {
  const found = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return found ? { name: found[1] ?? '', args: (found[2] ?? '').trim() } : null
}
