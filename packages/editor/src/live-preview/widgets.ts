import { calloutIconParts } from '@nib/markdown/callouts'
import { NibWidget } from './widget'
import { EditorView } from '@codemirror/view'
// Aliased: `label` is already a local variable in more than one widget here.
import { iconElement } from '../icon'
import { fenceCodeAt } from '../fence'
import { label as uiLabel } from '../labels'
import { pressedByKey } from '../press'
import { isRunnableLanguage, runFence, runnableFenceAt } from '../run/door'
import { isAiLanguage } from '../ai/block'
import { aiFenceAt, askAiFence, stopAskAt } from '../ai/run'

export class BulletWidget extends NibWidget {
  constructor(private readonly depth: number) {
    super()
  }

  override eq(other: BulletWidget) {
    return other.depth === this.depth
  }

  toDOM() {
    const dot = document.createElement('span')
    dot.className = 'nib-bullet'
    dot.dataset.depth = String(Math.min(this.depth, 2))
    return dot
  }
}

export class CheckboxWidget extends NibWidget {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super()
  }

  override eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from
  }

  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'nib-checkbox'
    box.checked = this.checked
    box.setAttribute('aria-label', uiLabel('taskDone'))

    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
      // Ticking a box writes `[x]` into the note, which is an edit like any
      // other: while the note is only being read, the box says what the
      // document says. The stylesheet takes the hover off it to match.
      if (view.state.readOnly) return
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' },
      })
    })

    return box
  }

  override ignoreEvent() {
    return false
  }
}

export class RuleWidget extends NibWidget {
  override eq() {
    return true
  }

  toDOM() {
    const rule = document.createElement('span')
    rule.className = 'nib-rule'
    return rule
  }
}

/** A callout's icon as elements, or nothing for a callout that carries none. */
function calloutIcon(look: string | null): SVGElement | null {
  const parts = calloutIconParts(look)
  return parts ? iconElement(parts, 'callout-icon') : null
}

/** What stands where a callout's `[!type]-` marker is written.
 *
 *  Only what the note does not already say: the icon, and the type's own name
 *  when the writer gave the callout no title of their own. A title that *is*
 *  written stays where it is - real, editable words on the line - so nothing
 *  here has to be kept in step with what the reader types. */
export class CalloutWidget extends NibWidget {
  constructor(
    private readonly type: string,
    private readonly look: string | null,
    private readonly name: string,
  ) {
    super()
  }

  override eq(other: CalloutWidget) {
    return other.type === this.type && other.look === this.look && other.name === this.name
  }

  toDOM() {
    const label = document.createElement('span')
    label.className = 'nib-callout-label'
    label.dataset.callout = this.type

    const icon = calloutIcon(this.look)
    if (icon) label.append(icon)

    if (this.name) {
      const word = document.createElement('span')
      word.textContent = this.name
      label.append(word)
    }

    return label
  }
}

/** Sits on a code fence's top line: what the block is, what language it is, and
 *  a way to take it.
 *
 *  What it does not hold is the block's code. This is built again for every visible
 *  block on every keystroke, and the code is not drawn here - it is what a press on
 *  copy or on run asks for, which happens a handful of times in the life of a note.
 *  So the widget keeps the block's first line and reads the code from the document
 *  when a press comes. Carrying it meant slicing every visible block's code out of
 *  the document on each keystroke and then comparing all of it, character by
 *  character, against the copy the last keystroke made. */
export class FenceHeaderWidget extends NibWidget {
  constructor(
    private readonly language: string,
    /** What the fence's info string says after the language, or nothing - which
     *  is also what a fence showing its own source says here, since the words
     *  are already on the line and printing them twice would be printing them
     *  over each other. */
    private readonly caption: string,
    /** Where the language name lives in the document, so it can be retyped
     *  without disturbing the caption after it. */
    private readonly infoFrom: number,
    private readonly infoTo: number,
    /** Where the block's own first line begins, which is the place the code and a
     *  run are found by. */
    private readonly blockFrom: number,
    /** Whether this block is an `ai` fence waiting on an answer, so its glyph
     *  offers a stop. Part of the widget rather than read when it is drawn,
     *  because that is what makes the glyph change: two widgets that compare
     *  equal keep the DOM the first one built. */
    private readonly asking = false,
  ) {
    super()
  }

