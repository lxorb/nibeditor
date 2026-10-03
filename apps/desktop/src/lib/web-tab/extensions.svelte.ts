/** The extensions the web tabs run, as the bar, its bubble and Settings draw them.
 *
 *  The crate installs, checks, unpacks and hands each one to the engine; see
 *  src-tauri/src/extensions.rs. This is the list it answers with, the few things a
 *  reader does to a row, and the popup that is open, if one is. Fetched with the first
 *  web tab and never in the first paint: nothing here matters before a page is open. */

import { stored, keep } from '../stored'
import { invoke, isDesktop } from '../tauri'

/** One extension, as the crate describes it. */
export interface Extension {
  id: string
  store: 'chrome' | 'edge'
  version: string
  enabled: boolean
  pinned: boolean
  name: string
  /** Its picture, as a `data:` address. */
  picture: string | null
  /** Whether it has a page its button opens. */
  popup: string | null
  options: string | null
  /** Whether it has a button at all. */
  action: boolean
  /** What it asks to be allowed, in Chromium's own words. */
  permissions: string[]
  /** Why it did not load this run, if it did not. */
  problem: string | null
}

/** An extension out of what the crate sent, or null for anything that is not one. */
export function readExtension(value: unknown): Extension | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  if (typeof said.id !== 'string' || typeof said.version !== 'string') return null

  const text = (field: unknown) => (typeof field === 'string' && field ? field : null)
  return {
    id: said.id,
    store: said.store === 'edge' ? 'edge' : 'chrome',
    version: said.version,
    enabled: said.enabled !== false,
    pinned: said.pinned !== false,
    name: text(said.name) ?? said.id,
    picture: text(said.picture),
    popup: text(said.popup),
    options: text(said.options),
    action: said.action === true,
    permissions: Array.isArray(said.permissions)
      ? said.permissions.filter((one): one is string => typeof one === 'string')
      : [],
    problem: text(said.problem),
  }
}

/** The buttons the bar shows: what is on, has a button and is pinned. */
export function pinnedOf(list: readonly Extension[]): Extension[] {
  return list.filter((one) => one.enabled && one.action && one.pinned)
}

/** How long between two looks for newer versions: Chrome looks every five hours. */
export const UPDATE_EVERY = 5 * 60 * 60 * 1000

/** Where the last look was written down. */
const LOOKED = 'nib.extensions.looked'

/** Whether it is time to look for newer versions, given when the last look was. */
export function updateDue(last: number | null, now: number): boolean {
  return last === null || now - last >= UPDATE_EVERY || now < last
}

/** A popup that is open: which extension, over which tab. */
export interface Popped {
  id: string
  tab: string
  store: string | null | undefined
}

class Extensions {
  list = $state<Extension[]>([])
  /** Whether the crate has answered once. */
  read = $state(false)
  /** A link being installed, so its row can say so. */
  installing = $state<string | null>(null)
  /** Why the last install did not work. */
  failed = $state<string | null>(null)
  /** The popup that is open. */
  popped = $state<Popped | null>(null)

  private listening = false

  /** Reads the list, and from then on hears about every change to it. */
  async start(): Promise<void> {
    if (!isDesktop || this.listening) return
    this.listening = true
    const { listen } = await import('@tauri-apps/api/event')
    await listen('nib://extensions', () => void this.load())
    await this.load()
    this.lookForUpdates()
  }

  async load(): Promise<void> {
    const said = await invoke<unknown[]>('extensions_list').catch(() => [])
    this.list = said.map(readExtension).filter((one): one is Extension => one !== null)
    this.read = true
  }

  /** Installs what a store link or an id names. Answers whether it worked. */
  async install(link: string): Promise<boolean> {
    this.installing = link
    this.failed = null
    try {
      const said = await invoke<{ store?: unknown } | null>('extensions_install', { link })
      // nib's own Chromium installs from the store's own page, with the store's own
      // button: the link opens there. See src-tauri/src/extensions/chromium.rs.
      if (typeof said?.store === 'string') {
        const { workspace } = await import('../workspace.svelte')
        workspace.openPage(said.store, 'front')
        return true
      }
      await this.load()
      return true
    } catch (error) {
      this.failed = typeof error === 'string' ? error : 'that did not work'
      return false
    } finally {
      this.installing = null
    }
  }

  /** Turns one on or off. Shown at once, put right if the crate refuses. */
  async enable(id: string, enabled: boolean): Promise<void> {
    this.change(id, { enabled })
    await invoke('extensions_set', { id, enabled }).catch(() => this.load())
  }

  /** Pins or unpins one's button. */
  async pin(id: string, pinned: boolean): Promise<void> {
    this.change(id, { pinned })
    await invoke('extensions_set', { id, pinned }).catch(() => this.load())
  }

  async remove(id: string): Promise<void> {
    if (this.popped?.id === id) this.close()
    this.list = this.list.filter((one) => one.id !== id)
    await invoke('extensions_remove', { id }).catch(() => this.load())
  }

  /** The address of one's options page, for a tab. */
  async optionsOf(id: string): Promise<string | null> {
    return invoke<string>('extensions_page', { id, options: true }).catch(() => null)
  }

  /** Whether an address is a store's page for an extension, and which. */
  async named(url: string): Promise<string | null> {
    const said = await invoke<[string, string] | null>('extensions_named', { link: url }).catch(
      () => null,
    )
    return said ? said[1] : null
  }

  /** Opens one's popup over `tab`. */
  open(id: string, tab: string, store: string | null | undefined): void {
    this.popped = this.popped?.id === id && this.popped.tab === tab ? null : { id, tab, store }
  }

  close(): void {
    this.popped = null
  }

  private change(id: string, fields: Partial<Extension>) {
    this.list = this.list.map((one) => (one.id === id ? { ...one, ...fields } : one))
  }

  /** Newer versions, once in a while and never at the launch: the stores are asked
   *  after the first web tab has settled, the way a browser looks some minutes in. */
  private lookForUpdates() {
    const last = stored(LOOKED)
    if (!updateDue(typeof last === 'number' ? last : null, Date.now())) return
    setTimeout(() => {
      keep(LOOKED, String(Date.now()))
      void invoke<number>('extensions_update')
        .then((moved) => (moved > 0 ? this.load() : undefined))
        .catch(() => undefined)
    }, 60_000)
  }
}

export const extensions = new Extensions()
