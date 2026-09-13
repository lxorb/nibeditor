import type { MarkedExtension, Token, Tokens } from 'marked'
import { blockMath, definitionList } from './blocks'
import { calloutChevron, calloutIcon, calloutOf } from './callouts'
import { emojiTable, loadEmoji, loadMaths, mathsEngine } from './engines'
import { closesFence, fenceMark } from './fences'
import { highlightTone, readHighlight } from './highlights'
import { escape, fragment } from './html'
import { firstStart, lineStart, matchesAt } from './starts'

/** Only the three that matter in element content, which is where the source of
 *  an equation that would not parse ends up. */
const ESCAPED_IN_ERROR: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

/** The largest a formula may say one of its own parts is, in ems.
 *
 *  TeX lets the formula choose: `\rule`, `\kern`, `\raisebox` and their
 *  neighbours all take a length, and KaTeX honours whatever they ask for unless
 *  it is told a ceiling. A note is not always the reader's own - one arrives
 *  from a share, from a room, or is published to strangers from a domain shared
 *  with every other blog - so a single line of TeX could hand the reader a box
 *  tens of thousands of ems tall, which is a page nobody can read or scroll.
 *  Well past anything a real equation asks for; nothing legible is 100 lines
 *  tall. Macro depth needs no number here: KaTeX caps expansion by default. */
export const MOST_EMS = 100

/** Renders TeX, or shows the source when it will not parse.
 *
 *  And shows the source, plainly, when the engine is not here yet: the whole of it
 *  is three quarters of a megabyte and it is loaded when a note turns out to have a
 *  formula in it rather than when the app starts, so a caller that can wait says
 *  `await loadFor(source)` first and this never happens to it. The one that cannot
 *  is the clipboard's HTML flavour, written inside a copy event - and what it writes
 *  then is the formula's own source, which is what the plain-text flavour beside it
 *  carries anyway. See engines.ts. */
function math(tex: string, display: boolean): string {
  const engine = mathsEngine()
  const escaped = () => tex.replace(/[&<>]/g, (c) => ESCAPED_IN_ERROR[c] ?? c)

  if (!engine) {
    void loadMaths()
    return display ? `<pre>${escaped()}</pre>` : `<code>${escaped()}</code>`
  }

  try {
    return engine.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      output: 'html',
      maxSize: MOST_EMS,
    })
  } catch {
    return display ? `<pre class="math-error">${escaped()}</pre>` : `<code>${escaped()}</code>`
  }
}

/** `==marked==`, and `==🔴 marked==` for one of the five colours Obsidian writes.
 *
 *  The colour comes off the front of the words before they are tokenized, so it
 *  never reaches the page as an emoji and never reaches the glasses, an export or
 *  a search as one either: what the reader sees is the words, tinted. See
 *  highlights.ts, which is also what the editor reads.
 *
 *  The token carries the palette tone as the number it is, not as the class it is
 *  drawn in: one representation, so the page's `<mark class="tone-4">` and the
 *  Word highlight and the RTF colour a document export writes are all read off
 *  the same answer. See `documentOf` in apps/desktop/src/lib/export/document.ts,
 *  the other reader. */
export const highlight: MarkedExtension = {
  extensions: [
    {
      name: 'highlight',
      level: 'inline',
      start: (src: string) => src.indexOf('=='),
      tokenizer(src: string) {
        const match = /^==(?=\S)([\s\S]*?\S)==/.exec(src)
        if (!match?.[1]) return undefined

        const { colour, from } = readHighlight(match[1])
        const words = match[1].slice(from)

        return {
          type: 'highlight',
          raw: match[0],
          text: words,
          tone: colour.tone,
          tokens: this.lexer.inlineTokens(words),
        }
      },
      renderer(token: Tokens.Generic) {
        const drawn = highlightTone(typeof token.tone === 'number' ? token.tone : null).className
        const tone = drawn ? ` class="${drawn}"` : ''
        return `<mark${tone}>${this.parser.parseInline(token.tokens ?? [])}</mark>`
      },
    },
  ],
}

