/** The panes of the settings, and the line drawing each wears.
 *
 *  Data rather than markup, so the panel is left with the navigation and the
 *  search rather than with a list of names as well. Grouped the way a phone
 *  shows them: the preferences, the things an account owns, and getting a note
 *  out. */

import { account } from '../account.svelte'
import { reach } from '../agents/settings/reach.svelte'
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
export const ICONS: Record<string, string> = {
  // Sliders, not a sun with rays: the theme button at the foot of the panel is
  // already a sun, and adjusting things is what this pane is for.
  general:
    'M2 4h2.4M7.6 4H14M2 8h4.4M9.6 8H14M2 12h6.4M11.6 12H14M4.4 4a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M6.4 8a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M8.4 12a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0',
  editor: 'M2 12.6l1.6-.4 8-8a1.4 1.4 0 0 0-2-2l-8 8zM2 14.2h12',
  // A keyboard: the row of keys is the shortcut, not the writing.
  shortcuts: 'M2 4.5h12v7H2zM4.4 7h.01M6.9 7h.01M9.4 7h.01M11.9 7h.01M5.4 9.4h5.2',
  // A phone, upright, with the bar this pane is about across the bottom of it.
  mobile: 'M5 1.8h6a1 1 0 0 1 1 1v10.4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1zM4 11h8',
  // A word under the checker's wavy line, with the tick it earns.
  spelling: 'M2 11.5L5.6 3l3.6 8.5M3.4 8.6h4.4M9.6 12.8l1.8 1.7 3.1-3.5',
  markdown: 'M2.5 3.5h11v9h-11zM4.5 10.5V6l2 2.4L8.5 6v4.5M10.5 6v4.5M9 9l1.5 1.5L12 9',
  appearance:
    'M8 1.8a6.2 6.2 0 1 0 0 12.4c.9 0 1.4-.6 1.4-1.3 0-.8-.7-1.2-.7-1.9 0-.5.4-.9 1-.9h1.1a3.4 3.4 0 0 0 3.4-3.4c0-2.8-2.8-4.9-6.2-4.9zM5 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zM8 5.6a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zM11 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z',
  // A pair of lenses and the bridge between them, as the plugin's corner draws
  // them.
  glasses:
    'M4.3 9.4a2.7 2.7 0 1 0 0-.1M11.7 9.4a2.7 2.7 0 1 0 0-.1M7 9.4h2M1.6 8L2.6 5.3h2.7M14.4 8l-1-2.7h-2.7',
  account: 'M8 8.4a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8zM2.6 14a5.4 5.4 0 0 1 10.8 0',
  llm: 'M5 2.5h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8.5L5.5 14v-2.5H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z',
  // A four-pointed spark, which is what a model answering has looked like since
  // everybody started drawing one. Two of them, so it reads as a spark and not as
  // a star: the small one is what says this is the machine and not the sky.
  ai: 'M6 2.2l1.1 2.9L10 6.2 7.1 7.3 6 10.2 4.9 7.3 2 6.2l2.9-1.1zM11.5 9.2l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z',
  // A head with two eyes and an aerial: something that acts on its own, which the
  // spark beside it (a model answering) does not.
  agents:
    'M4.5 6h7a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 11.5v-4A1.5 1.5 0 0 1 4.5 6zM8 6V3.6M8 3.4h.01M6.2 9.3v.4M9.8 9.3v.4',
  // Two arrows going round, which is what syncing has looked like since before
  // any of this.
  sync: 'M13.2 7a5.3 5.3 0 0 0-9.1-2.6L2.8 5.7M2.8 9a5.3 5.3 0 0 0 9.1 2.6l1.3-1.3M2.8 3v2.7h2.7M13.2 13v-2.7h-2.7',
  trash:
    'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8M6.5 7v4M9.5 7v4',
  export: 'M8 10.5V2.5M5 5.5L8 2.5l3 3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10',
  // Export's arrow turned round: into the tray rather than out of it.
  import: 'M8 2.5v8M5 7.5l3 3 3-3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10',
  // Two servers stacked, the mark a remote terminal's tab wears.
  remote: 'M3 2.5h10v4.5H3zM3 9h10v4.5H3zM5.5 4.75h.01M5.5 11.25h.01',
}

/** The panes, in their groups.
 *
 *  The LLM connector is a thing an account owns, and it is off until deliberately
 *  turned on. Until there is an account it has nothing to show but an instruction
 *  to sign in, so it stays out of the list rather than sitting there offering
 *  nothing. Glasses is the same argument from the other side: somebody who has
 *  never had a pair in front of the plugin has no glasses to set anything about.
 *
 *  Publishing a space is not here at all: it is a sheet opened from the space's
 *  own menu, beside sharing it; see PublishSheet.svelte. */
export function sectionGroups(): Item[][] {
  return [
    [
      { id: 'general', label: t('General') },
      { id: 'editor', label: t('Editor') },
      { id: 'shortcuts', label: t('Shortcuts') },
      // The bar over the keyboard on a phone, and the pull on its lists. Here on
      // every device rather than only where there is a thumb: it goes on the
      // account, and putting a bar together with a keyboard is easier than doing
      // it with the thumb it is for.
      { id: 'mobile', label: t('Mobile') },
      { id: 'spelling', label: t('Spelling') },
      { id: 'markdown', label: t('Markdown') },
      { id: 'appearance', label: t('Appearance') },
      // The providers a note's `ai` block and the rewrites reach, and where their
      // keys went. Always here: unlike the connector below, nothing about it needs
      // an account, and the pane's own first row is how one is added.
      { id: 'ai', label: t('AI') },
      // The agents on this machine, and what each may do: a desktop's alone, because
      // an agent reaches nib through the installed app's own program. Beside AI,
      // since both are about a model; the account's connector is its other half,
      // under the account. See agents/settings/reach.svelte.ts.
      ...(!__EVEN_PLUGIN__ && reach.offered
        ? [{ id: 'agents' as Section, label: t('Agents') }]
        : []),
      // The machines a remote terminal reaches: a desktop's alone, as a terminal is.
      ...(!__EVEN_PLUGIN__ && isDesktop ? [{ id: 'remote' as Section, label: t('Remote') }] : []),
      // Only for somebody who has a pair: in the plugin always, and on any other
      // device once the plugin has answered one, which the account remembers.
      // Spread rather than hidden, so the group closes over the gap instead of
      // leaving one. See preferences.ts, which gates the pane on the same answer.
      ...(isPlugin() || modes.glassesSeen
        ? [{ id: 'glasses' as Section, label: t('Glasses') }]
        : []),
    ],
    [
      { id: 'account', label: t('Account') },
      // Only with an account: a pane about what syncs where has nothing to say
      // until there is somewhere for notes to sync to.
      ...(account.user ? [{ id: 'sync' as Section, label: t('Sync') }] : []),
      ...(account.user ? [{ id: 'llm' as Section, label: t('LLM access') }] : []),
    ],
    [
      { id: 'trash', label: t('Recently deleted') },
      // Notes from another app, each into a space of its own: Notion's Settings >
      // Import, beside the pane that sends them the other way. Not in the plugin,
      // which has no file to be given. See MigrateRows.svelte.
      ...(__EVEN_PLUGIN__ ? [] : [{ id: 'import' as Section, label: t('Import') }]),
      { id: 'export', label: t('Export') },
    ],
  ]
}