  override eq(other: FenceHeaderWidget) {
    return (
      other.language === this.language &&
      other.caption === this.caption &&
      other.infoFrom === this.infoFrom &&
      other.blockFrom === this.blockFrom &&
      other.asking === this.asking
    )
  }

  toDOM(view: EditorView) {
    const bar = document.createElement('span')
    bar.className = 'nib-fence-header'
    bar.contentEditable = 'false'

    // The widget itself takes no width: it only holds the row open. What is seen
    // sits in a box pinned across the line, so the fence text, when the caret
    // reveals it, and this row share one row rather than the row wrapping onto
    // one of its own - which made the block grow whenever the caret was inside
    // it.
    const row = document.createElement('span')
    row.className = 'nib-fence-row'
    bar.append(row)

    // What the block is, at the start of that row, where the fence's own text
    // sits when the caret brings it back. Read off the fence line rather than
    // part of the note's words, so nothing selects it and a press on it is a
    // press on the line.
    if (this.caption) {
      const said = document.createElement('span')
      said.className = 'nib-fence-caption'
      said.textContent = this.caption
      row.append(said)
    }

    const controls = document.createElement('span')
    controls.className = 'nib-fence-controls'
    row.append(controls)

    const label = document.createElement('button')
    label.className = 'nib-fence-language'
    label.type = 'button'
    label.title = uiLabel('setLanguage')
    label.textContent = this.language || 'plain'
    if (!this.language) label.classList.add('nib-fence-unset')

    const edit = () => this.editLanguage(view, label)
    label.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      edit()
    })
    pressedByKey(label, edit)

    controls.append(label)

    if (isRunnableLanguage(this.language)) controls.append(this.runButton(view))
    else if (isAiLanguage(this.language)) controls.append(this.askButton(view))

    const copy = document.createElement('button')
    copy.className = 'nib-fence-copy'
    copy.type = 'button'
    copy.title = uiLabel('copy')
    copy.setAttribute('aria-label', uiLabel('copyCode'))

    // Two overlapping sheets for copy, a tick once it has been taken. Drawn
    // rather than written, so the button stays the same size in any language.
    const draw = (paths: string[]) => {
      copy.replaceChildren()
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 14 14')

      for (const d of paths) {
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        shape.setAttribute('d', d)
        svg.append(shape)
      }

      copy.append(svg)
    }

    const SHEETS = ['M5 5h7v7H5z', 'M2 9V2h7']
    const TICK = ['M2.5 7.5l3 3 6-6']

    draw(SHEETS)

    const take = () => {
      navigator.clipboard
        .writeText(fenceCodeAt(view.state, this.blockFrom))
        .then(() => {
          copy.classList.add('nib-fence-copied')
          copy.title = uiLabel('copied')
          draw(TICK)

          window.setTimeout(() => {
            copy.classList.remove('nib-fence-copied')
            copy.title = uiLabel('copy')
            draw(SHEETS)
          }, 1400)
        })
        // A clipboard the browser refuses - no permission, or not a secure
        // context - leaves the button as it was, which says the copy did not
        // happen. Caught rather than dropped: an unhandled rejection is a
        // console full of noise, and in a webview sometimes worse.
        .catch(() => undefined)
    }

    copy.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      take()
    })
    pressedByKey(copy, take)

    controls.append(copy)

    // The button shows while the pointer is anywhere over the block. The block
    // is a run of sibling lines rather than one element, so no CSS selector
    // can see that; the content element is watched instead, and a hovered
    // line counts when it sits between this header's line and the closing
    // line of the same block.
    const over = (event: Event) => {
      // The pointer can be over a text node rather than an element, so the
      // target is asked what it is rather than assumed to be one.
      const target = event.target
      const line = target instanceof Element ? target.closest('.cm-line') : null
      bar.classList.toggle('nib-fence-hover', !!line && FenceHeaderWidget.holds(bar, line))
    }
    const leave = () => bar.classList.remove('nib-fence-hover')

    view.contentDOM.addEventListener('mouseover', over)
    view.contentDOM.addEventListener('mouseleave', leave)
    this.onDestroy(bar, () => {
      view.contentDOM.removeEventListener('mouseover', over)
      view.contentDOM.removeEventListener('mouseleave', leave)
    })

    return bar
  }

  /** Whether `line` is one of the lines of the block this header sits on. */
  private static holds(bar: Element, line: Element): boolean {
    let current: Element | null = bar.closest('.cm-line')

    while (current?.classList.contains('nib-code')) {
      if (current === line) return true
      if (current.classList.contains('nib-code-close')) break
      current = current.nextElementSibling
    }

    return false
  }

  /** A glyph at the end of the header row, drawn rather than written so it is the
   *  same size in every language. Two fences carry one - JavaScript runs, and an
   *  `ai` block's question is asked - and the two look and behave alike, so the
   *  shape is one thing with the glyph and the press passed in. */
  private glyphButton(title: string, spoken: string, path: string, press: () => void): HTMLElement {
    const button = document.createElement('button')
    button.className = 'nib-fence-run'
    button.type = 'button'
    button.title = title
    button.setAttribute('aria-label', spoken)

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 14 14')
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    shape.setAttribute('d', path)
    svg.append(shape)
    button.append(svg)

    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      press()
    })
    pressedByKey(button, press)

    return button
  }

  /** Runs the block's code in a sandbox, with the output below it. Only on the
   *  languages that are JavaScript; see run/run.ts for which and for why. */
  private runButton(view: EditorView): HTMLElement {
    return this.glyphButton(uiLabel('run'), uiLabel('runCode'), 'M4 2.6l7 4.4-7 4.4z', () => {
      // Read now rather than remembered: the same block, as the document holds it
      // at the moment of the press. Null where the block has stopped being one.
      const fence = runnableFenceAt(view.state, this.blockFrom)
      if (fence) runFence(view, fence)
    })
  }

  /** Asks the question the block holds, and writes the answer into the note under
   *  it; see ai/run.ts. The same triangle a run wears, because it is the same
   *  gesture: this block does something, and this is the press that does it. While
   *  an answer is arriving it is a square instead, which stops it. */
  private askButton(view: EditorView): HTMLElement {
    if (this.asking) {
      return this.glyphButton(uiLabel('stop'), uiLabel('stop'), 'M4 4h6v6H4z', () =>
        stopAskAt(view, this.blockFrom),
      )
    }

    return this.glyphButton(uiLabel('ask'), uiLabel('askModel'), 'M4 2.6l7 4.4-7 4.4z', () => {
      const fence = aiFenceAt(view.state, this.blockFrom)
      if (fence) askAiFence(view, fence)
    })
  }

  /** Turns the label into a field, and writes the name straight into the fence.
   *
   *  Only the language word is replaced, so a fence that carries a caption keeps
   *  it: what the block is has nothing to do with which language it is in. */
  private editLanguage(view: EditorView, label: HTMLElement) {
    const field = document.createElement('input')
    field.className = 'nib-fence-language-input'
    field.value = this.language
    field.placeholder = uiLabel('fenceLanguage')
    field.spellcheck = false

    const commit = () => {
      const next = field.value.trim().replace(/\s+/g, '')
      field.replaceWith(label)

      if (next === this.language) return
      view.dispatch({ changes: { from: this.infoFrom, to: this.infoTo, insert: next } })
    }

    field.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') field.blur()
      if (event.key === 'Escape') {
        field.value = this.language
        field.blur()
      }
    })
    field.addEventListener('blur', commit)

    label.replaceWith(field)
    field.focus()
    field.select()
  }

  override ignoreEvent() {
    return true
  }
}

/** Where a printed page ends. Invisible in the file, obvious on screen. */
export class PageBreakWidget extends NibWidget {
  override eq() {
    return true
  }

  toDOM() {
    const rule = document.createElement('span')
    rule.className = 'nib-page-break'
    rule.dataset.label = 'page break'
    return rule
  }
}

/** Shows `:smile:` as the character it names. */
export class EmojiWidget extends NibWidget {
  constructor(private readonly character: string) {
    super()
  }

  override eq(other: EmojiWidget) {
    return other.character === this.character
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'nib-emoji'
    span.textContent = this.character
    return span
  }
}

// Images live in image.ts: they carry enough behaviour to be a file of their own.
