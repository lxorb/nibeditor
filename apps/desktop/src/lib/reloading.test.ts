import { afterEach, beforeEach, describe, expect, type Mock, test, vi } from 'vitest'
import { entryOf, verdict } from './reload-when'

/** A piece of the app that did not arrive, found by hunt-7: one chunk lost to a deploy
 *  under an open tab or to a flaky network, and the palette, the right-click menu, the
 *  prompt sheet, sign-in and the format bar were dead until a reload nobody knew to do.
 *  What is under test is what the page does about it; the doors themselves are
 *  test/effects/doors.effect.test.ts. */

/** The page Vite writes, with the two scripts in front of the entry that a build has: an
 *  inline one that is not a module, and none that is. */
function page(entry: string): string {
  return [
    '<!doctype html><html><head>',
    '<script>document.documentElement.dataset.theme = "dark"</script>',
    `<script type="module" crossorigin src="${entry}"></script>`,
    '<link rel="modulepreload" crossorigin href="/assets/shell-9f.js">',
    '</head><body><div id="app"></div></body></html>',
  ].join('\n')
}

describe('the entry a page starts from', () => {
  test('is the module script with a source, whatever comes before it', () => {
    expect(entryOf(page('/assets/index-B2x9.js'))).toBe('/assets/index-B2x9.js')
  })

  test('is read in any attribute order and either quote', () => {
    expect(entryOf(`<script src='/assets/index-a.js' type='module'></script>`)).toBe(
      '/assets/index-a.js',
    )
  })

  test('is nothing on a page with no module script', () => {
    expect(entryOf('<p>Service unavailable</p>')).toBeNull()
  })
})

describe('what a missing piece calls for', () => {
  test('a newer build under the page is a reload', () => {
    expect(verdict('/assets/index-old.js', '/assets/index-new.js', null)).toBe('reload')
  })

  test('the same build is an offer: the network lost the piece', () => {
    expect(verdict('/assets/index-old.js', '/assets/index-old.js', null)).toBe('offer')
  })

  test('a build a reload already went for and did not get is an offer, not a loop', () => {
    expect(verdict('/assets/index-old.js', '/assets/index-new.js', '/assets/index-new.js')).toBe(
      'offer',
    )
  })
})

/** The page, as far as the store reads it. */
const RUNNING = '/assets/index-old.js'
const HANDS_OFF = 3000

let events: EventTarget
let doc: EventTarget & {
  hidden: boolean
  activeElement: Element | null
  querySelector: () => unknown
}
let reload: Mock<() => void>
let serve: Mock<() => Promise<Response>>
let storage: Map<string, string>

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()

  events = new EventTarget()
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))

  doc = Object.assign(new EventTarget(), {
    hidden: false,
    activeElement: null,
    querySelector: () => ({ getAttribute: () => RUNNING }),
  })
  vi.stubGlobal('document', doc)

  reload = vi.fn()
  vi.stubGlobal('location', { reload })

  serve = vi.fn(() => Promise.resolve(new Response(page('/assets/index-new.js'))))
  vi.stubGlobal('fetch', serve)

  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** The store and the overlay stack, fresh for each test, watching with `settled`. */
async function watching(settled: () => Promise<boolean> = () => Promise.resolve(true)) {
  const { reloading } = await import('./reloading.svelte')
  const { overlays } = await import('./overlays')
  const stop = reloading.watch(settled)
  return { reloading, overlays, stop }
}

/** What Vite's loader raises when a dynamic import in the build fails. */
function failedImport() {
  events.dispatchEvent(new Event('vite:preloadError'))
}

