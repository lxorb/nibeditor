/** What a theme is allowed to be.
 *
 *  A theme from the store is a stylesheet somebody else wrote, applied to the
 *  whole app. So it is not applied as it arrives: it is read here, and what
 *  comes out the other side is only the rules this file recognised. Everything
 *  else is dropped and named, so the person installing it is told rather than
 *  left with a theme that quietly does less than it says.
 *
 *  Two things are being defended. The obvious one is anything that runs or
 *  fetches: a `url()` phones home with the reader's address, an `@import` pulls
 *  in a stylesheet nobody reviewed. The quieter one is the app's own shape - a
 *  theme that may set `position` or `display` can move the sidebar off the
 *  screen or hide the title bar, and a person who installed a colour scheme did
 *  not agree to that. So a theme states colours, and it states them in two
 *  places only: the token blocks, and the prose of a note.
 *
 *  The registry runs the same rules on every submission, which is where a theme
 *  author finds out. This copy is what makes them true on the machine. */

/** Bigger than any theme written against tokens, small enough that a stylesheet
 *  with something else hiding in it does not get read at all. */
const MOST_BYTES = 48 * 1024

/** A theme with more rules than this is not a theme. */
const MOST_RULES = 160
const MOST_DECLARATIONS = 600

/** The blocks that carry tokens: the shared ones, and one per scheme. Written
 *  without quotes and without spaces, which is how `selectorOf` hands them
 *  over, so `[data-theme="dark"]` and `[data-theme='dark']` are one selector. */
const TOKEN_BLOCKS = new Set([':root', '[data-theme=light]', '[data-theme=dark]'])

/** What a token block may say besides a token of its own. `color-scheme` is how
 *  a theme tells the browser which way its scrollbars and form controls go, and
 *  a theme that sets colours without it gets the wrong ones. */
const TOKEN_PROPERTIES = new Set(['color-scheme'])

/** The prose of a note, and nothing else in the app. `#write` is the surface
 *  the renderer and the editor both draw into; a rule here reaches the words
 *  and never the chrome around them. */
const PROSE_ROOT = '#write'

/** What may follow `#write`: the elements a note is made of. A theme that wants
 *  serif headings or a heavier quote bar says so here. */
const PROSE_PARTS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'a',
  'strong',
  'em',
  'del',
  'mark',
  'code',
  'pre',
  'pre code',
  'blockquote',
  'ul',
  'ol',
  'li',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'dt',
  'dd',
])

/** What a prose rule may set: how the words look, never where they are.
 *
 *  Absent on purpose: `position`, `display`, `inset`, `z-index`, `transform`,
 *  `visibility`, `overflow`, `width`, `height`, `content`, `animation` and
 *  `transition`. Those are the app's layout and the app's motion, and a theme
 *  that could set them could take a pane away or hold a menu open. */
const PROSE_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'border',
  'border-color',
  'border-style',
  'border-width',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
  'box-shadow',
  'font-family',
  'font-feature-settings',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'line-height',
  'margin',
  'opacity',
  'padding',
  'text-decoration',
  'text-decoration-color',
  'text-shadow',
  'text-transform',
  'text-underline-offset',
  'word-spacing',
])

/** Anything in a value that would reach outside the stylesheet, or run.
 *
 *  `url()` and `image-set()` fetch; `element()` and `attr()` read the page;
 *  `expression()` is Internet Explorer's way of running script from CSS and
 *  costs nothing to refuse; a backslash is how a keyword is spelled to slip
 *  past a check like this one. */
