import { describe, expect, test } from 'vitest'
import { type Resizable, WindowState } from './window-state.svelte'

/** A window under our own hand: it can be maximised and restored, and it tells
 *  whoever is listening whenever its size changes - which is how a real one
 *  behaves whether the change came from a button, a drag or a keyboard. */
class FakeWindow implements Resizable {
  maximized = false
  fullscreen = false
  /** How many listeners are on it, so a teardown can be checked. */
  listeners = 0
  /** How often it has been asked, so nothing is asking on every frame. */
  asked = 0

  private readonly told = new Set<() => void>()
  /** Set to refuse the toggle, the way a window manager may. */
  stubborn = false

  isMaximized(): Promise<boolean> {
    this.asked++
    return Promise.resolve(this.maximized)
  }

  isFullscreen(): Promise<boolean> {
    return Promise.resolve(this.fullscreen)
  }

  toggleMaximize(): Promise<void> {
    if (!this.stubborn) this.resize(!this.maximized)
    return Promise.resolve()
  }

  onResized(handler: () => void): Promise<() => void> {
    this.told.add(handler)
    this.listeners++

    return Promise.resolve(() => {
      this.told.delete(handler)
      this.listeners--
    })
  }

  /** What dragging the window, snapping it, or double clicking its bar does. */
  resize(maximized: boolean, fullscreen = this.fullscreen) {
    this.maximized = maximized
    this.fullscreen = fullscreen
    for (const handler of this.told) handler()
  }
}

/** Lets every promise the tracker is waiting on land. */
const settled = () => new Promise((done) => setTimeout(done, 0))

describe('whether the window is maximised', () => {
  test('starts from what the window says, not from a guess', async () => {
    const window = new FakeWindow()
    window.maximized = true
    const state = new WindowState()

    const stop = state.follow(() => Promise.resolve(window))
    await settled()

    expect(state.maximized).toBe(true)
    stop()
  })

  test('follows a window maximised by something other than the button', async () => {
    const window = new FakeWindow()
    const state = new WindowState()
    const stop = state.follow(() => Promise.resolve(window))
    await settled()
    expect(state.maximized).toBe(false)

    // A double click on the bar, or Win and an arrow key.
    window.resize(true)
    await settled()

    expect(state.maximized).toBe(true)
    stop()
  })

  test('follows a maximised window dragged off the top of the screen', async () => {
    const window = new FakeWindow()
    window.maximized = true
    const state = new WindowState()
    const stop = state.follow(() => Promise.resolve(window))
    await settled()

    window.resize(false)
    await settled()

    expect(state.maximized).toBe(false)
    stop()
  })

  test('the button says what happened rather than what it asked for', async () => {
    const window = new FakeWindow()
    const state = new WindowState()
    const stop = state.follow(() => Promise.resolve(window))
    await settled()

    window.stubborn = true
    await state.toggle(window)

    expect(state.maximized).toBe(false)
    stop()
  })

  test('the button and the window agree when the toggle works', async () => {
    const window = new FakeWindow()
    const state = new WindowState()
    const stop = state.follow(() => Promise.resolve(window))
    await settled()

    await state.toggle(window)
    expect(state.maximized).toBe(true)

    await state.toggle(window)
    expect(state.maximized).toBe(false)

    stop()
  })

  test('stops listening when the bar goes', async () => {
    const window = new FakeWindow()
    const state = new WindowState()
    const stop = state.follow(() => Promise.resolve(window))
    await settled()
    expect(window.listeners).toBe(1)

    stop()

    expect(window.listeners).toBe(0)

    // And nothing it says afterwards is written down.
    window.resize(true)
    await settled()
    expect(state.maximized).toBe(false)
  })

  test('a bar that goes before the window arrives leaves no listener behind', async () => {
    const window = new FakeWindow()
    const state = new WindowState()

    const stop = state.follow(() => Promise.resolve(window))
    stop()
    await settled()

    expect(window.listeners).toBe(0)
    expect(state.maximized).toBe(false)
  })

  test('asks the window only when its size changed', async () => {
    const window = new FakeWindow()
    const state = new WindowState()
    const stop = state.follow(() => Promise.resolve(window))
    await settled()

    const before = window.asked
    await settled()
    expect(window.asked).toBe(before)

    window.resize(true)
    await settled()
    expect(window.asked).toBe(before + 1)

    stop()
  })
})

/** A Mac hides its traffic lights in full screen, and the bar stops keeping room
 *  for them; see Titlebar.svelte. */
describe('whether the window is full screen', () => {
  test('follows the window in and out of it', async () => {
    const window = new FakeWindow()
    const state = new WindowState()

    const stop = state.follow(() => Promise.resolve(window))
    await settled()
    expect(state.fullscreen).toBe(false)

    window.resize(false, true)
    await settled()
    expect(state.fullscreen).toBe(true)

    window.resize(false, false)
    await settled()
    expect(state.fullscreen).toBe(false)
    stop()
  })
})
