/** Keeps the first screen of the note in front, for the next launch to draw before its
 *  editor exists; see first-screen.svelte.ts for why and when it is drawn.
 *
 *  Kept whenever the reader stops for a moment - the words, the scroll or the size of
 *  the editor changed and then nothing did for a second and a half - in an idle
 *  moment after that, and at once when the window goes out of sight, which is the
 *  last chance a closing window gives. Only the lines on screen, as the editor drew
 *  them, and only as inert markup: nothing in it runs, nothing in it fetches anything
 *  but the pictures the app serves itself, and anything that would - a frame, a
 *  video, a picture from the web - is a box of its own size, so the lines around it
 *  are laid out where they were.
 *
 *  Fetched at the launch's last turn, like the other doors; never in the glasses'
 *  plugin, which has no room in its package for a note it draws on a pair of glasses. */

import { documentOf, type EditorView } from '@nib/editor'
import {
  KEY,
  type Kept,
  type Level,
  type Look,
  NAMED,
  RENAMED,
  wordsHash,
} from '../first-screen.svelte'
import { keep } from '../stored'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'

/** How long nothing has to change before the screen is kept. */
const QUIET = 1500

/** Past this many characters a note is not hashed on a pause. */
const LONGEST = 2_000_000

/** What the drawing is checked against once it is laid out, besides where its content
 *  starts: the type, the padding and the width the lines wrap in. */
const LOOKED_AT = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'tab-size',
  'padding-left',
  'padding-right',
  'padding-top',
  'width',
]

/** Elements with nothing to draw, or with something that runs. */
const DROPPED = new Set(['script', 'style', 'link', 'meta', 'base', 'noscript', 'template'])

/** Elements that fetch or play what they show: a box of their size instead. */
const BOXED = new Set(['iframe', 'frame', 'object', 'embed', 'video', 'audio', 'canvas'])

/** Addresses the app serves itself, which is all a kept picture may point at. */
const OWN = /^(?:asset:|https?:\/\/asset\.localhost\/|data:image\/)/i

/** Attributes that act, fetch or take input. */
const ACTING = /^(?:on|contenteditable$|tabindex$|autofocus$|srcdoc$|action$|formaction$|ping$)/i

/** An element as inert markup: what `inert` makes of the one kept, beside the live one
 *  it was cloned from, which is what the boxes are measured on. */
function inert(live: Element): string {
  const clone = live.cloneNode(true) as Element
  const lives = [live, ...live.querySelectorAll('*')]
  const clones = [clone, ...clone.querySelectorAll('*')]

  clones.forEach((one, at) => {
    const tag = one.localName
    if (DROPPED.has(tag)) {
      one.remove()
      return
    }

    // Measured only where a box has to keep a place: every element of a screenful is
    // hundreds, and each measure is a question to the layout.
    const rect = () => lives[at]?.getBoundingClientRect()
    if (BOXED.has(tag)) {
      const box = one.ownerDocument.createElement('div')
      box.setAttribute('style', sized(one.getAttribute('style'), rect()))
      one.replaceWith(box)
      return
    }

    let taken = false
    for (const { name, value } of [...one.attributes]) {
      if (ACTING.test(name)) one.removeAttribute(name)
      else if (ADDRESSES.test(name) && !allowed(tag, name.toLowerCase(), value.trim())) {
        one.removeAttribute(name)
        taken ||= name.toLowerCase() === 'src'
      } else if (name === 'style') one.setAttribute('style', value.replace(/url\([^)]*\)/gi, own))
    }

    // A picture whose address was taken keeps its place all the same.
    if (taken) one.setAttribute('style', sized(one.getAttribute('style'), rect()))
  })

  return clone.outerHTML
}

/** Attributes that hold an address. */
const ADDRESSES = /^(?:src|srcset|poster|href|xlink:href)$/i

/** An address an element may keep: a picture the app serves, or a reference to a part
 *  of the same drawing. A link keeps none, so nothing in the drawing goes anywhere, and
 *  a set of sources none either, since any one of them could be somebody else's. */
function allowed(tag: string, name: string, value: string): boolean {
  if (tag === 'a' || name === 'srcset' || name === 'poster') return false
  if (name === 'href' || name === 'xlink:href') {
    return tag === 'use' ? value.startsWith('#') : tag === 'image' && OWN.test(value)
  }
  return OWN.test(value)
}

