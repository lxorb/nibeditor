/** Which models a provider has and what each can be asked (4.9), from the provider's own
 *  list and nothing written down here.
 *
 *  - Claude: `GET /v1/models`, whose `capabilities` say which efforts, whether it thinks,
 *    takes pictures, compacts, and `max_input_tokens` is the window.
 *  - OpenAI with a key: names only. Every level is offered until one is refused, and the
 *    window is whatever a refusal names (learned.ts).
 *  - A ChatGPT plan: the plan's catalogue, `models[]`, the ones meant to be listed.
 *  - OpenAI-compatible: `<base>/v1/models`, with whatever context field the server
 *    fills in (OpenRouter's `context_length`, LM Studio's `max_context_length`) and an
 *    effort row only where the model advertises reasoning.
 *
 *  Claude Code and Codex are their own engines' (lane 2). Asked when the reader opens the
 *  model popover, which is the press the request is for. */

import { isLocal, modelsUrl, type Provider } from '../providers'
import { sseJson } from '../stream'
import { ordered, SCALE } from './effort'
import { learnt } from './learned'
import { request } from './request'
import type { Effort, ModelInfo } from './types'

/** Claude's beta that makes the list say whether a model compacts on request. */
export const ANTHROPIC_COMPACT_BETA = 'compact-2026-09-04'

type Json = Record<string, unknown>

function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** `{supported: true}` at the end of a path through Claude's capability tree. */
function supported(tree: unknown, ...path: string[]): boolean {
  let at: unknown = tree
  for (const key of path) at = record(at)?.[key]
  return record(at)?.supported === true
}

/** The rows of a list, whichever key holds them. */
function rows(body: unknown, key: 'data' | 'models'): Json[] {
  const list = record(body)?.[key]
  return Array.isArray(list) ? list.map(record).filter((one): one is Json => one !== null) : []
}

/** Claude's list, one page. */
export function anthropicModels(body: unknown): ModelInfo[] {
  return rows(body, 'data').flatMap((row) => {
    const id = text(row.id)
    if (!id) return []
    const caps = row.capabilities
    const efforts = (['low', 'medium', 'high', 'xhigh', 'max'] as const).filter((level) =>
      supported(caps, 'effort', level),
    )
    const output = count(row.max_tokens)
    return [
      {
        id,
        name: text(row.display_name) || id,
        window: count(row.max_input_tokens),
        efforts: ordered(efforts),
        images: supported(caps, 'image_input'),
        // Claude's fast mode is the research preview's; a list that says so is believed,
        // one that does not leaves the row out.
        fast: supported(caps, 'fast_mode') || supported(caps, 'speed', 'fast'),
        ...(output ? { output } : {}),
        thinking: supported(caps, 'thinking', 'types', 'adaptive'),
        compaction: supported(caps, 'compaction'),
      },
    ]
  })
}

/** Families on OpenAI's list that are not for talking to. */
const NOT_CHAT =
  /embedding|whisper|tts|dall-e|moderation|transcribe|audio|realtime|image|search|babbage|davinci/i

/** OpenAI's list: names, and every level until one is refused. */
export function openaiModels(body: unknown): ModelInfo[] {
  return rows(body, 'data').flatMap((row) => {
    const id = text(row.id)
    if (!id || NOT_CHAT.test(id)) return []
    return [{ id, name: id, window: null, efforts: [...SCALE], images: true, fast: true }]
  })
}

/** The efforts a plan's catalogue row lists, under whichever of the names Codex's own
 *  catalogue uses. */
function planEfforts(row: Json): Effort[] {
  const listed =
    row.supported_reasoning_levels ?? row.supported_reasoning_efforts ?? row.reasoning_efforts
  if (!Array.isArray(listed)) return [...SCALE]
  const words = listed.map((one) => text(record(one)?.effort) || text(one))
  return ordered(
    words
      .map((word) => (word === 'none' ? 'off' : word))
      .filter((word): word is Effort => (SCALE as readonly string[]).includes(word)),
  )
}

/** A ChatGPT plan's catalogue: the rows meant to be listed, in the plan's own order. */
export function planModels(body: unknown): ModelInfo[] {
  return rows(body, 'models').flatMap((row) => {
    const id = text(row.slug) || text(row.id)
    if (!id || (row.visibility !== undefined && row.visibility !== 'list')) return []
    const modalities = row.input_modalities
    return [
      {
        id,
        name: text(row.display_name) || id,
        window: count(row.context_window) ?? count(row.max_context_window),
        efforts: planEfforts(row),
        images: Array.isArray(modalities) ? modalities.includes('image') : true,
        fast: false,
      },
    ]
  })
}

