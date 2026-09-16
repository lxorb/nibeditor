/** A page's text, as markdown that says the same words.
 *
 *  Markdown's markers are ordinary punctuation, so a page's prose is full of
 *  characters a note would read as markup: the star in a glob, the underscore in
 *  a file name, the plus somebody typed to make a bullet. A backslash in front of
 *  each is what turndown writes, and what it buys is that the note shows what the
 *  page showed.
 *
 *  It bought it too widely, and it bought the wrong thing twice.
 *
 *  Too widely, because turndown escapes every marker it can see whatever sits
 *  around it, and most of those escapes change nothing a reader would ever see.
 *  `cx_out` is not emphasis to any reader of markdown - an underscore inside a
 *  word opens none - so `cx\_out` is a backslash the note carries for no reason,
 *  and the file is somebody's writing rather than a transport format. So: escape
 *  where the escape changes what is rendered, and nowhere else.
 *
 *  The wrong thing, because a page whose visible text *is* markdown - a course
 *  page quoting a lecturer's `**kurz**`, a forum post, anything that shows syntax
 *  outside a code block - was pasted into a markdown editor and arrived as
 *  `\*\*kurz\*\*`: the characters, faithfully, and never bold however hard
 *  anybody looked at them. Faithful is not what a person guesses there. And the
 *  converter was never consistent about it anyway: `~~struck~~` and
 *  `==highlighted==` have always come through as markup, because turndown has no
 *  rule for either, so `**` was the odd marker out rather than the principled
 *  one. So a run that is unmistakably markdown is kept as it was written.
 *
 *  Unmistakably is the whole of the judgement, and it is deliberately narrow,
 *  because the two mistakes are not the same size. An escape too many leaves a
 *  backslash in the note: visible, ugly, and a person can delete it. An escape
 *  too few eats the characters: silent, and found much later if at all. So a
 *  doubled marker around plain words (`**kurz**`, `__fett__`) and a code span
 *  (`` `npm run dev` ``) are kept, because nobody puts two stars on each side of
 *  a word by accident - and a single marker is not, because `rename *.md to
 *  *.txt` is a sentence rather than a phrase in italics.
 *
 *  Everything a conversion writes goes through here - a paste, a clip, an import
 *  - which is the same promise from-html.ts makes about the rest of its markers:
 *  a page pasted into a note and the same page clipped come out as one file. */

import { asWords } from './words'

/** What a backslash escapes, which is ASCII punctuation and nothing else: `\*`
 *  is a star, and `\U` is a backslash and a U. */
