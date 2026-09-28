import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The words a paper is remembered by, kept where they can be found after a
 *  restart.
 *
 *  Driven against a store that lives in a Map rather than against either real one:
 *  what is being asserted is when a record is trusted, when it is thrown away and
 *  what the bounds do, not how a folder or a row is written. The counters say what
 *  was read and written, because "the paper is not taken apart again" is a count
 *  rather than a duration. */

const store = vi.hoisted(() => ({ records: new Map<string, string>() }))

vi.mock('../tauri', () => ({
  isNative: false,
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    const path = args.path as string

    switch (command) {
      case 'read_paper_text':
        return Promise.resolve(store.records.get(path) ?? '')
      case 'write_paper_text': {
        const content = args.content as string
        if (content) store.records.set(path, content)
        else store.records.delete(path)
        return Promise.resolve(undefined)
      }
      case 'list_paper_texts':
        return Promise.resolve(
          [...store.records].map(([path_, content]) => ({ path: path_, size: content.length })),
        )
      default:
        return Promise.reject(new Error(`no such command: ${command}`))
    }
  },
}))

const { forgetPaperText, keepAtMost, keepPaperText, paperFiles, paperText, paperTextOf, textWork } =
  await import('./text-cache')

/** Bounds small enough for a test to cross: a hundred characters of one paper, and
 *  four hundred bytes of records in all. A record is its words and a little JSON
 *  around them, so the two are not counted in the same unit; the store's bound is
 *  over what it actually holds. */
const A_PAPER = 100
const ALL_PAPERS = 400

const PAPER = '/space/papers/Ink.pdf'

/** One paper written down: pages of `each` characters, under one hash. */
function pages(count: number, each = 20): [number, string][] {
  return Array.from({ length: count }, (_unused, index) => [index + 1, 'ink '.repeat(each / 4)])
}

beforeEach(() => {
  store.records.clear()
  textWork()
  keepAtMost(A_PAPER, ALL_PAPERS)
})

describe('a paper the store holds', () => {
  test('comes back with the words that were written down', async () => {
    await keepPaperText(paperTextOf(PAPER, 'abc', 10, pages(3)))
    expect(textWork().wrote).toBe(1)

    const found = await paperText(PAPER, 10, 'abc')
    expect(found?.pages).toHaveLength(3)
    expect(found?.pages[0]?.[1]).toContain('ink')
    expect(textWork().read).toBe(1)
  })

  test('is nothing at all for a paper nobody has read', async () => {
    expect(await paperText(PAPER)).toBeNull()
  })

  test('is dropped when the file has been written since', async () => {
    await keepPaperText(paperTextOf(PAPER, 'abc', 10, pages(3)))

    // The listing says the file is newer than the words, so the words are not this
    // file's words.
    expect(await paperText(PAPER, 11)).toBeNull()
    // The stamp it was taken down at still answers, which is what makes a paper
    // nobody has touched free to ask about.
    expect(await paperText(PAPER, 10)).not.toBeNull()
  })

  test('is dropped when the bytes hash to something else', async () => {
    await keepPaperText(paperTextOf(PAPER, 'abc', 10, pages(3)))

    expect(await paperText(PAPER, 10, 'def')).toBeNull()
    expect(await paperText(PAPER, 10, 'abc')).not.toBeNull()
  })

  test('is nothing at all once it has been forgotten', async () => {
    await keepPaperText(paperTextOf(PAPER, 'abc', 10, pages(3)))
    await forgetPaperText(PAPER)

    expect(await paperText(PAPER, 10)).toBeNull()
    expect(await paperFiles()).toEqual([])
  })

  test('and a record that is not one reads as nothing', async () => {
    store.records.set(PAPER, 'not json at all')
    expect(await paperText(PAPER)).toBeNull()

    store.records.set(PAPER, JSON.stringify({ path: PAPER, hash: 'abc' }))
    expect(await paperText(PAPER)).toBeNull()
  })
})

describe('the bounds', () => {
  test('one paper is kept from its first page up to what a paper may hold', () => {
    const long = paperTextOf(PAPER, 'abc', 10, pages(40, 20))

    expect(long.characters).toBeLessThanOrEqual(A_PAPER)
    // The front of the book rather than the middle of it: a reader is at the front,
    // and the pages are written down in page order.
    expect(long.pages[0]?.[0]).toBe(1)
    expect(long.pages.at(-1)?.[0]).toBeLessThan(40)
  })

  test('the largest paper goes when the store holds more than it may', async () => {
    // Three papers the store cannot all hold: the largest of them goes, and it is
    // never the one just written.
    await keepPaperText(paperTextOf('/space/A.pdf', 'a', 1, [[1, 'a'.repeat(A_PAPER)]]))
    await keepPaperText(paperTextOf('/space/B.pdf', 'b', 1, [[1, 'b'.repeat(20)]]))
    expect((await paperFiles()).length).toBe(2)

    await keepPaperText(paperTextOf('/space/C.pdf', 'c', 1, [[1, 'c'.repeat(A_PAPER)]]))
    const left = await paperFiles()

    expect(left.map((file) => file.path)).toContain('/space/C.pdf')
    expect(left.reduce((sum, file) => sum + file.size, 0)).toBeLessThanOrEqual(ALL_PAPERS)
    expect(left.map((file) => file.path)).not.toContain('/space/A.pdf')
  })

  test('and the listing comes back smallest first', async () => {
    await keepPaperText(paperTextOf('/space/Big.pdf', 'a', 1, [[1, 'a'.repeat(80)]]))
    await keepPaperText(paperTextOf('/space/Small.pdf', 'b', 1, [[1, 'b'.repeat(10)]]))

    expect((await paperFiles()).map((one) => one.path)).toEqual([
      '/space/Small.pdf',
      '/space/Big.pdf',
    ])
  })
})
