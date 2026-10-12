/** The reader's AI accounts as the app reads them: which providers there are, the
 *  account each answers with now, which one a block or a rewrite asks, and which one
 *  each feature asks where the reader chose.
 *
 *  Everything here is a choice and none of it is a secret: the kind, the address of a
 *  local server, the model, the name in the list. The keys are not in it and never
 *  reach storage; see keys.ts. What an account is and how a change makes the next set of
 *  them is accounts.ts; where they are kept is accounts-file.ts.
 *
 *  **One set for every window.** The accounts are a file of the crate's, which every
 *  window, both engines and every space read, and each write is heard by every window;
 *  the window also keeps a copy in its own storage, which is what it starts from in the
 *  moment before the crate has answered. They used to be that copy alone, which is why a
 *  switch of engine forgot them. The first time a window finds no file, it writes one out
 *  of what it kept before (`migrated`); a second profile that kept rows of its own adds
 *  the ones the file lacks, once (`merged`). Nobody types a key or signs in again: the
 *  rows keep their ids, and their keys are under those ids.
 *
 *  **Asking by any id.** A thread, a feature or the default names an account, and what
 *  answers is that account's provider's active one (`provider`), so a switch of account
 *  reaches everything that asks that provider at its next question. */

import { key } from '../i18n.svelte'
import { log } from '../log'
import { keep, stored, storedText } from '../stored'
import {
  type Account,
  type Accounts,
  accountsIn,
  accountsOf,
  accountsText,
  activated,
  activeOf,
  actives,
  added,
  defaulted,
  including,
  isActive,
  merged,
  migrated,
  NONE,
  removed,
  resolve,
  updated,
  used,
  type Vendor,
  vendors,
} from './accounts'
import { accountName, vendorName } from './account-words'
import { COPY, hearChanges, readKept, STALE, writeKept } from './accounts-file'
import { transcribersAre } from './hears'
import { accountsAre } from './switching'
import { type Provider, type ProviderKind, transcribes, usable } from './providers'

/** What the window kept before the accounts were a file: the rows a first run moves. */
const EARLIER = 'nib:ai'

/** Said in this window's own storage once its earlier rows are in the file, so a second
 *  profile brings them once and a removed one does not come back. */
const MOVED = 'nib:ai-moved'

/** How often a change is made again over a newer text before it is given up on. */
const TRIES = 3

/** What a reader asks a model for, each of which may ask a provider of its own: a plan
 *  for questions about the notes and a fast model on this machine for rewrites, say. */
export type Feature = 'ask' | 'quick' | 'block' | 'rewrite'

/** The features, in the order Settings lists them, with the words it lists them by. */
export const FEATURES: readonly { id: Feature; label: string }[] = [
  { id: 'ask', label: key('Ask') },
  { id: 'quick', label: key('Quick question') },
  { id: 'block', label: key('AI block') },
  { id: 'rewrite', label: key('Rewrite') },
]

function isStale(error: unknown): boolean {
  return error === STALE || (error instanceof Error && error.message === STALE)
}

function parsedText(text: string | null): Accounts | null {
  if (text === null) return null
  try {
    return accountsIn(JSON.parse(text) as unknown)
  } catch {
    return null
  }
}

class Ai {
  /** Everything kept. Replaced whole by each change, never edited in place. */
  state = $state<Accounts>(NONE)

  /** Every account, in the order they were added. */
  readonly accounts = $derived<Account[]>(this.state.accounts)

  /** The account each provider answers with: what a model picker lists. */
  readonly providers = $derived<Provider[]>(actives(this.state))

  /** The providers there are accounts of, in Settings' order. */
  readonly vendors = $derived<Vendor[]>(vendors(this.state))

  /** Which provider each feature asks, where the reader chose one other than the default. */
  readonly uses = $derived<Record<string, Vendor>>(this.state.uses)

  /** The provider a block and a rewrite ask without being told. */
  readonly defaultVendor = $derived<Vendor>(this.state.defaultVendor)

  /** The account that answers, or null where none can: the default provider's active one,
   *  or the first that can when it cannot. */
  readonly chosen = $derived<Provider | null>(
    [activeOf(this.state, this.state.defaultVendor), ...actives(this.state)].find(
      (one): one is Account => !!one && usable(one),
    ) ?? null,
  )

  /** Whether anything is set up well enough to be asked. What the rewrite menu and the
   *  block's failure sentence read. */
  readonly ready = $derived(this.chosen !== null)

  /** The account that turns sound into words, or null where none can.
   *
   *  The same reading as `chosen` - the default provider's if it can, else the first that
   *  can - but a different question: transcribing wants an address and a route, not a
   *  chat model, so a local whisper server with no chat model set is still a transcriber.
   *  Claude serves no such route and is never this. See `transcribes` in providers.ts and
   *  recorder/transcribe.ts, which is what asks. */
  readonly transcriber = $derived<Provider | null>(
    [activeOf(this.state, this.state.defaultVendor), ...actives(this.state)].find(
      (one): one is Account => !!one && transcribes(one),
    ) ?? null,
  )

  /** The stamp of the file's text this window last read or wrote. */
  private stamp = ''
  /** Whether this window has heard from the file yet; a change made before then waits. */
  private synced: Promise<void> | null = null

  /** What an id answers with now: its provider's active account, or null for an id of
   *  nothing there. The one place a thread, a feature or a helper learns who answers. */
  provider(id: string): Provider | null {
    return resolve(this.state, id)
  }

  /** A provider's accounts, in the order they were added. */
  accountsOf(vendor: Vendor): Account[] {
    return accountsOf(this.state, vendor)
  }

