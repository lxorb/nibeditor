/** Whether this window is maximised, as it actually is.
 *
 *  The button in the corner used to answer from its own clicks, and a window has
 *  more ways of being maximised or restored than that one: dragged off the top of
 *  the screen, double clicked on its bar, snapped with Win and an arrow key, or
 *  put back by the window manager itself. So the window is asked, and asked again
 *  every time it changes size. */

/** As much of a window as this needs. The Tauri window is one; so is the object a
 *  test hands over. */
export interface Resizable {
  isMaximized(): Promise<boolean>
  isFullscreen(): Promise<boolean>
  toggleMaximize(): Promise<void>
  onResized(handler: () => void): Promise<() => void>
}

export class WindowState {
  /** True while the window fills the screen. False until the window has been
   *  asked, which is the right answer for a window that has just opened. */
  maximized = $state(false)

  /** True while the window is in full screen, where a Mac takes its traffic lights
   *  away and the bar has no room to keep for them. */
  fullscreen = $state(false)

  /** Follows a window until the teardown is called. `open` is asked for the
   *  window rather than handed one, because getting at it means loading Tauri's
   *  own module and that is a promise.
   *
   *  Answers the teardown, so the effect that calls this can hand it straight
   *  back to Svelte. */
  follow(open: () => Promise<Resizable>): () => void {
    const watching = { alive: true, stop: null as (() => void) | null }

    void open().then(async (window) => {
      const read = () => void this.read(window, watching)
      const stop = await window.onResized(read)

      // The teardown may have run while the listener was being set up, in which
      // case the listener is taken off again rather than kept.
      if (watching.alive) {
        watching.stop = stop
        read()
      } else stop()
    })

    return () => {
      watching.alive = false
      watching.stop?.()
      watching.stop = null
    }
  }

  /** Maximises or restores, and then asks what actually happened: a window
   *  manager is allowed to refuse, and a button that lies about the state is
   *  worse than one that took a moment to tell the truth. */
  async toggle(window: Resizable) {
    await window.toggleMaximize()
    this.maximized = await window.isMaximized()
  }

  private async read(window: Resizable, watching: { alive: boolean }) {
    const [on, full] = await Promise.all([window.isMaximized(), window.isFullscreen()])
    if (!watching.alive) return

    this.maximized = on
    this.fullscreen = full
  }
}
