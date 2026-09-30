/** Notes the way people write them, for the properties to be tried on.
 *
 *  A string of random characters finds the bugs a string of random characters has.
 *  The ones that matter here live in markdown's shapes: a heading edited on one side
 *  and deleted on the other, a list both sides appended to, a fence one side closed,
 *  front matter, a table row, a line long enough to be a paragraph on its own, and
 *  characters outside the Basic Multilingual Plane, which JavaScript stores as two
 *  code units and which a careless offset cuts in half. So the generator writes
 *  blocks of those, and the edits are the ones a person makes: a word typed, a
 *  stretch deleted, a word replaced, a paragraph taken out, a line appended. */

import fc from 'fast-check'

/** Words from several scripts. The emoji and the rarer CJK ideograph are pairs of
 *  code units; the family emoji is several pairs joined; the accented word has a
 *  combining mark in one spelling. */
const WORDS = [
  'the',
  'plan',
  'milk',
  'tomorrow',
  'Zürich',
  'café',
  'naïve',
  'meeting',
  'draft',
  'x',
  '42',
  '日本語',
  '漢字',
  '𠮷野家',
  '😀',
  '👩‍💻',
  '🇨🇭',
  'مرحبا',
  'Привет',
  '`code`',
  '**bold**',
  '[[Link]]',
]

const word = fc.constantFrom(...WORDS)

const line = fc.array(word, { minLength: 1, maxLength: 12 }).map((words) => words.join(' '))

const heading = fc
  .tuple(fc.integer({ min: 1, max: 3 }), line)
  .map(([level, text]) => `${'#'.repeat(level)} ${text}`)

const paragraph = fc.array(line, { minLength: 1, maxLength: 3 }).map((lines) => lines.join('\n'))

const list = fc
  .tuple(
    fc.constantFrom('- ', '* ', '1. ', '- [ ] '),
    fc.array(line, { minLength: 1, maxLength: 4 }),
  )
  .map(([mark, items]) => items.map((item) => `${mark}${item}`).join('\n'))

const fence = fc
  .tuple(fc.constantFrom('', 'ts', 'py'), fc.array(line, { minLength: 0, maxLength: 3 }))
  .map(([lang, lines]) => ['```' + lang, ...lines, '```'].join('\n'))

const table = fc
  .array(fc.tuple(word, word), { minLength: 1, maxLength: 3 })
  .map((rows) =>
    ['| a | b |', '| --- | --- |', ...rows.map(([a, b]) => `| ${a} | ${b} |`)].join('\n'),
  )

const long = fc.array(word, { minLength: 30, maxLength: 60 }).map((words) => words.join(' '))

const quote = line.map((text) => `> ${text}`)

const block = fc.oneof(
  { weight: 4, arbitrary: paragraph },
  { weight: 2, arbitrary: heading },
  { weight: 3, arbitrary: list },
  { weight: 1, arbitrary: fence },
  { weight: 1, arbitrary: table },
  { weight: 1, arbitrary: long },
  { weight: 1, arbitrary: quote },
)

const frontMatter = fc
  .tuple(line, fc.array(word, { maxLength: 3 }))
  .map(([title, tags]) => `---\ntitle: ${title}\ntags: [${tags.join(', ')}]\n---\n`)

/** A whole note: perhaps front matter, then blocks with a blank line between, and
 *  usually a line break at the end. */
export const note = fc
  .tuple(
    fc.option(frontMatter, { nil: '' }),
    fc.array(block, { minLength: 0, maxLength: 8 }),
    fc.boolean(),
  )
  .map(([front, blocks, ends]) => `${front}${blocks.join('\n\n')}${ends ? '\n' : ''}`)

/** Whether `at` falls between two whole characters of `text`. */
function between(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return true
  const code = text.charCodeAt(at - 1)
  return code < 0xd800 || code > 0xdbff
}

/** The nearest place at or before `at` that falls between whole characters. */
function snapped(text: string, at: number): number {
  let place = Math.max(0, Math.min(text.length, at))
  while (!between(text, place)) place--
  return place
}

/** One edit a person makes, with where it lands given as a fraction of the text so
 *  that one edit means something in any text it is applied to. */
export type Change =
  | { kind: 'type'; at: number; words: string }
  | { kind: 'delete'; at: number; length: number }
  | { kind: 'replace'; at: number; length: number; words: string }
  | { kind: 'drop-block'; at: number }
  | { kind: 'append'; words: string }

const fraction = fc.double({ min: 0, max: 1, noNaN: true })

const change: fc.Arbitrary<Change> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('type'), at: fraction, words: line }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('delete'),
      at: fraction,
      length: fc.integer({ min: 1, max: 40 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('replace'),
      at: fraction,
      length: fc.integer({ min: 1, max: 20 }),
      words: line,
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('drop-block'), at: fraction }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('append'), words: line }) },
)

/** `text` with one change made to it. */
function changed(text: string, one: Change): string {
  switch (one.kind) {
    case 'type': {
      const at = snapped(text, Math.floor(one.at * text.length))
      return `${text.slice(0, at)}${one.words} ${text.slice(at)}`
    }
    case 'delete':
    case 'replace': {
      const from = snapped(text, Math.floor(one.at * text.length))
      const to = snapped(text, Math.min(text.length, from + one.length))
      const insert = one.kind === 'replace' ? one.words : ''
      return `${text.slice(0, from)}${insert}${text.slice(Math.max(from, to))}`
    }
    case 'drop-block': {
      const blocks = text.split('\n\n')
      const at = Math.min(blocks.length - 1, Math.floor(one.at * blocks.length))
      return blocks.filter((_, index) => index !== at).join('\n\n')
    }
    case 'append':
      return `${text}${text.endsWith('\n') || !text ? '' : '\n'}${one.words}\n`
  }
}

/** `text` with every change made to it, in order. */
export function edited(text: string, changes: readonly Change[]): string {
  return changes.reduce(changed, text)
}

export const changes = fc.array(change, { minLength: 0, maxLength: 5 })
