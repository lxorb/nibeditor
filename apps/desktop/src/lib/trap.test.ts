import { afterEach, describe, expect, test, vi } from 'vitest'
import { trap } from './trap'

/** Who holds the keyboard while a layer is open, and who has it once the layer
 *  has gone.
 *
 *  The second half is the one with a bug in it. A menu entry can open something
 *  that wants the keyboard - a row's name field - and the entry that opened it is
 *  still fading out when the layer is taken off the page. Handing the keyboard
 *  back then takes it off the field, and a name field that loses the keyboard
 *  commits what is in it; for a row being made that is nothing, so the row goes
 *  and New note made no note. */

/** A stand-in for an element, with only what the trap reads. `focus` records
 *  itself on the document, which is what `activeElement` answers. */
interface Fake {
  tagName: string
  isConnected: boolean
  tabIndex: number
  focused: number
  children: Fake[]
  focus(): void
  hasAttribute(name: string): boolean
  getAttribute(name: string): string | null
  matches(selector: string): boolean
  getClientRects(): { length: number }[]
  contains(other: unknown): boolean
  querySelector(): Fake | null
  querySelectorAll(): Fake[]
  addEventListener(): void
  removeEventListener(): void
}

let active: Fake | null = null

function fake(tagName: string, children: Fake[] = []): Fake {
  const one: Fake = {
    tagName,
    isConnected: true,
    tabIndex: 0,
    focused: 0,
    children,
    focus() {
      one.focused += 1
      active = one
    },
    hasAttribute: () => false,
    getAttribute: () => null,
    matches: () => false,
    getClientRects: () => [{ length: 1 }],
    contains: (other) => other === one || children.some((child) => child.contains(other)),
    querySelector: () => null,
    querySelectorAll: () => children,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }

  return one
}

/** A document whose `activeElement` is whatever was focused last, so the trap
 *  reads the same answer a browser would give it. */
function pretendDocument(body: Fake, root: Fake) {
  vi.stubGlobal('document', {
    get activeElement() {
      return active
    },
    body,
    documentElement: root,
  })
}

/** The trap tests `from instanceof HTMLElement`, which in this environment has to
 *  be something the fakes pass. Not a class: `instanceof` asks the right-hand
 *  side for `Symbol.hasInstance`, and anything can answer. */
function pretendHTMLElement() {
  vi.stubGlobal('HTMLElement', {
    [Symbol.hasInstance]: (value: unknown) =>
      typeof value === 'object' && value !== null && 'focus' in value,
  })
}

function layer(children: Fake[] = []): Fake {
  return fake('DIV', children)
}

function open(node: Fake) {
  return trap(node as unknown as HTMLElement)
}

afterEach(() => {
  vi.unstubAllGlobals()
  active = null
})

describe('the keyboard while a layer is open', () => {
  test('the first thing in the layer takes it', () => {
    const body = fake('BODY')
    const root = fake('HTML')
    const row = fake('BUTTON')
    pretendDocument(body, root)
    pretendHTMLElement()

    open(layer([row]))
    expect(row.focused).toBe(1)
  })

  test('a layer with nothing to stand on takes it itself', () => {
    const body = fake('BODY')
    const root = fake('HTML')
    pretendDocument(body, root)
    pretendHTMLElement()

    const node = layer()
    node.tabIndex = 0
    open(node)
    expect(node.focused).toBe(1)
  })

  /** Opened by a finger, a menu showed its first row ringed, as the row already
   *  chosen. The box of a menu is there to hold the keyboard for its rows, and
   *  wears no ring. */
  test('under a thumb a menu keeps it itself, and a sheet still hands it on', () => {
    const body = fake('BODY')
    const root = fake('HTML')
    root.hasAttribute = (name) => name === 'data-touch'
    pretendDocument(body, root)
    pretendHTMLElement()

    const row = fake('BUTTON')
    const menu = layer([row])
    menu.matches = (selector) => selector.startsWith('.nib-host')
    open(menu)
    expect(menu.focused).toBe(1)
    expect(row.focused).toBe(0)

    const answer = fake('BUTTON')
    open(layer([answer]))
    expect(answer.focused).toBe(1)
  })
})

describe('the keyboard once the layer has gone', () => {
  test('goes back to what opened it', () => {
    const body = fake('BODY')
    const root = fake('HTML')
    const opener = fake('BUTTON')
    pretendDocument(body, root)
    pretendHTMLElement()

    opener.focus()
    const row = fake('BUTTON')
    const node = layer([row])
    const held = open(node)
    expect(row.focused).toBe(1)

    held.destroy()
    expect(opener.focused).toBe(2)
  })

  test('goes back when the keyboard has fallen to the page', () => {
    const body = fake('BODY')
    const root = fake('HTML')
    const opener = fake('BUTTON')
    pretendDocument(body, root)
    pretendHTMLElement()

    opener.focus()
    const node = layer([fake('BUTTON')])
    const held = open(node)

    // What a browser answers once the thing that held it has been taken off the
    // page, which is what the layer's own outro does to its rows.
    active = body
    held.destroy()
    expect(opener.focused).toBe(2)
  })

  test('stays where something else has taken it', () => {
    const body = fake('BODY')
    const root = fake('HTML')
    const opener = fake('BUTTON')
    pretendDocument(body, root)
    pretendHTMLElement()

    opener.focus()
    const node = layer([fake('BUTTON')])
    const held = open(node)

    // The field a menu entry opened, which took the keyboard while the menu was
    // still fading. Handing it back here is what made New note make nothing.
    const field = fake('INPUT')
    field.focus()

    held.destroy()
    expect(field.focused).toBe(1)
    expect(opener.focused).toBe(1)
    expect(active).toBe(field)
  })

  test("nothing of the app's own takes it back from a site that had it", () => {
    const body = fake('BODY')
    const root = fake('HTML')
    root.hasAttribute = (name) => name === 'data-keyboard-in-page'
    const opener = fake('BUTTON')
    pretendDocument(body, root)
    pretendHTMLElement()

    // What the app's page last had focused, before a site in a web tab took the
    // keyboard; the crate hands it back to the site once the layer has gone.
    opener.focus()
    const held = open(layer([fake('BUTTON')]))
    active = body
    held.destroy()
    expect(opener.focused).toBe(1)
  })

  test('nothing goes back to a row the layer itself deleted', () => {
    const body = fake('BODY')
    const root = fake('HTML')
    const opener = fake('BUTTON')
    pretendDocument(body, root)
    pretendHTMLElement()

    opener.focus()
    const node = layer([fake('BUTTON')])
    const held = open(node)

    opener.isConnected = false
    active = body
    held.destroy()
    expect(opener.focused).toBe(1)
  })
})
