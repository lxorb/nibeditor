/** Making an online terminal: a new tab's card on O (Ctrl+T or the plus), the palette's New
 *  online terminal and an empty pane all come here (docs/online-terminal.md 4.5, 4.10).
 *
 *  A new session on the reader's own machine - made, and started, if there is none yet -
 *  named by a `.term` file in the folder new notes go to, `Terminal`, `Terminal 2`..., and
 *  that file opened as a terminal tab. Signed out it opens the account sheet; not on the
 *  list yet, it says so. The file is what carries it from then on: renamed, moved to
 *  another space, bookmarked, put back after a restart and opened on another device, all
 *  as a note is. */

import { account } from '../account.svelte'
import { t } from '../i18n.svelte'
import type { OpenHow } from '../new-tab'
import { nameOf, samePath } from '../space-paths'
import { joinPath } from '../tauri'
import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import type { Refused } from './calls'
import { machine } from './machine.svelte'
import { refusalWords } from './words'
import { MADE_NAME, termName } from './path'

/** A new online terminal, in the pane that has the keyboard: beside the tab in front with
 *  `beside` (Open another, a split), at the end of the strip otherwise. Null where none
 *  was made. */
export async function openOnline(beside = false): Promise<Tab | null> {
  if (!account.accountToken) {
    account.ask('sign-in')
    return null
  }
  const root = workspace.activeSpace?.root
  if (!root) return null

  // Not on the list yet, or the service off: said before any file is made. Asked again
  // every time, but waited for only when this window has not heard yes already: the
  // socket says a refusal that came since, and the terminal is on its way meanwhile.
  const asking = machine.refresh()
  if (machine.known?.allowed !== true || machine.refused !== null) await asking
  const why = machine.known?.allowed === false ? 'list' : machine.refused
  if (why) {
    await refused(why)
    return null
  }

  // The file first, empty: sync gives it its id, the account names its session by that id,
  // and the terminal writes the session into it as it starts. See source.ts.
  const path = joinPath(root, workspace.freeName(root, `${MADE_NAME}.term`))
  await writeFile(path, '')
  await workspace.fileCame(path, 'file')
  const tab = openTerm(path, { beside })
  void workspace.loadTree()
  return tab
}

/** A `.term` in a tab of its own: a terminal tab whose document is the file, one tab per
 *  file as a PDF has, so opening it again brings the one there is forward. Its words are
 *  the file's where the caller has them, and the terminal reads the file otherwise; a
 *  restart puts it back as any tab with a file comes back. Null in the glasses' plugin,
 *  which has no terminal. */
export function openTerm(path: string, how: OpenHow = {}, text = ''): Tab | null {
  if (__EVEN_PLUGIN__) return null
  const open = workspace.tabs.find((one) => one.kind === 'terminal' && samePath(one.path, path))
  if (open) {
    if (how.activate !== false) workspace.activeTabId = open.id
    return open
  }

  const beside = how.beside ? workspace.activeTabId : null
  const name = termName(nameOf(path))
  const tab = workspace.openUnsaved('terminal', text, name, beside, how.activate ?? true)
  tab.path = path
  workspace.persist()
  return tab
}

/** Why no terminal was made, said once in the question sheet. */
async function refused(why: Refused): Promise<void> {
  if (why === 'signed-out') {
    account.ask('sign-in')
    return
  }
  const title = refusalWords(why)
  if (title === null) return
  const { prompt } = await import('../prompt.svelte')
  await prompt.choose({ title, options: [{ id: 'ok', label: t('OK'), primary: true }] })
}
