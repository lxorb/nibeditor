/** Making a terminal tab: which shell, which folder, and where in the strip.
 *
 *  Every door comes here - the plus and Ctrl+T through new-kinds.ts, the palette, a
 *  tab's own "Open another", a row of the file list - so there is one answer to where a
 *  terminal starts and what it is called. The tab is made at once, named for its shell;
 *  the shell itself is started by the surface when the tab is first on screen. See
 *  sessions.svelte.ts.
 *
 *  Light: nothing of xterm.js is here, so the menus can carry it. */

import { identifier } from '../identifier'
import type { MenuEntry } from '../menu-item'
import { type Tab, workspace } from '../workspace.svelte'
import { type Shell, shellName, shells } from './shells.svelte'
import { hostIdOf, startingFolder, writeSpec } from './spec'

interface Where {
  /** The folder to start in; where the reader is working when not given. */
  folder?: string | null
  /** The tab it goes beside, rather than at the end of the strip. */
  beside?: string
  /** False for a terminal made behind the tab in front, which starts its shell the
   *  first time it is shown or typed into; see lib/agents/workspace/terminal-tab.ts. */
  activate?: boolean
}

/** A terminal, in the shell given or the one Settings chose, in the pane that has the
 *  keyboard. Answers its tab, or null where there is no shell to start and for a
 *  terminal on another machine, whose connection is remote/open.ts's. */
export async function openTerminal(shellId?: string, where: Where = {}): Promise<Tab | null> {
  // Another beside a terminal on another machine is another connection to it.
  const host = shellId === undefined ? null : hostIdOf(shellId)
  if (host !== null) {
    const { openRemote } = await import('../remote/open')
    await openRemote(host, where.beside === undefined ? {} : { beside: where.beside })
    return null
  }

  const list = await shells.ask()
  const shell = list.find((one) => one.id === shellId) ?? shells.chosen
  if (!shell) return null

  const folder = where.folder === undefined ? hereFolder() : where.folder
  const text = writeSpec({ shell: shell.id, folder, key: identifier(), name: null })
  return workspace.openUnsaved(
    'terminal',
    text,
    shellName(shell),
    where.beside ?? null,
    where.activate ?? true,
  )
}

/** The folder the reader is working in; see `startingFolder`. */
function hereFolder(): string | null {
  const showing = workspace.showing(workspace.panes.focusedId)?.path ?? null
  const roots = workspace.spaces.map((space) => space.root)
  return startingFolder(showing, workspace.activeSpace?.root ?? null, roots)
}

/** The shells, as rows of a menu that makes one: the one a new terminal opens ticked,
 *  the way a chooser marks the default. `make` is handed the shell pressed. */
export async function shellRows(make: (shell: Shell) => void): Promise<MenuEntry[]> {
  const list = await shells.ask()
  const chosen = shells.chosen?.id

  return list.map((shell) => ({
    label: shellName(shell),
    ...(shell.id === chosen ? { checked: true } : {}),
    run: () => make(shell),
  }))
}
