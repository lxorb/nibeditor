/** One request and its stream: the round every turn of the loop is made of, and the one
 *  a summary is written in.
 *
 *  A provider that refuses part of a request rather than all of it - an effort a model
 *  does not have, reasoning sent to a model that does not reason, a per-message effort,
 *  tools on a server that has none - is answered once: what it refused is written down
 *  (learned.ts), the request is made again without it, and nobody is told twice. */

import { t } from '../../i18n.svelte'
import { sseEvents } from '../stream'
import {
  nearest,
  ordered,
  refusesEffort,
  refusesReasoning,
  SCALE,
  supportedIn,
  takesNoEffort,
} from './effort'
import { learn } from './learned'
import { Refused, refusalIn, request } from './request'
import type { Effort, Part, Usage } from './types'
import { type Answer, type Ask, record, type Wire } from './wire'

/** What one round came to. */
export interface Round {
  answer: Answer
  parts: Part[]
  usage: Usage | null
  model: string
}

/** What the round may change about the request before it is made again, said back so
 *  the thread can show it: the level now used, and whether tools were dropped. */
export interface Adjusted {
  effort?: Effort
  /** The levels the model is now known to take. */
  efforts?: Effort[]
  toolsRefused?: boolean
}

/** Whether a refusal was about something the request can do without, and the request
 *  without it. Null where it was about the request as a whole. */
function without(refused: Refused, ask: Ask): { ask: Ask; adjusted: Adjusted } | null {
  if (refused.status !== 400) return null
  const said = refused.message
  const provider = ask.provider.id
  const model = ask.model.id

  if (ask.perMessage && /per-turn effort|per-message effort|mid-conversation/i.test(said)) {
    learn(provider, model, { perMessage: false })
    return { ask: { ...ask, perMessage: false, base: ask.effort }, adjusted: {} }
  }
  const aboutEffort = refusesEffort(said, refused.param)
  if (refusesReasoning(said, refused.param) || (aboutEffort && takesNoEffort(said, refused.code))) {
    learn(provider, model, { reasons: false })
    const efforts: Effort[] = ['auto']
    return {
      ask: { ...ask, effort: 'auto', base: 'auto', model: { ...ask.model, efforts } },
      adjusted: { effort: 'auto', efforts },
    }
  }
  if (ask.effort !== 'auto' && aboutEffort) {
    // Where the refusal lists what the model takes, every other level is refused at
    // once; where not, this one.
    const listed = supportedIn(said)
    const offered = listed ?? ask.model.efforts.filter((one) => one !== ask.effort)
    const refusedNow = SCALE.filter((one) => one !== 'auto' && !offered.includes(one))
    learn(provider, model, { refused: listed ? refusedNow : [ask.effort] })
    const efforts = ordered(offered)
    const effort = nearest(ask.effort, efforts)
    return {
      ask: { ...ask, effort, base: effort, model: { ...ask.model, efforts } },
      adjusted: { effort, efforts },
    }
  }
  if (ask.tools.length && ask.provider.kind === 'compatible' && /\btools?\b|function/i.test(said)) {
    learn(provider, model, { tools: false })
    return { ask: { ...ask, tools: [] }, adjusted: { toolsRefused: true } }
  }
  return null
}

/** Makes the request, stepping round what the provider refused, and reads its stream,
 *  saying each part as it changes. */
export async function round(
  wire: Wire,
  first: Ask,
  heard: (parts: readonly Part[], changed: number[], model: string) => void,
  adjusted: (change: Adjusted) => void,
  signal: AbortSignal,
): Promise<Round> {
  let ask = first
  let response: Response | null = null
  // Each of the four can be refused once; a fifth refusal is about something else.
  for (let tries = 0; !response; tries++) {
    const { url, body, headers } = wire.request(ask)
    try {
      response = await request(ask.provider, url, { body: JSON.stringify(body), headers }, signal)
    } catch (error) {
      const next = error instanceof Refused && tries < 4 ? without(error, ask) : null
      if (!next) throw error
      ask = next.ask
      adjusted(next.adjusted)
    }
  }
  if (!response.body)
    throw new Error(t('The provider answered {status}.', { status: response.status }))

  const reader = wire.reader(ask.model.window)
  let usage: Usage | null = null
  let model = ''
  for await (const event of sseEvents(response.body)) {
    const said = reader.heard(event)
    // A failed response carries its complaint inside it, the way complete.ts reads one.
    if (said.trouble) {
      throw await refusalIn(record(said.trouble).response ?? said.trouble, 0, ask.provider)
    }
    if (said.model) model = said.model
    if (said.usage) usage = said.usage
    if (said.changed.length) heard(reader.parts, said.changed, model)
  }
  return { answer: reader.answer(), parts: reader.parts, usage, model }
}