/** `H~2~O` and `X^2^`
 *
 *  Both tokenize what is between the marks and render it through the parser,
 *  the way `highlight` above does. Interpolating the source text straight into
 *  the tag was a way past the escaping a published note relies on - `~<img
 *  src=x onerror=...>~` is not a raw HTML token, so nothing else would have
 *  caught it - and it also meant that emphasis inside a subscript came out as
 *  its own asterisks. */
export const scripts: MarkedExtension = {
  extensions: [
    {
      name: 'subscript',
      level: 'inline',
      start: (src: string) => src.indexOf('~'),
      tokenizer(src: string) {
        const inner = /^~(?!~)([^~\s][^~]*)~/.exec(src)
        if (!inner?.[1]) return undefined
        return {
          type: 'subscript',
          raw: inner[0],
          text: inner[1],
          tokens: this.lexer.inlineTokens(inner[1]),
        }
      },
      renderer(token: Tokens.Generic) {
        return `<sub>${this.parser.parseInline(token.tokens ?? [])}</sub>`
      },
    },
    {
      name: 'superscript',
      level: 'inline',
      start: (src: string) => src.indexOf('^'),
      tokenizer(src: string) {
        const inner = /^\^([^^\s][^^]*)\^/.exec(src)
        if (!inner?.[1]) return undefined
        return {
          type: 'superscript',
          raw: inner[0],
          text: inner[1],
          tokens: this.lexer.inlineTokens(inner[1]),
        }
      },
      renderer(token: Tokens.Generic) {
        return `<sup>${this.parser.parseInline(token.tokens ?? [])}</sup>`
      },
    },
  ],
}

/** `$inline$`, and a `$$` block written either way. Where the block begins and
 *  ends is blocks.ts, which slides.ts reads without any of this. */
export const maths: MarkedExtension = {
  extensions: [
    {
      ...blockMath,
      renderer: (token: Tokens.Generic) =>
        `<div class="math-block">${math(String(token.text ?? ''), true)}</div>`,
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start: (src: string) => src.indexOf('$'),
      tokenizer(src: string) {
        const match = /^\$(?!\s)((?:\\.|[^$\\])+?)(?<!\s)\$/.exec(src)
        if (!match) return undefined
        return { type: 'inlineMath', raw: match[0], text: match[1] }
      },
      renderer: (token: Tokens.Generic) =>
        `<span class="math-inline">${math(String(token.text ?? ''), false)}</span>`,
    },
  ],
}

/** The opening paragraph of a callout with its marker line taken off.
 *
 *  Counted in source characters against the tokens' own `raw`, because by the
 *  time a renderer sees a blockquote the lexer has already been over its words,
 *  and lexing what is left again here would lose every extension the instance
 *  was built with - the maths, the emoji, the wikilinks. The marker is at the
 *  very start, so the token it ends inside is the first one and is plain text;
 *  anything else is dropped whole, which is the marker's own characters going. */
function afterMarker(tokens: Token[], cut: number): Token[] {
  const out: Token[] = []
  let left = cut

  for (const token of tokens) {
    if (left <= 0) {
      out.push(token)
      continue
    }

    const raw = token.raw
    if (raw.length <= left) {
      left -= raw.length
      continue
    }

    const kept = raw.slice(left)
    left = 0
    if (token.type === 'text') out.push({ ...token, raw: kept, text: kept })
  }

  return out
}

