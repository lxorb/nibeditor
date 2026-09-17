import { MOST_EMS } from '@nib/markdown'
import { chartFigure } from '@nib/markdown/chart'
import { DIAGRAM_LANGUAGES } from '@nib/markdown/diagrams'
import { loadMaths, mathsEngine } from '@nib/markdown/engines'
import type { NoteIndex } from '../wikilink/notes'
import { NibWidget } from './widget'
// The engine itself, chemistry pack and all, is loaded when a note turns out to have
// a formula in it; see @nib/markdown/engines, which is the one holder for it. Its
// stylesheet stays here and stays eager: a rule is not a module, the faces inside it
// are fetched only once something on the page wears one, and a formula appearing
// before the CSS that sets it would be a formula in the wrong font for a frame.
import 'katex/dist/katex.min.css'
import { sequenceToMermaid } from './sequence'

/** Equation labels seen in this document, in order, so `\eqref` can resolve. */
const equationNumbers = new Map<string, number>()

export function resetEquationLabels() {
  equationNumbers.clear()
}

export function recordEquationLabel(tex: string, number: number) {
  const label = /\\label\s*\{([^}]+)\}/.exec(tex)?.[1]
  if (label !== undefined) equationNumbers.set(label, number)
}

/** `\label` is TeX bookkeeping, not something KaTeX renders; `\eqref` becomes
 *  the number the label was given. */
export function prepare(tex: string): string {
  return tex
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(?:eq)?ref\s*\{([^}]+)\}/g, (whole, name: string) => {
      const number = equationNumbers.get(name)
      return number ? `(${number})` : whole
    })
}

/** A picture the note draws and nobody presses: a formula, a diagram, a chart.
 *
 *  CodeMirror treats a widget as opaque, so a press inside one never reaches the
 *  editor and the caret stays wherever it was. For a block that replaces its whole
 *  source that leaves nothing to aim at: the picture is the entire row, there is
 *  no text on it to click, and pressing a rendered formula did nothing whatever.
 *  These three hold nothing of their own to press, so the press is the editor's -
 *  it lands on the line the picture stands on, and the source comes back with it.
 *
 *  A widget that DOES hold something to press stays opaque, because there a press
 *  already means something: a table's cells, a `[toc]`'s entries, a query's rows,
 *  the card an embed offers, a picture's own handles. */
abstract class PictureWidget extends NibWidget {
  override ignoreEvent() {
    return false
  }
}

export class MathWidget extends PictureWidget {
  constructor(
    private readonly tex: string,
    private readonly block: boolean,
    /** Shown to the right of a display equation when numbering is on. */
    private readonly number?: number,
  ) {
    super()
  }

  override eq(other: MathWidget) {
    return other.tex === this.tex && other.block === this.block && other.number === this.number
  }

  /** Only the display shape. Inline maths sits in a row with words either side,
   *  where a press already lands beside it and reveals the `$…$` around it. */
  override ignoreEvent() {
    return !this.block
  }

  toDOM() {
    const host = document.createElement(this.block ? 'div' : 'span')
    host.className = this.block ? 'nib-math-block' : 'nib-math-inline'

    const body = this.number ? document.createElement('span') : host
    if (this.number) host.append(body)

    // The same bargain a diagram strikes below: the engine is heavy, so it does not
    // load until a document has a formula, and the first formula of a session appears
    // a moment after the rest of the note rather than with it. Every one after that
    // is drawn in the frame it was decorated in, because the engine is already here.
    const engine = mathsEngine()
    if (engine) this.draw(engine, body)
    else void loadMaths().then(() => body.isConnected && this.draw(mathsEngine(), body))

    if (this.number) {
      const tag = document.createElement('span')
      tag.className = 'nib-math-number'
      tag.textContent = `(${this.number})`
      host.append(tag)
    }

    return host
  }

  private draw(engine: ReturnType<typeof mathsEngine>, body: HTMLElement) {
    engine?.render(prepare(this.tex), body, {
      displayMode: this.block,
      throwOnError: false,
      errorColor: 'var(--danger)',
      output: 'html',
      // Typora enables these packages by default; matching keeps documents portable.
      trust: false,
      strict: false,
      // The same ceiling the renderer uses, and for the same reason: a note is
      // not always the reader's own, and `\rule{99999em}{99999em}` is one line
      // of TeX that leaves nothing else on screen. See @nib/markdown.
      maxSize: MOST_EMS,
    })
  }
}

/** Fence languages Typora renders as pictures rather than code. The list itself
 *  is @nib/markdown's, because a published page has to know it too - it decides
 *  which fences the app drew a picture for; see packages/markdown/src/diagrams.ts. */
export { DIAGRAM_LANGUAGES }

/** Every fence drawn rather than coloured, which is the wider question two places
 *  ask: the block field, deciding whether to replace the fence, and the walk in
 *  decorate.ts, which has to step aside for exactly the same ones or the two
 *  decorate the same range twice and CodeMirror throws.
 *
 *  A chart is here and not in `DIAGRAM_LANGUAGES` because that set is also the
 *  list of what the two heavy diagram renderers draw; a chart needs neither. */