const PUNCTUATION = /[!-/:-@[-`{-~]/

/** A letter or a digit. What an underscore has to sit between for markdown to
 *  refuse to read it as emphasis: a delimiter inside a word is both-flanking and
 *  next to no punctuation, so it can neither open nor close. */
const WORD = /[\p{L}\p{N}]/u

const BLANK = /\s/

/** The characters that would open a block where the page had a paragraph, at the
 *  start of the text and nowhere else - which is where turndown looked for them
 *  too. A hyphen is a bullet with a blank after it and a rule with two more;
 *  `-5°C` is a temperature. */
const A_BLOCK = /^(?:-(?=[\s-]|$)|\+ |>|~~~|=+|#{1,6} )/

/** A number that would open an ordered list. The escape goes on the dot, because
 *  the dot is the marker; the digits are a number either way. */
const A_NUMBER = /^(\d+)\. /

/** A code span: as many backticks as it closes with, and something between them.
 *  Whatever else is in there is inert - markdown reads a code span as the
 *  characters it is made of, which is the same reason a fence keeps a page's own
 *  brackets; see `preformatted` in from-html.ts.
 *
 *  Three at the most, which is every code span anybody writes and is also what
 *  keeps this linear: an open-ended run of backticks is a run the engine tries
 *  every length of, and a page is somebody else's to fill with as many of them as
 *  it likes. A longer one is escaped, as it was before. */
const A_CODE_SPAN = /(`{1,3})([^`]+)\1(?!`)/y

/** A doubled emphasis marker around plain words. The words may hold nothing the
 *  escaping was protecting the note from - no marker, no bracket, no backslash,
 *  no `<` - so what a page gets to keep is a phrase in bold, and never markup of
 *  its own in somebody's note. */
const A_STRONG = /(\*\*|__)([^`*_[\]\\<]+)\1/y

/** Whether a run markdown would read may stay as it was written: nothing blank
 *  against the markers, which is where markdown stops reading one, and no more of
 *  the same marker on either side of it - `***a***` is not this rule's to judge. */
function unmistakable(text: string, at: number, found: RegExpExecArray): boolean {
  const run = found[0]
  const marker = run[0]
  const inside = found[2] ?? ''

  if (text[at - 1] === marker || text[at + run.length] === marker) return false
  return !BLANK.test(inside[0] ?? ' ') && !BLANK.test(inside.at(-1) ?? ' ')
}

/** The three characters a kept run can start with, asked before either pattern
 *  is run against the text: a conversion walks every character of a page and
 *  almost all of them are letters. */
const A_RUN = /[`*_]/

/** The markdown that starts here and needs no escaping, or nothing. */
function keptAt(text: string, at: number): string | null {
  if (!A_RUN.test(text[at] ?? '')) return null

  for (const pattern of [A_CODE_SPAN, A_STRONG]) {
    pattern.lastIndex = at
    const found = pattern.exec(text)
    if (found && unmistakable(text, at, found)) return found[0]
  }

  return null
}

function isWord(one: string | undefined): boolean {
  return one !== undefined && WORD.test(one)
}

/** Blank, and the ends of the text are not: the node before this one ended in
 *  something and the node after it starts with something, and neither is this
 *  function's to guess at. Where a character's neighbours are unknown it is
 *  escaped, which is the answer that can only cost a backslash. */
function isBlank(one: string | undefined): boolean {
  return one !== undefined && BLANK.test(one)
}

/** One character, escaped where a reader would otherwise take it for markup.
 *
 *  `midLine` says whether anything has been written before it on this line, which
 *  is what a star needs to know: turndown hands over one text node at a time with
 *  its newlines already collapsed, so a character with words before it in the
 *  same node is a character that cannot begin a list. */
function escapeAt(text: string, at: number, midLine: boolean): string {
  const one = text[at] ?? ''
  const before = text[at - 1]
  const after = text[at + 1]

  switch (one) {
    // An escape of the punctuation after it, or a backslash. At the end of the
    // text it is in front of whatever the next node begins with.
    case '\\':
      return after === undefined || PUNCTUATION.test(after) ? '\\\\' : '\\'
    // Never emphasis inside a word, which is where a file name and a variable
    // keep theirs.
    case '_':
      return isWord(before) && isWord(after) ? '_' : '\\_'
    // A star with a blank on each side leans neither way, so it can neither open
    // emphasis nor close it, and `2 * 3` is arithmetic. At the start of a line it
    // is a bullet instead.
    case '*':
      return midLine && isBlank(before) && isBlank(after) ? '*' : '\\*'
    case '`':
    case '[':
    case ']':
      return `\\${one}`
    default:
      return one
  }
}

/** A page's words, as a note may hold them. */
export function escapeText(text: string): string {
  const out: string[] = []
  const numbered = A_NUMBER.exec(text)
  const block = numbered ? null : A_BLOCK.exec(text)

  // A block marker is only ever the first thing in the text, so it is answered
  // once rather than asked about at every character after it.
  let escaped = numbered ? `${numbered[1]}\\. ` : block ? `\\${block[0]}` : ''
  let at = (numbered?.[0] ?? block?.[0] ?? '').length
  let midLine = at > 0

  while (at < text.length) {
    const kept = keptAt(text, at)

    if (kept) {
      // The words on either side of a kept run are escaped as the text they are,
      // and `asWords` reads two characters at a time - so a run is a boundary for
      // it as well. Nothing it looks for spans one: a `<` before a kept run is
      // followed by a marker, and a marker opens no tag.
      out.push(asWords(escaped), kept)
      escaped = ''
      at += kept.length
      midLine = true
      continue
    }

    escaped += escapeAt(text, at, midLine)
    midLine ||= !isBlank(text[at])
    at += 1
  }

  out.push(asWords(escaped))
  return out.join('')
}
