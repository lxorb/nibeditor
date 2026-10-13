/** A web note's own web data, chosen from its tab's menu or its row in the file list (#239).
 *
 *  Emil, 2026-10-13: *"there should be an option that you can set for a web note / tab when
 *  right clicking on it that gives it independent web data"*. Firefox's containers are
 *  the model, one cookie jar per container and the history shared, and so are their two
 *  faults, which this does not repeat: the choice is in the menu of the thing it is about,
 *  ticked where it stands, and undone the way it was made.
 *
 *  - **Separate**: a new id goes in the note's file (`Nib-Data`, see shortcut.ts) and its
 *    page is built again in a store of its own, empty - signed out, which is the point of
 *    one: a second account on the same site. Said under the bar for a moment.
 *  - **Global**: asked first, because what the note's pages were signed in to is deleted -
 *    a store nobody names is a login nobody can see - then the id comes out of the file,
 *    the page is built again in the store every page shares, and the note's own is
 *    cleared through the same call Delete browsing data makes (web_clear.rs).
 *
 *  The file is the whole of the choice, so it moves and is renamed with the note, syncs
 *  with it, and is the same choice on every computer. Fetched with the press. */

import { t } from '../i18n.svelte'
import { menu } from '../menu.svelte'
import { prompt } from '../prompt.svelte'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { pages } from './pages.svelte'
import { withOwn } from './own-file'
import { readWebFile } from './shortcut'
import { freshOwn, ownStore } from './web-data.svelte'

/** The two places a web note's pages may keep what websites store. */
type Where = 'global' | 'separate'

const WHERE: readonly Where[] = ['global', 'separate']

/** The note's words: the open document's, or the file's. */
async function textOf(path: string): Promise<string | null> {
  const open = workspace.documentAt(path)
  if (open) return open.text
  return invoke<string>('read_note', { path }).catch(() => null)
}

/** The choice in place of the row that asked, the one in force ticked: the shared web
 *  data, or the note's own. */
export async function showWebData(path: string): Promise<void> {
  const text = await textOf(path)
  const now: Where = readWebFile(path, text)?.own ? 'separate' : 'global'
  const said: Record<Where, string> = { global: t('Global'), separate: t('Separate') }
  menu.replace(
    WHERE.map((where) => ({
      label: said[where],
      checked: where === now,
      run: () => void choose(path, where),
    })),
  )
}

/** Keeps the note's web data where it was asked to. */
async function choose(path: string, where: Where): Promise<void> {
  const text = await textOf(path)
  if (text === null) return
  const was = readWebFile(path, text)?.own ?? null
  if ((was !== null) === (where === 'separate')) return

  if (where === 'global') {
    const sure = await prompt.confirm({
      title: t('Share this note’s web data again?'),
      detail: t('What its pages are signed in to on this computer is deleted.'),
      confirmLabel: t('Share again'),
      danger: true,
    })
    if (!sure) return
  }

  const own = where === 'separate' ? freshOwn() : null
  const content = withOwn(path, text, own)
  if (content === null) return

  workspace.documentAt(path)?.replace(content, false)
  await writeFile(path, content)

  // Its open page moves now, before the store it leaves is cleared; see `rehouse`.
  const said = own ? t('This note keeps its own web data now') : t('Back on the shared web data')
  for (const tab of workspace.tabs) {
    if (tab.kind === 'web' && tab.path === path) await pages.rehouse(tab.id, own, said)
  }

  if (was !== null && own === null) {
    await invoke('web_clear', {
      stores: [ownStore(was)],
      clearing: { since: 0, site: true, cache: true },
      sites: [],
    }).catch(() => undefined)
  }
}
