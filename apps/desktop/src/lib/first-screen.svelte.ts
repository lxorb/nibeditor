/** The note a window was left on, drawn as it was left before its editor exists.
 *
 *  A launch puts the file list on screen first and reads the notes after it; the
 *  editor of the note in front is built last, one task that on a slow machine is a
 *  third of a second of an empty page after the list. So the lines that were on
 *  screen are kept, as the editor's own markup, whenever the reader stops for a
 *  moment (first-screen/keep.ts), and the next launch draws them in the first frame,
 *  where the editor will be, with the editor's classes and its own styles: the same
 *  fonts, the same wrapping, the same place in the note. The editor is built under
 *  them and they go once it has drawn itself, which looks like nothing at all. VS
 *  Code paints its parts from the last session before the workbench exists; this is
 *  the same idea one step further, down to the words.
 *
 *  Only when what was kept is provably what the editor will show: the same build
 *  (whose classes the markup wears), the note in front of a lone pane, the same words
 *  (a hash of the note as the editor held it, against the draft the session kept, the
 *  words the crate read ahead - see workspace/ahead.ts - or the note read there and
 *  then where nothing was read ahead), a panes area the same size, and
 *  the same computed type once it is laid out. Anything else draws nothing, which is
 *  what a launch drew before. It takes no input it would lose: a press is where the
 *  caret goes and a key typed is written there, once the editor is up. */

import type { EditorView } from '@nib/editor'
import { samePath } from './space-paths'
import { isNumber, isRecord, isString, stored } from './stored'
import { mark } from './trace'
import type { Draft, Session } from './workspace/session'

/** Where it is kept. */
export const KEY = 'nib:first-screen'

/** How long the drawing may stand in for an editor that has not come. */
const PATIENCE = 8000

/** One element on the way from the editor's surface to its lines: what it is and
 *  what it wore. */
export interface Level {
  tag: string
  className: string
  style: string
}

/** The computed type of the lines, which is what the editor would lay them out in. */
export type Look = Record<string, string>

/** What was kept of one note's first screen. */
export interface Kept {
  /** The build that drew it, whose hashed classes the markup wears. */
  build: string
  /** The note's file, or null for a tab with no file yet, whose words the session
   *  keeps itself; see docs/chrome-tabs.md, A tab with no file. */
  path: string | null
  /** The words as the editor held them, hashed with their length; see `wordsHash`. */
  words: string
  /** The panes area it was drawn in, and the surface's box inside it. */
  area: { width: number; height: number }
  box: { left: number; top: number; width: number; height: number }
  /** The surface, the editor, its scroller and its content, outermost first. */
  levels: Level[]
  /** How far the content's top is below the scroller's, negative once scrolled, and
   *  how far below the content's top the first kept line starts. */
  shift: number
  inset: number
  /** The line at the top of the scroller, as a place in the note, and how far its top
   *  was below the scroller's: what the editor that takes over is lined up by. */
  anchor: number
  at: number
  /** The lines, as inert markup; see first-screen/keep.ts. */
  lines: string
  /** The editor's own rules, with its class names renamed so they cannot touch a
   *  live editor's; see `RENAMED`. */
  css: string
  look: Look
}

/** The first letter of every class CodeMirror names itself (style-mod's `ͼ`), and
 *  the letter the kept markup and rules wear instead. A live editor's classes are
 *  counted afresh in every session, so the same name may mean something else in the
 *  next; renamed, the drawing is dressed by the rules it was kept with and by nothing
 *  a live editor mounts. */
export const NAMED = String.fromCharCode(0x37c)
export const RENAMED = String.fromCharCode(0x37d)

/** The words, as a short stamp: their length and a 32-bit FNV-1a over them, with
 *  line endings as the editor holds them. Two notes that differ and stamp the same
 *  would draw the one for the other for a moment; at these odds nobody will see it. */
