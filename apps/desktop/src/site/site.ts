/** What a published page does in a browser.
 *
 *  Four small things, and the reason they are one file is that a page should
 *  fetch one script or none: the slash that focuses the search box, the theme
 *  toggle, the card a link shows on hover, and the graph.
 *
 *  Every one of them is an addition to a page that already works without it. The
 *  search box is a form, the theme follows the reader's system, a link is a link
 *  and the graph page carries the same list of pages as words above the canvas.
 *  A reader with scripting off loses the niceties and nothing else, which is the
 *  rule a published note is held to; see docs/publishing.md.
 *
 *  It is bundled into the Worker by scripts/site-js.ts and served from the site's
 *  own domain at a path that is its own hash - never from a CDN, for the reason
 *  the KaTeX faces are not either. The graph is the app's own layout and painter,
 *  imported rather than reimplemented: one graph in nib, drawn by one piece of
 *  code, on a canvas in the app and on a canvas on the page. */

import { framing, nodeAt } from '../lib/camera'
import { type NoteGraph, neighbours } from '../lib/graph'
import { Layout } from '../lib/graph-layout'
import { paint, radiusOf } from '../lib/graph-paint'

/** Where the reader's choice of theme is kept. Per site, because it is a
 *  decision about this site rather than about the browser. */
const THEME_KEY = 'nib:site-theme'

/** How long a hover waits before it fetches anything, and how long the pointer
 *  has to leave before the card goes. Both are what the app's own preview uses;
 *  see docs/links.md. */
const HOVER_IN = 320
const HOVER_OUT = 180

/** How many pages of previews are kept. A reader who runs down a list of links
 *  fetches each once. */
const MOST_CACHED = 40

function ready(run: () => void) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run)
  else run()
}

/* ── The search box ──────────────────────────────────────────────── */

/** `/` focuses it, the way it does in the app and in every reader on the web.
 *  Not while somebody is typing in something else, and not when a modifier is
 *  held: `Ctrl+/` belongs to the browser. */
function slashFocuses() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return

    const inside = event.target as HTMLElement | null
    if (inside?.closest('input, textarea, select, [contenteditable]')) return

    const box = document.querySelector<HTMLInputElement>('.find input[name="q"]')
    if (!box) return

    event.preventDefault()
    box.focus()
    box.select()
  })
}

/* ── Light or dark ───────────────────────────────────────────────── */

/** The reader's own choice, remembered for this site and applied before the
 *  first paint by the tiny script in the page's head; this is only the button.
 *
 *  Three states rather than two, because "what my system says" is a real answer
 *  and the only one that keeps up when the sun goes down. */
