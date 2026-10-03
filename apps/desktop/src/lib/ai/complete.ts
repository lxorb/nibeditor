/** The one place nib asks a model anything.
 *
 *  Every AI surface goes through this: the ```` ```ai ```` block in a note, the four
 *  rewrites on a selection, the Ask panel, a meeting's summary, and whatever comes after
 *  them. One function, so there is one place that knows how a request is made, one place
 *  a key is read, and one place a failure becomes a sentence somebody can read. Which
 *  provider each of them asks is the store's `providerFor`, the other half of the seam.
 *
 *  The request is made by the page itself, from the device, to whichever provider
 *  the reader chose - or, for Claude Code and Codex, by the program the reader installed,
 *  started on this machine by the crate. Nothing goes through nibeditor's own server:
 *  the account never sees the question, the note or the key. The one exception is not
 *  an exception at all - the glasses ask through the Worker with the account's own
 *  OpenAI key, which is a different key for a different thing; see services/sync/src/ask
 *  and the AI pane, which says so. A plan cannot be spent there: the Worker is
 *  nibeditor's server, and no plan's terms let a server spend a reader's plan.
 *
 *  Streaming because an answer is read as it arrives, and abortable because a person
 *  who has read enough should be able to stop paying for the rest. */

import { t } from '../i18n.svelte'
import { readKey } from './keys'
import {
  askUrl,
  bodyFor,
  deltaIn,
  headersFor,
  isLocal,
  type Message,
  modelsIn,
  modelsUrl,
  type Provider,
  reachable,
  troubleIn,
  usable,
} from './providers'
import { sseJson, sseLines } from './stream'

export interface Ask {
  provider: Provider
  /** Which model answers. Passed rather than read off the provider, so one call can
   *  ask a model other than the one that provider is set to - which is what listing
   *  models and trying one out needs. Empty, for Claude Code and Codex, is the model
   *  the reader chose in the program. */
  model: string
  messages: readonly Message[]
  /** Each piece of the answer as it arrives. Without one the whole answer is asked
   *  for in a single reply, which is what a request nobody is watching should do. */
  stream?: (text: string) => void
  /** Which model is answering, said once before the first piece. The model asked for
   *  where it was named; the one a program says it runs where it was not. */
  named?: (model: string) => void
  signal?: AbortSignal
}

/** Asks, and answers with the whole of what came back.
 *
 *  Three roads, one call: a request from the page to the provider's API (a key, a
 *  server on this machine, or a ChatGPT plan's token of the hour), or a question put to
 *  Claude Code or Codex through the crate (local/ask.ts). Every caller is the same
 *  either way.
 *
 *  Throws with a sentence: whatever the provider said, or a translated one where it
 *  said nothing useful. Aborting throws too, with the browser's own `AbortError`,
 *  which callers tell apart with `wasStopped`. */
export async function complete(ask: Ask): Promise<string> {
  // The plugin offers no program and no plan (see `offeredKinds`), and leaves both
  // roads out of its package.
  if (!__EVEN_PLUGIN__ && isLocal(ask.provider.kind)) {
    const { askLocal } = await import('./local/ask')
    return await askLocal({ ...ask, provider: { ...ask.provider, kind: ask.provider.kind } })
  }

  const provider: Provider = { ...ask.provider, model: ask.model }
  if (!usable(provider)) throw new Error(t('That provider is not set up yet.'))

  const apiKey = await keyFor(provider)
  // No key, no request to somebody else's server - which is the same question the
  // pane asks before it offers to list the models, asked here because this is where
  // the note goes. A hosted provider with no key can only answer 401, and by the
  // time it does the body has left: the prompt, and the whole note where the fence
  // asked for it. A provider whose key was removed keeps its model, so it is still
  // the chosen one; see store.svelte.ts.
  if (!reachable(provider, !!apiKey)) throw new Error(t('That provider is not set up yet.'))

  // A plan is only ever answered as a stream.
  const streaming = !!ask.stream || provider.kind === 'chatgpt'

  const response = await fetch(askUrl(provider), {
    method: 'POST',
    headers: headersFor(provider, apiKey),
    body: bodyFor(provider, ask.messages, streaming),
    ...(ask.signal ? { signal: ask.signal } : {}),
  }).catch((error: unknown) => {
    // A request that never reached anything: no network, a local server that is not
    // running, an address that is not one. The browser's own message for that is
    // "Failed to fetch", which says nothing about which of the three it was, so the
    // address is what the sentence carries instead. An abort is rethrown as itself:
    // stopping is not a failure and the caller has to be able to see that it was one.
    if (wasStopped(error)) throw error
    throw new Error(t('Could not reach {url}', { url: askUrl(provider) }))
  })

  if (!response.ok) throw new Error(await refusal(response, provider))
  ask.named?.(provider.model)
  if (!streaming || !response.body) return whole(await response.text(), provider)

  return await streamed(response.body, provider, ask.stream)
}

