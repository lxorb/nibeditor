/** The reader's AI accounts: every provider they added, under whom it serves, and which
 *  one of each answers now.
 *
 *  A **provider** is who serves the model. Claude is served through Claude Code or an
 *  Anthropic key, OpenAI through Codex, a ChatGPT sign-in or an OpenAI key, and each
 *  OpenAI-compatible server is a provider of its own. An **account** is one way in to a
 *  provider: a sign-in or a key, a row of Settings > AI. A reader may have several of a
 *  provider (a work Claude and their own) and exactly one of them is **active**; Claude
 *  and OpenAI are active side by side.
 *
 *  So the rest of the app never asks which account: it asks a provider, by any of its
 *  accounts' ids or its own, and is answered with the active account (`resolve`). A
 *  thread that was started on the work account follows the reader to their own when they
 *  switch, because what it keeps is the account it was on and what that resolves to is
 *  whichever is active now.
 *
 *  Pure: what the accounts are and how each change makes the next set of them. Where
 *  they are kept is accounts-file.ts, and the store that holds them is store.svelte.ts.
 *  Nothing here is a secret: a key is in the device's own store under the account's id,
 *  and a program's sign-in is the program's own (docs/ai.md). */

import { withOrWithout } from '../records'
import { isRecord, isString } from '../stored'
import { isLocal, type Provider, type ProviderKind } from './providers'

/** Who serves a model: `claude`, `openai`, or a compatible server's own account id. */
export type Vendor = string

export const CLAUDE: Vendor = 'claude'
export const OPENAI: Vendor = 'openai'

/** One account. `own` marks a second sign-in to Claude Code or Codex, whose program
 *  keeps its login in a folder of the app's rather than in the reader's own home; the
 *  crate makes the folder from the id (src-tauri/src/ai_accounts.rs). The first of each
 *  program is the reader's own, as it always was. */
export interface Account extends Provider {
  own?: true
}

/** Everything kept: the accounts in the order they were added, the active one of each
 *  provider, the provider a block or a rewrite asks without being told, and the one each
 *  feature asks where the reader chose (Settings > AI > Used for). */
export interface Accounts {
  accounts: Account[]
  active: Record<Vendor, string>
  defaultVendor: Vendor
  uses: Record<string, Vendor>
}

export const NONE: Accounts = { accounts: [], active: {}, defaultVendor: '', uses: {} }

/** The ids the first account of a kind has always had, so the key written under it on an
 *  earlier run is found, and so the keychain shows one entry per account. */
const FIRST: Record<Exclude<ProviderKind, 'compatible'>, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  chatgpt: 'chatgpt',
  'claude-code': 'claude-code',
  codex: 'codex',
}

/** The kinds that may be added more than once: keys, servers and programs, whose second
 *  sign-in keeps its login in a home of nib's. A ChatGPT sign-in is one per installation
 *  until the crate keeps a token per account. */
export function repeatable(kind: ProviderKind): boolean {
  return kind !== 'chatgpt'
}

/** Who serves an account's models. */
export function vendorOf(account: Pick<Provider, 'id' | 'kind'>): Vendor {
  switch (account.kind) {
    case 'anthropic':
    case 'claude-code':
      return CLAUDE
    case 'openai':
    case 'chatgpt':
    case 'codex':
      return OPENAI
    case 'compatible':
      return account.id
  }
}

/** A kind this build knows. Claude Code is left out of a build that does not offer it, so
 *  a row kept from one that did is not drawn with nothing behind it. */
function isKind(value: unknown): value is ProviderKind {
  if (value === 'claude-code' && !__CLAUDE_CODE__) return false
  return value === 'compatible' || (isString(value) && value in FIRST)
}

/** An id as the keychain and the crate take one: letters, digits, `-` and `_`. */
function isId(value: unknown): value is string {
  return isString(value) && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

/** One account out of storage, or null for a row that is not one. */
function accountIn(value: unknown): Account | null {
  if (!isRecord(value)) return null
  const { id, kind, name, baseUrl, model, own } = value
  if (!isId(id) || !isKind(kind) || !isString(name)) return null

  return {
    id,
    kind,
    name,
    ...(isString(baseUrl) ? { baseUrl } : {}),
    model: isString(model) ? model : '',
    ...(own === true && isLocal(kind) ? { own: true as const } : {}),
  }
}

/** A map of strings out of storage: each name to an id. */
function namesIn(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => isString(entry[1])),
  )
}

