/** Chat completions, as every OpenAI-compatible server copied them: Ollama, LM Studio,
 *  OpenRouter, vLLM, a gateway at work.
 *
 *  - Tools as functions, their calls streamed in pieces by index.
 *  - Effort as `reasoning_effort` where the model advertised reasoning; a server that
 *    refuses it is not sent it again (learned.ts).
 *  - Usage asked for at the end of the stream (`stream_options.include_usage`), with
 *    OpenRouter's `cost` where it reports one.
 *  - Thinking from whichever field the server writes it in: `reasoning_content`
 *    (DeepSeek, vLLM) or `reasoning` (OpenRouter, Ollama).
 *
 *  Nothing comes back that only the model can read, so every turn is rebuilt from its
 *  words and calls. Pure, as anthropic.ts is. */

import { conversationUrl } from '../providers'
import { wireEffort } from './effort'
import { learnt } from './learned'
import { outputText, type Call, type Step } from './transcript'
import { completionsUsage } from './usage'
import {
  type Answer,
  argsOf,
  type Ask,
  type Heard,
  type Reader,
  record,
  text,
  type Wire,
} from './wire'
import type { Part, ToolOutput, Usage } from './types'

type Message = Record<string, unknown>

function userMessage(step: Extract<Step, { role: 'user' }>): Message {
  if (!step.images.length) return { role: 'user', content: step.text }
  return {
    role: 'user',
    content: [
      ...(step.text ? [{ type: 'text', text: step.text }] : []),
      ...step.images.map((one) => ({
        type: 'image_url',
        image_url: { url: `data:${one.mime};base64,${one.data}` },
      })),
    ],
  }
}

function assistantMessage(words: string, calls: readonly Call[]): Message {
  return {
    role: 'assistant',
    content: words || null,
    ...(calls.length
      ? {
          tool_calls: calls.map((one) => ({
            id: one.id,
            type: 'function',
            function: {
              name: one.name,
              arguments: typeof one.args === 'string' ? one.args : JSON.stringify(one.args ?? {}),
            },
          })),
        }
      : {}),
  }
}

function toolMessage(id: string, output: ToolOutput): Message {
  return { role: 'tool', tool_call_id: id, content: outputText(output) }
}

/** The steps as chat messages, the system prompt first. */
export function chatMessagesOf(system: string, steps: readonly Step[]): Message[] {
  const out: Message[] = system ? [{ role: 'system', content: system }] : []
  for (const step of steps) {
    switch (step.role) {
      case 'user':
        out.push(userMessage(step))
        break
      case 'assistant':
        out.push(assistantMessage(step.text, step.calls))
        break
      case 'tool':
        out.push(...step.results.map((one) => toolMessage(one.id, one.output)))
        break
      case 'native':
        out.push(...(step.messages as Message[]))
        break
      case 'compacted':
      case 'effort':
        break
    }
  }
  return out
}

export const completions: Wire = {
  request(ask: Ask) {
    const known = learnt(ask.provider.id, ask.model.id)
    const effort = known.reasons === false ? null : wireEffort('completions', ask.effort)
    const tools = known.tools === false ? [] : ask.tools
    const body = {
      model: ask.model.id,
      messages: [...chatMessagesOf(ask.system, ask.steps), ...ask.added],
      stream: true,
      stream_options: { include_usage: true },
      ...(tools.length
        ? {
            tools: tools.map((one) => ({
              type: 'function',
              function: {
                name: one.name,
                description: one.description,
                parameters: one.inputSchema,
              },
            })),
          }
        : {}),
      ...(effort ? { reasoning_effort: effort } : {}),
    }
    return { url: conversationUrl(ask.provider), body, headers: {} }
  },

  reader(window) {
    return new CompletionsReader(window)
  },

  results(results) {
    return results.map((one) => toolMessage(one.call.id, one.output))
  },
}

/** A call as it arrives, in pieces by index. */
interface Arriving {
  id: string
  name: string
  json: string
  part: number
}

class CompletionsReader implements Reader {
  readonly parts: Part[] = []
  private readonly calls = new Map<number, Arriving>()
  private words = ''
  private finish = ''
  private thinking: { part: number; started: number } | null = null
  private usage: Usage | undefined

  constructor(private readonly window: number | null) {}

  heard(event: unknown): Heard {
    const said = record(event)
    if (said.error) return { changed: [], trouble: said }
    const changed: number[] = []
    const model = text(said.model)
    if (said.usage) this.usage = completionsUsage(said.usage, this.window)

    const choice = record(Array.isArray(said.choices) ? said.choices[0] : null)
    const delta = record(choice.delta)
    this.finish = text(choice.finish_reason) || this.finish

    const thought = text(delta.reasoning_content) || text(delta.reasoning)
    if (thought) changed.push(this.think(thought))

    const words = text(delta.content)
    if (words) changed.push(this.say(words))

    if (Array.isArray(delta.tool_calls)) {
      for (const piece of delta.tool_calls.map(record)) changed.push(this.call(piece))
    }
    return { changed, ...(model ? { model } : {}), ...(this.usage ? { usage: this.usage } : {}) }
  }

  private think(words: string): number {
    if (!this.thinking) {
      this.parts.push({ kind: 'thinking', text: '', ms: 0 })
      this.thinking = { part: this.parts.length - 1, started: Date.now() }
    }
    const part = this.parts[this.thinking.part]
    if (part?.kind === 'thinking') {
      part.text += words
      part.ms = Date.now() - this.thinking.started
    }
    return this.thinking.part
  }

  private say(words: string): number {
    this.words += words
    const last = this.parts.at(-1)
    if (last?.kind === 'text') {
      last.text += words
      return this.parts.length - 1
    }
    this.parts.push({ kind: 'text', text: words })
    return this.parts.length - 1
  }

  private call(piece: Record<string, unknown>): number {
    const index = Number(piece.index ?? 0)
    const fn = record(piece.function)
    let arriving = this.calls.get(index)
    if (!arriving) {
      this.parts.push({ kind: 'tool', id: '', verb: '', args: {}, state: 'running' })
      arriving = { id: '', name: '', json: '', part: this.parts.length - 1 }
      this.calls.set(index, arriving)
    }
    arriving.id = text(piece.id) || arriving.id
    arriving.name += text(fn.name)
    arriving.json += text(fn.arguments)
    const part = this.parts[arriving.part]
    if (part?.kind === 'tool') {
      part.id = arriving.id
      part.verb = arriving.name
    }
    return arriving.part
  }

  answer(): Answer {
    const calls: Call[] = [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([at, one]) => ({ id: one.id || `call_${at}`, name: one.name, args: argsOf(one.json) }))
    for (const [at, one] of this.calls) {
      const part = this.parts[one.part]
      if (part?.kind === 'tool') {
        part.id = part.id || `call_${at}`
        part.args = argsOf(one.json)
      }
    }
    const message = assistantMessage(this.words, calls)
    return {
      messages: this.words || calls.length ? [message] : [],
      calls,
      ending: calls.length
        ? 'tool'
        : this.finish === 'length'
          ? 'max_tokens'
          : this.finish === 'content_filter'
            ? 'refusal'
            : 'end',
    }
  }
}