/** What a request is authorised with: the key on this device, or a plan's token of the
 *  hour, asked of the crate. */
async function keyFor(provider: Provider): Promise<string> {
  if (__EVEN_PLUGIN__ || provider.kind !== 'chatgpt') return await readKey(provider)
  const { planToken } = await import('./chatgpt')
  return await planToken()
}

/** Whether something thrown was a stop rather than a failure. */
export function wasStopped(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** What a refused request says. The provider's own sentence where it sent one, since
 *  "this key cannot use that model" is a thing only the provider knows. */
async function refusal(response: Response, provider: Provider): Promise<string> {
  const text = await response.text().catch(() => '')
  const body = sseJson(text)
  const plan = await planSaid(provider, response.status, body)
  if (plan) return plan

  const said = troubleIn(body)
  if (said) return said

  if (response.status === 401 || response.status === 403) return t('That key was refused.')
  return t('The provider answered {status}.', { status: response.status })
}

/** A ChatGPT plan's refusal in nib's words - its limit, a sign-in gone - or null for
 *  any other provider and any other refusal. */
async function planSaid(provider: Provider, status: number, body: unknown): Promise<string | null> {
  if (__EVEN_PLUGIN__ || provider.kind !== 'chatgpt') return null
  const { planRefusal } = await import('./chatgpt')
  return planRefusal(status, body)
}

/** The answer of a request that was not streamed. Both shapes put the words
 *  somewhere different, and neither is the shape a stream sends. */
function whole(text: string, provider: Provider): string {
  const body = sseJson(text)
  const said = troubleIn(body)
  if (said) throw new Error(said)

  if (typeof body !== 'object' || body === null) return ''

  if (provider.kind === 'anthropic') {
    const content = (body as { content?: unknown }).content
    if (!Array.isArray(content)) return ''
    return content
      .map((one) =>
        typeof one === 'object' &&
        one !== null &&
        typeof (one as { text?: unknown }).text === 'string'
          ? (one as { text: string }).text
          : '',
      )
      .join('')
  }

  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return ''
  const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
  return typeof message === 'string' ? message : ''
}

/** Reads the stream to its end, handing every piece on as it arrives. */
async function streamed(
  body: ReadableStream<Uint8Array>,
  provider: Provider,
  wrote: ((text: string) => void) | undefined,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let held = ''
  let answer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      const { payloads, rest } = sseLines(held, decoder.decode(value, { stream: true }))
      held = rest

      for (const payload of payloads) {
        const event = sseJson(payload)
        // A provider can refuse mid-stream: the status was 200 and the complaint is
        // an event like any other. What has arrived so far is kept by the caller,
        // and this says why the rest never will.
        const said = troubleIn(event)
        if (said) {
          const failed = (event as { response?: unknown } | null)?.response ?? event
          throw new Error((await planSaid(provider, 0, failed)) ?? said)
        }

        const piece = deltaIn(provider.kind, event)
        if (!piece) continue
        answer += piece
        wrote?.(piece)
      }
    }
  } finally {
    // Lets go of the connection however this ended, including a stop: a reader left
    // open holds the socket, and a note asked twice would leave two behind.
    reader.cancel().catch(() => undefined)
  }

  return answer
}

/** What a provider says it has. Empty where it has nothing to say, which is what a
 *  local server with no model loaded looks like. */
export async function listModels(provider: Provider, signal?: AbortSignal): Promise<string[]> {
  const apiKey = await keyFor(provider)
  // Asked here as well as by the pane that offers the press: the rule is about the
  // request rather than about the button.
  if (!reachable(provider, !!apiKey)) throw new Error(t('That provider is not set up yet.'))

  const response = await fetch(modelsUrl(provider), {
    headers: headersFor(provider, apiKey),
    ...(signal ? { signal } : {}),
  }).catch((error: unknown) => {
    if (wasStopped(error)) throw error
    throw new Error(t('Could not reach {url}', { url: modelsUrl(provider) }))
  })

  if (!response.ok) throw new Error(await refusal(response, provider))
  return modelsIn(sseJson(await response.text()))
}