export const RENDERED_LANGUAGES: ReadonlySet<string> = new Set([
  ...DIAGRAM_LANGUAGES,
  'chart',
  'query',
])

let diagramSeq = 0

export class DiagramWidget extends PictureWidget {
  constructor(
    private readonly code: string,
    private readonly language: string,
  ) {
    super()
  }

  override eq(other: DiagramWidget) {
    return other.code === this.code && other.language === this.language
  }

  toDOM() {
    const host = document.createElement('div')
    host.className = 'nib-diagram'
    host.dataset.language = this.language
    void this.draw(host)
    return host
  }

  /** Both renderers are heavy, so neither loads until a document has one. */
  private async draw(host: HTMLElement) {
    try {
      if (this.language === 'flow') await drawFlowchart(host, this.code)
      else if (this.language === 'sequence') await drawMermaid(host, sequenceToMermaid(this.code))
      else await drawMermaid(host, this.code)
    } catch (error) {
      host.classList.add('nib-diagram-error')
      host.textContent = error instanceof Error ? error.message : String(error)
    }
  }
}

/** A ` ```chart ` fence, drawn. No library and nothing to wait for: the picture is
 *  built from the numbers as a string, by the same code that draws one into an
 *  exported document and onto a published page. So unlike a diagram this appears
 *  with the keystroke that finishes it rather than a moment later.
 *
 *  A fence whose body is not a chart gets no widget at all - blocks.ts asks first
 *  - and stays code, which is what says nib could not read it. */
export class ChartWidget extends PictureWidget {
  constructor(private readonly code: string) {
    super()
  }

  override eq(other: ChartWidget) {
    return other.code === this.code
  }

  toDOM() {
    const host = document.createElement('div')
    host.className = 'nib-chart'
    // The renderer's own markup, built out of escaped text and numbers this
    // package never sees; see chart.ts.
    host.innerHTML = chartFigure(this.code) ?? ''
    return host
  }
}

/** A ` ```query ` fence: a search written into a note, answered where it stands.
 *
 *  The rows come from the app as HTML, because what a search finds is the app's to
 *  know and the Search panel's rows are the ones to draw. This draws the frame
 *  first and fills it in when the answer lands, the way an embed does: reading a
 *  space is a round trip, and a fence that waited for it would be a blank line
 *  where a paragraph is.
 *
 *  It answers again whenever the space changes, and the index is what says so: the
 *  app hands over a new one each time a note is saved, and a widget holding the old
 *  one is not equal to a widget holding the new. */
export class QueryWidget extends NibWidget {
  constructor(
    private readonly code: string,
    private readonly index: NoteIndex,
  ) {
    super()
  }

  override eq(other: QueryWidget) {
    return other.code === this.code && other.index === this.index
  }

  toDOM() {
    const host = document.createElement('div')
    host.className = 'nib-query-block'

    // A press on a row opens the note it found, and one on a box ticks it. One
    // listener on the host rather than one per row, because the rows are replaced
    // when the answer lands, and the app reads the press because the app wrote the
    // rows.
    host.addEventListener('mousedown', (event) => {
      if (this.index.pressRow?.(event.target) !== true) return

      // The press goes no further: otherwise the editor takes it as a click in the
      // document and puts the caret inside the fence this row is drawn over.
      event.preventDefault()
    })

    void this.draw(host)
    return host
  }

  private async draw(host: HTMLElement) {
    const html = await this.index.query?.(this.code)
    // The widget may be gone by the time the space has answered.
    if (!host.isConnected || html === null || html === undefined) return

    host.innerHTML = html
  }
}

/** A diagram as standalone SVG, for an export that has no editor around it. */
export async function diagramSvg(code: string, language: string): Promise<string> {
  const host = document.createElement('div')

  if (language === 'flow') await drawFlowchart(host, code)
  else await drawMermaid(host, language === 'sequence' ? sequenceToMermaid(code) : code)

  return host.innerHTML
}

function themeColour(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

async function drawMermaid(host: HTMLElement, code: string) {
  const { default: mermaid } = await import('mermaid')

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark',
    fontFamily: themeColour('--font-ui'),
  })

  const { svg } = await mermaid.render(`nib-diagram-${diagramSeq++}`, code)
  host.innerHTML = svg
}

/** Typora's legacy ` ```flow ` fences, drawn by flowchart.js. */
async function drawFlowchart(host: HTMLElement, code: string) {
  const flowchart = (await import('flowchart.js')).default

  host.innerHTML = ''
  flowchart.parse(code).drawSVG(host, {
    'line-width': 1.5,
    'font-family': themeColour('--font-ui'),
    'font-size': 13,
    fill: themeColour('--surface-2'),
    'line-color': themeColour('--muted'),
    'element-color': themeColour('--line-strong'),
    'font-color': themeColour('--text'),
    'yes-text': 'yes',
    'no-text': 'no',
  })
}
