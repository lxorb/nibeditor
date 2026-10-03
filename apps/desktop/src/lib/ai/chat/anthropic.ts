/** Claude's Messages API, as a conversation with tools.
 *
 *  - Thinking is adaptive and summarised where the model has it, and its blocks come
 *    back exactly as they came: Claude checks each against what came before it.
 *  - Effort is `output_config.effort`. A change mid-thread is a per-message effort
 *    where the model takes one (`mid-conversation-output-config-2026-07-01`), so the
 *    cached prefix survives it; elsewhere the top level changes.
 *  - The prefix is cached: one breakpoint on the request, the tools and system first.
 *  - Fast mode, the web search tool and pictures where the model has them.
 *  - Compaction on demand (`compact-2026-09-04`) is compact.ts's; a request that carries
 *    the block it returned says the beta too.
 *
 *  Pure: the request is built and the stream read, and engine.ts does the rest. */

import { conversationUrl } from '../providers'
import { ANTHROPIC_COMPACT_BETA } from './catalogue'
import { wireEffort } from './effort'
import type { Call, Step } from './transcript'
import { anthropicUsage } from './usage'
import {
  type Answer,
  argsOf,
  type Ask,
  type Ending,
  type Heard,
  type Reader,
  record,
  text,
  type Wire,
} from './wire'
import type { Part, ToolOutput, Usage } from './types'

export const PER_MESSAGE_BETA = 'mid-conversation-output-config-2026-07-01'
const FAST_BETA = 'fast-mode-2026-02-01'

/** The most an answer may be, thinking included, where the model does not say less. */
const MOST_TOKENS = 32_000

type Block = Record<string, unknown>
interface Message {
  role: string
  content: unknown
  output_config?: unknown
}

/** One user message's blocks: pictures first, as Claude asks, then the words. */
function userBlocks(step: Extract<Step, { role: 'user' }>): Block[] {
  return [
    ...step.images.map((one) => ({
      type: 'image',
      source: { type: 'base64', media_type: one.mime, data: one.data },
    })),
    ...(step.text ? [{ type: 'text', text: step.text }] : []),
  ]
}

/** A tool's answer as a `tool_result`, pictures included. */
function resultBlock(id: string, output: ToolOutput): Block {
  return {
    type: 'tool_result',
    tool_use_id: id,
    ...(output.error ? { is_error: true } : {}),
    content: [
      { type: 'text', text: output.text || ' ' },
      ...output.images.map((one) => ({
        type: 'image',
        source: { type: 'base64', media_type: one.mime, data: one.data },
      })),
    ],
  }
}

/** The steps as Claude's messages. */
export function messagesOf(steps: readonly Step[]): Message[] {
  const out: Message[] = []
  for (const step of steps) {
    switch (step.role) {
      case 'user':
        out.push({ role: 'user', content: userBlocks(step) })
        break
      case 'assistant':
        out.push({
          role: 'assistant',
          content: [
            ...(step.text ? [{ type: 'text', text: step.text }] : []),
            ...step.calls.map((one) => ({
              type: 'tool_use',
              id: one.id,
              name: one.name,
              input: typeof one.args === 'object' && one.args !== null ? one.args : {},
            })),
          ],
        })
        break
      case 'tool':
        out.push({
          role: 'user',
          content: step.results.map((one) => resultBlock(one.id, one.output)),
        })
        break
      case 'native':
        out.push(...(step.messages as Message[]))
        break
      case 'compacted':
        out.push({ role: 'assistant', content: [step.block] })
        break
      case 'effort': {
        const effort = wireEffort('anthropic', step.effort)
        if (effort) out.push({ role: 'system', content: [], output_config: { effort } })
        break
      }
    }
  }
  // An assistant message with nothing in it is a 400; a rebuilt turn that said nothing
  // and called nothing has no place in the conversation.
  return out.filter(
    (one) => !Array.isArray(one.content) || one.content.length || one.role === 'system',
  )
}

/** Whether any message carries a compaction block. */
function carriesCompaction(messages: readonly Message[]): boolean {
  return messages.some(
    (one) =>
      Array.isArray(one.content) &&
      one.content.some((block) => record(block).type === 'compaction'),
  )
}

