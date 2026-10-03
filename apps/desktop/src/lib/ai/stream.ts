/** Server-sent events, as the two provider shapes send them.
 *
 *  Both stream an answer as a run of `data:` lines with one JSON object on each,
 *  separated by blank lines, with `event:`, `id:` and comment lines mixed in that
 *  neither of them needs read. A chunk off the network is not a line and not a
 *  whole event: it ends wherever the packet ended, sometimes mid-word and sometimes
 *  mid-brace, so whatever is left over has to be kept for the next one.
 *
 *  Pure, and separate from the request for that reason: a stream that loses a word
 *  because a chunk split in an awkward place is the kind of bug that only shows up
 *  on a slow connection, and this way it can be split in every awkward place a test
 *  can think of. See complete.ts for the request. */

/** What OpenAI's shape ends a stream with. Not JSON, so it is answered here rather
 *  than handed on to be parsed and quietly dropped. */
export const SSE_DONE = '[DONE]'

/** The payloads of the `data:` lines that completed, and whatever text was left
 *  over for the next chunk.
 *
 *  A line is only complete once its newline has arrived: without that, a `data:`
 *  line cut in half would be parsed as two, and the half that was valid JSON would
 *  be written into the note. */
export function sseLines(held: string, chunk: string): { payloads: string[]; rest: string } {
  const text = held + chunk
  const lines = text.split('\n')
  // Whatever follows the last newline is not a line yet.
  const rest = lines.pop() ?? ''
  const payloads: string[] = []

  for (const line of lines) {
    // A trailing carriage return where the server wrote CRLF, and the one space
    // after the colon that the format allows and both of them write.
    const said = line.replace(/\r$/, '')
    if (!said.startsWith('data:')) continue

    const payload = said.slice('data:'.length).trim()
    if (payload) payloads.push(payload)
  }

  return { payloads, rest }
}

/** One event's JSON, or null for a payload that is not JSON at all.
 *
 *  `[DONE]` is the expected one of those; a provider having a bad day is the other.
 *  Neither is worth stopping a stream for: what has arrived is still the answer. */
export function sseJson(payload: string): unknown {
  if (payload === SSE_DONE) return null

  try {
    return JSON.parse(payload)
  } catch {
    // Not JSON, so not an event this understands. Nothing to report: a stream is
    // read for the words in it, and a line with none contributes none.
    return null
  }
}

/** Every event of a stream, parsed, as it arrives: what a conversation reads, where the
 *  one-shot request only wants the words. A payload that is not JSON is skipped, as
 *  above. The reader is let go however the loop over it ends, a stop included: a reader
 *  left open holds the socket. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let held = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      const chunk = done ? decoder.decode() + '\n' : decoder.decode(value, { stream: true })
      const { payloads, rest } = sseLines(held, chunk)
      held = rest
      for (const payload of payloads) {
        const event = sseJson(payload)
        if (event !== null) yield event
      }
      if (done) return
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }
}