const DANGEROUS = /url\s*\(|image-set\s*\(|element\s*\(|attr\s*\(|expression\s*\(|javascript:|\\/i

/** Whether every bracket in a value is closed, the strings passed over.
 *
 *  A `(` left open swallows everything after it: a browser reads to the end of
 *  the file looking for the `)` and takes the `}`, the next selector and every
 *  rule below into the value. The scanner cannot catch that the way it catches a
 *  stray brace, because it counts braces, and a brace inside an unclosed
 *  function is still a brace to it.
 *
 *  Quotes are followed for the same reason `declarationsOf` follows them: a
 *  bracket inside a string is a letter, which is what keeps a font called
 *  `'Half ('` working. */
function bracketsClose(value: string): boolean {
  let depth = 0
  let quote = ''

  for (const letter of value) {
    if (quote) {
      if (letter === quote) quote = ''
      continue
    }

    if (letter === '"' || letter === "'") quote = letter
    else if (letter === '(') depth++
    else if (letter === ')' && --depth < 0) return false
  }

  return depth === 0
}

/** Whether a value written back out is read back as the same value.
 *
 *  A comment marker would comment out the rest of the file from wherever it
 *  landed, and a string opened and never closed swallows the end of the rule and
 *  whatever follows it. Both would make the sheet that is applied differ from
 *  the sheet that was read here, which is the one thing this file exists to
 *  prevent.
 *
 *  Kept here rather than beside the palettes because the palettes ask a stricter
 *  version of the same question; see `usablePaletteValue`.
 *
 *  A brace or a semicolon needs no rule of its own: the scanner has already
 *  ended the block at an unquoted `}`, refused the rule outright at an unquoted
 *  `{`, and split the declaration at an unquoted `;`, so one that reaches a
 *  value is inside a string and stays there. That is what lets a font called
 *  `'Semi; colon'` through, which a blanket ban would not. */
function usableValue(value: string): boolean {
  if (!value || DANGEROUS.test(value)) return false
  if (/\/\*|\*\//.test(value) || /\p{Cc}/u.test(value)) return false
  if (!bracketsClose(value)) return false

  const doubles = value.split('"').length - 1
  const singles = value.split("'").length - 1
  return doubles % 2 === 0 && singles % 2 === 0
}

/** The same question, for a value that never goes past the scanner.
 *
 *  A palette in the catalogue is pasted straight into a block the gallery
 *  injects; nothing has looked at where its braces and semicolons are, so those
 *  are the breakout that `usableValue` can afford to leave to the scanner and
 *  this cannot. See registry.ts. */
export function usablePaletteValue(value: string): boolean {
  return usableValue(value) && !/[{};]/.test(value)
}

/** What a custom property is called. */
const TOKEN = /^--[a-z0-9-]+$/i

export interface Reviewed {
  /** The rules that survived, as a stylesheet ready to apply. */
  css: string
  /** Which schemes the theme states, so the app knows whether it is a pair. */
  variants: ('light' | 'dark')[]
  /** One short phrase per thing dropped, in the order they were met. What the
   *  person installing it is shown. */
  refused: string[]
}

/** A rule as the scanner found it. */
interface Rule {
  selectors: string[]
  declarations: [string, string][]
}

/** Comments taken out, so nothing after this has to think about them. The
 *  scanner below reads braces and semicolons, and a comment can hold both. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/** A selector without its quotes or its spare whitespace, so two spellings of
 *  the same thing compare equal. Lower-cased: CSS element names and attribute
 *  selectors are not case-sensitive, and a theme writing `#WRITE H1` means the
 *  same thing as one writing it small. */
function selectorOf(text: string): string {
  return text
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s*([[\]=])\s*/g, '$1')
}

/** The declarations of one block, as they were written. A value may hold a
 *  semicolon inside a string or a function, so the split walks rather than
 *  using `split`. */
export function declarationsOf(body: string): [string, string][] {
  const found: [string, string][] = []
  let depth = 0
  let quote = ''
  let start = 0

  const take = (end: number) => {
    const text = body.slice(start, end).trim()
    start = end + 1
    if (!text) return

    const colon = text.indexOf(':')
    if (colon < 0) return

    found.push([text.slice(0, colon).trim(), text.slice(colon + 1).trim()])
  }

  for (let at = 0; at < body.length; at++) {
    const letter = body[at]

    if (quote) {
      if (letter === quote) quote = ''
      continue
    }

    if (letter === '"' || letter === "'") quote = letter
    else if (letter === '(') depth++
    else if (letter === ')') depth = Math.max(0, depth - 1)
    else if (letter === ';' && depth === 0) take(at)
  }

  take(body.length)
  return found
}

/** Where the block opened at `from` closes, counting the braces in between.
 *
 *  The whole of it, not the first `}`: an at-rule or a nested selector has to be
 *  stepped over as one thing, or what is inside it goes on to be read as
 *  top-level rules and walks straight past the whitelist. Quotes are followed for
 *  the same reason: a `}` inside a string is not the end of anything.
 *
 *  Answers the length of the file when nothing closes it, which the caller reads
 *  as an unfinished block. Exported because the gallery walks the app's own
 *  stylesheets the same way; see sample.ts. */
export function closes(css: string, from: number): number {
  let depth = 1
  let quote = ''

  for (let at = from + 1; at < css.length; at++) {
    const letter = css[at]

    if (quote) {
      if (letter === quote) quote = ''
      continue
    }

    if (letter === '"' || letter === "'") quote = letter
    else if (letter === '{') depth++
    else if (letter === '}' && --depth === 0) return at
  }

  return css.length
}

/** Every flat `selector { ... }` in the sheet, and whatever was not one.
 *
 *  Flat is the whole grammar: a theme has no at-rules and no nesting, so a
 *  brace inside a block is a rule this scanner refuses rather than one it
 *  descends into. */
function scan(css: string): { rules: Rule[]; stray: string[] } {
  const rules: Rule[] = []
  const stray: string[] = []
  let at = 0

  while (at < css.length) {
    const open = css.indexOf('{', at)
    if (open < 0) {
      if (css.slice(at).trim()) stray.push(css.slice(at).trim().slice(0, 40))
      break
    }

    const whole = css.slice(at, open)
    const close = closes(css, open)
    const body = css.slice(open + 1, close)
    const unfinished = close === css.length

    at = close + 1

    // An at-rule with no block of its own - `@charset`, a bare `@import` - ends
    // at its semicolon, and what follows it is the next rule's selector. Split
    // there, so one of those at the top of a file is refused on its own rather
    // than swallowing the rule after it.
    const statements = whole.split(';')
    const prelude = (statements.pop() ?? '').trim()
    for (const one of statements) {
      if (one.trim()) stray.push(one.trim().slice(0, 40))
    }

    if (unfinished || body.includes('{') || prelude.startsWith('@') || !prelude) {
      stray.push(prelude.slice(0, 40) || '{')
      continue
    }

    rules.push({
      selectors: prelude.split(',').map(selectorOf).filter(Boolean),
      declarations: declarationsOf(body),
    })
  }

  return { rules, stray }
}

/** Whether a selector is one a theme may write, and which kind it is. */
function kindOf(selector: string): 'tokens' | 'prose' | null {
  if (TOKEN_BLOCKS.has(selector)) return 'tokens'
  if (selector === PROSE_ROOT) return 'prose'

  const rest = selector.startsWith(`${PROSE_ROOT} `) ? selector.slice(PROSE_ROOT.length + 1) : null
  return rest !== null && PROSE_PARTS.has(rest) ? 'prose' : null
}

/** Whether a declaration belongs in a block of that kind. */
function allowed(kind: 'tokens' | 'prose', property: string): boolean {
  const name = property.toLowerCase()
  if (kind === 'tokens') return TOKEN.test(name) || TOKEN_PROPERTIES.has(name)
  return PROSE_PROPERTIES.has(name)
}

/** The theme, reduced to what it may do.
 *
 *  Every rule is kept or dropped whole where its selector decides it, and
 *  declaration by declaration where the properties do, so a theme with one bad
 *  line still installs with a sentence about the line. */
export function review(css: string): Reviewed {
  const refused: string[] = []
  const bytes = new TextEncoder().encode(css).length

  if (bytes > MOST_BYTES) {
    return {
      css: '',
      variants: [],
      refused: [`the file is larger than ${Math.round(MOST_BYTES / 1024)} kB`],
    }
  }

  const { rules, stray } = scan(withoutComments(css))
  for (const one of stray) refused.push(`${one || 'a block'} is not a theme rule`)

  const kept: string[] = []
  const variants = new Set<'light' | 'dark'>()
  let declarations = 0

  for (const rule of rules) {
    if (kept.length >= MOST_RULES) {
      refused.push(`only the first ${MOST_RULES} rules are read`)
      break
    }

    const good = rule.selectors.filter((one) => kindOf(one) !== null)
    for (const one of rule.selectors.filter((selector) => kindOf(selector) === null)) {
      refused.push(`${one} is not a selector a theme may set`)
    }

    if (!good.length) continue

    // A list naming both kinds is refused whole rather than read as its first
    // selector's kind. `#write, :root` would otherwise be a prose rule, and
    // `:root` is the element the app itself is laid out on: a theme allowed to
    // set `opacity` or `font-size` there could hide the window or rescale every
    // measurement in it. No theme has any use for the mixture.
    const kinds = new Set(good.map((one) => kindOf(one)))
    if (kinds.size > 1) {
      refused.push(`${good.join(', ')} mixes the tokens with the prose`)
      continue
    }

    const kind = kindOf(good[0] ?? '') ?? 'tokens'
    const lines: string[] = []

    for (const [property, value] of rule.declarations) {
      if (declarations >= MOST_DECLARATIONS) break

      if (!allowed(kind, property)) {
        refused.push(`${property} is not a property a theme may set`)
        continue
      }

      if (!usableValue(value)) {
        refused.push(`${property} is not a value a theme may set`)
        continue
      }

      lines.push(`  ${property}: ${value};`)
      declarations++
    }

    if (!lines.length) continue

    for (const selector of good) {
      if (selector === '[data-theme=light]') variants.add('light')
      if (selector === '[data-theme=dark]') variants.add('dark')
    }

    kept.push(`${good.join(',\n')} {\n${lines.join('\n')}\n}`)
  }

  if (declarations >= MOST_DECLARATIONS) {
    refused.push(`only the first ${MOST_DECLARATIONS} declarations are read`)
  }

  return { css: kept.join('\n\n'), variants: [...variants], refused }
}
