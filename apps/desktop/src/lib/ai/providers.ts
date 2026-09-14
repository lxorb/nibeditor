/** What a provider is, and what its wire looks like.
 *
 *  Three kinds, because there are three shapes of API in the world worth knowing
 *  about: Anthropic's own, OpenAI's, and everything that copied OpenAI's - Ollama,
 *  LM Studio, OpenRouter, vLLM, a colleague's gateway. The third is not a list of
 *  services: it is a base URL somebody types, which is what makes a local model on
 *  the same machine and a proxy on the other side of the world the same two fields.
 *
 *  Pure. Nothing here fetches, stores or reads a key: this is the arithmetic of
 *  which address, which headers and which shape, so all of it can be tested without
 *  a network. See complete.ts for the request and keys.ts for the key.
 *
 *  What is deliberately not here is a table of model names. Every provider is asked
 *  what it has (`/v1/models`), because a list written down here is a list that is
 *  wrong by the time anybody reads it, and a local model has a name only the
 *  machine it runs on knows. */

import { key } from '../i18n.svelte'

export type ProviderKind = 'anthropic' | 'openai' | 'compatible'

/** One provider a person added. The key is not here: it lives in the device's own
 *  store under `id`, and nothing that can be written to disk or synced ever holds
 *  one. See keys.ts. */
export interface Provider {
  /** Stable, and the name the key is filed under. Made of the characters the
   *  keychain command accepts; see `named` in secrets.rs. */
  id: string
  kind: ProviderKind
  /** What the list calls it. The kind's own name until somebody types another,
   *  which matters once there are two OpenAI-compatible ones. */
  name: string
  /** Where the API is, for a compatible provider. The other two know their own. */
  baseUrl?: string
  /** The model chosen for it, or empty until one has been. */
  model: string
}

/** The word each kind wears in the list. Translated by the caller: these are keys
 *  and not sentences, and two of the three are brand names that do not translate. */
export const KIND_NAMES: Record<ProviderKind, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  compatible: key('OpenAI-compatible'),
}

/** Where each kind's own API lives, `/v1` and all, so every address below is one
 *  join away. */
const ROOTS: Record<Exclude<ProviderKind, 'compatible'>, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
}

/** The version of Anthropic's API this speaks. Required on every request there,
 *  and dated rather than numbered, which is that API's own convention. */
const ANTHROPIC_VERSION = '2023-06-01'

/** The most an answer may be. Anthropic requires a number and will not guess one;
 *  OpenAI is left to its own default, which is the model's context. Generous
 *  enough for a page of prose, which is what the block and the rewrites ask for. */
const MOST_TOKENS = 4096

/** The other ways of writing "this machine", and the one the app can reach.
 *
 *  `127.0.0.1` and `localhost` are the same machine to every network stack alive.
 *  They are not the same host to a content security policy, and nib's policy names
 *  `http://localhost:*` and no other plain-http origin, which is deliberate: plain
 *  http to this machine is what a local model is, and plain http to anywhere else
 *  is what the policy exists to forbid. See src/csp.ts.
 *
 *  A request to the other spelling is refused by the webview before it leaves, and
 *  the only trace is a console line nobody typing an address into a settings field
 *  would think to look for. So the address is written the way the policy can
 *  honour it, which is the same address. */
const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|\[::1\])(?=[:/]|$)/i

/** A base URL as a root that ends in `/v1`.
 *
 *  Somebody typing an address for a local model types `http://localhost:11434`, or
 *  the same with `/v1` on the end, or with a trailing slash, and all three mean the
 *  same server. Ollama, LM Studio and OpenRouter all serve the OpenAI shape under
 *  `/v1`, so that is where the guessing ends: the root is what was typed with one
 *  `/v1` on it, and never two. */
