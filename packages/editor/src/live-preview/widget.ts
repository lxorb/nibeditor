import { WidgetType } from '@codemirror/view'

/** The base every widget Orden renders extends, for the one thing they all owe
 *  the editor: giving back what they took.
 *
 *  Orden's widgets are not passive markup. A run panel counts up in an interval,
 *  a fence header listens on the editor's own content element so it can tell
 *  which block the pointer is over, a table keeps a live view object, an image
 *  holds a resize observer. CodeMirror announces the end of a widget exactly
 *  once, through `destroy`, and a widget that misses it leaves its timer or its
 *  listener behind. Nothing breaks at once; the session simply gets slower the
 *  longer it stays open, which is the hardest kind of fault to trace back.
 *
 *  So teardown lives here rather than in each widget. `onDestroy` records what
 *  to undo, keyed by the element it belongs to - the element and not the widget
 *  because one widget instance can be drawn more than once, and because the
 *  element is what CodeMirror hands back. A subclass that needs its own
 *  `destroy` may still write one; it only has to call `super.destroy(dom)`.
 *
 *  What this class deliberately does *not* do is guard against DOM mutations
 *  inside a widget being read as document edits. That guard used to live here,
 *  as an `ignoreMutation` that CodeMirror 6 never calls: it is a CodeMirror 5
 *  hook, and the version in use ignores mutations under a widget tile itself,
 *  in its DOM observer, and marks the element `contenteditable="false"` on the
 *  way in. The method was dead, so it is gone rather than left to reassure.
 *
 *  Extending this rather than `WidgetType` directly is enforced by a test, so a
 *  widget added later cannot quietly go back to leaking. */
export abstract class NibWidget extends WidgetType {
  override destroy(dom: HTMLElement) {
    const undo = TEARDOWN.get(dom)
    TEARDOWN.delete(dom)
    for (const one of undo ?? []) one()
    super.destroy(dom)
  }

  /** Records something to undo when `dom` leaves the editor. Called from
   *  `toDOM` or `updateDOM`, as many times as the widget has things to give
   *  back; they run in the order they were added. */
  protected onDestroy(dom: HTMLElement, undo: () => void) {
    const existing = TEARDOWN.get(dom)
    if (existing) existing.push(undo)
    else TEARDOWN.set(dom, [undo])
  }
}

/** What each drawn widget has to give back, keyed by its element. Weak so a
 *  widget whose DOM was dropped without a `destroy` - which CodeMirror does not
 *  do, but a detached view can - still lets go of the closure. */
const TEARDOWN = new WeakMap<HTMLElement, (() => void)[]>()
