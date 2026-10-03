/** One request from the page to a provider, the way `complete()` makes one: the key read
 *  for this request and not kept, a plan's token of the hour, no request at all to a
 *  hosted provider with no key, and a refusal in the provider's own words.
 *
 *  The conversation needs two things `complete()` does not: the refusal kept apart from
 *  its sentence, so the engine can tell an effort refused from a key refused and step
 *  rather than fail; and headers of its own, for Claude's betas. */

import { t } from '../../i18n.svelte'
import { readKey } from '../keys'
import { headersFor, type Provider, reachable, troubleIn, usable } from '../providers'
import { sseJson } from '../stream'

/** A refusal, with what the engine reads to decide what to do next. */
export class Refused extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The parameter OpenAI's shape names, where it names one. */
    readonly param: string,
    /** The provider's code for it, where it gives one. */
    readonly code: string,
  ) {
    super(message)
    this.name = 'Refused'
  }
}

/** Whether something thrown was a stop rather than a failure. */
export function wasStopped(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** What a request is authorised with: the key on this device, or a plan's token. */
async function keyFor(provider: Provider): Promise<string> {
  if (provider.kind !== 'chatgpt') return await readKey(provider)
  const { planToken } = await import('../chatgpt')
  return await planToken()
}

/** The headers for a request, or a thrown sentence where none should be made. */
export async function headers(
  provider: Provider,
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  // A conversation's model is the thread's, so the provider's own model is not what
  // decides whether it is set up: a root and, where hosted, a key.
  if (!usable({ ...provider, model: provider.model || '-' })) {
    throw new Error(t('That provider is not set up yet.'))
  }
  const apiKey = await keyFor(provider)
  if (!reachable(provider, !!apiKey)) throw new Error(t('That provider is not set up yet.'))
  return { ...headersFor(provider, apiKey), ...extra }
}

/** A request, answered `ok` or thrown as a `Refused`. */
export async function request(
  provider: Provider,
  url: string,
  init: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> },
  signal?: AbortSignal,
): Promise<Response> {
  const sent = await headers(provider, init.headers)
  const response = await fetch(url, {
    method: init.method ?? 'POST',
    headers: sent,
    ...(init.body === undefined ? {} : { body: init.body }),
    ...(signal ? { signal } : {}),
  }).catch((error: unknown) => {
    // Never reached anything; the address is the useful half of the sentence. A stop is
    // rethrown as itself.
    if (wasStopped(error)) throw error
    throw new Error(t('Could not reach {url}', { url }))
  })
  if (!response.ok) throw await refusalOf(response, provider)
  return response
}

/** The provider's refusal, read once. */
async function refusalOf(response: Response, provider: Provider): Promise<Refused> {
  const text = await response.text().catch(() => '')
  return refusalIn(sseJson(text), response.status, provider)
}

/** A refusal from its body: the plan's sentence where a plan said it, else the
 *  provider's, else a status in nib's words. */
export async function refusalIn(
  body: unknown,
  status: number,
  provider: Provider,
): Promise<Refused> {
  const { param, code } = detailsIn(body)
  if (provider.kind === 'chatgpt') {
    const { planRefusal } = await import('../chatgpt')
    const plan = planRefusal(status, body)
    if (plan) return new Refused(plan, status, param, code)
  }
  const said = troubleIn(body)
  if (said) return new Refused(said, status, param, code)
  if (status === 401 || status === 403) {
    return new Refused(t('That key was refused.'), status, param, code)
  }
  return new Refused(t('The provider answered {status}.', { status }), status, param, code)
}

/** The `param` and `code` an error object carries, where it carries them. */
function detailsIn(body: unknown): { param: string; code: string } {
  const error =
    typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null
  if (typeof error !== 'object' || error === null) return { param: '', code: '' }
  const { param, code, type } = error as { param?: unknown; code?: unknown; type?: unknown }
  return {
    param: typeof param === 'string' ? param : '',
    code: typeof code === 'string' ? code : typeof type === 'string' ? type : '',
  }
}