/** A `url()` in a style, kept only where it is one the app serves. */
function own(whole: string): string {
  const inside = whole
    .slice(4, -1)
    .trim()
    .replace(/^['"]|['"]$/g, '')
  return OWN.test(inside) ? whole : 'none'
}

function sized(style: string | null, rect: DOMRect | undefined): string {
  const size = rect ? `width:${String(rect.width)}px;height:${String(rect.height)}px;` : ''
  return `${style ?? ''};display:inline-block;${size}`
}

/** One element on the way down, without the states a kept drawing must not wear: the
 *  keyboard's, and the entrance the first surface of a session plays. */
function levelOf(element: Element): Level {
  const className = [...element.classList]
    .filter((one) => one !== 'cm-focused' && one !== 'rise')
    .join(' ')
  return {
    tag: element.localName,
    className: className.replaceAll(NAMED, RENAMED),
    style: element.getAttribute('style') ?? '',
  }
}

/** The rules CodeMirror mounted, which are what its class names mean in this session. */
function editorRules(): string {
  const sheets = [
    ...document.adoptedStyleSheets,
    ...[...document.querySelectorAll('style')].flatMap((one) => (one.sheet ? [one.sheet] : [])),
  ]

  const out: string[] = []
  for (const sheet of sheets) {
    const rules = [...sheet.cssRules].map((rule) => rule.cssText)
    if (rules.some((rule) => rule.includes(NAMED))) out.push(...rules)
  }
  return out.join('\n').replaceAll(NAMED, RENAMED)
}

/** The first screen of the note `view` shows, or null where it is not one to keep:
 *  another tab in front, a window of several panes or a stack (whose drawing the next
 *  launch would not draw; see `frontOf`), a note too long to hash on a pause, or an
 *  editor with a gutter, which the drawing does not carry. */
function screenOf(view: EditorView): Kept | null {
  const tab = workspace.active
  const frame = workspace.panes.frame
  if (tab?.kind !== 'note' || tab.reading) return null
  if (frame.kind !== 'pane' || frame.stacked) return null
  if (documentOf(view) !== tab.note.live || view.state.doc.length > LONGEST) return null

  const surface = view.dom.parentElement
  const area = view.dom.closest('.panes')
  if (!surface || !area || view.scrollDOM.querySelector('.cm-gutters')) return null

  const within = area.getBoundingClientRect()
  const outer = surface.getBoundingClientRect()
  const scroller = view.scrollDOM.getBoundingClientRect()
  const content = view.contentDOM.getBoundingClientRect()
  const style = getComputedStyle(view.contentDOM)

  const lines = [...view.contentDOM.children].filter((one) => {
    const rect = one.getBoundingClientRect()
    return rect.bottom > scroller.top && rect.top < scroller.bottom
  })
  const first = lines[0]
  if (!first) return null

  const top = first.getBoundingClientRect().top - parseFloat(getComputedStyle(first).marginTop)
  // The line the scroller's top edge falls in, which the editor that takes over is lined
  // up by; see `lineUp`.
  const atTop = view.lineBlockAtHeight(scroller.top - view.documentTop)
  const look: Look = Object.fromEntries(
    LOOKED_AT.map((name) => [name, style.getPropertyValue(name)]),
  )
  look.left = `${String(Math.round(content.left - outer.left))}px`

  return {
    build: __EVEN_BUILD__,
    path: tab.path,
    words: wordsHash(view.state.doc.toString()),
    area: { width: area.clientWidth, height: area.clientHeight },
    box: {
      left: outer.left - within.left,
      top: outer.top - within.top,
      width: outer.width,
      height: outer.height,
    },
    levels: [surface, view.dom, view.scrollDOM, view.contentDOM].map(levelOf),
    shift: content.top - scroller.top,
    inset: top - content.top - (parseFloat(style.paddingTop) || 0),
    anchor: atTop.from,
    at: atTop.top + view.documentTop - scroller.top,
    lines: lines.map(inert).join('').replaceAll(NAMED, RENAMED),
    css: editorRules(),
    look,
  }
}

/** What was written last, so a screen unchanged since is not written again. */
let written = ''

function keepScreen(view: EditorView): void {
  const screen = screenOf(view)
  if (!screen) return

  const said = JSON.stringify(screen)
  if (said !== written && keep(KEY, said)) written = said
}

/** The editor in front, followed: every change to its words, its scroll or its size
 *  starts the pause again. */
function follow(view: EditorView): () => void {
  let waiting: ReturnType<typeof setTimeout> | undefined
  let idle = 0

  const later = () => {
    clearTimeout(waiting)
    cancelIdleCallback(idle)
    waiting = setTimeout(() => {
      idle = requestIdleCallback(() => keepScreen(view), { timeout: QUIET })
    }, QUIET)
  }

  const changed = new MutationObserver(later)
  changed.observe(view.contentDOM, { childList: true, subtree: true, characterData: true })
  const resized = new ResizeObserver(later)
  resized.observe(view.scrollDOM)
  view.scrollDOM.addEventListener('scroll', later, { passive: true })

  // And the last word before the window goes, which may be the only one a sitting
  // that closed straight after a keystroke gets.
  const hidden = () => {
    if (document.visibilityState === 'hidden') keepScreen(view)
  }
  const leaving = () => keepScreen(view)
  document.addEventListener('visibilitychange', hidden)
  addEventListener('pagehide', leaving)

  later()
  return () => {
    clearTimeout(waiting)
    cancelIdleCallback(idle)
    changed.disconnect()
    resized.disconnect()
    view.scrollDOM.removeEventListener('scroll', later)
    document.removeEventListener('visibilitychange', hidden)
    removeEventListener('pagehide', leaving)
  }
}

/** Starts keeping, for as long as the window is open. */
export function keepFirstScreens(): void {
  $effect.root(() => {
    $effect(() => {
      const view = views.of(workspace.panes.focusedId)
      if (!view || workspace.active?.kind !== 'note') return
      return follow(view)
    })
  })
}
