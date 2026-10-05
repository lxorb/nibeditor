/** Whether a file is an online terminal - a `.term`, whose words name a session on its
 *  owner's machine - and what its tab is called (docs/online-terminal.md 4.5, 4.10). */

const TERM = /\.term$/i

/** Whether a path or a name is a `.term`. */
export function isTermTarget(path: string | null): boolean {
  return path !== null && TERM.test(path)
}

/** Whether a tab is an online terminal: a terminal whose file is a `.term`. */
export function isOnlineTab(tab: { kind: string; path: string | null }): boolean {
  return tab.kind === 'terminal' && isTermTarget(tab.path)
}

/** The name a new online terminal's file is made with, numbered after the first. */
export const MADE_NAME = 'Terminal'

/** A `.term`'s name without its ending, as the tab says it. */
export function termName(name: string): string {
  return name.replace(TERM, '') || name
}

/** Whether a file's name is still the one it was made with, `Terminal` or `Terminal 2`, so
 *  the tab says what runs in it instead of the name. */
export function isMadeName(name: string): boolean {
  return new RegExp(`^${MADE_NAME}(?: \\d+)?$`, 'i').test(termName(name).trim())
}
