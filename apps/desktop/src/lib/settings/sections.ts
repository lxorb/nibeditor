/** The panes of the settings, and the line drawing each wears.
 *
 *  Data rather than markup, so the panel is left with the navigation and the
 *  search rather than with a list of names as well. Grouped the way a phone
 *  shows them: the preferences, the things an account owns, and getting a note
 *  out. */

import { account } from '../account.svelte'
import { modes } from '../modes.svelte'
import { isPlugin } from '../plugin'
import { t } from '../i18n.svelte'
import type { Section } from '../settings.svelte'
import { isDesktop } from '../tauri'

export interface Item {
  id: Section
  label: string
}

/** One path each, so the list reads at a glance rather than as a column of
 *  words. */
export const ICONS: Record<Section, string> = {
  // Sliders, not a sun with rays: the theme button at the foot of the panel is
  // already a sun, and adjusting things is what this pane is for.
  general:
    'M2 4h2.4M7.6 4H14M2 8h4.4M9.6 8H14M2 12h6.4M11.6 12H14M4.4 4a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M6.4 8a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M8.4 12a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0',
  editor: 'M2 12.6l1.6-.4 8-8a1.4 1.4 0 0 0-2-2l-8 8zM2 14.2h12',
  // A keyboard: the row of keys is the shortcut, not the writing.
  shortcuts: 'M2 4.5h12v7H2zM4.4 7h.01M6.9 7h.01M9.4 7h.01M11.9 7h.01M5.4 9.4h5.2',
  // A phone, upright, with the bar this pane is about across the bottom of it.
  mobile: 'M5 1.8h6a1 1 0 0 1 1 1v10.4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1zM4 11h8',
  markdown: 'M2.5 3.5h11v9h-11zM4.5 10.5V6l2 2.4L8.5 6v4.5M10.5 6v4.5M9 9l1.5 1.5L12 9',
  appearance:
    'M8 1.8a6.2 6.2 0 1 0 0 12.4c.9 0 1.4-.6 1.4-1.3 0-.8-.7-1.2-.7-1.9 0-.5.4-.9 1-.9h1.1a3.4 3.4 0 0 0 3.4-3.4c0-2.8-2.8-4.9-6.2-4.9zM5 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zM8 5.6a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zM11 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z',
  // A globe, the mark every browser's settings wear.
  browser:
    'M8 1.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4zM1.8 8h12.4M8 1.8c1.7 1.8 2.6 3.9 2.6 6.2s-.9 4.4-2.6 6.2c-1.7-1.8-2.6-3.9-2.6-6.2s.9-4.4 2.6-6.2z',
  // A box with its tick, which is a task done.
  tasks:
    'M4 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5zM5.4 8.1l1.9 1.9 3.4-3.8',
  // A window with a prompt in it, which every kind of terminal on the page is.
  terminal: 'M2.5 3h11v10h-11zM5 6.5l2 1.5-2 1.5M8.5 10H11',
  // A pair of lenses and the bridge between them, as the plugin's corner draws
  // them.
  glasses:
    'M4.3 9.4a2.7 2.7 0 1 0 0-.1M11.7 9.4a2.7 2.7 0 1 0 0-.1M7 9.4h2M1.6 8L2.6 5.3h2.7M14.4 8l-1-2.7h-2.7',
  account: 'M8 8.4a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8zM2.6 14a5.4 5.4 0 0 1 10.8 0',
  // A four-pointed spark, which is what a model answering has looked like since
  // everybody started drawing one. Two of them, so it reads as a spark and not as
  // a star: the small one is what says this is the machine and not the sky.
  ai: 'M6 2.2l1.1 2.9L10 6.2 7.1 7.3 6 10.2 4.9 7.3 2 6.2l2.9-1.1zM11.5 9.2l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z',
  // Two arrows going round, which is what syncing has looked like since before
  // any of this.
  sync: 'M13.2 7a5.3 5.3 0 0 0-9.1-2.6L2.8 5.7M2.8 9a5.3 5.3 0 0 0 9.1 2.6l1.3-1.3M2.8 3v2.7h2.7M13.2 13v-2.7h-2.7',
  trash:
    'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8M6.5 7v4M9.5 7v4',
  // One arrow out and one in: notes leaving and notes arriving, on one page.
  export: 'M5.5 10.5v-8M3 5l2.5-2.5L8 5M10.5 5.5v8M8 11l2.5 2.5L13 11',
}

