/** A question to a model, with the account's notes as tools.
 *
 *  Said out loud after the word "question" on a pair of glasses, and answered on
 *  them. Three decisions shape the whole of it:
 *
 *  1. **The request is made here.** It used to be made by the plugin, with the key
 *     on the phone. The key is now written and never read back, so the one place
 *     that can make this request is the one place that can open it.
 *  2. **Nothing is stuffed into the context.** Two tools and no notes; see notes.ts.
 *  3. **The answer is one sentence first.** A panel is seven lines and a reader is
 *     walking: the first line has to be the answer, and the detail after a blank
 *     line is for the reader who scrolls.
 *
 *  Written against the Responses API, whose shapes were checked against the live
 *  endpoint on 2026-09-09: a tool is `{ type: 'function', name, parameters,
 *  strict }`, a call comes back as an output item of type `function_call` with a
 *  `call_id`, and the answer to it goes back as an input item of type
 *  `function_call_output`. The text of a reply is in `output[].content[].text`
 *  where the content's type is `output_text`. */

import { OPENAI } from './models'
import { type Found, readNote, searchNotes } from './notes'
import type { Env } from '../types'

/** How hard the model is asked to think. The API's own list, read off the error it
 *  answers an invalid one with on 2026-09-09, so it is the API's and not a guess. */
export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

/** What the model needs to know before it answers.
 *
 *  Short on purpose. A long prompt for a panel of seven lines is a long prompt spent
 *  teaching the model to write for a screen it will never see. */
const PROMPT = [
  "You answer questions about the person's own notes, out loud, on a pair of",
  'glasses with seven short lines on them.',
  '',
  'Answer in this shape, always:',
  'first one sentence with the answer, then a blank line, then more detail only if',
  'it is needed.',
  '',
  'Use search_notes to find what you need and read_note to read it. Never guess at',
  'what a note says. If the notes do not answer the question, say so in the first',
  'sentence.',
].join('\n')

/** The two tools, as the API takes them. */
const TOOLS = [
  {
    type: 'function',
    name: 'search_notes',
    description: "Search every note in the person's account. Answers matching lines.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'read_note',
    description: 'Read one whole note, by the name a search gave.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the note.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    strict: true,
  },
] as const

/** How many rounds of tool calls are allowed before the answer has to come.
 *
 *  Four. A question about the notes is a search and a read, and a model that has not
 *  answered after four is a model in a loop; the reader is standing there. */
const ROUNDS = 4

/** How much of a note the model is given at once.
 *
 *  Twelve thousand characters, which is a long note and a small fraction of any
 *  model's window. A note longer than that is cut rather than refused, and the model
 *  is told it was cut so that it does not report the ending of something it did not
 *  see. */
const MOST = 12_000

/** What came back, kept to what is used. */
interface Call {
  id: string
  name: string
  arguments: string
}

/** Every message of the conversation so far. Plain objects rather than a type from a
 *  package: this is a wire format and it is written out where it is read. */
type Item = Record<string, unknown>

/** The text of a reply, and the calls it wants made. Read field by field, because
 *  this is JSON from somebody else's server. */
function readReply(body: unknown): { text: string; calls: Call[]; refused: string } {
  const out: { text: string; calls: Call[]; refused: string } = { text: '', calls: [], refused: '' }
  if (typeof body !== 'object' || body === null) return out

  const error = (body as { error?: unknown }).error
  if (typeof error === 'object' && error !== null) {
    const said = (error as { message?: unknown }).message
    out.refused = typeof said === 'string' ? said : 'refused'
    return out
  }

  const output = (body as { output?: unknown }).output
  if (!Array.isArray(output)) return out

  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue

    const one = item as Record<string, unknown>
    if (one.type === 'function_call') {
      const id = typeof one.call_id === 'string' ? one.call_id : ''
      const name = typeof one.name === 'string' ? one.name : ''
      const args = typeof one.arguments === 'string' ? one.arguments : '{}'
      if (id && name) out.calls.push({ id, name, arguments: args })
      continue
    }

    const content = one.content
    if (!Array.isArray(content)) continue

    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue

      const piece = part as Record<string, unknown>
      if (piece.type === 'output_text' && typeof piece.text === 'string') out.text += piece.text
    }
  }

  return out
}

/** One field of a tool call's arguments, which arrive as a JSON string. */
function argument(call: Call, name: string): string {
  try {
    const parsed: unknown = JSON.parse(call.arguments)
    if (typeof parsed !== 'object' || parsed === null) return ''

    const found = (parsed as Record<string, unknown>)[name]
    return typeof found === 'string' ? found : ''
  } catch {
    // A model that sent something that is not JSON has asked for nothing, and the
    // empty answer below tells it so.
    return ''
  }
}

/** What a tool answers, as the string the model is handed.
 *
 *  Every one of them is scoped to the account the session belongs to, and no
 *  argument the model can send names a user. A model that asks for somebody else's
 *  note is asking for a note that is not in the list it can see. */
async function answer(env: Env, userId: string, call: Call): Promise<string> {
  if (call.name === 'search_notes') {
    const query = argument(call, 'query')
    if (!query) return 'no query'

    const found: Found[] = await searchNotes(env, userId, query)
    if (!found.length) return 'nothing found'
    return JSON.stringify(found)
  }

  if (call.name === 'read_note') {
    const name = argument(call, 'name')
    if (!name) return 'no name'

    const text = await readNote(env, userId, name)
    if (text === null) return 'no such note'
    // Said rather than silently cut, so the model does not report the end of
    // something it was never shown.
    return text.length > MOST ? `${text.slice(0, MOST)}\n\n[cut here; the note goes on]` : text
  }

  return 'no such tool'
}

/** The question, asked and answered.
 *
 *  Throws only what the reader has to be told - a refusal from the API, a model that
 *  is not there - because somebody is standing there and a silent failure is a pair
 *  of glasses that ignored them. */
export async function askAbout(
  env: Env,
  userId: string,
  question: string,
  asking: { key: string; model: string; effort: Effort },
): Promise<string> {
  const items: Item[] = [
    { role: 'developer', content: PROMPT },
    { role: 'user', content: question },
  ]

  for (let round = 0; round <= ROUNDS; round++) {
    const answered = await fetch(`${OPENAI}/v1/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${asking.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: asking.model,
        input: items,
        reasoning: { effort: asking.effort },
        tools: TOOLS,
        // Enough for a sentence and a few paragraphs after it. A panel holds seven
        // lines and the reader scrolls; a thousand words is nobody's answer.
        max_output_tokens: 1200,
      }),
    })

    const body: unknown = await answered.json().catch(() => null)
    const reply = readReply(body)
    if (reply.refused) throw new Error(reply.refused)
    if (!answered.ok) throw new Error(`the model answered ${String(answered.status)}`)

    // The last round is the answer whatever else it wanted: a model still asking for
    // notes after four rounds is not going to stop.
    if (!reply.calls.length || round === ROUNDS) return reply.text.trim()

    for (const call of reply.calls) {
      items.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
      })
      items.push({
        type: 'function_call_output',
        call_id: call.id,
        output: await answer(env, userId, call),
      })
    }
  }

  return ''
}
