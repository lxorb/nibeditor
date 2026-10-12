/** What a provider and an account are called on screen: the provider by who serves it,
 *  `Claude`, `OpenAI` or the server's own name, and an account by the name the reader
 *  gave it, else by its road, `Claude Code` or `API key`. Products' names are not
 *  translated; the two words that are go through the catalogues. */

import { t } from '../i18n.svelte'
import { type Account, CLAUDE, OPENAI, type Vendor } from './accounts'
import { KIND_NAMES, type ProviderKind } from './providers'

/** The road an account is, as its row names it under its provider. */
const ROADS: Record<ProviderKind, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  chatgpt: 'ChatGPT',
  anthropic: 'API key',
  openai: 'API key',
  compatible: KIND_NAMES.compatible,
}

/** A provider's name: Claude, OpenAI, or the compatible server's own. */
export function vendorName(vendor: Vendor, accounts: readonly Account[]): string {
  if (vendor === CLAUDE) return KIND_NAMES.anthropic
  if (vendor === OPENAI) return KIND_NAMES.openai
  const named = accounts.find((one) => one.id === vendor)?.name
  return named ? named : t(KIND_NAMES.compatible)
}

/** An account's name: what the reader called it, else its road. */
export function accountName(account: Account): string {
  return account.name || t(ROADS[account.kind])
}
