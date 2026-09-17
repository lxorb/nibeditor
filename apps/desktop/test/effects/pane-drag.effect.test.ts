/** The end of a drag over the panes, and what it costs when it never comes.
 *
 *  This needs a window, which is why it is here rather than beside `panes.svelte.ts`:
 *  the whole point is that the end is listened for on the window rather than left to
 *  the element that began the drag.
 *
 *  What is being held is not really about dragging. `Pane.svelte` draws its five drop
 *  zones only `{#if workspace.panes.dragging}`, and `.zone.whole` is `inset: 0` with
 *  `pointer-events: auto` over the whole pane. So a drag flag left standing puts an
 *  invisible sheet over every note, and every wheel goes into it. Emil found it by
 *  the only symptom it has: *"note scrollbar, mouse scrolling does nothing, but when
 *  I move the cursor to the bottom it scrolls"* - the caret still moves the note,
 *  because that is the app scrolling rather than the reader. */

import { beforeEach, describe, expect, test } from 'vitest'
import { Panes } from '../../src/lib/workspace/panes.svelte'

describe('a drag over the panes', () => {
  let panes: Panes

  beforeEach(() => {
    panes = new Panes(() => undefined)
  })

  test('lights the zones while it is under way', () => {
    panes.dragged({ tabId: 't1' })
    expect(panes.dragging).toEqual({ tabId: 't1' })
  })

  test('is over when the drag ends', () => {
    panes.dragged({ tabId: 't1' })
    window.dispatchEvent(new Event('dragend'))
    expect(panes.dragging).toBeNull()
  })

  /** The one that was failing. A tab dropped on another pane's strip moves, so the
   *  row it was dragged from is torn down, and `dragend` never fires on a node that
   *  is gone. The drop does fire, on the window, and that is what ends it. */
  test('is over on a drop, even though the row it began on has gone', () => {
    panes.dragged({ tabId: 't1' })
    window.dispatchEvent(new Event('drop'))
    expect(panes.dragging).toBeNull()
  })

  test('and takes the landing with it, so no zone is left lit', () => {
    panes.dragged({ tabId: 't1' })
    panes.landing = { kind: 'pane', paneId: 'p1', zone: 'middle' }
    window.dispatchEvent(new Event('drop'))
    expect(panes.landing).toBeNull()
  })

  /** A second drag must not be ended by the first one's listeners, and the first
   *  one's must not be left on the window waiting for an event that will now end
   *  somebody else's drag. */
  test('is not ended by the drag before it', () => {
    panes.dragged({ tabId: 'first' })
    panes.dragged({ tabId: 'second' })
    expect(panes.dragging).toEqual({ tabId: 'second' })

    window.dispatchEvent(new Event('dragend'))
    expect(panes.dragging).toBeNull()

    // The first drag's listeners are gone, so this ends nothing that is not there.
    panes.dragged({ tabId: 'third' })
    expect(panes.dragging).toEqual({ tabId: 'third' })
  })

  test('can be ended by hand, and ending one that is over is harmless', () => {
    panes.dragged({ tabId: 't1' })
    panes.dropped()
    expect(panes.dragging).toBeNull()

    panes.dropped()
    expect(panes.dragging).toBeNull()
  })
})
