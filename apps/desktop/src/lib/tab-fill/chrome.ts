/** The window's chrome going off to its edges as a tab fills the window, and coming back
 *  from them as it stops.
 *
 *  The document itself never moves: it is resized once, in one step, the moment the chrome
 *  has gone or before it arrives. A web page is a native webview placed by the crate and a
 *  terminal a grid of cells a shell is told the size of, and a document animated through
 *  the sizes in between would be one placement of the webview and one `pty_resize` per
 *  frame. So only what goes and comes moves, by transform and opacity, which change the
 *  size of nothing: each part toward the edge it lives on, which is where it is when it
 *  is not there. Going is quick and coming is a beat slower, the durations every layer of
 *  the app moves by.
 *
 *  Each part says which edge is its own with `data-chrome`: the two sides, the window's
 *  bar and a split pane's strip, and the status bar. */

import { dur } from '../motion'

type Edge = 'start' | 'end' | 'top' | 'bottom'

/** Which way each edge is, across and down, for a language that reads left to right. */
const AWAY: Record<Edge, [number, number]> = {
  start: [-1, 0],
  end: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
}

/** How far a part travels toward its edge: a nudge that says where it went, not a
 *  journey the eye has to follow. */
const TRAVEL = 16

function isEdge(value: string | undefined): value is Edge {
  return value !== undefined && value in AWAY
}

/** The one easing curve every part of the app moves on, read from its token. */
function easing(): string {
  const said = getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim()
  return said || 'ease-out'
}

/** Every part of the chrome on the page now, with the edge it belongs to. */
function parts(): [HTMLElement, Edge][] {
  return [...document.querySelectorAll<HTMLElement>('[data-chrome]')].flatMap((one) => {
    const edge = one.dataset.chrome
    return isEdge(edge) ? [[one, edge] as [HTMLElement, Edge]] : []
  })
}

/** The chrome off toward its edges. Answers once it is out of sight - at once where
 *  nothing moves, under reduced motion or with no animation to be had - and leaves each
 *  part held out of sight until the fill takes it off the page. */
export async function chromeGoes(): Promise<void> {
  await Promise.all(parts().map(([one, edge]) => move(one, edge, true)))
}

/** The chrome back from its edges, once it is on the page again. */
export function chromeComes(): void {
  for (const [one, edge] of parts()) void move(one, edge, false)
}

/** The chrome back where it was at once, for a fill that did not happen after all: what
 *  it was held out of sight by is let go of. */
export function chromeStays(): void {
  for (const [one] of parts()) {
    if (typeof one.getAnimations !== 'function') continue
    for (const held of one.getAnimations()) held.cancel()
  }
}

function move(one: HTMLElement, edge: Edge, going: boolean): Promise<unknown> {
  if (typeof one.animate !== 'function') return Promise.resolve()

  const [across, down] = AWAY[edge]
  // Mirrored with the interface under a language that reads the other way, where the
  // start side is on the right; see direction.ts.
  const turned = document.documentElement.dir === 'rtl' ? -1 : 1
  const away = `translate(${across * turned * TRAVEL}px, ${down * TRAVEL}px)`
  const here = { opacity: 1, transform: 'none' }
  const there = { opacity: 0, transform: away }

  return one
    .animate(going ? [here, there] : [there, here], {
      duration: dur(going ? 130 : 210),
      easing: easing(),
      fill: going ? 'forwards' : 'none',
    })
    .finished.catch(() => undefined)
}
