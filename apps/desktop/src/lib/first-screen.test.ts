import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Draft, Session } from './workspace/session'

function memoryStorage(): Storage {
  const held = new Map<string, string>()
  return {
    get length() {
      return held.size
    },
    clear: () => held.clear(),
    getItem: (key) => held.get(key) ?? null,
    key: (at) => [...held.keys()][at] ?? null,
    removeItem: (key) => void held.delete(key),
    setItem: (key, value) => void held.set(key, value),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const { firstScreen, frontOf, KEY, keptOf, wordsHash } = await import('./first-screen.svelte')

const PATH = 'C:\\Nib\\Work\\Plan.md'
const WORDS = '# Plan\n\nWhat we are doing.\n'

const draft = (more: Partial<Draft> = {}): Draft => ({
  kind: 'note',
  path: PATH,
  name: 'Plan.md',
  doc: '',
  dirty: false,
  cursor: 0,
  scroll: 0,
  ...more,
})

const lone = (tab: Draft, stacked = false): Session => ({
  spaces: [],
  activeSpace: null,
  panel: null,
  layout: {
    frame: { kind: 'pane', pane: { id: 'p', tabs: [tab], active: 0, linked: false, stacked } },
    focused: 'p',
    panel: null,
  },
})

const KEPT = {
  build: __EVEN_BUILD__,
  path: PATH,
  words: wordsHash(WORDS),
  area: { width: 900, height: 700 },
  box: { left: 0, top: 0, width: 900, height: 700 },
  levels: [
    { tag: 'div', className: 'surface', style: '' },
    { tag: 'div', className: 'cm-editor \u037d1', style: '' },
    { tag: 'div', className: 'cm-scroller', style: '' },
    { tag: 'div', className: 'cm-content', style: '' },
  ],
  shift: 0,
  inset: 0,
  anchor: 0,
  at: 0,
  lines: '<div class="cm-line">What we are doing.</div>',
  css: '.\u037d1 { color: red }',
  look: { 'font-size': '16px' },
}

beforeEach(() => {
  localStorage.clear()
  firstScreen.drop()
})

describe('the words a first screen is kept against', () => {
  test('are the same with the line endings a file on Windows has', () => {
    expect(wordsHash('one\r\ntwo\r\n')).toBe(wordsHash('one\ntwo\n'))
    expect(wordsHash('one\rtwo')).toBe(wordsHash('one\ntwo'))
  })

  test('and different for different words, or more of them', () => {
    expect(wordsHash('one')).not.toBe(wordsHash('two'))
    expect(wordsHash('one')).not.toBe(wordsHash('one '))
  })
})

describe('the note in front of the sitting', () => {
  test('is the lone pane’s showing note', () => {
    expect(frontOf(lone(draft()))?.path).toBe(PATH)
  })

  test('is nothing for a split, a stack, a canvas or a note being read', () => {
    const split: Session = {
      ...lone(draft()),
      layout: {
        frame: {
          kind: 'split',
          id: 's',
          along: 'row',
          fraction: 0.5,
          sides: [
            { kind: 'pane', pane: { id: 'a', tabs: [draft()], active: 0, linked: false } },
            { kind: 'pane', pane: { id: 'b', tabs: [draft()], active: 0, linked: false } },
          ],
        },
        focused: 'a',
        panel: null,
      },
    }
    expect(frontOf(split)).toBeNull()
    expect(frontOf(lone(draft(), true))).toBeNull()
    expect(frontOf(lone(draft({ kind: 'canvas' })))).toBeNull()
    expect(frontOf(lone(draft({ reading: true })))).toBeNull()
  })

  test('is read off a strip written before there were panes', () => {
    const old: Session = { spaces: [], activeSpace: null, panel: null, tabs: [draft()], active: 0 }
    expect(frontOf(old)?.path).toBe(PATH)
  })
})

describe('what is kept', () => {
  test('reads back as it was written, and not when anything is missing', () => {
    expect(keptOf(JSON.parse(JSON.stringify(KEPT)))).toEqual(KEPT)
    expect(keptOf({ ...KEPT, levels: KEPT.levels.slice(1) })).toBeNull()
    expect(keptOf({ ...KEPT, box: null })).toBeNull()
    expect(keptOf('a string')).toBeNull()
  })
})

describe('the first frame', () => {
  const words = (text: string | null) => () => Promise.resolve(text)

  test('draws what was kept of the note in front, where its words are those words', async () => {
    localStorage.setItem(KEY, JSON.stringify(KEPT))
    await firstScreen.arm(lone(draft()), words(WORDS.replaceAll('\n', '\r\n')))
    expect(firstScreen.showing?.path).toBe(PATH)
  })

  test('draws nothing for words that changed since, or that are not known', async () => {
    localStorage.setItem(KEY, JSON.stringify(KEPT))
    await firstScreen.arm(lone(draft()), words('# Plan\n\nSomething else.\n'))
    expect(firstScreen.showing).toBeNull()

    await firstScreen.arm(lone(draft()), words(null))
    expect(firstScreen.showing).toBeNull()
  })

  test('reads a note with unwritten words by the draft the sitting kept', async () => {
    localStorage.setItem(KEY, JSON.stringify(KEPT))
    await firstScreen.arm(lone(draft({ dirty: true, doc: WORDS })), words(null))
    expect(firstScreen.showing?.path).toBe(PATH)
  })

  test('draws a tab with no file by the words the sitting kept for it', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...KEPT, path: null }))
    await firstScreen.arm(lone(draft({ path: null, dirty: true, doc: WORDS })), words(null))
    expect(firstScreen.showing?.path).toBeNull()
    expect(firstScreen.showing).not.toBeNull()
  })

  test('draws nothing kept by another build, or of another note', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...KEPT, build: 'an older one' }))
    await firstScreen.arm(lone(draft()), words(WORDS))
    expect(firstScreen.showing).toBeNull()

    localStorage.setItem(KEY, JSON.stringify(KEPT))
    await firstScreen.arm(lone(draft({ path: 'C:\\Nib\\Work\\Other.md' })), words(WORDS))
    expect(firstScreen.showing).toBeNull()
  })

  test('rises once in a session, whichever draws the first surface', () => {
    const fresh = firstScreen.rise()
    expect(firstScreen.rise()).toBe(false)
    expect(typeof fresh).toBe('boolean')
  })
})