export const anthropic: Wire = {
  request(ask: Ask) {
    const messages = [...messagesOf(ask.steps), ...(ask.added as Message[])]
    const betas: string[] = []
    if (carriesCompaction(messages)) betas.push(ANTHROPIC_COMPACT_BETA)
    if (messages.some((one) => one.role === 'system')) betas.push(PER_MESSAGE_BETA)
    const fast = ask.fast && ask.model.fast
    if (fast) betas.push(FAST_BETA)

    const effort = wireEffort('anthropic', ask.perMessage && ask.base ? ask.base : ask.effort)
    const tools = [
      ...ask.tools.map((one) => ({
        name: one.name,
        description: one.description,
        input_schema: one.inputSchema,
      })),
      ...(ask.web ? [{ type: 'web_search_20260209', name: 'web_search' }] : []),
    ]
    const body = {
      model: ask.model.id,
      max_tokens: Math.min(MOST_TOKENS, ask.model.output ?? MOST_TOKENS),
      stream: true,
      // One breakpoint, at the end of what was sent: the tools, the system and every
      // earlier turn are read from the cache on the next request.
      cache_control: { type: 'ephemeral' },
      ...(ask.system ? { system: ask.system } : {}),
      messages,
      ...(tools.length ? { tools } : {}),
      ...(ask.model.thinking ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
      ...(effort ? { output_config: { effort } } : {}),
      ...(fast ? { speed: 'fast' } : {}),
    }
    return {
      url: conversationUrl(ask.provider),
      body,
      headers: betas.length ? { 'anthropic-beta': betas.join(',') } : {},
    }
  },

  reader(window) {
    return new AnthropicReader(window)
  },

  results(results) {
    return [{ role: 'user', content: results.map((one) => resultBlock(one.call.id, one.output)) }]
  },
}

/** One block as it arrives, with what it grew from. */
interface Open {
  block: Block
  /** Where it is drawn, if it is drawn. */
  part: number | null
  json: string
  started: number
}

/** Reads one streamed message. */
class AnthropicReader implements Reader {
  readonly parts: Part[] = []
  private readonly blocks: Block[] = []
  private readonly open = new Map<number, Open>()
  private usage: Usage
  private stop = ''
  private category = ''

  constructor(private readonly window: number | null) {
    this.usage = anthropicUsage({}, window)
  }

  heard(event: unknown): Heard {
    const said = record(event)
    switch (said.type) {
      case 'message_start': {
        const message = record(said.message)
        this.usage = anthropicUsage(message.usage, this.window)
        return { changed: [], model: text(message.model), usage: this.usage }
      }
      case 'content_block_start':
        return this.started(Number(said.index), record(said.content_block))
      case 'content_block_delta':
        return this.grew(Number(said.index), record(said.delta))
      case 'content_block_stop':
        return this.stopped(Number(said.index))
      case 'message_delta': {
        const delta = record(said.delta)
        this.stop = text(delta.stop_reason) || this.stop
        this.category = text(record(delta.stop_details).category) || this.category
        const usage = record(said.usage)
        // The final counts: output always, input again where the provider repeats it.
        this.usage = anthropicUsage(
          {
            input_tokens: usage.input_tokens ?? this.usage.input - this.usage.cached,
            cache_read_input_tokens: usage.cache_read_input_tokens ?? this.usage.cached,
            output_tokens: usage.output_tokens,
          },
          this.window,
        )
        return { changed: [], usage: this.usage }
      }
      case 'error':
        return { changed: [], trouble: said }
      default:
        return { changed: [] }
    }
  }

  private started(index: number, block: Block): Heard {
    const open: Open = { block: { ...block }, part: null, json: '', started: Date.now() }
    this.open.set(index, open)
    const kind = text(block.type)
    if (kind === 'text') open.part = this.add({ kind: 'text', text: text(block.text) })
    else if (kind === 'thinking')
      open.part = this.add({ kind: 'thinking', text: text(block.thinking), ms: 0 })
    else if (kind === 'tool_use' || kind === 'server_tool_use') {
      open.part = this.add({
        kind: 'tool',
        id: text(block.id),
        verb: text(block.name),
        args: {},
        state: 'running',
      })
    }
    return { changed: open.part === null ? [] : [open.part] }
  }

  private grew(index: number, delta: Block): Heard {
    const open = this.open.get(index)
    if (!open) return { changed: [] }
    const { block } = open
    switch (delta.type) {
      case 'text_delta':
        block.text = text(block.text) + text(delta.text)
        break
      case 'thinking_delta':
        block.thinking = text(block.thinking) + text(delta.thinking)
        break
      case 'signature_delta':
        block.signature = text(delta.signature)
        return { changed: [] }
      case 'input_json_delta':
        open.json += text(delta.partial_json)
        return { changed: [] }
      case 'citations_delta':
        {
          const before: unknown[] = Array.isArray(block.citations) ? block.citations : []
          block.citations = [...before, delta.citation]
        }
        return { changed: [] }
      case 'compaction_delta':
        block.content = text(delta.content)
        return { changed: [] }
      default:
        return { changed: [] }
    }
    if (open.part === null) return { changed: [] }
    const part = this.parts[open.part]
    if (part?.kind === 'text') part.text = text(block.text)
    if (part?.kind === 'thinking') part.text = text(block.thinking)
    return { changed: [open.part] }
  }

  private stopped(index: number): Heard {
    const open = this.open.get(index)
    if (!open) return { changed: [] }
    this.open.delete(index)
    const { block } = open
    if (block.type === 'tool_use' || block.type === 'server_tool_use') {
      block.input = argsOf(open.json)
    }
    this.blocks.push(block)
    if (open.part === null) return { changed: [] }
    const part = this.parts[open.part]
    if (part?.kind === 'thinking') part.ms = Date.now() - open.started
    if (part?.kind === 'tool') {
      part.args = block.input
      // A search the provider ran itself has answered by the time its result block
      // arrives; nib has nothing to run.
      if (block.type === 'server_tool_use') part.state = 'ok'
    }
    return { changed: [open.part] }
  }

  private add(part: Part): number {
    this.parts.push(part)
    return this.parts.length - 1
  }

  answer(): Answer {
    // Blocks that never stopped (a stream cut short) are kept as far as they came, so
    // the words that arrived are not lost; an unfinished call is not.
    for (const open of this.open.values()) {
      if (open.block.type !== 'tool_use' && open.block.type !== 'server_tool_use') {
        this.blocks.push(open.block)
      }
    }
    this.open.clear()
    const calls: Call[] = this.blocks
      .filter((one) => one.type === 'tool_use')
      .map((one) => ({ id: text(one.id), name: text(one.name), args: one.input ?? {} }))
    const content = this.blocks.filter((one) => one.type !== 'text' || text(one.text))
    return {
      messages: content.length ? [{ role: 'assistant', content }] : [],
      calls,
      ending: endingOf(this.stop, calls.length > 0),
      ...(this.category ? { refusal: this.category } : {}),
    }
  }
}

function endingOf(stop: string, calls: boolean): Ending {
  if (stop === 'tool_use' && calls) return 'tool'
  if (stop === 'max_tokens' || stop === 'model_context_window_exceeded') return 'max_tokens'
  if (stop === 'refusal') return 'refusal'
  if (stop === 'pause_turn') return 'pause'
  return 'end'
}
