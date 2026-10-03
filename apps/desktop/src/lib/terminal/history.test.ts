import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A terminal's last lines between runs: what is kept, how much, in what order the crate
 *  hears about it, and what a closed tab leaves behind. */

const said: { command: string; args: Record<string, unknown> }[] = []
/** The crate's files, by space and key. */
const files = new Map<string, unknown>()
/** A write the crate has not finished yet, while a test holds it. */
let holding: Promise<void> | null = null

vi.mock('../tauri', () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    said.push({ command, args })
    const at = `${String(args.space)}/${String(args.key)}`
    if (command === 'terminal_history_read') return files.get(at) ?? null
    if (command === 'terminal_history_write') {
      await holding
      files.set(at, args.history)
    }
    if (command === 'terminal_history_forget') {
      if (args.key === null) files.clear()
      else files.delete(at)
    }
    return null
  },
}))

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

const {
  dropHistory,
  fitted,
  forgetHistories,
  historyOf,
  keepHistory,
  LINES,
  MOST,
  moveHistory,
  moveLegacy,
  restoredAbove,
  restoredLine,
} = await import('./history')
const { stillWriting, written } = await import('../parting')

const place = { space: 's1', key: 'k1' }
const screen = (text: string, at = 1) => ({ cols: 120, rows: 30, at, text })

beforeEach(async () => {
  await written()
  said.length = 0
  files.clear()
  store.clear()
  holding = null
})

describe('how much of a screen is kept', () => {
  test('a thousand lines of scrollback, when they fit', () => {
    const asked: number[] = []
    const text = fitted((lines) => (asked.push(lines), `${lines} lines`))
    expect(text).toBe(`${LINES} lines`)
    expect(asked).toEqual([1000])
  })

  /** A minified file printed whole is one line a megabyte long: fewer lines, not none. */
  test('half as many, and half again, until they fit', () => {
    const asked: number[] = []
    const text = fitted((lines) => (asked.push(lines), 'x'.repeat(lines * 10)), 2000)
    expect(asked).toEqual([1000, 500, 250, 125])
    expect(text).toHaveLength(1250)
  })

  test('and nothing at all where the screen alone does not fit', () => {
    const asked: number[] = []
    expect(fitted((lines) => (asked.push(lines), 'x'.repeat(MOST + 1)))).toBeNull()
    expect(asked.at(-1)).toBe(0)
  })
})

test('the line under a replayed screen is dim and on a line of its own', () => {
  expect(restoredLine('Restored 30 Sep 2026, 14:02')).toBe(
    '\x1b[0m\r\n\x1b[2mRestored 30 Sep 2026, 14:02\x1b[22m\r\n',
  )
})

/** On Windows the pseudo console owns the screen it starts on, so the replayed lines go
 *  above it: a screen's worth of new lines, back to the top, and the line saying when as
 *  its first row, with the cursor under it where the new prompt goes. */
test('on Windows the replayed screen goes above, and the line saying when is the first row', () => {
  expect(restoredAbove('Restored', 4)).toBe(
    '\x1b[0m\r\n' + '\r\n\r\n\r\n' + '\x1b[H' + '\x1b[2mRestored\x1b[22m\r\n',
  )
  expect(restoredAbove('Restored', 1)).toBe('\x1b[0m\r\n\x1b[H\x1b[2mRestored\x1b[22m\r\n')
})

describe('a screen written down', () => {
  test('comes back from the crate under its space and key', async () => {
    keepHistory(place, screen('npm run build\r\nfailed'))
    await written()

    expect(await historyOf(place)).toEqual(screen('npm run build\r\nfailed'))
    expect(await historyOf({ space: 's2', key: 'k1' })).toBeNull()
    expect(said.map((one) => one.command)).toEqual([
      'terminal_history_write',
      'terminal_history_read',
      'terminal_history_read',
    ])
  })

  /** A tab from before there were keys has nowhere to keep anything. */
  test('never without a key', async () => {
    keepHistory({ space: null, key: '' }, screen('lost'))
    expect(await historyOf({ space: null, key: '' })).toBeNull()
    expect(said).toEqual([])
  })

  test('and what the crate answers is read, not trusted', async () => {
    files.set('s1/k1', { cols: 'wide', rows: 30, at: 1, text: 'x' })
    expect(await historyOf(place)).toBeNull()
    files.set('s1/k1', { cols: 80, rows: 24, at: 1, text: '' })
    expect(await historyOf(place)).toBeNull()
  })

  /** The window going waits for it, the way it waits for a note. */
  test('is waited for by the window going', async () => {
    let land: () => void = () => undefined
    holding = new Promise((resolve) => (land = resolve))
    keepHistory(place, screen('one'))

    expect(stillWriting()).toBe(true)
    land()
    await written()
    expect(stillWriting()).toBe(false)
    expect(files.get('s1/k1')).toEqual(screen('one'))
  })
})