/** The accounts out of what was kept, read rather than trusted: a row that is not an
 *  account is dropped, a second row with one id is dropped, and an active choice or a
 *  feature's that names nothing there is let go. */
export function accountsIn(value: unknown): Accounts {
  if (!isRecord(value)) return NONE
  const seen = new Set<string>()
  const accounts = (Array.isArray(value.accounts) ? value.accounts : [])
    .map(accountIn)
    .filter((one): one is Account => {
      if (!one || seen.has(one.id)) return false
      seen.add(one.id)
      return true
    })
  return tidied({
    accounts,
    active: namesIn(value.active),
    defaultVendor: isString(value.defaultVendor) ? value.defaultVendor : '',
    uses: namesIn(value.uses),
  })
}

/** What is written down: the same fields, in a fixed order. */
export function accountsText(state: Accounts): string {
  return JSON.stringify({
    version: 1,
    accounts: state.accounts,
    active: state.active,
    defaultVendor: state.defaultVendor,
    uses: state.uses,
  })
}

/** Every provider there is an account of, Claude and OpenAI first and the compatible
 *  servers after in the order they were added: the order Settings and the palette list
 *  them in. */
export function vendors(state: Accounts): Vendor[] {
  const all = [...new Set(state.accounts.map(vendorOf))]
  const rank = (one: Vendor) => (one === CLAUDE ? 0 : one === OPENAI ? 1 : 2)
  return all.sort((a, b) => rank(a) - rank(b))
}

/** A provider's accounts, in the order they were added. */
export function accountsOf(state: Accounts, vendor: Vendor): Account[] {
  return state.accounts.filter((one) => vendorOf(one) === vendor)
}

/** The account a provider answers with: the one chosen, or its first where the chosen one
 *  has gone. */
export function activeOf(state: Accounts, vendor: Vendor): Account | null {
  const mine = accountsOf(state, vendor)
  return mine.find((one) => one.id === state.active[vendor]) ?? mine[0] ?? null
}

/** The active account of every provider: what a model picker lists. */
export function actives(state: Accounts): Account[] {
  return vendors(state)
    .map((vendor) => activeOf(state, vendor))
    .filter((one): one is Account => one !== null)
}

/** The provider an id names: an account's own, or a provider's. */
function vendorNamed(state: Accounts, id: string): Vendor | null {
  const account = state.accounts.find((one) => one.id === id)
  if (account) return vendorOf(account)
  return state.accounts.some((one) => vendorOf(one) === id) ? id : null
}

/** What an id answers with now: the active account of the provider the id names, whether
 *  it is that account, another account of the same provider, or the provider itself. */
export function resolve(state: Accounts, id: string): Account | null {
  const vendor = vendorNamed(state, id)
  return vendor === null ? null : activeOf(state, vendor)
}

/** Whether an account is the one its provider answers with. */
export function isActive(state: Accounts, id: string): boolean {
  const account = state.accounts.find((one) => one.id === id)
  return !!account && activeOf(state, vendorOf(account))?.id === id
}

/** The id the next account of a kind gets: the kind's own for the first, counted from
 *  two after it, and a compatible server's counted from one. Counted rather than random,
 *  so it is short enough to read in a keychain. */
function nextId(state: Accounts, kind: ProviderKind): string {
  const taken = (id: string) => state.accounts.some((one) => one.id === id)
  if (kind !== 'compatible' && !taken(FIRST[kind])) return FIRST[kind]
  const stem = kind === 'compatible' ? 'compatible' : FIRST[kind]
  for (let number = kind === 'compatible' ? 1 : 2; ; number++) {
    const id = `${stem}-${number}`
    if (!taken(id)) return id
  }
}

/** Active choices, the default and each feature's choice, kept to what is there: one that
 *  names no provider any more is let go, and a provider with accounts and no choice is
 *  given its first. */
function tidied(state: Accounts): Accounts {
  const there = vendors(state)
  const active: Record<Vendor, string> = {}
  for (const vendor of there) {
    const chosen = state.active[vendor]
    const mine = accountsOf(state, vendor)
    const kept = mine.find((one) => one.id === chosen) ?? mine[0]
    if (kept) active[vendor] = kept.id
  }
  return {
    accounts: state.accounts,
    active,
    defaultVendor: there.includes(state.defaultVendor) ? state.defaultVendor : (there[0] ?? ''),
    uses: Object.fromEntries(Object.entries(state.uses).filter(([, one]) => there.includes(one))),
  }
}