function themeToggle() {
  const button = document.querySelector<HTMLButtonElement>('.theme')
  if (!button) return

  const order = ['system', 'light', 'dark'] as const
  const say = (held: string) => {
    button.dataset.theme = held
    button.setAttribute(
      'aria-label',
      held === 'system' ? 'Theme: follow the system' : `Theme: ${held}`,
    )
  }

  let held = (() => {
    try {
      return localStorage.getItem(THEME_KEY) ?? 'system'
    } catch {
      return 'system'
    }
  })()

  say(held)

  button.addEventListener('click', () => {
    held = order[(order.indexOf(held as 'system') + 1) % order.length] ?? 'system'

    if (held === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', held)

    // The one write in the app that does not go through `keep` in stored.ts, and
    // the reason is what this file is: a handful of lines bundled into the Worker
    // and served to a stranger's browser. Importing that module here would pull
    // the app's log into a public page to guard one write of a reader's own theme
    // choice. So the guard is here, and it is the same guard: a browser with
    // storage turned off still switches, it just forgets. See stored.test.ts.
    try {
      if (held === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, held)
    } catch {
      // Nothing to do and nobody to tell.
    }

    say(held)
  })
}

/* ── The card a link shows on hover ──────────────────────────────── */

const held = new Map<string, string>()

async function preview(href: string): Promise<string | null> {
  const kept = held.get(href)
  if (kept !== undefined) return kept

  try {
    const answer = await fetch(href, { headers: { 'x-nib-preview': '1' } })
    if (!answer.ok) return null

    const page = new DOMParser().parseFromString(await answer.text(), 'text/html')
    const write = page.querySelector('#write')
    if (!write) return null

    // The note and nothing around it: no navigation, no byline, no footer, and
    // no picture of the page's own furniture inside a card the size of a
    // paragraph.
    for (const gone of write.querySelectorAll('nav, footer, .back, .present, .find, .toc')) {
      gone.remove()
    }

    const words = write.innerHTML.slice(0, 4000)
    if (held.size >= MOST_CACHED) held.delete([...held.keys()][0] ?? '')
    held.set(href, words)

    return words
  } catch {
    return null
  }
}

function hoverCards() {
  const card = document.createElement('aside')
  card.className = 'card'
  card.hidden = true
  document.body.append(card)

  let going: ReturnType<typeof setTimeout> | undefined
  let leaving: ReturnType<typeof setTimeout> | undefined

  const place = (link: HTMLAnchorElement) => {
    const box = link.getBoundingClientRect()
    const room = window.innerHeight - box.bottom
    card.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - 380))}px`

    if (room > 260) {
      card.style.top = `${box.bottom + 8}px`
      card.style.bottom = 'auto'
    } else {
      card.style.bottom = `${window.innerHeight - box.top + 8}px`
      card.style.top = 'auto'
    }
  }

  const show = async (link: HTMLAnchorElement) => {
    const words = await preview(link.pathname)
    if (!words) return

    card.innerHTML = words
    card.hidden = false
    place(link)
  }

  const hide = () => {
    clearTimeout(going)
    leaving = setTimeout(() => (card.hidden = true), HOVER_OUT)
  }

  const inside = (target: EventTarget | null): HTMLAnchorElement | null => {
    const link = (target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="/"]')
    // A link to a file, an address of somebody else's, or the page itself: none
    // of those has a note to show.
    if (!link || link.getAttribute('href')?.startsWith('/i/')) return null
    if (link.pathname === location.pathname) return null

    return link
  }

  document.addEventListener('pointerover', (event) => {
    const link = inside(event.target)
    if (!link) return

    clearTimeout(leaving)
    clearTimeout(going)
    going = setTimeout(() => void show(link), HOVER_IN)
  })

  document.addEventListener('pointerout', (event) => {
    if (inside(event.target)) hide()
  })

  // A finger has no hover, so a long press is the gesture. The link still opens
  // on a tap: nothing here cancels it.
  document.addEventListener(
    'contextmenu',
    (event) => {
      const link = inside(event.target)
      if (!link || !window.matchMedia('(hover: none)').matches) return

      event.preventDefault()
      void show(link)
    },
    { passive: false },
  )

  card.addEventListener('pointerenter', () => clearTimeout(leaving))
  card.addEventListener('pointerleave', hide)
  document.addEventListener('scroll', () => (card.hidden = true), { passive: true })
}

/* ── The graph ───────────────────────────────────────────────────── */

/** The app's own layout and painter, on a canvas on the page.
 *
 *  What is here is only the part that is a page rather than an app: reading the
 *  graph the server wrote into the document, sizing the canvas, framing what
 *  came, and following a link when somebody presses a node. The physics, the
 *  radii, the framing and every pixel are the app's, imported - one graph in
 *  nib, drawn by one piece of code.
 *
 *  No dragging, no zoom, no controls. A reader of a blog is being shown how the
 *  pages hang together and then following one; the dials are for somebody
 *  standing in their own vault. */
function graphs() {
  for (const holder of document.querySelectorAll<HTMLElement>('.graph')) {
    const said = holder.querySelector('script[type="application/json"]')?.textContent
    if (!said) continue

    let graph: NoteGraph
    try {
      graph = JSON.parse(said) as NoteGraph
    } catch {
      continue
    }
    if (!graph.nodes.length) continue

    const canvas = document.createElement('canvas')
    holder.append(canvas)

    const context = canvas.getContext('2d')
    if (!context) continue

    const count = graph.nodes.length
    const layout = new Layout(graph)
    const radii = new Float64Array(count)
    for (let one = 0; one < count; one++) radii[one] = radiusOf(graph.nodes[one]?.degree ?? 0)

    const lit = new Uint8Array(count)
    const shown = new Uint8Array(count).fill(1)
    const tint = new Int8Array(count).fill(-1)

    const style = getComputedStyle(holder)
    const token = (name: string) => style.getPropertyValue(name).trim()
    const colours = {
      edge: token('--line-strong') || '#33333b',
      litEdge: token('--accent') || '#6f5ce0',
      node: token('--muted') || '#8a8a94',
      hollow: token('--muted') || '#8a8a94',
      current: token('--accent') || '#6f5ce0',
      label: token('--muted-strong') || '#b6b6c0',
      font: token('--font-ui') || 'sans-serif',
      // The page draws no colour groups: a group is something a reader of the
      // app puts a note in, and a page has nobody to ask.
      groups: [],
    }

    /** Which node is the page being read, from the address the server marked it
     *  with, so the picture says "you are here" the way the app's does. */
    const current = graph.nodes.findIndex((one) => one.path === holder.dataset.here)
    let hovered = -1
    let width = 0
    let height = 0
    let ratio = 1
    let camera = { x: 0, y: 0, scale: 1 }

    const size = () => {
      const box = holder.getBoundingClientRect()
      width = box.width
      height = box.height
      ratio = window.devicePixelRatio || 1

      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const draw = () => {
      context.clearRect(0, 0, width, height)
      paint(context, {
        graph,
        x: layout.x,
        y: layout.y,
        radii,
        camera,
        width,
        height,
        colours,
        current,
        hovered,
        lit,
        shown,
        tint,
        arrows: false,
        // What the card's dials do unasked. A published page is the site's own
        // picture rather than the reader's: there is no card on it, and a stranger
        // arriving at a page is shown what a picture of a space looks like.
        lines: 2,
        fade: 1,
        ratio,
      })
    }

    /** Laid out to a budget and framed, the way the app does it: a few frames of
     *  settling rather than a loop that holds the thread, and the camera then
     *  fits what came. */
    const settle = () => {
      const done = layout.settle(12)
      camera = framing(layout.x, layout.y, count, width, height, 28)
      draw()

      if (!done) requestAnimationFrame(settle)
    }

    size()
    settle()

    window.addEventListener(
      'resize',
      () => {
        size()
        camera = framing(layout.x, layout.y, count, width, height, 28)
        draw()
      },
      { passive: true },
    )

    canvas.addEventListener('pointermove', (event) => {
      const box = canvas.getBoundingClientRect()
      const at = nodeAt(
        layout.x,
        layout.y,
        radii,
        camera,
        width,
        height,
        event.clientX - box.left,
        event.clientY - box.top,
      )

      if (at === hovered) return
      hovered = at

      lit.fill(0)
      if (at >= 0) {
        lit[at] = 2
        for (const near of neighbours(graph, at)) lit[near] ||= 1
      }

      canvas.style.cursor = at >= 0 && graph.nodes[at]?.path ? 'pointer' : 'default'
      draw()
    })

    canvas.addEventListener('pointerleave', () => {
      hovered = -1
      lit.fill(0)
      draw()
    })

    canvas.addEventListener('click', () => {
      const where = hovered >= 0 ? graph.nodes[hovered]?.path : null
      if (where) location.assign(where)
    })
  }
}

ready(() => {
  slashFocuses()
  themeToggle()
  hoverCards()
  graphs()
})
