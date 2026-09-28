/** Find and the address field in a web tab: Ctrl+F, Ctrl+L and Alt+D are the page's
 *  first, as in Chrome. The script in every page asks for nib's answer only when nothing
 *  in the page took the key, and the crate's word for it is read into one of four asks
 *  for the tab it came from. See seek.ts, passed.svelte.ts and web_opens.rs. */

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

const { seek, shut, sought } = await import('./seek')
const { addressing, answer, readAsk } = await import('./passed.svelte')
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
}

interface Heard {
  type: string
  handler: (event: Pressed) => void
  capture: boolean
}

type Pressed = Required<Key> & {
  type: string
  readonly defaultPrevented: boolean
  preventDefault: () => void
}

/** The script run in a page of its own, with what it opens written down.
 *
 *  The page's window is the one target a key reaches last, and the DOM's order on it is
 *  kept: the capturing handlers, then the bubbling ones, each turn running the handlers
 *  there are when it starts, in the order they were added. `own` is a page with a find
 *  of its own, whose handler is added after the script, as every page's is. */
function page(own = false) {
  const opened: string[] = []
  const heard: Heard[] = []
  const window = {
    open(this: unknown, _url: string, name: string) {
      if (this !== window) throw new Error('open called off the window')
      opened.push(name)
      return null
    },
  }
  const at = (type: string, handler: Heard['handler'], capture: boolean) =>
    heard.findIndex(
      (one) => one.type === type && one.handler === handler && one.capture === capture,
    )
  const addEventListener = (type: string, handler: Heard['handler'], capture = false) => {
    if (at(type, handler, capture) < 0) heard.push({ type, handler, capture })
  }
  const removeEventListener = (type: string, handler: Heard['handler'], capture = false) => {
    const index = at(type, handler, capture)
    if (index >= 0) heard.splice(index, 1)
  }
  runInNewContext(pageScript(), { window, addEventListener, removeEventListener, Element: Object })

  // The page puts its own `window.open` in after the script has run, as some do.
  window.open = () => {
    throw new Error("the page's own open")
  }
  let ownFind = 0
  if (own) {
    addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.keyCode === 70) {
        event.preventDefault()
        ownFind++
      }
    })
  }

  const turn = (event: Pressed, capture: boolean) => {
    const now = heard.filter((one) => one.type === event.type && one.capture === capture)
    for (const one of now) if (heard.includes(one)) one.handler(event)
  }
  const press = (key: Key) => {
    let prevented = false
    const event: Pressed = {
      type: 'keydown',
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
    turn(event, true)
    turn(event, false)
    return { opened: opened.splice(0), prevented }
  }
  return { press, own: () => ownFind }
}

describe('the script in every page', () => {
  test('asks for the find on Ctrl+F nothing in the page took, and keeps the engine off it', () => {
    expect(page().press({ keyCode: 70, ctrlKey: true })).toEqual({
      opened: ['nib-find'],
      prevented: true,
    })
  })

  test('leaves Ctrl+F to a page with a find of its own, added after the script', () => {
    const one = page(true)
    expect(one.press({ keyCode: 70, ctrlKey: true })).toEqual({ opened: [], prevented: true })
    expect(one.press({ keyCode: 70, ctrlKey: true }).opened).toEqual([])
    expect(one.own()).toBe(2)
    // Its other keys are still nib's.
    expect(one.press({ keyCode: 71, ctrlKey: true }).opened).toEqual(['nib-find-next'])
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
      // Ctrl+Shift+L and Ctrl+Alt+D, and a D typed with Alt and Shift.
      { keyCode: 76, ctrlKey: true, shiftKey: true },
      { keyCode: 68, ctrlKey: true, altKey: true },
      { keyCode: 68, altKey: true, shiftKey: true },
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
      { keyCode: 75, ctrlKey: true },
    ]
    for (const key of others) {
      expect(one.press(key), JSON.stringify(key)).toEqual({ opened: [], prevented: false })
    }
  })

  test('asks for the address field on Ctrl+L and Alt+D nothing in the page took', () => {
    const one = page()
    expect(one.press({ keyCode: 76, ctrlKey: true }).opened).toEqual(['nib-address'])
    expect(one.press({ keyCode: 68, altKey: true }).opened).toEqual(['nib-address'])
  })

  test('answers only a key a person pressed', () => {
    expect(page().press({ keyCode: 70, ctrlKey: true, isTrusted: false }).opened).toEqual([])
  })
})

describe("the crate's word for an ask", () => {
  test('is one of four, for a tab', () => {
    for (const key of ['find', 'next', 'previous', 'address']) {
      expect(readAsk({ tab: 't1', key })).toEqual({ tab: 't1', key })
    }
  })

  test('and nothing else is read as one', () => {
    for (const value of [
      null,
      'find',
      { key: 'find' },
      { tab: 't1' },
      { tab: 't1', key: 'open' },
      { tab: 't1', key: 'fresh' },
      { tab: 't1', key: 'app.close' },
      { tab: 1, key: 'find' },
    ]) {
      expect(readAsk(value), JSON.stringify(value)).toBeNull()
    }
  })
})

describe('an ask', () => {
  test('for the find opens the bar', () => {
    const one = new Page()
    answer('t1', one, 'find')
    expect(one.find.open).toBe(true)
    expect(called).toEqual([])
  })

  test('for a step opens a shut bar too, as Chrome does', () => {
    const one = new Page()
    sought('t1', one, 'next')
    expect(one.find.open).toBe(true)
    expect(called).toEqual([])
  })

  test("for a step walks an open bar's matches", () => {
    const one = new Page()
    one.find.open = true
    one.find.query = 'nib'
    answer('t1', one, 'previous')
    expect(called).toEqual([
      { command: 'web_find', args: { tab: 't1', term: 'nib', look: 'previous' } },
    ])
  })

  test("for the address field is that page's, and a new ask each time", () => {
    const one = new Page()
    answer('t1', one, 'address')
    const first = addressing.asked
    expect(first?.page).toBe(one)
    expect(one.find.open).toBe(false)
    answer('t1', one, 'address')
    expect(addressing.asked).not.toBe(first)
    expect(addressing.asked?.page).toBe(one)
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
