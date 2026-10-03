/** Sound as the shape the transcriber already takes.
 *
 *  The Worker's listening route takes a RIFF WAVE of sixteen bit little endian PCM
 *  at 16 kHz, mono, because that is what the glasses send and what both models
 *  behind it are happiest with; see services/sync/src/ask/heard.ts. A recording is
 *  none of those things - it is Opus in a WebM at whatever rate the microphone
 *  runs at - so something has to meet the route where it stands.
 *
 *  It is met here rather than there, for two reasons. The container a platform
 *  records into is the platform's business and a Worker should not have to know
 *  four of them; and the browser already has a decoder for every container it can
 *  record into, which is a thing a Worker does not have at all. So the file stays
 *  the best container the platform gave, and what crosses the internet is the one
 *  format the route has always taken.
 *
 *  Mono and 16 kHz on purpose, not as a compromise. Speech is under 8 kHz, a
 *  second of it is 32 kB at this rate, and the ceiling the route holds a request to
 *  is measured in megabytes: a stereo 48 kHz minute is six megabytes of the same
 *  words. Pure arithmetic, all of it, so it is tested without a microphone. */

/** What the route listens at. The glasses' own rate, and Whisper's. */
export const RATE = 16_000

/** How many samples a WAV header is, in bytes, before the sound starts. */
const HEADER = 44

/** Every channel mixed down to one, in the order the samples were heard.
 *
 *  Averaged rather than one channel taken: a laptop with two microphones puts a
 *  voice in both, and picking the left one throws away half the sound for nothing.
 *  A file already mono is handed straight back. */
export function mono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0]
  if (!first) return new Float32Array(0)
  if (channels.length === 1) return first

  const out = new Float32Array(first.length)
  for (let at = 0; at < out.length; at++) {
    let sum = 0
    for (const channel of channels) sum += channel[at] ?? 0
    out[at] = sum / channels.length
  }

  return out
}

/** The same sound at another rate, by linear interpolation between the samples
 *  either side of where each new one falls.
 *
 *  Linear rather than a windowed filter: what this feeds is a speech model, the
 *  rate only ever goes down, and the aliasing a proper filter would keep out is
 *  above the band the model listens to anyway. A rate that is already right is
 *  handed straight back rather than resampled onto itself. */
export function resampled(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || from <= 0 || samples.length === 0) return samples

  const count = Math.max(1, Math.round((samples.length * to) / from))
  const out = new Float32Array(count)
  const step = (samples.length - 1) / Math.max(1, count - 1)

  for (let at = 0; at < count; at++) {
    const where = at * step
    const below = Math.floor(where)
    const above = Math.min(below + 1, samples.length - 1)
    const part = where - below
    out[at] = (samples[below] ?? 0) * (1 - part) + (samples[above] ?? 0) * part
  }

  return out
}

/** One sample as sixteen bits, clipped rather than wrapped: a sample over full
 *  scale that wraps is a click, and a clipped one is the loud sound it was. */
function sixteenBit(sample: number): number {
  const held = Math.max(-1, Math.min(1, sample))
  return Math.round(held * (held < 0 ? 0x8000 : 0x7fff))
}

/** A RIFF WAVE of one channel of sixteen bit PCM at `rate`.
 *
 *  Written field by field with the numbers the route's own reader looks for: it
 *  reads the rate out of byte 28 to work out how long an utterance is, so a header
 *  this writes wrongly would be an utterance refused for the wrong reason. */
export function wavOf(samples: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(HEADER + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, text: string) => {
    for (let one = 0; one < text.length; one++) view.setUint8(at + one, text.charCodeAt(one))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  // One: PCM, which is the only format anything here writes.
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  // Bytes a second, and bytes a frame: one channel of two bytes each.
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  for (let at = 0; at < samples.length; at++) {
    view.setInt16(HEADER + at * 2, sixteenBit(samples[at] ?? 0), true)
  }

  return bytes
}

/** How many samples a piece of `seconds` holds at `rate`. */
function samplesIn(seconds: number, rate: number): number {
  return Math.max(1, Math.round(seconds * rate))
}

/** One long stretch of sound as pieces of at most `seconds` each.
 *
 *  Why it is cut at all: the route holds a request to four megabytes, which at this
 *  rate is two minutes, and a model given an hour in one go is a request nothing
 *  survives. Why the pieces are this size is `transcribe.ts`, which also says what
 *  is lost at a seam.
 *
 *  The last piece is whatever is left, however short. Sound that is cut off because
 *  it did not fill a piece is a sentence that ends mid word. */
export function pieces(samples: Float32Array, rate: number, seconds: number): Float32Array[] {
  const most = samplesIn(seconds, rate)
  if (samples.length <= most) return samples.length ? [samples] : []

  const out: Float32Array[] = []
  for (let at = 0; at < samples.length; at += most) {
    out.push(samples.subarray(at, Math.min(at + most, samples.length)))
  }

  return out
}
