/** The providers a person added, which one answers by default, and which one each
 *  feature asks where the reader chose.
 *
 *  Everything here is a choice and none of it is a secret: the kind, the address of
 *  a local server, the model, the name in the list. The keys are not in it and never
 *  reach storage; see keys.ts. That split is what makes this safe to keep in
 *  `localStorage` beside every other preference.
 *
 *  One provider per kind is the common case and two are allowed for one of them: a
 *  person with Ollama on this machine and OpenRouter behind it has two
 *  OpenAI-compatible providers, and the only thing that tells them apart is the name
 *  and the address. So the list is a list and the ids are handed out here. */

import { key } from '../i18n.svelte'
import { withOrWithout } from '../records'
import { isRecord, isString, keep, stored } from '../stored'
import { transcribersAre } from './hears'
import { type Provider, type ProviderKind, transcribes, usable } from './providers'

const STORAGE_KEY = 'nib:ai'

/** The ids the fixed kinds always use, so a key written on one run is found on the
 *  next and so the keychain shows one entry per provider rather than per session.
 *  A compatible one is numbered from there. */
const FIXED: Record<Exclude<ProviderKind, 'compatible'>, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  chatgpt: 'chatgpt',
  'claude-code': 'claude-code',
  codex: 'codex',
}

/** A kind this build knows. Claude Code is left out of a build that does not offer it,
 *  so a row kept from one that did is not drawn with nothing behind it. */
function isKind(value: unknown): value is ProviderKind {
  if (value === 'claude-code' && !__CLAUDE_CODE__) return false
  return value === 'compatible' || (isString(value) && value in FIXED)
}

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

function isFeature(value: string): value is Feature {
  return FEATURES.some((one) => one.id === value)
}

/** The per-feature choices out of storage: a feature's name to a provider's id. */
function usesIn(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [Feature, string] => isFeature(entry[0]) && isString(entry[1]),
    ),
  )
}

/** One provider out of storage, or null for a row that is not one. */
function providerIn(value: unknown): Provider | null {
  if (!isRecord(value)) return null
  const { id, kind, name, baseUrl, model } = value
  if (!isString(id) || !id || !isKind(kind) || !isString(name)) return null

  return {
    id,
    kind,
    name,
    ...(isString(baseUrl) ? { baseUrl } : {}),
    model: isString(model) ? model : '',
  }
}

class Ai {
  providers = $state<Provider[]>([])
  /** Which provider a block or a rewrite uses without being told. The first usable
   *  one when what was chosen has gone. */
  defaultId = $state('')

  /** The provider that answers, or null where none can. */
  readonly chosen = $derived<Provider | null>(
    this.providers.find((one) => one.id === this.defaultId && usable(one)) ??
      this.providers.find((one) => usable(one)) ??
      null,
  )

  /** Whether anything is set up well enough to be asked. What the rewrite menu and
   *  the block's failure sentence read. */
  readonly ready = $derived(this.chosen !== null)

  /** Which provider each feature asks, where the reader chose one other than the
   *  default. A feature with none here asks `chosen`. */
  uses = $state<Record<string, string>>({})

  /** The provider a feature asks: the one chosen for it while it can answer, and the
   *  default otherwise - so removing a provider, or its model, leaves every feature
   *  still answered rather than silent. The one place any AI surface learns who to ask;
   *  complete.ts is the other half. */
  providerFor(feature: Feature): Provider | null {
    const picked = this.uses[feature]
    return this.providers.find((one) => one.id === picked && usable(one)) ?? this.chosen
  }

  /** The provider that turns sound into words, or null where none can.
   *
   *  The same reading as `chosen` - the default one if it can, else the first that
   *  can - but a different question: transcribing wants an address and a route, not a
   *  chat model, so a local whisper server with no chat model set is still a
   *  transcriber. Claude serves no such route and is never this. See `transcribes` in
   *  providers.ts and recorder/transcribe.ts, which is what asks. */
  readonly transcriber = $derived<Provider | null>(
    this.providers.find((one) => one.id === this.defaultId && transcribes(one)) ??
      this.providers.find((one) => transcribes(one)) ??
      null,
  )

  restore() {
    const saved = stored(STORAGE_KEY)
    if (!isRecord(saved)) return

    const list = Array.isArray(saved.providers) ? saved.providers : []
    this.providers = list.map(providerIn).filter((one): one is Provider => one !== null)
    this.defaultId = isString(saved.defaultId) ? saved.defaultId : ''
    this.uses = usesIn(saved.uses)
  }

  private save() {
    // A browser told to keep no site data forgets them. The providers are still in
    // this session, and a session is all such a browser can offer anybody.
    keep(
      STORAGE_KEY,
      JSON.stringify({ providers: this.providers, defaultId: this.defaultId, uses: this.uses }),
    )
  }

  /** Has a feature ask `id`, or the default again for the empty string. */
  use(feature: Feature, id: string) {
    this.uses = withOrWithout(this.uses, feature, id || null)
    this.save()
  }

  /** Adds one of a kind, and makes it the default when there was none. Answers the
   *  provider so the pane can put the caret in its first empty field. */
  add(kind: ProviderKind): Provider {
    const provider: Provider = {
      id: kind === 'compatible' ? this.nextCompatibleId() : FIXED[kind],
      kind,
      name: '',
      ...(kind === 'compatible' ? { baseUrl: '' } : {}),
      model: '',
    }

    // Asking for a kind that is already there is asking to edit it: there is one
    // Anthropic API and one OpenAI API, and a second row for either would be two
    // rows for one key.
    const held = this.providers.find((one) => one.id === provider.id)
    if (held) return held

    this.providers = [...this.providers, provider]
    if (!this.defaultId) this.defaultId = provider.id
    this.save()
    return provider
  }

  /** A compatible provider's own id. Counted rather than random, so it is short
   *  enough to read in a keychain and the same shape every time. */
  private nextCompatibleId(): string {
    for (let number = 1; ; number++) {
      const id = `compatible-${number}`
      if (!this.providers.some((one) => one.id === id)) return id
    }
  }

  /** Changes one field of one provider. */
  update(id: string, change: Partial<Omit<Provider, 'id' | 'kind'>>) {
    this.providers = this.providers.map((one) => (one.id === id ? { ...one, ...change } : one))
    this.save()
  }

  /** Takes a provider out of the list. The key is the caller's to forget: it lives
   *  in a store this knows nothing about, and forgetting it can fail. */
  remove(id: string) {
    this.providers = this.providers.filter((one) => one.id !== id)
    if (this.defaultId === id) this.defaultId = this.providers[0]?.id ?? ''
    this.uses = Object.fromEntries(Object.entries(this.uses).filter(([, one]) => one !== id))
    this.save()
  }

  setDefault(id: string) {
    this.defaultId = id
    this.save()
  }
}

export const ai = new Ai()

// What can hear a recording, said once to the leaf the two recorder rows ask. They are
// built in front of the first paint and this store is not, so the question is asked
// there and answered here; see ai/hears.ts.
transcribersAre(() => ai.transcriber)

// Read as this module arrives rather than at launch, because the launch does not have
// it any more: everything about talking to a model is fetched by the press that asks
// for it, and the moment it is fetched is the moment to read what was kept. Idempotent,
// so a test that loads the module twice reads the same thing twice. See start.ts, which
// used to call this, and surfaces.svelte.ts for the doors it now comes through.
ai.restore()
