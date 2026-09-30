/** What Settings > Agents calls each part of a grant, in the reader's language.
 *
 *  One table, so a scope is called the same thing on its switch, in search and in a
 *  question, and so the words are read in one place when the grant grows another
 *  scope. What a scope reaches, said as what the agent may do, never the protocol's
 *  name for it: nobody grants `workspace.focus`, they let it bring a tab to the front. */

import { t } from '../../i18n.svelte'
import type { Category, Scope, SiteRule } from '../verbs'
import type { Limit, ScopeGroup } from './grant'

export const GROUP_WORDS: Record<ScopeGroup, () => string> = {
  notes: () => t('Notes'),
  workspace: () => t('Workspace'),
  browser: () => t('Browser'),
  tabs: () => t('Your tabs'),
  scripts: () => t('Scripts'),
  settings: () => t('Settings'),
  terminal: () => t('Terminal'),
}

export const SCOPE_WORDS: Record<Scope, () => string> = {
  'notes.read': () => t('Read notes'),
  'notes.write': () => t('Change notes'),
  context: () => t('See what you are looking at'),
  tree: () => t('Move and rename files'),
  workspace: () => t('Open tabs and bookmarks'),
  'workspace.focus': () => t('Bring a tab to the front'),
  browser: () => t('Browse in tabs of its own'),
  'browser.network': () => t('Read what pages load'),
  'browser.reader': () => t('Act in your tabs'),
  'browser.storage': () => t('Read your cookies'),
  'browser.script': () => t('Run scripts in pages'),
  settings: () => t('Change settings'),
  terminal: () => t('Run commands'),
}

/** The questions, as the thing the agent is about to do. */
export const CATEGORY_WORDS: Record<Category, () => string> = {
  paying: () => t('Paying'),
  sending: () => t('Sending messages'),
  publishing: () => t('Publishing and sharing'),
  deleting: () => t('Deleting for good'),
  signing_in: () => t('Signing in'),
  settings: () => t('Changing settings'),
  terminal: () => t('Commands not on its list'),
  files: () => t('Files from outside your spaces'),
  writing: () => t('Every change'),
  showing: () => t('Showing its tabs'),
  takeover: () => t('Handing a tab to you'),
  pairing: () => t('Connect'),
}

/** A site's rule as its state, the way a site's permissions read in its bubble. */
export const RULE_WORDS: Record<SiteRule, () => string> = {
  allow: () => t('Allowed'),
  deny: () => t('Blocked'),
  'agent-store': () => t('Without your logins'),
}

export const LIMIT_WORDS: Record<Limit, () => string> = {
  tabs: () => t('Tabs'),
  calls: () => t('Calls a minute'),
  navigations: () => t('Pages a minute'),
}
