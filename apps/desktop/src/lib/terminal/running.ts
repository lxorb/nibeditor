/** Which shell each terminal tab is running right now, by the tab's id.
 *
 *  A registry of its own, and nothing else, so the question asked before a tab closes
 *  (closing.ts) can find a tab's shell without fetching xterm.js to do it: a terminal
 *  restored after a restart and never looked at has no shell yet, and closing it
 *  should cost nothing. The sessions write it; see sessions.svelte.ts. */

const running = new Map<string, string>()

/** The session a tab's shell runs under, or undefined for a tab running none. */
export function ptyOf(tabId: string): string | undefined {
  return running.get(tabId)
}

export function setPty(tabId: string, pty: string | null): void {
  if (pty === null) running.delete(tabId)
  else running.set(tabId, pty)
}