/** The panes, in their groups: the app itself, what it does, the account, and the notes
 *  as a whole. Few groups, by whose the thing is, the way macOS clusters its sidebar and
 *  Linear splits Account from Features; and each page short enough to read at once, so
 *  General is the handful of things every app has rather than everything with nowhere
 *  else to go.
 *
 *  A page that is only there on some devices is spread in rather than hidden, so the
 *  group closes over the gap instead of leaving one.
 *
 *  Publishing a space is not here at all: it is a sheet opened from the space's
 *  own menu, beside sharing it; see PublishSheet.svelte. */
export function sectionGroups(): Item[][] {
  return [
    [
      { id: 'general', label: t('General') },
      { id: 'appearance', label: t('Appearance') },
      // The writing, Spelling with it: a checker is part of the editor, as it is in
      // every word processor.
      { id: 'editor', label: t('Editor') },
      { id: 'markdown', label: t('Markdown') },
      { id: 'shortcuts', label: t('Shortcuts') },
      // The bar over the keyboard on a phone, and the pull on its lists. Here on
      // every device rather than only where there is a thumb: it goes on the
      // account, and putting a bar together with a keyboard is easier than doing
      // it with the thumb it is for.
      { id: 'mobile', label: t('Mobile') },
    ],
    [
      // Where links open, the engine, the search engine, the extensions and what pages
      // do out of sight: a desktop's alone, which is the only build that is a browser.
      ...(!__EVEN_PLUGIN__ && isDesktop ? [{ id: 'browser' as Section, label: t('Browser') }] : []),
      // Quick add and the reminders.
      { id: 'tasks', label: t('Tasks') },
      // The shell a new terminal opens, the machines a remote one reaches (a desktop's)
      // and the account's machine in the cloud (with an account; docs/online-terminal.md
      // 4.10): every kind of terminal on one page.
      ...(!__EVEN_PLUGIN__ && (isDesktop || account.user)
        ? [{ id: 'terminal' as Section, label: t('Terminal') }]
        : []),
      // Everything about a model, on one page: the accounts a note's `ai` block, the
      // rewrites and the AI panel ask, and Access, everything that can reach the notes -
      // the agents on this machine and the apps connected through the account. Always
      // here: nothing about it needs an account, and its first row is how one is added.
      // See AiPane.svelte and access/Access.svelte.
      { id: 'ai', label: t('AI') },
      // Only for somebody who has a pair: in the plugin always, and on any other
      // device once the plugin has answered one, which the account remembers. See
      // preferences.ts, which gates the pane on the same answer.
      ...(isPlugin() || modes.glassesSeen
        ? [{ id: 'glasses' as Section, label: t('Glasses') }]
        : []),
    ],
    [
      { id: 'account', label: t('Account') },
      // Only with an account: a pane about what syncs where has nothing to say
      // until there is somewhere for notes to sync to.
      ...(account.user ? [{ id: 'sync' as Section, label: t('Sync') }] : []),
    ],
    [
      { id: 'trash', label: t('Recently deleted') },
      // Notes from another app, each into a space of its own, beside the page that sends
      // them the other way, as Notion keeps them. The plugin has no file to be given, so
      // there it is Export alone. See MigrateRows.svelte.
      { id: 'export', label: __EVEN_PLUGIN__ ? t('Export') : t('Import and export') },
    ],
  ]
}