export function wordsHash(text: string): string {
  const words = text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
  let hash = 0x811c9dc5
  for (let at = 0; at < words.length; at++) {
    hash ^= words.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${String(words.length)}:${(hash >>> 0).toString(36)}`
}

const box = (value: unknown): value is Kept['box'] =>
  isRecord(value) &&
  isNumber(value.left) &&
  isNumber(value.top) &&
  isNumber(value.width) &&
  isNumber(value.height)

const level = (value: unknown): value is Level =>
  isRecord(value) && isString(value.tag) && isString(value.className) && isString(value.style)

/** What was kept, checked into its shape, or null. */
export function keptOf(value: unknown): Kept | null {
  if (!isRecord(value)) return null
  const { build, path, words, area, levels, shift, inset, anchor, at, lines, css, look } = value
  if (
    !isString(build) ||
    (path !== null && !isString(path)) ||
    !isString(words) ||
    !isRecord(area) ||
    !isNumber(area.width) ||
    !isNumber(area.height) ||
    !box(value.box) ||
    !Array.isArray(levels) ||
    levels.length !== 4 ||
    !levels.every(level) ||
    !isNumber(shift) ||
    !isNumber(inset) ||
    !isNumber(anchor) ||
    !isNumber(at) ||
    !isString(lines) ||
    !isString(css) ||
    !isRecord(look)
  ) {
    return null
  }

  return {
    build,
    path,
    words,
    area: { width: area.width, height: area.height },
    box: value.box,
    levels,
    shift,
    inset,
    anchor,
    at,
    lines,
    css,
    look: Object.fromEntries(Object.entries(look).filter(([, one]) => isString(one))) as Look,
  }
}

/** Whether two notes are one: the same file, or both a tab with no file yet, whose
 *  words are what tells them apart (see `arm`). */
export function sameNote(one: string | null, other: string | null): boolean {
  return one === null || other === null ? one === other : samePath(one, other)
}

/** The note in front of the sitting, where it is a note in the only pane: a split or
 *  a stack is laid out after the first frame, and a drawing of one pane of it would
 *  stand where that pane is not yet. Read off the sitting's own `Draft`, the one record
 *  a tab is restored from, a tab with no file included (see docs/chrome-tabs.md). */
export function frontOf(state: Session): Draft | null {
  const front = (() => {
    const frame = state.layout?.frame
    if (!frame) return state.tabs?.[state.active ?? 0] ?? null
    if (frame.kind !== 'pane' || frame.pane.stacked === true) return null
    return frame.pane.tabs[frame.pane.active] ?? frame.pane.tabs[0] ?? null
  })()

  return front?.kind === 'note' && front.reading !== true ? front : null
}

class FirstScreen {
  /** What is drawn, while it is. */
  showing = $state<Kept | null>(null)

  /** Where a press on the drawing asked for the caret, and what was typed onto it,
   *  for the editor to be handed once it is up. Plain: nothing renders from them. */
  pressed: { x: number; y: number } | null = null
  typed = ''

  /** Whether the writing surface has risen yet this session: the drawing rises in the
   *  editor's place, and the editor that takes over from it does not rise again. See
   *  Editor.svelte. */
  private risen = false

  private patience: ReturnType<typeof setTimeout> | undefined

  /** The first surface of the session rises; every other arrives still. */
  rise(): boolean {
    const first = !this.risen
    this.risen = true
    return first
  }

  /** Draws what was kept of the note in front, where it is still that note: called by
   *  the launch between reading the tree and its first frame. `words` is how the
   *  note will read - the draft the session kept, or the words read ahead - and null
   *  where it is not known yet. */
  async arm(state: Session, words: (front: Draft) => Promise<string | null>): Promise<void> {
    const front = frontOf(state)
    if (!front) return

    const kept = keptOf(stored(KEY))
    if (kept?.build !== __EVEN_BUILD__ || !sameNote(kept.path, front.path)) return

    const text = front.dirty ? front.doc : await words(front)
    if (text === null || wordsHash(text) !== kept.words) return

    this.showing = kept
    this.patience = setTimeout(() => this.drop(), PATIENCE)
  }

  /** The editor that takes over, put exactly where the drawing is.
   *
   *  Exactly, because the editor puts a note back by the line that was at the top,
   *  which lands a few pixels from where the reader left it; the drawing is where they
   *  left it, and the editor meeting it there is what makes the handover invisible. */
  lineUp(view: EditorView, kept: Kept): void {
    const scroller = view.scrollDOM.getBoundingClientRect().top
    const line = view.lineBlockAt(Math.min(kept.anchor, view.state.doc.length))
    view.scrollDOM.scrollTop += line.top + view.documentTop - scroller - kept.at
  }

  /** The editor is up, showing the note where the drawing shows it: the press and the
   *  keys go to it, and the drawing goes. */
  handTo(view: EditorView): void {
    const pressed = this.pressed
    if (pressed) {
      const at = view.posAtCoords(pressed)
      if (at !== null) view.dispatch({ selection: { anchor: at } })
    }
    if (this.typed) view.dispatch(view.state.replaceSelection(this.typed))
    if (pressed || this.typed) view.focus()
    mark('first screen handed to the editor')
    this.clear()
  }

  /** Nothing drawn any more, because what was kept is not what the editor will show. */
  drop(): void {
    if (this.showing) mark('first screen dropped')
    this.clear()
  }

  private clear(): void {
    clearTimeout(this.patience)
    this.showing = null
    this.pressed = null
    this.typed = ''
  }
}

export const firstScreen = new FirstScreen()
