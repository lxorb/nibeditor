/** What choosing a row of the palette does, and how the keys held with the press
 *  change it: Enter goes there, Ctrl+Enter (a Ctrl+click, the middle button) opens a
 *  tab of its own behind this one and Ctrl+Shift+Enter in front of it, and
 *  Ctrl+Alt+Enter a note in a pane to the right, Obsidian's chord. Chrome's rule for a
 *  link, kept the same everywhere; see new-tab.ts.
 *
 *  What there is to do it with is handed in, so the whole of it is a test with a
 *  stand-in that writes down what it was asked. */

import type { OpenHow, Press, TabAsk } from '../new-tab'
import { howFor, linkAsk, tabAsk } from '../new-tab'
import type { Section } from '../settings.svelte'
import type { NoteToMake } from './new-note'
import type { Row } from './rows'

/** What the app can be asked to do. */
export interface Hands {
  openEntry(path: string, how: OpenHow): void
  openAside(path: string): void
  openPage(url: string, ask: TabAsk): void
  activate(tab: string): void
  openAtHeading(path: string, heading: string, how: OpenHow): void
  openAtBlock(target: string, how: OpenHow): void
  revealFolder(path: string): void
  searchFor(words: string): void
  openGraph(view: string | undefined): void
  showSetting(section: Section, landing: string | null): void
  make(note: NoteToMake): void
  goto(line: number): void
}

/** Whether the palette closes after, stays up, or nothing happened at all. */
export type Chosen = 'close' | 'stay' | 'nothing'

/** A file opened the way the press asked. */
function openFile(path: string, press: Press | undefined, hands: Hands) {
  const ask = press ? linkAsk(press) : 'plain'
  if (ask === 'aside') hands.openAside(path)
  else hands.openEntry(path, howFor(ask))
}

export function choose(row: Row, press: Press | undefined, hands: Hands): Chosen {
  const ask = press ? tabAsk(press) : 'plain'

  switch (row.kind) {
    case 'command':
      if (row.command.disabled) return 'nothing'
      row.command.run()
      return 'close'
    case 'note':
      openFile(row.entry.path, press, hands)
      return 'close'
    case 'tab':
      // A tab is switched to. Asked for a tab of its own, it is what it holds, opened
      // again the way the press asked.
      if (press && linkAsk(press) !== 'plain' && row.tab.path) openFile(row.tab.path, press, hands)
      else if (ask !== 'plain' && row.tab.url) hands.openPage(row.tab.url, ask)
      else hands.activate(row.tab.id)
      return 'close'
    case 'page':
    case 'address':
      hands.openPage(row.url, ask)
      return 'close'
    case 'setting': {
      // A switch is flipped where it stands, as JetBrains' search flips one, and the
      // list stays up showing it flipped: there is nowhere further to go. Anything
      // else opens its pane, scrolled to it.
      const field = row.setting.field
      if (field?.kind === 'switch') {
        field.set(!field.get())
        return 'stay'
      }
      hands.showSetting(row.setting.section, row.setting.row ? row.setting.label : null)
      return 'close'
    }
    case 'bookmark':
      return openBookmark(row, ask, hands)
    case 'make':
      hands.make(row.make)
      return 'close'
    case 'place':
      hands.goto(row.line)
      return 'close'
  }
}

/** A bookmark, opened the way its own row above the file list opens it. */
function openBookmark(row: Extract<Row, { kind: 'bookmark' }>, ask: TabAsk, hands: Hands): Chosen {
  const mark = row.mark
  const how = howFor(ask)

  switch (mark.kind) {
    case 'folder':
      if (row.path) hands.revealFolder(row.path)
      break
    case 'heading':
      hands.openAtHeading(mark.path, mark.text, how)
      break
    case 'block':
      hands.openAtBlock(mark.path, how)
      break
    case 'search':
      hands.searchFor(mark.text)
      break
    case 'graph':
      hands.openGraph(mark.view)
      break
    case 'note':
      if (row.path) hands.openEntry(row.path, how)
      break
    case 'group':
      return 'nothing'
  }

  return 'close'
}
