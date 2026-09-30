import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { frontMatter } from '@nib/markdown'
import { isDeck } from '@nib/markdown/slide-breaks'
import { inCodeSpan, keepsStraightQuotes, smartReplacement, typingBreak } from './typography'
import { nibMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

/** Applies the rule the way the editor would, so tests read as typed text. */
function type(line: string, character: string): string {
  const before = line + character
  const replacement = smartReplacement(before)
  if (!replacement) return before

  return before.slice(0, before.length - replacement.consumed) + replacement.insert
}

describe('quotes', () => {
  test('opens at the start of a line', () => {
    expect(type('', '"')).toBe('“')
  })

  test('opens after a space', () => {
    expect(type('he said ', '"')).toBe('he said “')
  })

  test('closes after a word', () => {
    expect(type('he said “hello', '"')).toBe('he said “hello”')
  })

  test('opens after a bracket', () => {
    expect(type('(', '"')).toBe('(“')
  })

  test('handles single quotes the same way', () => {
    expect(type('', "'")).toBe('‘')
    expect(type('‘hello', "'")).toBe('‘hello’')
  })

  test('makes an apostrophe, not an opening quote', () => {
    expect(type('don', "'")).toBe('don’')
  })
})

describe('dashes', () => {
  test('two hyphens become an en dash', () => {
    expect(type('a -', '-')).toBe('a –')
  })

  test('three become an em dash', () => {
    expect(type('a –', '-')).toBe('a —')
  })

  test('a lone hyphen is left alone', () => {
    expect(type('a', '-')).toBe('a-')
  })
})

describe('a line that is a break rather than a sentence', () => {
  /** The whole of a line, typed one character at a time through the rule, which
   *  is the only way to catch a conversion that happens mid-word: `---` used to
   *  come out as an em dash because the second hyphen had already gone. */
  const typed = (line: string) => line.split('').reduce((so, character) => type(so, character), '')

  test('three hyphens on their own line stay a rule', () => {
    expect(typed('---')).toBe('---')
  })

  test('and so do the longer runs a rule may be written with', () => {
    expect(typed('----')).toBe('----')
    expect(typed('--------')).toBe('--------')
  })

  test('the second hyphen is the one that had to be spared', () => {
    // By the third there is no run of hyphens left to recognise, so the guard
    // has to hold on the second: `--` is a rule halfway typed.
    expect(type('-', '-')).toBe('--')
    expect(type('--', '-')).toBe('---')
  })

  test('indented up to three spaces, and inside a quotation', () => {
    expect(typed('  ---')).toBe('  ---')
    expect(typed('> ---')).toBe('> ---')
    expect(typed('>> ---')).toBe('>> ---')
  })

  test('but dashes in prose still become dashes', () => {
    expect(typed('a -- b')).toBe('a – b')
    expect(typed('a --- b')).toBe('a — b')
    expect(typed('see -- here')).toBe('see – here')
  })

  test('and a line with words on it is prose however it ends', () => {
    expect(typingBreak('---')).toBe(true)
    expect(typingBreak('a --')).toBe(false)
    expect(typingBreak('    --')).toBe(false)
  })

  test('the rule a deck is broken on, typed rather than commanded', () => {
    // What the bug cost: every break in a deck came out as an em dash, so the
    // note stopped being a deck at all. The detector is the judge.
    const note = `# One

${typed('---')}

# Two
`
    expect(note).toContain('---')
    expect(isDeck(note)).toBe(true)
  })

  test('front matter can be opened by typing its fence', () => {
    const note = `${typed('---')}
title: Hi
---

Body.
`
    expect(note.split('\n')[0]).toBe('---')
    expect(frontMatter(note)).toBe('title: Hi')
  })

  test('a setext underline stays an underline', () => {
    expect(typed('---')).toBe('---')
    expect(typed('===')).toBe('===')
  })
})

describe('ellipsis', () => {
  test('three dots collapse', () => {
    expect(type('wait..', '.')).toBe('wait…')
  })

  test('two dots do not', () => {
    expect(type('wait.', '.')).toBe('wait..')
  })
})

describe('code spans', () => {
  test('inside backticks nothing is substituted', () => {
    expect(inCodeSpan('run `echo ', 10)).toBe(true)
  })

  test('after the closing backtick it resumes', () => {
    expect(inCodeSpan('run `echo` ', 11)).toBe(false)
  })

  test('an indented code block is left alone', () => {
    expect(inCodeSpan('    let x = "y"', 12)).toBe(true)
  })

  test('a fence is left alone', () => {
    expect(inCodeSpan('```js', 5)).toBe(true)
  })
})

/** A document with `|` where the caret is, so a test reads as the place it is
 *  asking about. */
function at(marked: string): boolean {
  const caret = marked.indexOf('|')
  const doc = marked.slice(0, caret) + marked.slice(caret + 1)
  const state = parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    }),
  )
  return keepsStraightQuotes(state, caret)
}

describe('what keeps its straight quotes', () => {
  test('the body of a fenced block, which is not prose at all', () => {
    // The line on its own reads as ordinary text, so only the tree can say.
    expect(at('```js\nconst s = "a|\n```\n')).toBe(true)
    expect(at('```\nwait..|\n```\n')).toBe(true)
  })

  test('an inline code span, and the fence lines themselves', () => {
    expect(at('run `echo "a|` after\n')).toBe(true)
    expect(at('```js|\n\n```\n')).toBe(true)
  })

  test('maths, where a quote is a prime', () => {
    expect(at('the slope $f|$ of it\n')).toBe(true)
    expect(at('$$\nf|\n$$\n')).toBe(true)
  })

  test('front matter, which is YAML', () => {
    expect(at('---\ntitle: "a|\n---\n\nBody.\n')).toBe(true)
  })

  test("a link's address and its title", () => {
    expect(at('see [it](https://x.dev/a|b "T")\n')).toBe(true)
    expect(at('see [it](https://x.dev "a|")\n')).toBe(true)
  })

  test('an HTML tag, whose attributes are quoted straight', () => {
    expect(at('text <span class="a| ">x</span>\n')).toBe(true)
  })

  test('but not the prose around any of them', () => {
    expect(at('he said |\n')).toBe(false)
    expect(at('run `echo` and| then\n')).toBe(false)
    expect(at('```js\nlet x = 1\n```\n\nafter| it\n')).toBe(false)
    expect(at('see [it](https://x.dev) and| more\n')).toBe(false)
  })

  test('and not a fence that nothing closes, which is a paragraph', () => {
    // The parser only calls a closed fence a fence; see markdown/fences.ts. The
    // line test still holds the fence line itself.
    expect(at('```js\nhe said| something\n')).toBe(false)
  })
})
