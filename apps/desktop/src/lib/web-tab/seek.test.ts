/** Find in a web tab: Ctrl+F is the page's first, as in Chrome. The script in every page
 *  asks for nib's find only when nothing in the page took the key, and the crate's word
 *  for it is read into one of three asks for the tab it came from. See seek.ts and
 *  web_opens.rs. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const called: { command: string; args: Record<string, unknown> }[] = []

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    called.push({ command, args })
    return Promise.resolve(undefined)
  },
}))

const { readAsked, seek, shut, sought } = await import('./seek')
const { Page } = await import('./pages.svelte')

beforeEach(() => {
  called.length = 0
})

/** The script the crate puts in every page, read off the crate so the two cannot drift. */
function pageScript(): string {
  const crate = readFileSync(
    fileURLToPath(new URL('../../../src-tauri/src/web_opens.rs', import.meta.url)),
    'utf8',
  )
  const found = /pub const SCRIPT: &str = r"([\s\S]*?)";/.exec(crate)
  if (!found?.[1]) throw new Error('web_opens.rs has no SCRIPT')
  return found[1]
}

interface Key {
  keyCode: number
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  isTrusted?: boolean
  /** A handler of the page's own took the key before the script's turn. */
  taken?: boolean
}

/** The script run in a page of its own, with what it opens written down. */
function page() {
  const opened: string[] = []
  const heard: Record<string, ((event: unknown) => void)[]> = {}
  const window = {
    open(this: unknown, _url: string, name: string) {
      if (this !== window) throw new Error('open called off the window')
      opened.push(name)
      return null
    },
  }
  const listen = (type: string, handler: (event: unknown) => void) => {
    ;(heard[type] ??= []).push(handler)
  }
  runInNewContext(pageScript(), { window, addEventListener: listen, Element: Object })

  // The page puts its own `window.open` in after the script has run, as some do.
  window.open = () => {
    throw new Error("the page's own open")
  }

  const press = (key: Key) => {
    let prevented = key.taken === true
    const event = {
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      isTrusted: true,
      ...key,
      get defaultPrevented() {
        return prevented
      },
      preventDefault() {
        prevented = true
      },
    }
    for (const handler of heard.keydown ?? []) handler(event)
    return { opened: opened.splice(0), prevented }
  }
  return { press }
}

describe('the script in every page', () => {
  test('asks for the find on Ctrl+F nothing in the page took, and keeps the engine off it', () => {
    expect(page().press({ keyCode: 70, ctrlKey: true })).toEqual({
      opened: ['nib-find'],
      prevented: true,
    })
  })

  test('leaves Ctrl+F to a page with a find of its own', () => {
    expect(page().press({ keyCode: 70, ctrlKey: true, taken: true }).opened).toEqual([])
  })

  test('steps on Ctrl+G and F3, back with Shift', () => {
    const one = page()
    expect(one.press({ keyCode: 71, ctrlKey: true }).opened).toEqual(['nib-find-next'])
    expect(one.press({ keyCode: 71, ctrlKey: true, shiftKey: true }).opened).toEqual([
      'nib-find-previous',
    ])
    expect(one.press({ keyCode: 114 }).opened).toEqual(['nib-find-next'])
    expect(one.press({ keyCode: 114, shiftKey: true }).opened).toEqual(['nib-find-previous'])
  })

  test('leaves every other key alone', () => {
    const one = page()
    const others: Key[] = [
      // Typing an f, and Ctrl+Shift+F, which is the page's.
      { keyCode: 70 },
      { keyCode: 70, ctrlKey: true, shiftKey: true },
      // AltGr is Ctrl+Alt, and a character.
      { keyCode: 70, ctrlKey: true, altKey: true },
      { keyCode: 71, ctrlKey: true, altKey: true },
      { keyCode: 70, ctrlKey: true, metaKey: true },
      // F3 with Ctrl is not a step, and neither is a G.
      { keyCode: 114, ctrlKey: true },
      { keyCode: 71 },
      { keyCode: 76, ctrlKey: true },
    ]
    for (const key of others) {
      expect(one.press(key), JSON.stringify(key)).toEqual({ opened: [], prevented: false })
    }
  })

  test('answers only a key a person pressed', () => {
    expect(page().press({ keyCode: 70, ctrlKey: true, isTrusted: false }).opened).toEqual([])
  })
})

describe("the crate's word for an ask", () => {
  test('is one of three, for a tab', () => {
    expect(readAsked({ tab: 't1', look: 'open' })).toEqual({ tab: 't1', look: 'open' })
    expect(readAsked({ tab: 't1', look: 'next' })).toEqual({ tab: 't1', look: 'next' })
    expect(readAsked({ tab: 't1', look: 'previous' })).toEqual({ tab: 't1', look: 'previous' })
  })

  test('and nothing else is read as one', () => {
    for (const value of [
      null,
      'open',
      { look: 'open' },
      { tab: 't1' },
      { tab: 't1', look: 'fresh' },
      { tab: 't1', look: 'app.close' },
      { tab: 1, look: 'open' },
    ]) {
      expect(readAsked(value), JSON.stringify(value)).toBeNull()
    }
  })
})

describe('an ask', () => {
  test('opens the bar', () => {
    const one = new Page()
    sought('t1', one, 'open')
    expect(one.find.open).toBe(true)
    expect(called).toEqual([])
  })

  test('opens a shut bar on a step too, as Chrome does', () => {
    const one = new Page()
    sought('t1', one, 'next')
    expect(one.find.open).toBe(true)
    expect(called).toEqual([])
  })

  test("steps through an open bar's matches", () => {
    const one = new Page()
    one.find.open = true
    one.find.query = 'nib'
    sought('t1', one, 'previous')
    expect(called).toEqual([
      { command: 'web_find', args: { tab: 't1', term: 'nib', look: 'previous' } },
    ])
  })
})

describe('the bar', () => {
  test('lets go of the marks when the word is gone, and when it closes', () => {
    const one = new Page()
    one.find = { open: true, query: 'a', count: 3, at: 1 }
    seek('t1', one, '', 'fresh')
    expect(one.find).toMatchObject({ query: '', count: 0, at: -1 })
    shut('t1', one)
    expect(one.find.open).toBe(false)
    expect(called.map((one) => one.command)).toEqual(['web_find_stop', 'web_find_stop'])
  })
})
