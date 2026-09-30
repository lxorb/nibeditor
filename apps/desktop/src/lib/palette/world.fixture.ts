/** A space, a strip of tabs, a history and a few commands and settings, built by hand
 *  for the palette's tests: the shape `candidates` is handed by the palette, with
 *  nothing behind it. */

import type { Command } from '../commands'
import type { Visit } from '../web-tab/visits'
import type { Bookmark } from '../workspace/bookmarks.svelte'
import type { Entry } from '../workspace.svelte'
import type { World } from './kinds'
import type { OpenTab, Row } from './rows'
import type { Setting } from './settings'

export const ROOT = '/Space'

export const file = (path: string): Entry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path: `${ROOT}/${path}`,
  is_dir: false,
  modified: 0,
  created: 0,
  children: [],
})

export const command = (id: string, label: string, more: Partial<Command> = {}): Command => ({
  id,
  label,
  run: () => undefined,
  ...more,
})

export const tab = (id: string, shown: string, more: Partial<OpenTab> = {}): OpenTab => ({
  id,
  kind: 'note',
  path: null,
  shown,
  url: null,
  ...more,
})

export const visit = (url: string, title: string, more: Partial<Visit> = {}): Visit => ({
  url,
  title,
  visits: 1,
  typed: 0,
  last: NOW - 60_000,
  ...more,
})

export const setting = (label: string, where: string, more: Partial<Setting> = {}): Setting => ({
  section: 'editor',
  label,
  where,
  names: [],
  words: [],
  field: null,
  row: true,
  ...more,
})

export const NOW = Date.UTC(2026, 8, 30, 12)

export function world(more: Partial<World> = {}): World {
  return {
    root: ROOT,
    files: [],
    tabs: [],
    active: null,
    focused: null,
    recent: [],
    bookmarks: [] as Bookmark[],
    commands: [],
    pages: [],
    settings: [],
    worth: () => 0,
    now: NOW,
    ...more,
  }
}

/** What a row is called, the way the list says it. */
export function named(row: Row): string {
  switch (row.kind) {
    case 'note':
      return row.entry.name.replace(/\.md$/, '')
    case 'tab':
      return `tab ${row.tab.shown}`
    case 'command':
      return `> ${row.command.label}`
    case 'bookmark':
      return `bookmark ${row.label}`
    case 'page':
      return `page ${row.title}`
    case 'setting':
      return `setting ${row.setting.label}`
    case 'place':
      return `# ${row.text}`
    case 'make':
      return `new ${row.make.name}`
    case 'address':
      return `go ${row.address}`
  }
}
