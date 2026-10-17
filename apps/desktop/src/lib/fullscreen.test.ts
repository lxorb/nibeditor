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

const { escapeLeaves, fullscreen, IDLE } = await import('./fullscreen.svelte')

/** Two panes side by side, the left one worked in, as the store would have them. */
function twoPanes(
  showing: { left: string | null; right: string | null } = { left: 'tab-1', right: 'tab-2' },
) {
  const shown = { ...showing }
  return {
    fills: null as string | null,
    focusedId: 'left',
    shown,
    get focused() {
      return { activeTabId: this.focusedId === 'left' ? shown.left : shown.right }
    },
  }
}

let panes = twoPanes()

beforeEach(() => {
  asked.length = 0
  refuses = false
  panes = twoPanes()
  vi.useFakeTimers()
})

afterEach(async () => {
  vi.useRealTimers()
  await fullscreen.leave()
})

describe('turning it on and off', () => {
  test('one command does both, and the window follows', async () => {
    await fullscreen.toggle(panes)
    expect(fullscreen.on).toBe(true)
    expect(asked).toEqual([true])

    await fullscreen.toggle(panes)
    expect(fullscreen.on).toBe(false)
    expect(asked).toEqual([true, false])
  })

  test('asking twice for what is already so changes nothing', async () => {
    await fullscreen.enter(panes)
    await fullscreen.enter(panes)

    expect(asked).toEqual([true])

    await fullscreen.leave()
    await fullscreen.leave()
    expect(asked).toEqual([true, false])
  })

  /** A platform that will not go full screen - a webview on a phone, a browser
   *  outside a gesture - is no reason to leave the app on screen. */
  test('a window that refuses is not an error', async () => {
    refuses = true
    await fullscreen.enter(panes)

    expect(fullscreen.on).toBe(true)
    expect(asked).toEqual([])
  })

  /** A browser that granted full screen keeps Escape for itself and only says the
   *  document left it; the app comes back with it rather than staying out of the way
   *  in a window that is not full screen any more. */
  test('a browser giving its full screen back gives the app back', async () => {
    const page = Object.assign(new EventTarget(), { fullscreenElement: null as object | null })
    vi.stubGlobal('document', page)
    try {
      page.fullscreenElement = {}
      await fullscreen.enter(panes)
      expect(fullscreen.on).toBe(true)

      page.fullscreenElement = null
      page.dispatchEvent(new Event('fullscreenchange'))
      await vi.waitFor(() => expect(fullscreen.on).toBe(false))
      expect(panes.fills).toBe(null)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('the way out', () => {
  test('fades once nothing has moved, and lights again when something does', async () => {
    await fullscreen.enter(panes)
    expect(fullscreen.idle).toBe(false)

    vi.advanceTimersByTime(IDLE + 10)
    expect(fullscreen.idle).toBe(true)

    fullscreen.stir()
    expect(fullscreen.idle).toBe(false)

    vi.advanceTimersByTime(IDLE + 10)
    expect(fullscreen.idle).toBe(true)
  })

  test('is not re-armed sixty times a second by a moving hand', async () => {
    await fullscreen.enter(panes)

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

describe('the tab it shows', () => {
  /** Chrome's F11 for whatever is open: one tab, the one in front of the pane being
   *  worked in, and the other pane, the strips and the split exactly as they were after. */
  test('is the pane being worked in alone, and every pane comes back', async () => {
    await fullscreen.enter(panes)
    expect(panes.fills).toBe('left')

    await fullscreen.leave()
    expect(panes.fills).toBe(null)
  })

  test('a window filled before is filled again after', async () => {
    panes.fills = 'left'
    await fullscreen.enter(panes)
    expect(panes.fills).toBe('left')

    await fullscreen.leave()
    expect(panes.fills).toBe('left')
  })

  /** Unless the pane that filled is no longer the one worked in, which ends Full window
   *  on its own; see `stillFills` in tab-fill/rules.ts. */
  test('but not once the keyboard went to another pane', async () => {
    panes.fills = 'left'
    await fullscreen.enter(panes)
    panes.focusedId = 'right'
    fullscreen.follow()
    expect(panes.fills).toBe('right')

    await fullscreen.leave()
    expect(panes.fills).toBe(null)
  })

  test('goes with the keyboard to another pane', async () => {
    await fullscreen.enter(panes)
    panes.focusedId = 'right'
    fullscreen.follow()

    expect(fullscreen.on).toBe(true)
    expect(panes.fills).toBe('right')
  })

  test('stays through another tab of the same pane, as F11 does through a tab switch', async () => {
    await fullscreen.enter(panes)
    panes.shown.left = 'tab-3'
    fullscreen.follow()

    expect(fullscreen.on).toBe(true)
    expect(panes.fills).toBe('left')
  })

  test('and the app comes back when the pane shows nothing', async () => {
    await fullscreen.enter(panes)
    panes.shown.left = null
    fullscreen.follow()
    // The state goes at once, so nothing is drawn for a frame that says the app
    // is still away; the window is asked a tick later.
    expect(fullscreen.on).toBe(false)
    expect(panes.fills).toBe(null)

    await Promise.resolve()
    await Promise.resolve()
    expect(asked).toEqual([true, false])
  })

  test('a pane showing nothing is never put full screen', async () => {
    panes = twoPanes({ left: null, right: 'tab-2' })
    await fullscreen.enter(panes)

    expect(fullscreen.on).toBe(false)
    expect(panes.fills).toBe(null)
    expect(asked).toEqual([])
  })

  test('says nothing to panes it was not entered on', () => {
    fullscreen.follow()
    expect(panes.fills).toBe(null)
  })
})

/** Escape gives the screen back where nothing else wanted it. */
describe('Escape', () => {
  test('in a note, or on nothing, leaves', () => {
    expect(escapeLeaves(false, { tagName: 'DIV' })).toBe(true)
    expect(escapeLeaves(false, null)).toBe(true)
  })

  test('spent by the editor, vim or a picture stepped off, does not', () => {
    expect(escapeLeaves(true, { tagName: 'DIV' })).toBe(false)
  })

  test('in a field or a shell, which read it themselves, does not', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(escapeLeaves(false, { tagName }), tagName).toBe(false)
    }
  })
})

describe('what is kept of it', () => {
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
  const wayOut = readFileSync(`${SOURCE}lib/FullscreenLeave.svelte`, 'utf8')
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
    expect(app).toContain('{#if hasStatusBar(workspace.active?.kind) && !fullscreen.on && !filled}')
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
    // The button, Escape, back on Android, and the menu row that turned it on. The
    // button is fetched with full screen, which is never on as the window opens.
    expect(app).toContain('{#await fullscreenWayOut() then WayOut}')
    expect(wayOut).toContain("t('Leave fullscreen')")
    expect(wayOut).toContain('onclick={() => void fullscreen.leave()}')
    expect(app).toContain("if (event.key === 'Escape' && fullscreen.on) {")
    expect(app).toContain('closeOnBack(fullscreen.on, () => void fullscreen.leave())')
    expect(menu).toContain('run: () => void fullscreen.toggle(workspace.panes)')
  })

  /** Escape leaves it from the window's own key handler rather than off the overlay
   *  stack, and that is not a style: the stack answers a second question, which is
   *  whether anything of the app's is drawn over a pane - and a web tab's page is a
   *  native webview that has to be hidden while anything is. Full screen draws nothing
   *  over the document, so an entry on that stack hid the page full screen exists to
   *  fill the screen with. See overlays.ts and lib/web-tab/WebTab.svelte. */
  test('is not an overlay, because nothing is drawn over the document for it', () => {
    expect(app).not.toContain('fullscreen.on ? overlays.show')
    // And it is still the layer Escape reaches after the overlays, not before them.
    const escape = app.indexOf('overlays.escape(event)')
    const leaving = app.indexOf("if (event.key === 'Escape' && fullscreen.on) {")
    expect(escape).toBeGreaterThan(-1)
    expect(leaving).toBeGreaterThan(escape)
  })

  /** One command, one key, one row: the menu shows what the key is bound to and
   *  runs the same thing. */
  test('it is the command the keyboard already had', () => {
    expect(registry).toContain("id: 'app.fullscreen'")
    expect(registry).toContain("key: 'F11'")
    expect(menu).toContain("...keyed('app.fullscreen')")
    expect(app).toContain('fullscreen: () => void fullscreen.toggle(workspace.panes)')
  })

  test('and it keeps to the pane worked in, and is left when that shows nothing', () => {
    expect(app).toContain('$effect(() => fullscreen.follow())')
  })

  /** A web tab is its page alone: the bar goes, and no button is drawn where a native
   *  webview would draw over it. */
  test('a web tab is its page and nothing else', () => {
    const web = readFileSync(`${SOURCE}lib/web-tab/WebTab.svelte`, 'utf8')
    expect(web).toContain('<div class="head" class:gone={fullscreen.on}')
    expect(app).toContain("{#if fullscreen.on && workspace.active?.kind !== 'web'}")
  })
})
