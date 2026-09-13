/** The three providers, as one request each.
 *
 *  Three shapes and one question: a prompt goes out and a line of JSON comes
 *  back. Claude's Messages API wants the system prompt in its own field and a
 *  version header; everything else in reach speaks OpenAI's chat completions,
 *  which is what Ollama, LM Studio and OpenRouter all answer on, so those are one
 *  provider with the address left open rather than three with the same body.
 *
 *  Raw requests rather than a provider's own client library: the clipper needs one
 *  call, the extension already hand-writes its own client for the sync service for
 *  the same reason, and a popup that loaded an SDK for one of the three would
 *  still be hand-writing the other two. The same argument as `lib/api.ts`.
 *
 *  Everything here is pure - a request is an address, headers and a body, and
 *  nothing in this file sends one. `index.ts` is the half that does, and is the
 *  only file in the folder that is not liftable as it stands: when the app's own
 *  ai module lands under `apps/desktop/src/lib/ai/**`, this file, `prompt.ts`,
 *  `values.ts` and `templates.ts` are what the two would share. */

import { isRecord, isString, listOf, text } from '../stored'

export type ProviderId = 'claude' | 'openai' | 'compatible'

export const PROVIDER_IDS = [
  'claude',
  'openai',
  'compatible',
] as const satisfies readonly ProviderId[]

interface Provider {
  /** English, and so also the key each dictionary translates. */
  name: string
  /** Where it answers, for the two that answer in one place. */
  base: string
  model: string
  /** Whether a request without a key is worth sending. A model on the machine
   *  wants no key and refusing to ask it would be the extension inventing a
   *  requirement the server does not have. */
  needsKey: boolean
}

/** Ollama's own address, which is the one local thing worth looking for by
 *  itself: it is installed by more people than anything else that speaks this
 *  protocol, and it always answers on this port. */
export const OLLAMA = 'http://localhost:11434/v1'

export const PROVIDERS: Record<ProviderId, Provider> = {
  claude: {
    name: 'Claude',
    base: 'https://api.anthropic.com',
    model: 'claude-opus-5',
    needsKey: true,
  },
  openai: {
    name: 'OpenAI',
    base: 'https://api.openai.com/v1',
    model: '',
    needsKey: true,
  },
  compatible: {
    name: 'Another server',
    base: OLLAMA,
    model: '',
    needsKey: false,
  },
}

/** One provider, ready to be asked. */
export interface Setup {
  provider: ProviderId
  /** Empty where the provider needs none. */
  key: string
  /** Only the compatible provider's is a choice; the other two answer in one
   *  place and `base` is where. */
  address: string
  model: string
}

/** How many tokens a block of properties can possibly need. Claude requires the
 *  ceiling and gives no default; it is generous because a model that thinks
 *  before it answers spends the first of them thinking. */
const MOST_TOKENS = 4096

export interface Request {
  url: string
  headers: Record<string, string>
  body: unknown
}

/** Whether an address is one the key may be sent to.
 *
 *  The compatible provider's address is typed by hand, and what is sent to it is the
 *  key plus the page: a typo is somebody else's server being handed both, and `http:`
 *  to anywhere but this machine is both of them in the clear. So it has to parse, it
 *  has to be `https:`, and the one exception is loopback - which is where a model on
 *  the machine answers, has no certificate, and is the reason the provider exists.
 *
 *  Judged here rather than where it is typed, because here is where it is used: the
 *  options page says the same thing to the reader as they type it. */
export function reachable(address: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(address.trim())
  } catch {
    return false
  }

  if (parsed.protocol === 'https:') return true

  return (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]' ||
      parsed.hostname === '::1')
  )
}

/** Where a provider answers, with the trailing slash a pasted address usually
 *  carries taken off. Nothing for an address the key may not be sent to, which
 *  `ready` then reads as a provider that is not set up. */