describe('a tab closed', () => {
  test('takes its file with it, and keeps its lines in memory for this run', async () => {
    keepHistory(place, screen('before'))
    dropHistory(place, screen('last'))
    await written()

    expect(files.has('s1/k1')).toBe(false)
    // Reopen closed tab: the lines come back from memory, once.
    expect(await historyOf(place)).toEqual(screen('last'))
    expect(said.filter((one) => one.command === 'terminal_history_read')).toEqual([])
    expect(await historyOf(place)).toBeNull()
  })

  /** A forget that overtook the write before it would leave the file it meant to remove. */
  test('after the write that was already on its way', async () => {
    let land: () => void = () => undefined
    holding = new Promise((resolve) => (land = resolve))
    keepHistory(place, screen('slow'))
    dropHistory(place, null)
    land()
    await written()

    expect(files.has('s1/k1')).toBe(false)
    expect(said.map((one) => one.command)).toEqual([
      'terminal_history_write',
      'terminal_history_forget',
    ])
  })

  test('a dozen of them at most', async () => {
    for (let at = 0; at < 15; at++) dropHistory({ space: null, key: `t${at}` }, screen('x', at))
    await written()

    expect(await historyOf({ space: null, key: 't2' })).toBeNull()
    expect(await historyOf({ space: null, key: 't3' })).toEqual(screen('x', 3))
  })
})

describe('a terminal moved to another space', () => {
  test('takes its lines to that space, and the old file goes', async () => {
    keepHistory(place, screen('build log'))
    moveHistory(place, { space: 's2', key: 'k1' })
    await written()

    expect(files.get('s2/k1')).toEqual(screen('build log'))
    expect(files.has('s1/k1')).toBe(false)
    expect(await historyOf({ space: 's2', key: 'k1' })).toEqual(screen('build log'))
  })

  test('after the write that was already on its way, and before the next', async () => {
    let release: () => void = () => undefined
    holding = new Promise((done) => (release = done))
    keepHistory(place, screen('older'))
    moveHistory(place, { space: 's2', key: 'k1' })
    keepHistory({ space: 's2', key: 'k1' }, screen('newer', 2))
    release()
    await written()

    expect(files.get('s2/k1')).toEqual(screen('newer', 2))
    expect(files.has('s1/k1')).toBe(false)
  })

  test('from no space to one, and nothing at all where there were no lines', async () => {
    moveHistory({ space: null, key: 'k9' }, { space: 's2', key: 'k9' })
    await written()

    expect(files.size).toBe(0)
    expect(said.map((one) => one.command)).toEqual([
      'terminal_history_read',
      'terminal_history_forget',
    ])
  })
})

test('Restore history turned off forgets every file and every closed tab', async () => {
  keepHistory(place, screen('a'))
  keepHistory({ space: 's2', key: 'k2' }, screen('b'))
  dropHistory({ space: null, key: 'k3' }, screen('c'))
  forgetHistories()
  await written()

  expect(files.size).toBe(0)
  expect(said.at(-1)).toEqual({
    command: 'terminal_history_forget',
    args: { space: null, key: null },
  })
  expect(await historyOf({ space: null, key: 'k3' })).toBeNull()
})

describe('the lines this page kept before the crate did', () => {
  test('move into files for the terminals that are open, and the entry goes', async () => {
    store.set(
      'nib:terminal-lines',
      JSON.stringify({ k1: { at: 7, text: 'open one' }, gone: { at: 8, text: 'closed long ago' } }),
    )
    moveLegacy([place, { space: null, key: 'never-written' }])
    await written()

    expect(store.has('nib:terminal-lines')).toBe(false)
    expect(files.get('s1/k1')).toEqual({ cols: 0, rows: 0, at: 7, text: 'open one' })
    expect(files.size).toBe(1)
  })

  test('and an entry that is not a record of them just goes', () => {
    store.set('nib:terminal-lines', '["not", "a record"]')
    moveLegacy([place])
    expect(store.has('nib:terminal-lines')).toBe(false)
    expect(said).toEqual([])
  })
})
