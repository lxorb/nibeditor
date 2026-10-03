/** A long thread's older turns as a summary (4.10, `/compact`).
 *
 *  Three roads, the provider's own first:
 *
 *  - **Claude, on demand** (`compact-2026-09-04`) where the model lists it: the
 *    conversation is sent with `compaction: {type: "summarize"}` and comes back as one
 *    signed block, which from then on is sent first in place of what it summarised.
 *    nib decides when, so the ring's tick is where it happens.
 *  - **OpenAI, `/responses/compact`**, with a key: the conversation comes back as the
 *    opaque items that stand for it, sent back whole.
 *  - **nib's own summary turn** everywhere else, a ChatGPT plan and every compatible
 *    server among them: the model is asked for a summary, and the summary is what is
 *    sent from then on. The simple compaction Anthropic recommends: nothing of the old
 *    turns is replayed beside it.
 *
 *  The turns themselves stay in the thread for the reader to scroll back through; only
 *  what a request carries changes. A focus (`/compact <focus>`) steers the summary. */

import { t } from '../../i18n.svelte'
import { compactUrl, type Provider } from '../providers'
import { sseJson } from '../stream'
import { ANTHROPIC_COMPACT_BETA } from './catalogue'
import { request } from './request'
import { round } from './round'
import { stepsOf } from './transcript'
import type { Api, Compaction, ModelInfo, Thread } from './types'
import { compactionSpent, estimateText, noUsage } from './usage'
import { itemsOf } from './responses'
import { record, text, type ToolDef, type Wire } from './wire'

/** What a summary must keep. Sent to the model, never shown, so not translated. */
const KEEP =
  'Summarize this conversation so it can be continued from the summary alone. Keep every note path, page address, decision, change made and still to make, and the reader’s latest open request, in their own words where they matter. Do not call tools; reply with the summary only.'

/** The instructions for a summary, with the reader's focus. */
function summaryPrompt(focus?: string): string {
  return focus?.trim() ? `${KEEP}\nFocus on: ${focus.trim()}` : KEEP
}

interface Compacting {
  thread: Thread
  provider: Provider
  api: Api
  wire: Wire
  model: ModelInfo
  system: string
  tools: ToolDef[]
  focus?: string | undefined
}

/** Compacts a thread in place: its compaction set, its ring emptied to the summary, and
 *  a turn that says so. A thread with nothing to compact is left as it is. */
export async function compactThread(job: Compacting, signal?: AbortSignal): Promise<void> {
  const { thread } = job
  const last = thread.turns.at(-1)
  if (!last) return

  const { spent, ...made } = await compacted(job, signal)
  thread.compaction = { ...made, upTo: last.id }
  if (spent) {
    const before = thread.spent ?? { input: 0, output: 0 }
    thread.spent = {
      ...before,
      input: before.input + spent.input,
      output: before.output + spent.output,
    }
  }
  thread.usage = { ...noUsage(job.model.window), input: estimateText(made.summary) }
  thread.turns.push({
    id: crypto.randomUUID(),
    role: 'model',
    at: Date.now(),
    parts: [{ kind: 'notice', code: 'compacted', text: '' }],
  })
  thread.updated = Date.now()
}

/** A compaction made, and what making it spent where the provider said. */
type Made = Omit<Compaction, 'upTo'> & { spent?: { input: number; output: number } }

/** The provider's own compaction where it has one, nib's summary where not. */
async function compacted(job: Compacting, signal?: AbortSignal): Promise<Made> {
  if (job.api === 'anthropic' && job.model.compaction) {
    const own = await anthropicCompaction(job, signal).catch(() => null)
    if (own) return own
  }
  if (job.provider.kind === 'openai') {
    const own = await responsesCompaction(job, signal).catch(() => null)
    if (own) return own
  }
  return await ownSummary(job, signal)
}

/** Claude's on-demand compaction: one signed block, or null where none came back. */
async function anthropicCompaction(job: Compacting, signal?: AbortSignal): Promise<Made | null> {
  const steps = stepsOf(job.thread, 'anthropic', job.model.id)
  const { url, body, headers } = job.wire.request({
    provider: job.provider,
    model: job.model,
    effort: 'auto',
    fast: false,
    system: job.system,
    tools: job.tools,
    steps,
    added: [],
    web: false,
    perMessage: false,
  })
  const asked = {
    ...record(body),
    stream: false,
    max_tokens: 8_192,
    compaction: {
      type: 'summarize',
      ...(job.focus?.trim() ? { instructions: summaryPrompt(job.focus) } : {}),
    },
  }
  // On-demand compaction is its own beta; the request's other betas stay.
  const betas = [headers['anthropic-beta'], ANTHROPIC_COMPACT_BETA].filter(Boolean).join(',')
  const response = await request(
    job.provider,
    url,
    { body: JSON.stringify(asked), headers: { ...headers, 'anthropic-beta': betas } },
    signal,
  )
  const answer = record(sseJson(await response.text()))
  if (answer.stop_reason !== 'compaction') return null
  const content = Array.isArray(answer.content) ? answer.content.map(record) : []
  const block = content.find((one) => one.type === 'compaction')
  if (!block) return null
  return {
    kind: 'anthropic',
    model: job.model.id,
    summary: text(block.content),
    block,
    spent: compactionSpent(answer.usage),
  }
}

/** OpenAI's compaction: the items that stand for the conversation. */
async function responsesCompaction(
  job: Compacting,
  signal?: AbortSignal,
): Promise<Omit<Compaction, 'upTo'> | null> {
  const input = itemsOf(stepsOf(job.thread, 'responses', job.model.id))
  const response = await request(
    job.provider,
    compactUrl(job.provider),
    {
      body: JSON.stringify({
        model: job.model.id,
        input,
        ...(job.system ? { instructions: job.system } : {}),
      }),
    },
    signal,
  )
  const output = record(sseJson(await response.text())).output
  if (!Array.isArray(output) || !output.length) return null
  return { kind: 'responses', model: job.model.id, summary: '', block: output }
}

/** nib's own: the model asked for a summary, with no tools, in a round of its own. */
async function ownSummary(
  job: Compacting,
  signal?: AbortSignal,
): Promise<Omit<Compaction, 'upTo'>> {
  const steps = [
    ...stepsOf(job.thread, job.api, job.model.id),
    { role: 'user' as const, text: summaryPrompt(job.focus), images: [] },
  ]
  const result = await round(
    job.wire,
    {
      provider: job.provider,
      model: job.model,
      effort: 'auto',
      fast: false,
      system: job.system,
      tools: [],
      steps,
      added: [],
      web: false,
      perMessage: false,
    },
    () => undefined,
    () => undefined,
    signal ?? new AbortController().signal,
  )
  const summary = result.parts.flatMap((one) => (one.kind === 'text' ? [one.text] : [])).join('')
  if (!summary.trim()) throw new Error(t('No answer'))
  return { kind: 'summary', model: job.model.id, summary }
}
