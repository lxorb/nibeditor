/** The crate's half of carrying a web login between computers, typed: a site's state
 *  taken out of a web store and sealed, put into another, and the keys that make the
 *  account blind to it. See src-tauri/src/web_state.rs and docs/sync-v2.md section 6.
 *
 *  This only says how to ask. When to capture and restore, and where a bundle goes, is
 *  the lease's (lease.svelte.ts and the hub socket); what the account keeps is the hub's.
 *
 *  A browser and a phone have no web tabs and never hold the web key, so every call
 *  there is refused with `NotHere` before anything is asked of anybody. */

import { isRecord } from '../stored'
import { invoke, isDesktop } from '../tauri'

/** Why a database stayed behind: past 16 MiB, past the bundle's 32 MiB, holding a key
 *  that may not be exported, or gone while it was being read. */
type Why = 'large' | 'bundle' | 'unmovable' | 'gone'

/** A database that stayed behind, which the site fills again. */
interface Skipped {
  name: string
  version: number
  size: number
  why: Why
}

/** One file of a bundle, as it is uploaded: by name, and how large. */
interface BundleFile {
  name: string
  size: number
}

/** What a capture made: a folder holding the sealed manifest and one sealed chunk per
 *  database, which is uploaded as `PUT /v2/web/:key` and `PUT /v2/web/chunks/:name`. */
export interface Captured {
  folder: string
  manifest: BundleFile
  chunks: BundleFile[]
  skipped: Skipped[]
  cookies: number
}

/** A web note tab's sessionStorage, as it travels. */
export interface TabSession {
  origin: string
  items: [string, string][]
}

/** What a restore did, and what it hands back: the tab's sessionStorage for `session`,
 *  and what the app carried in the capture. */
export interface Restored {
  cookies: number
  origins: number
  databases: number
  skipped: Skipped[]
  session: TabSession | null
  app: unknown
  engine: string
  at: number
}

/** The web key wrapped to another computer's public key: what Allow sends. */
export interface Wrapped {
  wrapped: string
  generation: number
}

/** What every call answers where there are no web tabs to carry anything from. */
export class NotHere extends Error {
  constructor() {
    super('web logins are only carried between computers')
    this.name = 'NotHere'
  }
}

/** The crate's answer, checked once at the boundary into the shape it promised. */
async function asked<T>(
  command: string,
  args: Record<string, unknown>,
  shaped: (value: unknown) => value is T,
): Promise<T> {
  if (!isDesktop) throw new NotHere()
  const answer = await invoke<unknown>(command, args)
  if (!shaped(answer)) throw new Error(`${command} answered something else`)
  return answer
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number'
const isNothing = (value: unknown): value is null => value === null || value === undefined
const isGeneration = (value: unknown): value is number | null => isNothing(value) || isNumber(value)

function isSkipped(value: unknown): value is Skipped {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isNumber(value.version) &&
    isNumber(value.size) &&
    ['large', 'bundle', 'unmovable', 'gone'].includes(String(value.why))
  )
}

function isFile(value: unknown): value is BundleFile {
  return isRecord(value) && isString(value.name) && isNumber(value.size)
}

function isCaptured(value: unknown): value is Captured {
  return (
    isRecord(value) &&
    isString(value.folder) &&
    isFile(value.manifest) &&
    Array.isArray(value.chunks) &&
    value.chunks.every(isFile) &&
    Array.isArray(value.skipped) &&
    value.skipped.every(isSkipped) &&
    isNumber(value.cookies)
  )
}

function isPair(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && value.every(isString)
}

function isSession(value: unknown): value is TabSession | null {
  if (isNothing(value)) return true
  return (
    isRecord(value) &&
    isString(value.origin) &&
    Array.isArray(value.items) &&
    value.items.every(isPair)
  )
}

function isRestored(value: unknown): value is Restored {
  return (
    isRecord(value) &&
    isNumber(value.cookies) &&
    isNumber(value.origins) &&
    isNumber(value.databases) &&
    Array.isArray(value.skipped) &&
    value.skipped.every(isSkipped) &&
    isSession(value.session) &&
    isString(value.engine) &&
    isNumber(value.at)
  )
}

function isWrapped(value: unknown): value is Wrapped {
  return isRecord(value) && isString(value.wrapped) && isNumber(value.generation)
}

const isDigits = (value: unknown): value is string => isString(value) && /^\d{6}$/.test(value)
const isName = (value: unknown): value is string => isString(value) && /^[0-9a-f]{64}$/.test(value)

/** A site's state, out of a web store and into another. `store` is the store's name as
 *  web-data.ts makes it, null for the one every space shares; `site` is `siteOf`'s. */
export const webState = {
  /** Takes the site out of `store`: its cookies, and for each of `origins` its
   *  localStorage and IndexedDB; with `tab`, the web note's own page is read first and
   *  its sessionStorage goes too. `app` is carried as it is (the trail, zoom, grants). */
  capture(
    store: string | null,
    site: string,
    origins: string[],
    tab?: string,
    app?: unknown,
  ): Promise<Captured> {
    return asked('web_state_capture', { store, site, origins, tab, app }, isCaptured)
  },

  /** Puts a downloaded bundle into `store`: the manifest in a folder `inbox` made, with
   *  its chunks beside it. Only while no page of the site is live, which the lease makes
   *  true. */
  restore(store: string | null, site: string, manifestPath: string): Promise<Restored> {
    return asked('web_state_restore', { store, site, manifestPath }, isRestored)
  },

  /** Gives a web note's tab its sessionStorage back and loads its page again. */
  session(tab: string, session: TabSession): Promise<null> {
    return asked(
      'web_state_session',
      { tab, origin: session.origin, items: session.items },
      isNothing,
    )
  },

  /** A new, empty folder to download a bundle into. */
  inbox(): Promise<string> {
    return asked('web_state_inbox', {}, isString)
  },
}

/** The keys: this computer's pair, and the web key every approved computer shares. No
 *  call ever answers a private key or the web key itself. */
export const webKey = {
  /** This computer's public key, base64, made the first time. */
  device(): Promise<string> {
    return asked('web_key_device', {}, isString)
  },

  /** The six digits both screens show while `publicKey`'s computer is approved. */
  digits(publicKey: string): Promise<string> {
    return asked('web_key_digits', { publicKey }, isDigits)
  },

  /** The web key wrapped to another computer: what Allow sends through the hub. */
  wrap(targetPublicKey: string): Promise<Wrapped> {
    return asked('web_key_wrap', { targetPublicKey }, isWrapped)
  },

  /** Takes the web key another computer wrapped to this one. */
  accept(wrapped: Wrapped): Promise<null> {
    return asked('web_key_accept', { ...wrapped }, isNothing)
  },

  /** A new web key one generation on (the first, on the first computer). */
  rotate(): Promise<number> {
    return asked('web_key_rotate', {}, isNumber)
  },

  /** Which generation this computer holds, or null before it is approved. */
  current(): Promise<number | null> {
    return asked('web_key_current', {}, isGeneration)
  },

  /** The opaque name the hub knows a site in a store by. */
  lease(store: string | null, site: string): Promise<string> {
    return asked('web_key_lease', { store, site }, isName)
  },

  /** Every key this computer holds for web logins, gone: signing out. */
  forget(): Promise<null> {
    return asked('web_key_forget', {}, isNothing)
  },
}
