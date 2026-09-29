/** The question before a terminal tab closes on something running.
 *
 *  VS Code's rule, and iTerm2's: a shell waiting at its prompt closes without a word, and
 *  one running anything else - a build, a server, an editor - asks first, once, however
 *  many of the tabs going are busy. What counts as running is the crate's answer; see
 *  src-tauri/src/terminal/process.rs.
 *
 *  Never as the window closes or the app quits, which is VS Code's default too: those
 *  put every tab back on the next launch, and a question per terminal on the way out is
 *  a question people learn to click through. */

import { key, t } from '../i18n.svelte'
import { invoke } from '../tauri'
import type { Tab } from '../workspace.svelte'
import { ptyOf } from './running'

/** Whether the terminals among `closing` may go. */
export async function mayEnd(closing: readonly Tab[]): Promise<boolean> {
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
