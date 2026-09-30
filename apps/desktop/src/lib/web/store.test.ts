import 'fake-indexeddb/auto'
import { describe, expect, test, vi } from 'vitest'
import { files, inSlices, type RowChange, stats } from './store'

/** Reading a whole store without stopping the thread.
 *
 *  `getAll` on the listing of five thousand notes is one task of several hundred
 *  milliseconds, and the browser blamed it for the longest task of every launch. The
 *  rows and the order have to be exactly what one read gave; what changes is how
 *  many tasks they arrive in. So what is counted here is reads and the largest of
 *  them, not milliseconds - a clock says what the machine was doing and a count says
 *  what the code did. */

/** A store of `count` rows keyed by a path that sorts the way IndexedDB sorts one,
 *  answering a slice at a time and writing down what it was asked for. */
function shelf(count: number) {
  const rows = Array.from({ length: count }, (_, at) => ({
    path: `/Big/note-${String(at).padStart(5, '0')}.md`,
  }))

  const asked: number[] = []

  return {
    rows,
    asked,
    read: (after: string | null, most: number) => {
      const from = after === null ? 0 : rows.findIndex((row) => row.path > after)
      const slice = from === -1 ? [] : rows.slice(from, from + most)
      asked.push(slice.length)
      return Promise.resolve(slice)
    },
  }
}

const keyOf = (row: { path: string }) => row.path

describe('a whole store read in slices', () => {
  test('answers the same rows in the same order as one read would', async () => {
    const store = shelf(5003)
    const found = await inSlices(store.read, keyOf, 500)

    expect(found).toEqual(store.rows)
  })

  test('and no one read builds more than a slice of them', async () => {
    const store = shelf(5003)
    await inSlices(store.read, keyOf, 500)

    // Eleven reads of at most five hundred rows, not one read of five thousand:
    // this is the several hundred milliseconds with nothing else able to run.
    expect(store.asked).toHaveLength(11)
    expect(Math.max(...store.asked)).toBe(500)
    expect(store.asked.at(-1)).toBe(3)
  })

  test('stops on the read that came back short, and asks nothing after it', async () => {
    const store = shelf(400)
    await inSlices(store.read, keyOf, 500)

    expect(store.asked).toEqual([400])
  })

  test('and a store with nothing in it is one read and an empty answer', async () => {
    const store = shelf(0)
    expect(await inSlices(store.read, keyOf, 500)).toEqual([])
    expect(store.asked).toEqual([0])
  })

  test('a store that is exactly a slice long asks once more to find the end', async () => {
    const store = shelf(500)
    const found = await inSlices(store.read, keyOf, 500)

    // The first read is full, so there may be more; the second says there is not.
    expect(found).toHaveLength(500)
    expect(store.asked).toEqual([500, 0])
  })
})

describe('a file written over', () => {
  test('keeps the day it was made, read off its listing and never off the file', async () => {
    await files.write('/s/plane.canvas', 'x'.repeat(1000), 100)

    const reads = vi.spyOn(IDBObjectStore.prototype, 'get')
    await files.write('/s/plane.canvas', 'y'.repeat(1000), 200)
    const stores = reads.mock.contexts.map((store) => (store as IDBObjectStore).name)
    reads.mockRestore()

    expect(stores).toEqual(['stats'])
    expect(await files.get('/s/plane.canvas')).toMatchObject({ created: 100, modified: 200 })
    expect((await stats.all()).find((row) => row.path === '/s/plane.canvas')).toMatchObject({
      created: 100,
      modified: 200,
      size: 1000,
    })
  })

  test('says which path changed, and not what is in it', async () => {
    const heard: unknown[] = []
    const listening = new BroadcastChannel('nib:rows')
    const arrived = new Promise<void>((done) => {
      listening.onmessage = (event: MessageEvent<unknown>) => {
        heard.push(event.data)
        done()
      }
    })

    await files.write('/s/note.md', '# words', 300)
    await arrived
    listening.close()

    expect(heard).toEqual([{ written: ['/s/note.md'], gone: [] } satisfies RowChange])
  })
})
