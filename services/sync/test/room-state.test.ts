import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { MAX_NOTE_BYTES } from '../src/notes'
import { MOST_DOCUMENT_BYTES, RoomState, TOO_LARGE_IN_A_ROOM } from '../src/rooms/state'
import { TEXT } from '@nib/rooms'

/** A room's own storage, and what it survives.
 *
 *  The two things a document has to be held to, neither of which the sockets can
 *  show: how large it may get, and that however many pieces it is stored in they go
 *  back together in the order they were written. Driven through a Map, which is what
 *  `RoomStorage` was written against. */

/** As much of a Durable Object's storage as a room asks for. */
class Kept {
  readonly held = new Map<string, unknown>()

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.held.get(key) as T | undefined)
  }

  list<T>(options: { prefix: string }): Promise<Map<string, T>> {
    const found = new Map<string, T>()
    for (const [key, value] of this.held) {
      if (key.startsWith(options.prefix)) found.set(key, value as T)
    }
    return Promise.resolve(found)
  }

  put(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) this.held.set(key, value)
    return Promise.resolve()
  }

  delete(keys: string[]): Promise<unknown> {
    for (const key of keys) this.held.delete(key)
    return Promise.resolve(0)
  }

  keys(prefix: string): string[] {
    return [...this.held.keys()].filter((key) => key.startsWith(prefix)).sort()
  }
}

/** One update, as long as it says: a room counts what arrives by its bytes. */
function update(bytes: number): Uint8Array {
  return new Uint8Array(bytes)
}

describe('how large a room’s document may get', () => {
  test('is twice the longest note, which is the one number the two share', () => {
    expect(MOST_DOCUMENT_BYTES).toBe(2 * MAX_NOTE_BYTES)
  })

  test('and a document under it takes what arrives', async () => {
    const state = new RoomState(new Kept())
    await state.seed((doc) => {
      doc.getText(TEXT).insert(0, 'the words of a note')
    })

    expect(state.full()).toBe(false)
    await state.record(update(1024))
    expect(state.full()).toBe(false)
  })

  /** The ceiling is what was missing: the settle refuses a file over
   *  `MAX_NOTE_BYTES`, so a document grown past it was storage nobody was charged
   *  for and nobody could read - and every wake read all of it. */
  test('and a document at it refuses, in words', async () => {
    const kept = new Kept()
    const state = new RoomState(kept)

    // One insert rather than a million: what a room is held to is the size of the
    // document, however it got there.
    await state.seed((doc) => {
      doc.getText(TEXT).insert(0, 'x'.repeat(MOST_DOCUMENT_BYTES))
    })

    expect(state.full()).toBe(true)
    await expect(state.record(update(64))).rejects.toThrow(TOO_LARGE_IN_A_ROOM)
  })

  /** And it is still a room. A ceiling that left the object unopenable would have
   *  traded a bill for somebody's note. */
  test('and stays a room that opens, however many pieces it is stored in', async () => {
    const kept = new Kept()
    const state = new RoomState(kept)
    const words = 'x'.repeat(MOST_DOCUMENT_BYTES)

    await state.seed((doc) => {
      doc.getText(TEXT).insert(0, words)
    })

    // Ninety-six kilobyte pieces, so a document this size is stored in many.
    expect(kept.keys('state:').length).toBeGreaterThan(60)

    const again = new RoomState(kept)
    expect(await again.load()).toBe(true)
    expect(again.doc.getText(TEXT).toJSON()).toBe(words)
    // Measured on the way in, so a room woken at the ceiling is still at it.
    expect(again.full()).toBe(true)
  })
})

describe('the pieces a room is stored in', () => {
  /** A key is numbered, and a number written as text sorts by its first digit:
   *  `state:10` comes before `state:9`. Six digits is past what either kind of key
   *  can reach, and the sort is by the number either way - so a room written by a
   *  build that padded to three still opens, and one that ran past its padding
   *  cannot be put back in the wrong order. */
  test('go back together in the order they were written, not in the order they sort', async () => {
    const doc = new Y.Doc()
    doc
      .getText(TEXT)
      .insert(0, 'a note long enough to be written down in a dozen pieces '.repeat(40))
    const whole = Y.encodeStateAsUpdateV2(doc)

    // Twelve pieces under the keys an older build wrote, unpadded, so that the
    // tenth sorts before the ninth as text and after it as a number.
    const kept = new Kept()
    const size = Math.ceil(whole.length / 12)
    for (let at = 0; at * size < whole.length; at++) {
      await kept.put({ [`state:${at}`]: whole.slice(at * size, (at + 1) * size) })
    }
    expect(kept.keys('state:').length).toBe(12)

    const state = new RoomState(kept)
    expect(await state.load()).toBe(true)
    expect(state.doc.getText(TEXT).toJSON()).toBe(doc.getText(TEXT).toJSON())
  })

  test('and are written six digits wide', async () => {
    const kept = new Kept()
    const state = new RoomState(kept)
    await state.seed((doc) => {
      doc.getText(TEXT).insert(0, 'one small note')
    })

    expect(kept.keys('state:')).toEqual(['state:000000'])
  })
})