export function apiRoot(provider: Provider): string {
  if (provider.kind !== 'compatible') return ROOTS[provider.kind]

  const typed = (provider.baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(LOOPBACK, 'http://localhost')
  if (!typed) return ''
  return /\/v\d+$/.test(typed) ? typed : `${typed}/v1`
}

/** Whether a provider has everything it needs to be asked anything. A key is not
 *  part of it: a local model wants none, and whether a remote one has been given
 *  its key is a question for the device's store. */
export function usable(provider: Provider): boolean {
  return !!provider.model && !!apiRoot(provider)
}

/** Whether there is any point in a request to this provider yet.
 *
 *  The pane offers to list a provider's models, because a list of models is the
 *  first thing that tells somebody their key works. It offered it before there
 *  was a key too, and pressing it sent an unauthenticated request to Anthropic's
 *  or OpenAI's own server and showed the 401 that came back. That request can
 *  only fail, and it is a reader who has typed nothing yet telling somebody
 *  else's server that they exist - which is not what an app that keeps keys on
 *  the device and sends questions straight to the model should do with a press.
 *
 *  A compatible provider is the other case, and stays reachable without a key: a
 *  model on this machine wants none, and the address is one the reader typed. */
export function reachable(provider: Provider, keyed: boolean): boolean {
  return !!apiRoot(provider) && (provider.kind === 'compatible' || keyed)
}

/** Where the list of models is. */
export function modelsUrl(provider: Provider): string {
  return `${apiRoot(provider)}/models`
}

/** Where a question goes. Anthropic's messages, or the completions route the other
 *  two share. */
export function askUrl(provider: Provider): string {
  return provider.kind === 'anthropic'
    ? `${apiRoot(provider)}/messages`
    : `${apiRoot(provider)}/chat/completions`
}

/** Where sound goes to come back as words.
 *
 *  OpenAI's own route, and the one every server that speaks the OpenAI shape and
 *  transcribes at all serves under the same name - whisper.cpp's server, faster-whisper,
 *  LM Studio. So a local transcriber is the same two fields in the same pane as a local
 *  model, and nothing above here has to know which. */
export function heardUrl(provider: Provider): string {
  return `${apiRoot(provider)}/audio/transcriptions`
}

/** Whether this provider can be asked to turn sound into words at all.
 *
 *  Anthropic cannot: Claude reads text and images and there is no audio route to ask.
 *  The other two can, so a reader who has set either up has a transcriber already and
 *  needs no account for it. */
export function transcribes(provider: Provider): boolean {
  return provider.kind !== 'anthropic' && !!apiRoot(provider)
}

/** What the request carries besides its body. `key` may be empty, which is a local
 *  model: it gets no authorisation header at all rather than an empty one, which
 *  some servers refuse. */
export function headersFor(provider: Provider, apiKey: string): Record<string, string> {
  if (provider.kind === 'anthropic') {
    return {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': apiKey,
      // Anthropic's API sends no CORS headers unless asked. nib is a webview and a
      // browser tab, so every request it makes is a cross-origin one; without this
      // the browser refuses the reply before any of our code sees it. The name is
      // theirs, and what it warns about is a key in a page somebody else served -
      // which is not this: the key is the reader's own and the page is nib's.
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }

  return {
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  }
}

/** The same headers with the content type left off, for a body that names its own.
 *
 *  A multipart form has a boundary in its content type and only the browser knows what
 *  the boundary is, so a request that named the type itself would be describing a body
 *  it no longer has - and the server would read none of it. Built off `headersFor` so
 *  the authorisation is the one every other request carries. */
export function headersWithoutType(provider: Provider, apiKey: string): Record<string, string> {
  const headers = { ...headersFor(provider, apiKey) }
  delete headers['content-type']

  return headers
}

/** Reading the list of models is one line either way: both shapes answer with
 *  `data`, and an id is what a model is called when it is asked for. Sorted,
 *  because a provider answers in whatever order it likes and a list somebody has
 *  to find a name in should not move. */
export function modelsIn(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return []
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return []

  const names = data
    .map((one) => (typeof one === 'object' && one !== null ? (one as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

export interface Message {
  role: 'system' | 'user'
  content: string
}

/** The body one question is asked with. Anthropic keeps the system prompt out of
 *  the conversation and OpenAI keeps it in it, which is the only difference between
 *  the two shapes that matters here. */
export function bodyFor(provider: Provider, messages: readonly Message[], stream: boolean): string {
  if (provider.kind === 'anthropic') {
    const system = messages
      .filter((one) => one.role === 'system')
      .map((one) => one.content)
      .join('\n\n')

    return JSON.stringify({
      model: provider.model,
      max_tokens: MOST_TOKENS,
      stream,
      ...(system ? { system } : {}),
      messages: messages.filter((one) => one.role !== 'system'),
    })
  }

  return JSON.stringify({ model: provider.model, stream, messages })
}

/** The words one streamed event carries, or the empty string for an event that
 *  carries none - a ping, a start, a stop, a usage report.
 *
 *  Anthropic sends a typed event per delta; OpenAI sends a choice with a delta in
 *  it. Both arrive as the JSON of one `data:` line, which is what this is handed.
 *  A shape neither of them ever sends reads as nothing rather than as a failure:
 *  the stream is somebody else's and new event types appear in it. */
export function deltaIn(kind: ProviderKind, event: unknown): string {
  if (typeof event !== 'object' || event === null) return ''

  if (kind === 'anthropic') {
    const { type, delta } = event as { type?: unknown; delta?: { text?: unknown } }
    if (type !== 'content_block_delta') return ''
    return typeof delta?.text === 'string' ? delta.text : ''
  }

  const choices = (event as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return ''
  const content = (choices[0] as { delta?: { content?: unknown } } | undefined)?.delta?.content
  return typeof content === 'string' ? content : ''
}

/** What a provider said went wrong, or null where the shape holds no complaint.
 *
 *  Both kinds answer a refused request with `error`, and a streamed one can put the
 *  same object in the stream after a `200`. Read in one place so a key that is not
 *  a key, a model that is not there and a quota that has run out all reach the
 *  reader as the provider's own sentence rather than as a status code. */
export function troubleIn(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null

  const error = (body as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (typeof error !== 'object' || error === null) return null

  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message ? message : null
}
