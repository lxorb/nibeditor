import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The document and nothing else.
 *
 *  Two halves to it. The store is the state: what is full screen, whether the way
 *  out has faded back, and the document it belongs to - and the window it asks to
 *  drop its frame, which is stood in for here. The shell is the other half, and
 *  what a test can read of that is the markup: which parts of the app leave, which
 *  stay, and that there are ways back out of a screen with nothing on it. */

const asked: boolean[] = []
/** A platform that will not go full screen, which several will not. */
let refuses = false

vi.mock('./tauri', () => ({
  isMobile: false,
  currentWindow: () =>
    Promise.resolve({
      setFullscreen: (on: boolean) => {
        if (refuses) return Promise.reject(new Error('not here'))

        asked.push(on)
        return Promise.resolve()
      },
    }),
}))

const { fullscreen, IDLE } = await import('./fullscreen.svelte')

beforeEach(() => {
  asked.length = 0
  refuses = false
  vi.useFakeTimers()
})

afterEach(async () => {
  vi.useRealTimers()
  await fullscreen.leave()
})

describe('turning it on and off', () => {
  test('one command does both, and the window follows', async () => {
    await fullscreen.toggle('tab-1')
    expect(fullscreen.on).toBe(true)
    expect(fullscreen.of).toBe('tab-1')
    expect(asked).toEqual([true])

    await fullscreen.toggle('tab-1')
    expect(fullscreen.on).toBe(false)
    expect(fullscreen.of).toBe(null)
    expect(asked).toEqual([true, false])
  })

  test('asking twice for what is already so changes nothing', async () => {
    await fullscreen.enter('tab-1')
    await fullscreen.enter('tab-2')

    expect(fullscreen.of).toBe('tab-1')
    expect(asked).toEqual([true])

    await fullscreen.leave()
    await fullscreen.leave()
    expect(asked).toEqual([true, false])
  })

  /** A platform that will not go full screen - a webview on a phone, a browser
   *  outside a gesture - is no reason to leave the app on screen. */
  test('a window that refuses is not an error', async () => {
    refuses = true
    await fullscreen.enter('tab-1')

    expect(fullscreen.on).toBe(true)
    expect(asked).toEqual([])
  })
})

describe('the way out', () => {
  test('fades once nothing has moved, and lights again when something does', async () => {
    await fullscreen.enter('tab-1')
    expect(fullscreen.idle).toBe(false)

    vi.advanceTimersByTime(IDLE + 10)
    expect(fullscreen.idle).toBe(true)

    fullscreen.stir()
    expect(fullscreen.idle).toBe(false)

    vi.advanceTimersByTime(IDLE + 10)
    expect(fullscreen.idle).toBe(true)
  })

  test('is not re-armed sixty times a second by a moving hand', async () => {
    await fullscreen.enter('tab-1')

    // A pointer crossing the screen, well inside the window a stir is answered
    // in: the fade still comes when the first of them said it would.
    const start = Date.now()
    for (let step = 0; step < 20; step++) fullscreen.stir(start + step * 10)

    vi.advanceTimersByTime(IDLE + 10)
    expect(fullscreen.idle).toBe(true)
  })

  test('says nothing while the app is on screen', () => {
    fullscreen.stir()
    expect(fullscreen.idle).toBe(false)
  })
})

describe('the document it belongs to', () => {
  test('closing it brings the app back', async () => {
    await fullscreen.enter('tab-1')

    fullscreen.watch(['tab-1', 'tab-2'])
    expect(fullscreen.on).toBe(true)

    fullscreen.watch(['tab-2'])
    // The state goes at once, so nothing is drawn for a frame that says the app
    // is still away; the window is asked a tick later.
    expect(fullscreen.on).toBe(false)

    await Promise.resolve()
    await Promise.resolve()
    expect(asked).toEqual([true, false])
  })

  test('and nothing about it is written down', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./fullscreen.svelte.ts', import.meta.url)),
      'utf8',
    )

    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('persist')
  })
})

/** What the shell does with it, read out of the markup the way
 *  `reachable.test.ts` reads the window buttons. */
describe('the shell', () => {
  const SOURCE = fileURLToPath(new URL('../', import.meta.url))
  const app = readFileSync(`${SOURCE}App.svelte`, 'utf8')
  const menu = readFileSync(`${SOURCE}lib/app-menu.ts`, 'utf8')
  const registry = readFileSync(`${SOURCE}lib/shortcuts/registry.ts`, 'utf8')

  /** Everything inside a `{#if …fullscreen…}` block, by counting the blocks that
   *  open and close between. */
  function branches(text: string): string[] {
    const found: string[] = []

    for (const match of text.matchAll(/\{#if [^}]*fullscreen[^}]*\}/g)) {
      const opening = match.index
      let depth = 1
      let at = opening + match[0].length
      while (depth > 0) {
        const next = /\{[#/]/.exec(text.slice(at))
        if (!next) throw new Error(`${match[0]} is never closed`)

        at += next.index + 2
        depth += next[0] === '{#' ? 1 : -1
      }

      found.push(text.slice(opening, at))
    }

    return found
  }

  test('the app leaves: the file list, both bars, the round button', () => {
    expect(app).toContain('{#if !fullscreen.on}')
    // Which kinds have the bar at all is `hasStatusBar` in regions.ts; what is
    // asserted here is only that full screen takes it away as well.
    expect(app).toContain('{#if hasStatusBar(workspace.active?.kind) && !fullscreen.on}')
    expect(app).toContain('&& !fullscreen.on}\n        <button class="fab"')

    const gone = branches(app).find((one) => one.includes('class="panels"'))
    expect(gone, 'the panels are not left out').toBeDefined()
    expect(gone).toContain('<Sidebar')
  })

  /** The document is not one of the things that go, so whatever it draws on top
   *  of itself - the canvas's floating bar - stays with it. */
  test('the document stays, and so does what it draws over itself', () => {
    for (const one of branches(app)) {
      expect(one, 'the panes are inside a full screen branch').not.toContain('<PaneTree')
    }
  })

  test('there are four ways back', () => {
    // The button, Escape, back on Android, and the menu row that turned it on.
    expect(app).toContain("t('Leave fullscreen')")
    expect(app).toContain('overlays.show(() => void fullscreen.leave())')
    expect(app).toContain('closeOnBack(fullscreen.on, () => void fullscreen.leave())')
    expect(menu).toContain('run: () => void fullscreen.toggle(workspace.activeTabId)')
  })

  /** One command, one key, one row: the menu shows what the key is bound to and
   *  runs the same thing. */
  test('it is the command the keyboard already had', () => {
    expect(registry).toContain("id: 'app.fullscreen'")
    expect(registry).toContain("key: 'F11'")
    expect(menu).toContain("...keyed('app.fullscreen')")
    expect(app).toContain('fullscreen: () => void fullscreen.toggle(workspace.activeTabId)')
  })

  test('and it is left when the document it was entered on is closed', () => {
    expect(app).toContain('fullscreen.watch(workspace.tabs.map((tab) => tab.id))')
  })
})
