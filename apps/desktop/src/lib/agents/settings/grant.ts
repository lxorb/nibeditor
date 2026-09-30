/** A grant, changed the way Settings > Agents changes one (docs/agent-native.md 9.1).
 *
 *  Pure: every function takes a grant and answers a new one, so the pane's switches are
 *  tested without a window and a change is applied to whatever the crate holds at the
 *  moment it is written, not to the copy the pane read a minute ago (see pane.svelte.ts).
 *
 *  **A switch means what it says.** Writing notes without reading them, bringing a tab
 *  to the front without reaching the tabs, the reader's cookies without the reader's
 *  tabs: each of those is a switch that is on and does nothing, which is the one thing a
 *  permission page must never show. So turning a scope on turns on what it needs, and
 *  turning one off turns off what needed it - the way GitHub's write access brings read
 *  with it. */

import type { Category, Grant, Scope, SiteRule } from '../verbs'

/** What each scope reaches through, any one of them. */
const NEEDS: Partial<Record<Scope, readonly Scope[]>> = {
  'notes.write': ['notes.read'],
  'workspace.focus': ['workspace'],
  'browser.network': ['browser', 'browser.reader'],
  'browser.script': ['browser', 'browser.reader'],
  'browser.storage': ['browser.reader'],
}

/** The scopes as the pane groups them: by what they reach, in the order a reader thinks
 *  about them, from their own words out to the whole machine. */
export const SCOPE_GROUPS = [
  { id: 'notes', scopes: ['notes.read', 'notes.write'] },
  { id: 'workspace', scopes: ['context', 'tree', 'workspace', 'workspace.focus'] },
  { id: 'browser', scopes: ['browser', 'browser.network'] },
  { id: 'tabs', scopes: ['browser.reader', 'browser.storage'] },
  { id: 'scripts', scopes: ['browser.script'] },
  { id: 'settings', scopes: ['settings'] },
  { id: 'terminal', scopes: ['terminal'] },
] as const satisfies readonly { id: string; scopes: readonly Scope[] }[]

export type ScopeGroup = (typeof SCOPE_GROUPS)[number]['id']

/** Every scope, in the pane's order, which is the crate's (`Scope::ALL`). */
const ALL_SCOPES: readonly Scope[] = [
  'context',
  'notes.read',
  'notes.write',
  'tree',
  'workspace',
  'workspace.focus',
  'browser',
  'browser.reader',
  'browser.script',
  'browser.network',
  'browser.storage',
  'settings',
  'terminal',
]

/** The questions the reader may turn off, and what an agent needs to hold for the
 *  question ever to come up: asking before paying means nothing to an agent with no
 *  browser. Signing in is not here: a password is never typed by an agent, whatever
 *  the grant says (9.4), so there is nothing to turn off. */
export const ASKS: readonly { category: Category; needs: readonly Scope[] }[] = [
  { category: 'paying', needs: ['browser', 'browser.reader'] },
  { category: 'sending', needs: ['browser', 'browser.reader'] },
  { category: 'publishing', needs: ['workspace'] },
  { category: 'deleting', needs: ['browser', 'browser.reader', 'tree'] },
  { category: 'files', needs: ['browser', 'browser.reader'] },
  { category: 'settings', needs: ['settings'] },
  { category: 'terminal', needs: ['terminal'] },
]

/** The limits a slider may set: the crate's defaults sit inside each. Eight tabs is the
 *  most every agent together keeps open (6.4). */
export const LIMITS = {
  tabs: { min: 1, max: 8, step: 1 },
  calls: { min: 60, max: 1200, step: 60 },
  navigations: { min: 10, max: 300, step: 10 },
} as const

export type Limit = keyof typeof LIMITS

/** The limits in the order the pane shows them. */
export const LIMIT_NAMES: readonly Limit[] = ['tabs', 'calls', 'navigations']

const holds = (scopes: readonly Scope[], scope: Scope) => scopes.includes(scope)

/** Whether a scope held means anything: what it needs is held too. */
const reachable = (scopes: readonly Scope[], scope: Scope) =>
  (NEEDS[scope] ?? []).length === 0 || (NEEDS[scope] ?? []).some((one) => holds(scopes, one))

/** A grant with one scope on or off, and whatever that brings with it. */
export function withScope(grant: Grant, scope: Scope, on: boolean): Grant {
  let scopes = grant.scopes.filter((one) => one !== scope)

  if (on) {
    scopes.push(scope)
    // What it needs, the first of them when it needs any one of several: the plain
    // browser before the reader's own tabs, which is the narrower reach.
    const needs = NEEDS[scope] ?? []
    const first = needs[0]
    if (first && !needs.some((one) => holds(scopes, one)))
      return withScope({ ...grant, scopes }, first, true)
  } else {
    // Whatever reached through it and now reaches through nothing, until nothing
    // left is a switch that does nothing.
    let orphan = scopes.find((one) => !reachable(scopes, one))
    while (orphan !== undefined) {
      const gone = orphan
      scopes = scopes.filter((one) => one !== gone)
      orphan = scopes.find((one) => !reachable(scopes, one))
    }
  }

  return { ...grant, scopes: ALL_SCOPES.filter((one) => holds(scopes, one)) }
}

/** Whether a question can come up for this agent at all. */
export function askApplies(grant: Grant, category: Category): boolean {
  const needs = ASKS.find((one) => one.category === category)?.needs ?? []
  return needs.some((one) => holds(grant.scopes, one))
}

