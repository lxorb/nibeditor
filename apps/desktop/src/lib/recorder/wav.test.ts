import { describe, expect, test } from 'vitest'
import { mono, pieces, RATE, resampled, wavOf } from './wav'

/** What the Worker's own reader looks for in a WAV, read back out of one this wrote.
 *
 *  It matters field by field: the route works out how long an utterance is from the
 *  rate at byte 28, so a header written wrongly is a recording refused for a reason
 *  that has nothing to do with the recording. See services/sync/src/ask/heard.ts. */
function header(file: Uint8Array) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const text = (at: number, length: number) =>
    String.fromCharCode(...file.subarray(at, at + length))

  return {
    riff: text(0, 4),
    size: view.getUint32(4, true),
    wave: text(8, 4),
    fmt: text(12, 4),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    rate: view.getUint32(24, true),
    bytesASecond: view.getUint32(28, true),
    bytesAFrame: view.getUint16(32, true),
    bits: view.getUint16(34, true),
    data: text(36, 4),
    bytes: view.getUint32(40, true),
  }
}

describe('a WAV', () => {
  test('says what it is, field by field', () => {
    const file = wavOf(new Float32Array(16), 16_000)

    expect(header(file)).toEqual({
      riff: 'RIFF',
      size: 36 + 32,
      wave: 'WAVE',
      fmt: 'fmt ',
      // One is PCM, and one channel of sixteen bits at 16 kHz is 32 kB a second.
      format: 1,
      channels: 1,
      rate: 16_000,
      bytesASecond: 32_000,
      bytesAFrame: 2,
      bits: 16,
      data: 'data',
      bytes: 32,
    })
  })

  test('is the header and two bytes a sample', () => {
    expect(wavOf(new Float32Array(100), 16_000).length).toBe(44 + 200)
    expect(wavOf(new Float32Array(0), 16_000).length).toBe(44)
  })

  /** A sample over full scale that wrapped would be a click in the middle of a word,
   *  which is the one way of being wrong that a model would hear. */
  test('clips rather than wraps', () => {
    const file = wavOf(new Float32Array([0, 1, -1, 4, -4]), 16_000)
    const view = new DataView(file.buffer)
    const at = (one: number) => view.getInt16(44 + one * 2, true)

    expect([at(0), at(1), at(2)]).toEqual([0, 32_767, -32_768])
    expect([at(3), at(4)]).toEqual([32_767, -32_768])
  })
})

describe('mixing down', () => {
  test('hands one channel straight back', () => {
    const one = new Float32Array([0.5, -0.5])
    expect(mono([one])).toBe(one)
  })

  /** A laptop with two microphones puts the voice in both; taking the left one throws
   *  half the sound away for nothing. */
  test('averages the channels there are', () => {
    const heard = mono([new Float32Array([1, 0]), new Float32Array([0, 1])])
    expect([...heard]).toEqual([0.5, 0.5])
  })

  test('and answers nothing for no channels at all', () => {
    expect(mono([]).length).toBe(0)
  })
})

describe('resampling', () => {
  test('leaves sound that is already at the rate alone', () => {
    const same = new Float32Array([1, 2, 3])
    expect(resampled(same, 16_000, 16_000)).toBe(same)
  })

  test('brings the count down with the rate', () => {
    const third = resampled(new Float32Array(48_000), 48_000, 16_000)
    expect(third.length).toBe(16_000)
  })

  /** Linear interpolation between the samples either side, which on a ramp is the
   *  ramp: what comes out of a half-rate pass over 0..3 is 0 and 3 at the ends and the
   *  line between them in the middle. */
  test('reads between the samples rather than dropping every other one', () => {
    const halved = resampled(new Float32Array([0, 1, 2, 3]), 4, 2)
    expect([...halved]).toEqual([0, 3])

    const stretched = resampled(new Float32Array([0, 1]), 2, 3)
    expect([...stretched].map((one) => Math.round(one * 100) / 100)).toEqual([0, 0.5, 1])
  })
})

describe('cutting a recording into pieces', () => {
  test('leaves something short as one piece', () => {
    const short = new Float32Array(RATE * 5)
    expect(pieces(short, RATE, 20)).toHaveLength(1)
  })

  test('and nothing at all as no pieces', () => {
    expect(pieces(new Float32Array(0), RATE, 20)).toEqual([])
  })

  /** The last piece is whatever is left, however short: sound dropped because it did
   *  not fill a piece is a sentence that ends mid word. */
  test('cuts at the length asked for and keeps the tail', () => {
    const parts = pieces(new Float32Array(RATE * 50), RATE, 20)

    expect(parts.map((one) => one.length)).toEqual([RATE * 20, RATE * 20, RATE * 10])
    expect(parts.reduce((sum, one) => sum + one.length, 0)).toBe(RATE * 50)
  })
})