/** A callout: a blockquote whose first line names a type.
 *
 *  Which types there are, what each is called and which icon it wears is
 *  callouts.ts - the one place that knows. Here is only what the markup looks
 *  like: the type as written on `data-callout`, so a theme can reach any of
 *  them including one nib has never heard of, and the look nib does know as a
 *  class, so a stylesheet needs the fifteen names rather than the thirty.
 *
 *  A fold sign in the note makes it a `<details>`, open unless the sign was the
 *  `-` that says otherwise. Native, so a page that has been read, printed,
 *  published or put in an EPUB folds without a line of script following it
 *  around - and so the sign the writer put in the file means the same thing
 *  everywhere the note is read. A callout with no sign is not foldable, which
 *  is what the file says and what Obsidian does; in the editor every block
 *  folds, because there the chevron in the margin is how editing works rather
 *  than something the note asked for. */
export const callouts: MarkedExtension = {
  renderer: {
    blockquote(token: Tokens.Blockquote) {
      const first = token.tokens[0]
      const raw = first && 'text' in first ? String(first.text) : ''
      const found = calloutOf(raw)

      if (!found) return `<blockquote>\n${this.parser.parse(token.tokens)}</blockquote>\n`

      const opening = first as Tokens.Paragraph
      const inside = afterMarker(opening.tokens, found.taken)
      const rest: Token[] = inside.length
        ? [{ ...opening, text: found.rest, tokens: inside }, ...token.tokens.slice(1)]
        : token.tokens.slice(1)

      const look = found.look === null ? '' : ` callout-${found.look}`
      const title = escape(found.title || found.label)
      const box = found.foldable ? 'details' : 'div'
      const head = found.foldable ? 'summary' : 'p'
      const open = found.foldable && !found.folded ? ' open' : ''
      const chevron = found.foldable ? calloutChevron() : ''

      return (
        `<${box} class="callout${look}" data-callout="${escape(found.type)}"${open}>` +
        `<${head} class="callout-title">` +
        `${chevron}${calloutIcon(found.look)}<span>${title}</span></${head}>\n` +
        `<div class="callout-body">\n${this.parser.parse(rest)}</div></${box}>\n`
      )
    },
  },
}

/** `:smile:` becomes the character it names. */
export const emoji: MarkedExtension = {
  extensions: [
    {
      name: 'emoji',
      level: 'inline',
      start: (src: string) => src.indexOf(':'),
      tokenizer(src: string) {
        const match = /^:([a-z0-9_+-]+):/i.exec(src)
        if (!match?.[1]) return undefined

        // The table is a quarter of a megabyte and arrives when a note turns out to
        // have a shortcode in it; until it does, `:smile:` is the characters it is
        // written with, which is also what an unknown name has always shown. See
        // engines.ts.
        const table = emojiTable()
        if (!table) {
          void loadEmoji()
          return undefined
        }

        const character = table.get(match[1])
        if (!character) return undefined

        return { type: 'emoji', raw: match[0], text: character }
      },
      renderer: (token: Tokens.Generic) => String(token.text),
    },
  ],
}

/** A definition list, drawn. What one is, and how far it reaches, is blocks.ts. */
export const definitionLists: MarkedExtension = {
  extensions: [
    {
      ...definitionList,
      renderer(token: Tokens.Generic) {
        const items = token.items as { term: Tokens.Generic[]; details: Tokens.Generic[][] }[]

        const body = items
          .map((item) => {
            const term = `<dt>${this.parser.parseInline(item.term)}</dt>`
            const details = item.details
              .map((detail) => `<dd>${this.parser.parseInline(detail)}</dd>`)
              .join('\n')

            return `${term}\n${details}`
          })
          .join('\n')

        return `<dl>\n${body}\n</dl>\n`
      },
    },
  ],
}

/** An abbreviation being defined, wherever the `*[` the caller found sits. */
const DEFINITION = /\*\[[^\]\n]+\]:/y

function definition(src: string, at: number): number | null {
  return matchesAt(DEFINITION, src, at) ? at : null
}

/** `*[HTML]: HyperText Markup Language` defines it; every later mention of
 *  `HTML` in the document then carries the expansion. */
