/** What the hand-written panes of the settings show, so a search can land on those
 *  too: a storage meter, a sign-in row, the switch for Vim keys.
 *
 *  Two searches read it - the box at the top of the settings, and the palette, which
 *  finds a setting wherever it is typed for - so it is written once, here. The
 *  generated panes are `preferences.ts`, which both read as well; see
 *  settings-search.ts and palette/settings.ts. */

import { account } from '../account.svelte'
import { t } from '../i18n.svelte'
import type { Place } from '../settings-search'
import { isDesktop } from '../tauri'
import { theme } from '../theme.svelte'

export function places(): Place[] {
  const all: Place[] = [
    { section: 'account', label: t('Display name'), text: [] },
    { section: 'account', label: t('Email'), text: [account.user?.email ?? ''] },
    { section: 'account', label: t('Storage'), text: [] },
    { section: 'account', label: account.user ? t('Sign out') : t('Sign in'), text: [] },
    {
      section: 'account',
      label: t('Signing in'),
      text: [t('Ask for a code from an app'), t('Recovery codes left')],
    },
    { section: 'account', label: t('Signed in on'), text: [t('End every other session')] },
    ...(account.user
      ? [{ section: 'account' as const, label: t('Delete account'), text: [] }]
      : []),
    {
      section: 'sync',
      label: t('When the same note was written twice'),
      text: [t('Keep both copies'), t('Let the newest win'), t('Ask me each time')],
    },
    {
      section: 'sync',
      label: t('History on the account'),
      text: [t('Keep versions'), t('A month'), t('A year')],
    },
    { section: 'sync', label: t('What synced'), text: [] },
    { section: 'sync', label: t('Go back'), text: [t('This space, as it was')] },
    { section: 'appearance', label: t('Themes'), text: [t('Browse'), t('Install')] },
    { section: 'editor', label: t('Reset to defaults'), text: [] },
    // Modal editing sits with the keyboard rather than with the editor, so
    // this is where searching for it lands.
    { section: 'shortcuts', label: t('Vim keys'), text: ['vim'] },
    { section: 'markdown', label: t('Reset to defaults'), text: [] },
  ]

  if (!theme.accentIsTheme) {
    all.push({
      section: 'appearance',
      label: t('Accent'),
      text: theme.accents.map((one) => t(one.name)),
    })
  }

  if (isDesktop) {
    all.push({
      section: 'appearance',
      label: t('Reload themes and custom CSS'),
      text: [t('Custom')],
    })
    all.push({ section: 'general', label: t('Default browser'), text: [t('Make default')] })
  }

  if (account.user) {
    all.push({
      section: 'llm',
      label: t('LLM access'),
      text: ['MCP', 'Claude', 'ChatGPT', 'token', t('Connect'), t('Create a token')],
    })
  }

  return all
}