/** One more account of a kind. It answers at once only where its provider had none, so a
 *  second sign-in being set up never takes over from the one that works. A kind that may
 *  not be added twice answers with the account it already has. */
export function added(state: Accounts, kind: ProviderKind): { state: Accounts; account: Account } {
  const held = repeatable(kind) ? undefined : state.accounts.find((one) => one.kind === kind)
  if (held) return { state, account: held }

  const id = nextId(state, kind)
  const account: Account = {
    id,
    kind,
    name: '',
    ...(kind === 'compatible' ? { baseUrl: '' } : {}),
    model: '',
    // The program's own home is the first account's; every later one is a home of nib's.
    ...(isLocal(kind) && state.accounts.some((one) => one.kind === kind)
      ? { own: true as const }
      : {}),
  }
  return { state: including(state, account), account }
}

/** An account made elsewhere put in, as `added` would have: it answers at once only where
 *  its provider had none. Nothing changes where its id is already there. */
export function including(state: Accounts, account: Account): Accounts {
  if (state.accounts.some((one) => one.id === account.id)) return state
  return tidied({ ...state, accounts: [...state.accounts, account] })
}

/** One account changed. Its id, kind and home are what it is and do not change. */
export function updated(
  state: Accounts,
  id: string,
  change: Partial<Omit<Account, 'id' | 'kind' | 'own'>>,
): Accounts {
  return {
    ...state,
    accounts: state.accounts.map((one) => (one.id === id ? { ...one, ...change } : one)),
  }
}

/** An account taken away. Its provider answers with its next account, if it has one. */
export function removed(state: Accounts, id: string): Accounts {
  return tidied({ ...state, accounts: state.accounts.filter((one) => one.id !== id) })
}

/** An account made the one its provider answers with. */
export function activated(state: Accounts, id: string): Accounts {
  const account = state.accounts.find((one) => one.id === id)
  if (!account) return state
  return { ...state, active: { ...state.active, [vendorOf(account)]: id } }
}

/** A provider made the one a block and a rewrite ask, by any of its ids; an account's id
 *  also makes that account its provider's active one. */
export function defaulted(state: Accounts, id: string): Accounts {
  const vendor = vendorNamed(state, id)
  if (vendor === null) return state
  return { ...activated(state, id), defaultVendor: vendor }
}

/** A feature asking a provider of its own, by any of its ids, or the default again for
 *  the empty string. */
export function used(state: Accounts, feature: string, id: string): Accounts {
  const vendor = id ? vendorNamed(state, id) : null
  return { ...state, uses: withOrWithout(state.uses, feature, vendor) }
}

/** The accounts out of what the window kept before there was a file: `nib:ai`'s providers,
 *  the default and each feature's choice, by provider id. The rows keep their ids, so every
 *  key is found where it was written, every grant (`nib-<id>`) and every thread still names
 *  its account, and nobody signs in again. The default's provider answers with the row that
 *  was the default. */
export function migrated(old: unknown): Accounts {
  if (!isRecord(old)) return NONE
  const accounts = accountsIn({ accounts: old.providers }).accounts
  const state: Accounts = { accounts, active: {}, defaultVendor: '', uses: {} }
  const named = (id: unknown) => (isString(id) ? vendorNamed(state, id) : null)

  const active: Record<Vendor, string> = {}
  const defaultId = isString(old.defaultId) ? old.defaultId : ''
  const fallback = accounts.find((one) => one.id === defaultId)
  if (fallback) active[vendorOf(fallback)] = fallback.id

  const uses: Record<string, Vendor> = {}
  for (const [feature, id] of Object.entries(namesIn(old.uses))) {
    const vendor = named(id)
    if (vendor !== null) uses[feature] = vendor
  }
  return tidied({ accounts, active, defaultVendor: named(defaultId) ?? '', uses })
}

/** What one window's earlier rows add to the accounts already kept: the rows whose ids are
 *  not there. A second profile of the app (the other engine's) that still holds rows of its
 *  own brings them in once, beside what the first one brought; nothing already there is
 *  changed. */
export function merged(kept: Accounts, brought: Accounts): Accounts {
  const fresh = brought.accounts.filter(
    (one) => !kept.accounts.some((there) => there.id === one.id),
  )
  if (!fresh.length) return kept
  return tidied({
    ...kept,
    accounts: [...kept.accounts, ...fresh],
    defaultVendor: kept.defaultVendor || brought.defaultVendor,
  })
}