  /** Whether an account is the one its provider answers with. */
  isActive(id: string): boolean {
    return isActive(this.state, id)
  }

  /** The provider a feature asks: the one chosen for it while it can answer, and the
   *  default otherwise - so removing an account, or its model, leaves every feature still
   *  answered rather than silent. complete.ts is the other half. */
  providerFor(feature: Feature): Provider | null {
    const picked = this.state.uses[feature]
    const found = picked ? resolve(this.state, picked) : null
    return found && usable(found) ? found : this.chosen
  }

  /** What this window kept, read at once: the copy of the file, else the rows it kept
   *  before there was a file. Then the file itself, in the background. Idempotent. */
  restore() {
    const copy = parsedText(storedText(COPY))
    this.state = copy ?? migrated(stored(EARLIER))
    this.synced ??= this.sync()
  }

  /** The file read, and where there is none yet, written out of what this window had. */
  private async sync(): Promise<void> {
    try {
      await this.reread(true)
      void hearChanges(() => void this.reread(false))
    } catch (error) {
      // A crate that cannot be asked leaves the window with its own copy, which is true
      // for this window; the log hears why once.
      log('warn', `ai accounts: could not read the kept accounts: ${String(error)}`)
    }
  }

  /** Takes the file's text as the accounts. The first time, a window with rows of its
   *  own adds them: all of them where there is no file, the missing ones where there is. */
  private async reread(first: boolean): Promise<void> {
    const kept = await readKept()
    this.stamp = kept.stamp
    const read = parsedText(kept.text)
    if (read) this.took(read)
    if (!first) return

    const earlier = storedText(MOVED) === null ? migrated(stored(EARLIER)) : NONE
    const brought = read ? merged(read, earlier) : this.state
    // Made over the newest text, whichever window wrote it first: what this one brings is
    // added to it, never written over it.
    if (!read || brought !== read) await this.change((state) => merged(state, brought))
    keep(MOVED, '1')
  }

  private took(state: Accounts) {
    this.state = state
    keep(COPY, accountsText(state))
  }

  /** One change, made at once in this window and then written over the file's newest
   *  text: where another window wrote in between, the change is made again over what it
   *  wrote, so neither window's change is lost. */
  private async change(make: (state: Accounts) => Accounts): Promise<void> {
    this.took(make(this.state))
    for (let tries = 0; tries < TRIES; tries++) {
      try {
        this.stamp = await writeKept(accountsText(this.state), this.stamp)
        return
      } catch (error) {
        if (!isStale(error)) {
          log('warn', `ai accounts: could not keep the accounts: ${String(error)}`)
          return
        }
        const kept = await readKept()
        this.stamp = kept.stamp
        this.took(make(parsedText(kept.text) ?? NONE))
      }
    }
  }

  /** Makes a change once the file has been heard from, so a change made in the first
   *  moment is never written over a file this window has not read yet. */
  private changed(make: (state: Accounts) => Accounts) {
    // Shown at once; written once the window has read the file.
    this.state = make(this.state)
    void (this.synced ?? Promise.resolve()).then(() => this.change(make))
  }

  /** Has a feature ask the provider of `id`, or the default again for the empty string. */
  use(feature: Feature, id: string) {
    this.changed((state) => used(state, feature, id))
  }

  /** Adds an account of a kind. It answers at once only where its provider had none, and
   *  becomes the default where nothing was. Answers the account so the pane can put the
   *  caret in its first empty field. */
  add(kind: ProviderKind): Account {
    const { account } = added(this.state, kind)
    // Put in again over the newest accounts with the id it was given here, so the account
    // answered is the one kept.
    this.changed((state) => including(state, account))
    return account
  }

  /** Changes fields of one account. */
  update(id: string, change: Partial<Omit<Account, 'id' | 'kind' | 'own'>>) {
    this.changed((state) => updated(state, id, change))
  }

  /** Takes an account away. Its key is the caller's to forget: it lives in a store this
   *  knows nothing about, and forgetting it can fail. */
  remove(id: string) {
    this.changed((state) => removed(state, id))
  }

  /** Makes an account the one its provider answers with. A question already being
   *  answered finishes where it started; the next one asks this account. */
  activate(id: string) {
    this.changed((state) => activated(state, id))
  }

  /** Makes the provider of `id` the default, and an account of it its active one. */
  setDefault(id: string) {
    this.changed((state) => defaulted(state, id))
  }
}

export const ai = new Ai()

// What can hear a recording, said once to the leaf the two recorder rows ask. They are
// built in front of the first paint and this store is not, so the question is asked
// there and answered here; see ai/hears.ts.
transcribersAre(() => ai.transcriber)

// The accounts the palette can switch between, said to its leaf the same way: only a
// provider's with more than one, since a switch to the only account is no switch.
accountsAre(
  () =>
    ai.vendors.flatMap((vendor) => {
      const mine = ai.accountsOf(vendor)
      if (mine.length < 2) return []
      const provider = vendorName(vendor, ai.accounts)
      return mine.map((one) => ({
        id: one.id,
        label: `${provider} · ${accountName(one)}`,
        active: ai.isActive(one.id),
      }))
    }),
  (id) => {
    ai.activate(id)
  },
)

// Read as this module arrives rather than at launch, because the launch does not have
// it any more: everything about talking to a model is fetched by the press that asks
// for it, and the moment it is fetched is the moment to read what was kept. Idempotent,
// so a test that loads the module twice reads the same thing twice. See start.ts, which
// used to call this, and surfaces.svelte.ts for the doors it now comes through.
ai.restore()