export const abbreviations: MarkedExtension = {
  extensions: [
    {
      name: 'abbrDef',
      level: 'block',
      start: (src: string) => firstStart(src, ['*['], definition),
      tokenizer(src: string) {
        const match = /^\*\[([^\]\n]+)\]:[ \t]*(.*)(?:\r?\n|$)/.exec(src)
        if (!match) return undefined

        return {
          type: 'abbrDef',
          raw: match[0],
          term: match[1] ?? '',
          title: (match[2] ?? '').trim(),
        }
      },
      // The definition itself is not shown; it only teaches the document a word.
      renderer: () => '',
    },
  ],
}

const ABBREV_DEF = /^\*\[([^\]\n]+)\]:[ \t]*(.*)$/

/** Collects the abbreviations a document defines, so the rendered HTML can be
 *  marked up afterwards - the definition may come after its first use.
 *
 *  Read line by line rather than with one pass of the whole source, so that
 *  fenced code can be stepped over. The block tokenizer above never sees a line
 *  inside a fence, and this has to agree with it: a note showing what a
 *  definition looks like would otherwise teach itself the word. What a fence is
 *  and what closes one comes from fences.ts, which is what makes the two agree -
 *  the reading here used to take ```` ```ts ```` for a closing fence, and read
 *  the code after it as prose. */
export function collectAbbreviations(source: string): Map<string, string> {
  const found = new Map<string, string>()
  // One scan of the bytes for a note that defines none, which is nearly every
  // note: every definition opens with the mark, so a source without it is never
  // read line by line at all. This runs on every render of every note.
  if (!source.includes('*[')) return found

  let fence: string | null = null

  for (const line of source.split('\n')) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null
      continue
    }

    const mark = fenceMark(line)
    if (mark) {
      fence = mark
      continue
    }

    const match = ABBREV_DEF.exec(line)
    if (!match) continue

    const term = match[1]?.trim()
    if (term) found.set(term, (match[2] ?? '').trim())
  }

  return found
}

/** A footnote being defined rather than referred to: the colon is the whole
 *  difference. Confirmed for the same reason the maths block is - a `[^1]` in the
 *  middle of a sentence used to cut the paragraph in two just before it, which
 *  left a space in front of every footnote mark in the document. */
const FOOTNOTE_DEF = /\[\^[^\]\s]+\]:\s*\S/y

function footnoteDefinition(src: string, at: number): number | null {
  const line = lineStart(src, at, { orString: true })
  return line !== null && matchesAt(FOOTNOTE_DEF, src, at) ? line : null
}

/** `[^1]` in the text, `[^1]: …` at the bottom. */
export const footnotes: MarkedExtension = {
  extensions: [
    {
      name: 'footnoteDef',
      level: 'block',
      start: (src: string) => firstStart(src, ['[^'], footnoteDefinition),
      tokenizer(src: string) {
        const match = /^\[\^([^\]\s]+)\]:\s*(.+)(?:\r?\n|$)/.exec(src)
        if (!match) return undefined

        return {
          type: 'footnoteDef',
          raw: match[0],
          id: match[1] ?? '',
          tokens: this.lexer.inlineTokens(match[2] ?? ''),
        }
      },
      renderer(token: Tokens.Generic) {
        const id = String(token.id)
        const key = fragment(id)
        const body = this.parser.parseInline(token.tokens ?? [])
        return `<li id="fn-${key}"><a class="footnote-back" href="#fnref-${key}">${escape(id)}</a> ${body}</li>\n`
      },
    },
    {
      name: 'footnoteRef',
      level: 'inline',
      start: (src: string) => src.indexOf('[^'),
      tokenizer(src: string) {
        const match = /^\[\^([^\]\s]+)\]/.exec(src)
        if (!match) return undefined
        return { type: 'footnoteRef', raw: match[0], id: match[1] }
      },
      renderer: (token: Tokens.Generic) => {
        const id = String(token.id)
        const key = fragment(id)
        return `<sup class="footnote-ref" id="fnref-${key}"><a href="#fn-${key}">${escape(id)}</a></sup>`
      },
    },
  ],
}
