import { StateEffect, StateField } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'

/** Said by the watcher below when the button goes down and when it comes up.
 *  Exported so a test can drive a drag without a pointer or a DOM. */
export const setDragging = StateEffect.define<boolean>()

/** True while a selection is being dragged out with the mouse.
 *
 *  Revealing syntax as the selection moves would reflow the line under the
 *  pointer mid-drag: `**bold**` growing by four characters shifts everything
 *  after it, and the selection ends somewhere nobody pointed at. So the reveal
 *  state holds still until the button comes back up.
 *
 *  A whole block is worse than a line. A rendered table, diagram or display
 *  equation is not the height of the markdown behind it, so swapping the two
 *  moves the text under the pointer by rows rather than by characters: the next
 *  pointer event reads a position on the other side of the block's edge, the
 *  reveal changes its mind, the text moves back, and the two go round as fast as
 *  the events arrive. That is the flicker a selection dragged into a table used
 *  to set off, so the block field holds still on this as well as the inline
 *  decorations - see blocks.ts and decorate.ts. */
export const dragging = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDragging)) return effect.value
    }
    return value
  },
})

/** Whether a press is one that draws a selection by dragging: the main button of a
 *  mouse. A finger or a pen draws one with the platform's own handles, and the
 *  mousedown WebKit sends after a tap is no drag at all - answering it with a
 *  transaction wrote the editor's old selection back over the caret the tap had
 *  just put down, so the first tap into a note on an iPhone landed at the top of
 *  it, and whatever was typed next went into the first line. */
export function dragsSelection(button: number, pointer: string): boolean {
  return button === 0 && pointer === 'mouse'
}

/** Watches the mouse. The release is listened for on the window, because a
 *  drag very often ends past the edge of the editor - and because CodeMirror
 *  listens on the document. On mouseup it reads the pointer position one last
 *  time and moves the caret there, so the reveal has to wait until that read is
 *  done: revealing first reflows the line and the final read lands the caret a
 *  character or two from where the click was. Window listeners run after
 *  document listeners, whatever order they were added in. */
const watcher = ViewPlugin.fromClass(
  class {
    private readonly release: () => void
    /** What the last press was made with, which the mousedown after it does not say. */
    pointer = 'mouse'

    constructor(private readonly view: EditorView) {
      this.release = () => this.end()
      window.addEventListener('mouseup', this.release)
      // A drag interrupted by the window losing focus never gets a mouseup.
      window.addEventListener('blur', this.release)
      // Neither does a selection or an image carried off as a drag and drop:
      // the browser stops sending mouse events once the drag begins, and
      // says so with dragend instead.
      window.addEventListener('dragend', this.release)
    }

    destroy() {
      window.removeEventListener('mouseup', this.release)
      window.removeEventListener('blur', this.release)
      window.removeEventListener('dragend', this.release)
    }

    private end() {
      if (this.view.state.field(dragging, false)) {
        this.view.dispatch({ effects: setDragging.of(false) })
      }
    }
  },
  {
    eventHandlers: {
      pointerdown(event: PointerEvent) {
        this.pointer = event.pointerType || 'mouse'
        return false
      },
      mousedown(event: MouseEvent, view: EditorView) {
        // Only the button that draws a selection, and only a mouse's; see above.
        if (!dragsSelection(event.button, this.pointer)) return false
        view.dispatch({ effects: setDragging.of(true) })
        return false
      },
    },
  },
)

export const dragFreeze = [dragging, watcher]
