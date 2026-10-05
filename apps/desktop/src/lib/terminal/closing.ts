/** The question before a terminal tab closes on something running.
 *
 *  VS Code's rule, and iTerm2's: a shell waiting at its prompt closes without a word, and
 *  one running anything else - a build, a server, an editor - asks first, once, however
 *  many of the tabs going are busy. What counts as running is the crate's answer; see
 *  src-tauri/src/terminal/process.rs.
 *
 *  The window closing and the app quitting ask one question for all of them instead; see
 *  lib/quitting. Settings' Warn before quitting is that question's, and this one asks
 *  whatever it says: closing a tab is always one tab's program stopped on purpose or by
 *  a slip, which VS Code's `confirmOnKill` asks about by default too. */

import { key, t } from '../i18n.svelte'
import { invoke } from '../tauri'
import type { Tab } from '../workspace.svelte'
import { ptyOf } from './running'

/** Whether the terminals among `closing` may go. */
export async function mayEnd(closing: readonly Tab[]): Promise<boolean> {
  // Another machine's terminal counts as busy while it is connected, as macOS Terminal
  // and iTerm2 count an `ssh`: what runs there cannot be seen from here, and closing it
  // ends it. The crate says so; see `Held::busy` in src-tauri/src/terminal.rs.
  const shells = closing.filter((tab) => tab.kind === 'terminal')
  const busy = await Promise.all(
    shells.map(async (tab) => {
      const id = ptyOf(tab.id)
      if (id === undefined) return null
      const running = await invoke<boolean>('pty_busy', { id }).catch(() => false)
      return running ? tab : null
    }),
  )

  const asking = busy.filter((tab): tab is Tab => tab !== null)
  const [only] = asking
  if (!only) return true

  const { prompt } = await import('../prompt.svelte')
  return prompt.confirm({
    title:
      asking.length === 1
        ? t('Stop what is running in {name}?', { name: only.shown })
        : t('Stop what is running in these terminals?'),
    confirmLabel: key('Stop'),
    danger: true,
  })
}