function base(setup: Setup): string {
  const said = setup.provider === 'compatible' ? setup.address : PROVIDERS[setup.provider].base
  const trimmed = said.trim().replace(/\/+$/, '')

  return setup.provider === 'compatible' && !reachable(trimmed) ? '' : trimmed
}

/** Whether the setup is worth sending anything at all. */
export function ready(setup: Setup): boolean {
  if (!base(setup) || !setup.model.trim()) return false
  return !PROVIDERS[setup.provider].needsKey || !!setup.key.trim()
}

/** The one request, as the chosen provider wants it.
 *
 *  `json` asks for the provider's JSON mode where it has one. It is a request
 *  rather than a requirement: a server on somebody's machine may be old enough
 *  not to know the field and answer 400, which `index.ts` handles by asking again
 *  without it. The prompt says to answer in JSON either way. */
export function requestFor(
  setup: Setup,
  prompt: { system: string; user: string },
  json: boolean,
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }

  if (setup.provider === 'claude') {
    headers['x-api-key'] = setup.key
    headers['anthropic-version'] = '2023-06-01'
    // What the API asks for before it will answer a browser at all: the key is
    // in a page rather than on a server, and Anthropic would rather that were
    // said out loud than discovered from a CORS failure.
    headers['anthropic-dangerous-direct-browser-access'] = 'true'

    return {
      url: `${base(setup)}/v1/messages`,
      headers,
      body: {
        model: setup.model,
        max_tokens: MOST_TOKENS,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      },
    }
  }

  if (setup.key) headers.authorization = `Bearer ${setup.key}`

  return {
    url: `${base(setup)}/chat/completions`,
    headers,
    body: {
      model: setup.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    },
  }
}

/** What the models a provider has are asked for. Both protocols answer the same
 *  list in the same shape, which is the one thing they agree on. */
export function modelsRequest(setup: Setup): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {}

  if (setup.provider === 'claude') {
    headers['x-api-key'] = setup.key
    headers['anthropic-version'] = '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  } else if (setup.key) {
    headers.authorization = `Bearer ${setup.key}`
  }

  // Claude's address stops short of its version, the way its own documentation
  // writes it; an OpenAI-compatible address carries the `/v1` already, which is
  // also what makes `chat/completions` below relative to it.
  const path = setup.provider === 'claude' ? '/v1/models' : '/models'
  return { url: `${base(setup)}${path}`, headers }
}

/** The models a reply lists, in the order it listed them. */
export function readModels(body: unknown): string[] {
  const listed = isRecord(body) ? body.data : null
  return listOf(listed, (one) => text(one, 'id'))
}

/** The one line of text an answer holds, or null when it holds none.
 *
 *  Claude answers with a list of blocks, of which the interesting one is the text;
 *  a model that thought first puts its thinking in a block of its own in front of
 *  it, which is why the list is searched rather than indexed. */
export function readReply(provider: ProviderId, body: unknown): string | null {
  if (!isRecord(body)) return null

  if (provider === 'claude') {
    const said = listOf(body.content, (one) =>
      text(one, 'type') === 'text' ? text(one, 'text') : null,
    )

    return said[0] ?? null
  }

  const said = listOf(body.choices, (one) => text(isRecord(one) ? one.message : null, 'content'))
  return said[0] ?? null
}

/** Longer than this and it is not a sentence about what went wrong, it is a page.
 *  A provider's own words are worth showing; a provider's HTML is not. */
const LONGEST_REFUSAL = 200

/** Why a provider refused, in its own words, or null when it did not say.
 *
 *  All three write it the same way but not in the same place: `error` is an object
 *  with a message for the two big ones and a plain string for some of the local
 *  servers, so both are read. Handed on untranslated, the way the sync service's
 *  refusals are. */
export function refusalIn(body: unknown): string | null {
  if (!isRecord(body)) return null

  const error = body.error
  const said = isString(error) ? error : (text(error, 'message') ?? text(body, 'message'))

  const one = said?.replace(/\s+/g, ' ').trim().slice(0, LONGEST_REFUSAL) ?? ''
  return one === '' ? null : one
}