describe('a piece that did not arrive', () => {
  test('under a newer build, reloads once the hands are off', async () => {
    const { reloading } = await watching()

    failedImport()
    await vi.advanceTimersByTimeAsync(HANDS_OFF - 1)
    expect(reload).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(reload).toHaveBeenCalledOnce()
    expect(reloading.offered).toBe(false)
    expect(storage.get('nib:reloaded-for')).toBe('/assets/index-new.js')
  })

  test('asks the site once however many pieces failed', async () => {
    await watching()

    failedImport()
    failedImport()
    failedImport()
    await vi.advanceTimersByTimeAsync(HANDS_OFF)

    expect(serve).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
  })

  test('waits for a key, and for the pause after it', async () => {
    await watching()

    failedImport()
    await vi.advanceTimersByTimeAsync(HANDS_OFF - 500)
    events.dispatchEvent(new Event('keydown'))
    await vi.advanceTimersByTimeAsync(HANDS_OFF - 1)
    expect(reload).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(reload).toHaveBeenCalledOnce()
  })

  test('never goes while a button is held', async () => {
    await watching()

    failedImport()
    events.dispatchEvent(new Event('pointerdown'))
    await vi.advanceTimersByTimeAsync(HANDS_OFF * 5)
    expect(reload).not.toHaveBeenCalled()

    events.dispatchEvent(new Event('pointerup'))
    await vi.advanceTimersByTimeAsync(HANDS_OFF)
    expect(reload).toHaveBeenCalledOnce()
  })

  test('never goes from under something open over the note', async () => {
    const { overlays } = await watching()
    const close = overlays.show(() => undefined)

    failedImport()
    await vi.advanceTimersByTimeAsync(HANDS_OFF * 5)
    expect(reload).not.toHaveBeenCalled()

    close()
    await vi.advanceTimersByTimeAsync(HANDS_OFF)
    expect(reload).toHaveBeenCalledOnce()
  })

  test('never goes from under a field being typed in', async () => {
    await watching()
    const field = { closest: () => null, matches: (selector: string) => selector.includes('input') }
    doc.activeElement = field as unknown as Element

    failedImport()
    await vi.advanceTimersByTimeAsync(HANDS_OFF * 5)
    expect(reload).not.toHaveBeenCalled()

    doc.activeElement = null
    await vi.advanceTimersByTimeAsync(HANDS_OFF)
    expect(reload).toHaveBeenCalledOnce()
  })

  test('never goes while something holds the page', async () => {
    const { reloading } = await watching()
    let recording = true
    reloading.holds(() => recording)

    failedImport()
    await vi.advanceTimersByTimeAsync(HANDS_OFF * 5)
    expect(reload).not.toHaveBeenCalled()

    recording = false
    await vi.advanceTimersByTimeAsync(HANDS_OFF)
    expect(reload).toHaveBeenCalledOnce()
  })

  test('goes at once when the page is out of sight', async () => {
    await watching()
    doc.hidden = true

    failedImport()
    await vi.advanceTimersByTimeAsync(0)

    expect(reload).toHaveBeenCalledOnce()
  })

  test('waits for what is owed to the disk', async () => {
    const owed = [false, true]
    const settled = vi.fn(() => Promise.resolve(owed.shift() ?? true))
    await watching(settled)

    failedImport()
    await vi.advanceTimersByTimeAsync(HANDS_OFF)
    expect(reload).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(HANDS_OFF)
    expect(settled).toHaveBeenCalledTimes(2)
    expect(reload).toHaveBeenCalledOnce()
  })

  test('under the same build, offers Reload and never reloads by itself', async () => {
    serve.mockImplementation(() => Promise.resolve(new Response(page(RUNNING))))
    const { reloading } = await watching()

    failedImport()
    await vi.advanceTimersByTimeAsync(HANDS_OFF * 5)

    expect(reloading.offered).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  test('under a build a reload already went for, offers rather than reloading again', async () => {
    storage.set('nib:reloaded-for', '/assets/index-new.js')
    const { reloading } = await watching()

    failedImport()
    await vi.advanceTimersByTimeAsync(HANDS_OFF * 5)

    expect(reloading.offered).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  test('with the site out of reach, offers nothing and asks again when the network is back', async () => {
    serve.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
    const { reloading } = await watching()

    failedImport()
    await vi.advanceTimersByTimeAsync(HANDS_OFF * 5)
    expect(reloading.offered).toBe(false)
    expect(reload).not.toHaveBeenCalled()

    events.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(HANDS_OFF)
    expect(serve).toHaveBeenCalledTimes(2)
    expect(reload).toHaveBeenCalledOnce()
  })

  test('offers Reload when what answers did not arrive either', async () => {
    vi.doMock('./reload-when', () => {
      throw new TypeError('Failed to fetch dynamically imported module')
    })
    const { reloading } = await watching()

    failedImport()
    await vi.advanceTimersByTimeAsync(HANDS_OFF)

    expect(reloading.offered).toBe(true)
    expect(serve).not.toHaveBeenCalled()
    vi.doUnmock('./reload-when')
  })

  test('the network coming back asks nothing when nothing went missing', async () => {
    await watching()

    events.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(HANDS_OFF)

    expect(serve).not.toHaveBeenCalled()
  })
})