/** Whether the agent asks before this: on unless the reader turned it off. */
export const asks = (grant: Grant, category: Category): boolean => grant.asks[category] ?? true

/** A question on or off. On is what nothing says, so it is kept as nothing. */
export function withAsk(grant: Grant, category: Category, on: boolean): Grant {
  const rest = Object.fromEntries(Object.entries(grant.asks).filter(([one]) => one !== category))
  return { ...grant, asks: on ? rest : { ...rest, [category]: false } }
}

export const withMode = (grant: Grant, confirm: boolean): Grant => ({
  ...grant,
  mode: confirm ? 'confirm' : 'unsupervised',
})

export const withName = (grant: Grant, name: string): Grant => {
  const trimmed = name.trim()
  return trimmed ? { ...grant, name: trimmed } : grant
}

/** A limit set to a value a slider could have given it. */
export function withLimit(grant: Grant, limit: Limit, value: number): Grant {
  const { min, max, step } = LIMITS[limit]
  const stepped = Math.round((value - min) / step) * step + min
  return { ...grant, limits: { ...grant.limits, [limit]: Math.min(max, Math.max(min, stepped)) } }
}

/** Every space, or only the named ones. Leaving every space starts from the spaces
 *  there are, so the switch alone takes nothing away: the reader then turns off the
 *  spaces they mean. */
export function withEverySpace(grant: Grant, every: boolean, spaces: readonly string[]): Grant {
  return { ...grant, spaces: every ? 'all' : [...spaces] }
}

/** One space in or out. A space kept by name that no longer exists stays kept: a
 *  space brought back under its old name is the one the reader granted. */
export function withSpace(grant: Grant, space: string, on: boolean): Grant {
  if (grant.spaces === 'all') return grant
  const rest = grant.spaces.filter((one) => one !== space)
  return { ...grant, spaces: on ? [...rest, space] : rest }
}

export const reaches = (grant: Grant, space: string): boolean =>
  grant.spaces === 'all' || grant.spaces.includes(space)

/** A rule for a site, or none. */
export function withSite(grant: Grant, site: string, rule: SiteRule | null): Grant {
  const sites = Object.fromEntries(Object.entries(grant.sites).filter(([one]) => one !== site))
  return { ...grant, sites: rule === null ? sites : { ...sites, [site]: rule } }
}

/** "Always on this site" taken back for one category, and the site with it once it has
 *  none left. */
export function withoutAlways(grant: Grant, site: string, category: Category): Grant {
  const left = (grant.always[site] ?? []).filter((one) => one !== category)
  const always = Object.fromEntries(Object.entries(grant.always).filter(([one]) => one !== site))
  return { ...grant, always: left.length ? { ...always, [site]: left } : always }
}

/** A word added to or taken from one of the grant's lists: the sites scripts may run
 *  on, and the programs the terminal starts without asking. A word already there is not
 *  added twice. */
export function withListed(
  grant: Grant,
  list: 'scripts' | 'programs',
  word: string,
  on: boolean,
): Grant {
  const trimmed = word.trim()
  const rest = grant[list].filter((one) => one !== trimmed)
  return { ...grant, [list]: on && trimmed ? [...rest, trimmed] : rest }
}

/** Every site the pane lists: those with a rule and those with an "always", once each,
 *  in the order of their names. */
export function sitesOf(
  grant: Grant,
): { site: string; rule: SiteRule | null; always: Category[] }[] {
  const names = [...new Set([...Object.keys(grant.sites), ...Object.keys(grant.always)])].sort()
  return names.map((site) => ({
    site,
    rule: grant.sites[site] ?? null,
    always: grant.always[site] ?? [],
  }))
}

/** The lethal trifecta on one agent (9.6): private words, words from outside, and a way
 *  to send them out. An agent that reads the notes - or the note in front, which is
 *  what `context` hands it - and browses in the reader's store has all three, because
 *  every page it reads can ask it to take a note to a site where the reader is signed
 *  in. A grant only keeps sites apart by name, so the line stays while the browser is
 *  in reach: "agent store only" takes the leg away for the sites that matter, not for
 *  the one nobody thought of. */
export function trifecta(grant: Grant): boolean {
  const reads = holds(grant.scopes, 'notes.read') || holds(grant.scopes, 'context')
  const browses = holds(grant.scopes, 'browser') || holds(grant.scopes, 'browser.reader')
  return reads && browses
}

/** The grant a client paired on this machine gets: Emil's defaults (9.1), the same as
 *  `Grant::own` in grants.rs. */
export function ownGrant(id: string, client: string, created: number): Grant {
  return {
    id,
    name: client,
    client,
    scopes: ALL_SCOPES.filter(
      (one) => !['browser.script', 'browser.storage', 'settings', 'terminal'].includes(one),
    ),
    spaces: 'all',
    sites: {},
    scripts: [],
    mode: 'unsupervised',
    asks: {},
    always: {},
    programs: [],
    limits: { tabs: 4, calls: 600, navigations: 60 },
    created,
  }
}

/** The grant a token made by hand gets: somebody else's tool, without the reader's
 *  screen or tabs, asking for every write. `Grant::third_party` in grants.rs. */
export function thirdPartyGrant(id: string, client: string, created: number): Grant {
  const own = ownGrant(id, client, created)
  return {
    ...own,
    scopes: own.scopes.filter((one) => one !== 'context' && one !== 'browser.reader'),
    mode: 'confirm',
  }
}