/** An OpenAI-compatible server's list, with whatever it says about each model. */
export function compatibleModels(body: unknown): ModelInfo[] {
  return rows(body, 'data').flatMap((row) => {
    const id = text(row.id)
    if (!id) return []
    const top = record(row.top_provider)
    const params = Array.isArray(row.supported_parameters) ? row.supported_parameters : []
    const reasons = params.includes('reasoning') || params.includes('reasoning_effort')
    const modalities = record(row.architecture)?.input_modalities
    return [
      {
        id,
        name: text(row.name) || id,
        window:
          count(row.context_length) ??
          count(top?.context_length) ??
          count(row.max_context_length) ??
          count(row.context_window),
        efforts: reasons ? ordered(['minimal', 'low', 'medium', 'high']) : ['auto'],
        images: Array.isArray(modalities) ? modalities.includes('image') : false,
        fast: false,
      },
    ]
  })
}

/** A model as the list said it, with what the provider has refused since. */
export function withLearnt(provider: string, model: ModelInfo): ModelInfo {
  const known = learnt(provider, model.id)
  const refused = new Set(known.refused ?? [])
  const efforts =
    known.reasons === false ? ['auto' as const] : model.efforts.filter((one) => !refused.has(one))
  return { ...model, efforts: ordered(efforts), window: model.window ?? known.window ?? null }
}

/** Claude's list, every page of it. */
async function anthropicList(provider: Provider, signal?: AbortSignal): Promise<ModelInfo[]> {
  const found: ModelInfo[] = []
  let after = ''
  // A page is a thousand models; a second is already more than anybody has.
  for (let page = 0; page < 10; page++) {
    const url = `${modelsUrl(provider)}?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`
    const response = await request(
      provider,
      url,
      { method: 'GET', headers: { 'anthropic-beta': ANTHROPIC_COMPACT_BETA } },
      signal,
    )
    const body = sseJson(await response.text())
    found.push(...anthropicModels(body))
    const more = record(body)
    if (more?.has_more !== true || !text(more.last_id)) break
    after = text(more.last_id)
  }
  return found
}

/** What a provider has, newest knowledge folded in. */
export async function catalogue(provider: Provider, signal?: AbortSignal): Promise<ModelInfo[]> {
  if (isLocal(provider.kind)) return []
  if (provider.kind === 'anthropic') {
    return (await anthropicList(provider, signal)).map((one) => withLearnt(provider.id, one))
  }
  const response = await request(provider, modelsUrl(provider), { method: 'GET' }, signal)
  const body = sseJson(await response.text())
  const read =
    provider.kind === 'chatgpt'
      ? planModels(body)
      : provider.kind === 'openai'
        ? openaiModels(body)
        : compatibleModels(body)
  const listed = provider.kind === 'chatgpt' ? read : read.sort((a, b) => a.id.localeCompare(b.id))
  return listed.map((one) => withLearnt(provider.id, one))
}

/** A model the list did not have, or that has not been listed yet: a name typed, the
 *  provider's model from Settings. Knows nothing but what was learnt. */
export function unlisted(provider: Provider, id: string): ModelInfo {
  const keyed = provider.kind === 'openai' || provider.kind === 'chatgpt'
  return withLearnt(provider.id, {
    id,
    name: id,
    window: null,
    efforts: keyed ? [...SCALE] : ['auto'],
    images: provider.kind !== 'compatible',
    fast: false,
  })
}

/** The window a refusal names: "maximum context length is 128000 tokens", "prompt is too
 *  long: 210000 tokens > 200000 maximum". The larger number in the second shape is what
 *  was sent; the window is the one after `>` or after `is`. */
export function windowIn(said: string): number | null {
  const over = /(\d[\d,]*)\s*tokens?\s*>\s*(\d[\d,]*)/i.exec(said)
  const named = /context (?:length|window)[^\d]{0,40}(\d[\d,]*)/i.exec(said)
  const found = over?.[2] ?? named?.[1]
  return found ? count(Number(found.replace(/,/g, ''))) : null
}
