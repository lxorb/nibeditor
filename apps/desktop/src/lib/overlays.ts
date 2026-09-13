/** What Escape closes.
 *
 *  Everything the app puts over the note is one of these: the settings, the
 *  palette, a sheet, the version history, a menu, a dropdown inside another
 *  overlay. Escape closes the one on top, which is the last one opened - and
 *  nothing but the order they were opened in knows which that is, so they are
 *  kept as a stack rather than each asked in turn.
 *
 *  A key that reaches an empty stack was never about an overlay: Escape in the
 *  file list clears the selection and Escape in the editor steps off a picture,
 *  and both still get their turn. */

interface Open {
  close: () => void
}

/** As much of an Escape as this needs: enough to say the press is spent. */
interface Press {
  preventDefault: () => void
  stopImmediatePropagation: () => void
}

class Overlays {
  private readonly stack: Open[] = []

  /** Who wants to hear that the stack changed.
   *
   *  One reader, and a plain callback rather than reactive state, because this file
   *  is not a rune module and the thing that reads it is not drawing anything: a
   *  web tab's page is a native webview, which draws above every pixel of HTML in
   *  the window, so it has to be out of sight while anything of the app's is over
   *  it. Told rather than polled, because an overlay opens and closes without a
   *  press - a palette row opens the next one, Escape closes it - and a page that
   *  waited for a press stayed in front of the menu until somebody clicked
   *  something. See lib/web-tab/WebTab.svelte. */
  private readonly watchers = new Set<() => void>()

  /** Puts an overlay on top, and answers how to take it off again - so the
   *  effect that opened it can hand that straight back to Svelte. */
  show(close: () => void): () => void {
    const entry: Open = { close }
    this.stack.push(entry)
    this.said()

    return () => {
      const at = this.stack.indexOf(entry)
      if (at >= 0) this.stack.splice(at, 1)
      this.said()
    }
  }

  /** Hears about every overlay opening and closing, until it stops listening. */
  watch(tell: () => void): () => void {
    this.watchers.add(tell)
    return () => this.watchers.delete(tell)
  }

  private said() {
    for (const tell of this.watchers) tell()
  }

  /** How many are open. What the tests count. */
  get depth(): number {
    return this.stack.length
  }

  /** Closes the one on top. Answers whether there was one, so Escape can go on
   *  to mean whatever else it means when there was not.
   *
   *  Taken off the stack here rather than left for the closing to take it off,
   *  because closing is a change to some component's state and that reaches this
   *  list a moment later: two presses in the same moment would otherwise both
   *  close the same overlay and leave the one underneath it standing.
   *
   *  Handed the press, it spends it. Other surfaces read Escape off the same
   *  window - the find bar over a note being read, and the one over a PDF, both
   *  of which know only that their own pane has the focus - and one press that
   *  closes the palette and the bar underneath it is one press closing two
   *  things. */
  escape(press?: Press): boolean {
    const top = this.stack.pop()
    if (!top) return false

    this.said()
    press?.preventDefault()
    press?.stopImmediatePropagation()
    top.close()
    return true
  }
}

export const overlays = new Overlays()
