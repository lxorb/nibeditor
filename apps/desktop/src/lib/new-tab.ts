/** Whether a press asked for a tab of its own, and whether to go there: Chrome's rule,
 *  kept the same on every surface that opens something. Ctrl+click (Cmd on a Mac) and
 *  the middle button open a tab behind, beside this one; with Shift, in front. Shift
 *  alone does too where it means nothing else, since a nib window is a second
 *  workspace rather than one page. A plain click is the surface's own. See
 *  docs/web-tabs.md, "A link in a tab of its own". */

import { linkModifier } from '@nib/editor'

/** A `MouseEvent` or a `KeyboardEvent`; a key has no button, and is the main one. */
export interface Press {
  button?: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** Nothing beyond the surface's own click, a tab left behind, or a tab to go to. */
export type TabAsk = 'plain' | 'behind' | 'front'

/** The middle button, in the DOM's numbering. */
const MIDDLE = 1

export function tabAsk(press: Press, shiftOpens = false): TabAsk {
  if (press.button === MIDDLE || linkModifier(press)) return press.shiftKey ? 'front' : 'behind'
  return shiftOpens && press.shiftKey ? 'front' : 'plain'
}

/** How a listing opens a file, as `openEntry` takes it. */
export interface OpenHow {
  activate?: boolean
  preview?: boolean
  /** In the strip right after the tab it was opened from, as a browser puts a tab a
   *  link opened, rather than at the end. */
  beside?: boolean
}

/** What an ask makes of the surface's own plain open. A tab asked for is never the
 *  preview. */
export function howFor(ask: TabAsk, plain: OpenHow = {}): OpenHow {
  if (ask === 'plain') return plain
  return ask === 'behind' ? { activate: false, beside: true } : { beside: true }
}

/** Where along a strip a tab opened beside `opener` goes: after it, and after the tab
 *  last opened from it, so a run lands in the order pressed. Null is the end. */
export function besideAt(
  strip: readonly { id: string }[],
  opener: string,
  previous: string | null,
): number | null {
  const from = strip.findIndex((one) => one.id === opener)
  if (from < 0) return null

  const last = previous === null ? -1 : strip.findIndex((one) => one.id === previous)
  return Math.max(from, last) + 1
}

/** The middle button on a row that opens: the open on its `auxclick`, and nothing of
 *  the platform's own on the press, where Windows scrolls and X11 pastes. */
export function middleOpens(node: HTMLElement, open: (event: MouseEvent) => void) {
  let current = open

  const down = (event: MouseEvent) => {
    if (event.button === MIDDLE) event.preventDefault()
  }
  const up = (event: MouseEvent) => {
    if (event.button !== MIDDLE) return
    event.preventDefault()
    current(event)
  }

  node.addEventListener('mousedown', down)
  node.addEventListener('auxclick', up)

  return {
    update(next: (event: MouseEvent) => void) {
      current = next
    },
    destroy() {
      node.removeEventListener('mousedown', down)
      node.removeEventListener('auxclick', up)
    },
  }
}
