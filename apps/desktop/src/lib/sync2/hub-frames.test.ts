/** What the hub says, read at the boundary: each frame the hub sends comes back typed,
 *  and anything else - the beat's answer, a frame of the wrong shape, a key that could
 *  reach into another's name - comes back as nothing. */

import { describe, expect, test } from 'vitest'
import { BEAT_ANSWER, readHubFrame } from './hub-frames'

const KEY = 'a'.repeat(64)
const DEVICE = 'laptop-0001'

describe('readHubFrame', () => {
  test('reads every frame the hub sends', () => {
    const frames = [
      { t: 'poke', space: 's1', seq: 3 },
      { t: 'granted', key: KEY, fence: 2, version: 5, rotate: false },
      { t: 'busy', key: KEY, device: DEVICE, name: 'Laptop' },
      { t: 'flush', key: KEY, fence: 2 },
      { t: 'lost', key: KEY, device: DEVICE, name: 'Laptop' },
      { t: 'free', key: KEY },
      { t: 'state', key: KEY, version: 6 },
      { t: 'key-wanted', device: DEVICE, name: 'Laptop', pub: 'cHVibGljLWtleS1iYXNlNjQ=' },
      { t: 'key', wrapped: 'd3JhcHBlZA==', generation: 1 },
      { t: 'key-denied' },
      { t: 'key-settled', device: DEVICE },
      { t: 'refused', to: 'acquire', key: KEY, error: 'too many tries' },
    ]
    for (const frame of frames) expect(readHubFrame(JSON.stringify(frame))).toEqual(frame)
  })

  test('hands a chat’s poke on whole, for the chats to read', () => {
    const poke = {
      t: 'chat',
      chat: `c_${'1'.repeat(32)}`,
      seq: 4,
      at: 9,
      by: 'user:a',
      mention: true,
    }
    expect(readHubFrame(JSON.stringify(poke))).toEqual({ t: 'chat', said: poke })
  })

  test('says a grant asks for a rotation only when it does', () => {
    const plain = readHubFrame(JSON.stringify({ t: 'granted', key: KEY, fence: 1, version: 0 }))
    expect(plain).toMatchObject({ rotate: false })
    const rotate = readHubFrame(
      JSON.stringify({ t: 'granted', key: KEY, fence: 1, version: 0, rotate: true }),
    )
    expect(rotate).toMatchObject({ rotate: true })
  })

  test('drops the beat’s answer and anything that is not a frame', () => {
    for (const said of [BEAT_ANSWER, '', 'null', '[]', '{}', '{"t":"nothing"}']) {
      expect(readHubFrame(said)).toBeNull()
    }
  })

  test('drops a frame whose key or device is not one', () => {
    expect(readHubFrame(JSON.stringify({ t: 'free', key: '../other' }))).toBeNull()
    expect(readHubFrame(JSON.stringify({ t: 'free', key: 'short' }))).toBeNull()
    expect(
      readHubFrame(JSON.stringify({ t: 'busy', key: KEY, device: 'a b', name: 'x' })),
    ).toBeNull()
    expect(
      readHubFrame(JSON.stringify({ t: 'granted', key: KEY, fence: -1, version: 0 })),
    ).toBeNull()
    expect(readHubFrame(JSON.stringify({ t: 'key', wrapped: 'x', generation: 0 }))).toBeNull()
  })

  test('a busy with no name still names the device, with an empty name', () => {
    expect(readHubFrame(JSON.stringify({ t: 'busy', key: KEY, device: DEVICE }))).toEqual({
      t: 'busy',
      key: KEY,
      device: DEVICE,
      name: '',
    })
  })
})
