/** The recorded streams the adapters' tests read: what a provider sent, as it sent it.
 *
 *  `responses-*` and `completions-1` are OpenAI's own, recorded 2026-10-03 against
 *  gpt-5.4-mini and gpt-4.1-mini with a `read_note` tool: a call, then its answer sent
 *  back the way responses.ts sends it. `anthropic-*` are written from Claude's streaming
 *  reference, event for event. Test-only. */

import { readFileSync } from 'node:fs'
import { sseJson, sseLines } from '../../stream'

/** A recorded stream's text. */
export function streamText(name: string): string {
  return readFileSync(new URL(`./${name}.sse`, import.meta.url), 'utf8')
}

/** A recorded stream's events, parsed. */
export function events(name: string): unknown[] {
  const { payloads } = sseLines('', `${streamText(name)}\n`)
  return payloads.map(sseJson).filter((one) => one !== null)
}

/** A recorded stream as a response body, in chunks cut at awkward places. */
export function body(name: string, chunk = 97): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(streamText(name))
  let at = 0
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(at, at + chunk))
      at += chunk
    },
  })
}
