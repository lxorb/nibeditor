import { describe, expect, test } from 'vitest'
import { fit, Fuzzy, fuzzyTerms, withoutWords } from './fuzzy'
import { foldedOnce, Matcher, type SearchNote } from './match'
import { parseQuery } from './query'

/** The twin of this file is the tests in fuzzy.rs: the same terms, the same
 *  lines, the same order. A case added here belongs there too. */

/** What a term scores on a line, or null when its letters are not all there. */
const score = (term: string, line: string) => fit(term, line)?.score ?? null

/** The letters a term marks on a line, in order, so a ranking case can say what
 *  it thinks matched as well as how well. */
function marked(term: string, line: string): string {
  const found = fit(term, line)
  if (!found) return ''
  return found.ranges.map((range) => line.slice(range.from, range.to)).join('')
}

/** Which of two lines a term prefers. */
function better(term: string, one: string, other: string): string {
  const first = score(term, one)
  const second = score(term, other)
  if (first === null) return other
  if (second === null) return one
  return first >= second ? one : other
}

describe('a term against a line', () => {
  test('matches its letters in order, wherever they sit', () => {
    expect(score('rdm', 'read me')).not.toBeNull()
    expect(score('read', 'read me')).not.toBeNull()
    // Out of order is not a match: the letters have to come in the order typed.
    expect(score('mdr', 'read me')).toBeNull()
    expect(score('zq', 'read me')).toBeNull()
  })

  test('matches a typo, which is the point', () => {
    // A letter left out.
    expect(score('meting', 'Meeting notes')).not.toBeNull()
    // Letters typed the wrong way round lose their second one and still match.
    expect(score('recieve', 'i before e receipt')).toBeNull()
    expect(score('recept', 'i before e receipt')).not.toBeNull()
  })

  test('folds case, both ways', () => {
    expect(score('RDM', 'read me')).toBe(score('rdm', 'read me'))
    expect(score('rdm', 'READ ME')).not.toBeNull()
  })

  test('marks the letters it found, and nothing else', () => {
    expect(marked('rdm', 'read me')).toBe('rdm')
    expect(marked('read', 'read me')).toBe('read')
  })

  test('is nothing at all for an empty term', () => {
    expect(fit('', 'read me')).toBeNull()
  })
})

describe('what the score rewards', () => {
  test('letters next to each other over letters apart', () => {
    expect(better('run', 'a run of it', 'rather unusual number')).toBe('a run of it')
    // And a run beats a word start, or a term found whole in one word would rank
    // level with the same letters picked one from each of six.
    expect(better('quater', 'The quarter plan', 'q u a t e r')).toBe('The quarter plan')
  })

  test('a word start over the middle of a word', () => {
    expect(score('me', 'me first')).toBeGreaterThan(score('me', 'somewhere') ?? 0)
    // Initials work by their word starts, which is what earns the bonus.
    expect(score('rdm', 'read me')).toBeGreaterThan(score('rdm', 'a random thing') ?? 0)
  })

  test('a capital after a small letter as a word start too', () => {
    expect(score('rm', 'readMe')).toBeGreaterThan(score('rm', 'rummage') ?? 0)
  })

  /** Where in a line a term sits is not in the score; it settles a tie. Two
   *  places that score alike leave the earlier one marked, which is what a
   *  reader glancing at the row expects to see lit up. */
  test('and where it sits only settles a tie', () => {
    expect(score('plan', 'plan and plan')).toBe(score('plan', 'plan') ?? 0)
    expect(fit('plan', 'plan and plan')?.ranges).toEqual([{ from: 0, to: 4 }])
  })

  test('the whole word over the initials of it', () => {
    expect(score('meeting', 'Meeting notes')).toBeGreaterThan(score('mn', 'Meeting notes') ?? 0)
  })

  test('and picks the best place the term fits, not the first', () => {
    // The first `p` is in `paper`; the run in `plan` is worth more, so that is
    // what is marked.
    expect(marked('plan', 'paper: the plan')).toBe('plan')
  })
})

describe('which queries are relaxed at all', () => {
  const terms = (source: string) => fuzzyTerms(parseQuery(source))

  test('bare words are, folded', () => {
    expect(terms('meting notes')).toEqual(['meting', 'notes'])
    expect(terms('MeTing')).toEqual(['meting'])
  })

  test('and words narrowed by an operator that asks about the note', () => {
    expect(terms('meting path:Work')).toEqual(['meting'])
    expect(terms('meting tag:work file:a [status]')).toEqual(['meting'])
  })

  test('but nothing the reader asked to be exact', () => {
    expect(terms('"a phrase"')).toEqual([])
    expect(terms('/re/')).toEqual([])
    expect(terms('a -b')).toEqual([])
    expect(terms('a OR b')).toEqual([])
    expect(terms('line:(a b)')).toEqual([])
    expect(terms('case: Alpha')).toEqual([])
    expect(terms('content:meting')).toEqual([])
    // One precise term takes the whole query out: half a loose answer under a
    // precise question is still noise.
    expect(terms('meting "a phrase"')).toEqual([])
  })

  test('and not an empty field', () => {
    expect(terms('')).toEqual([])
    expect(terms('path:Work')).toEqual([])
  })
})

describe('what a note still has to answer exactly', () => {
  const left = (source: string) => withoutWords(parseQuery(source))

  test('nothing, when the query was only words', () => {
    expect(left('meting notes')).toEqual({ kind: 'all', of: [] })
  })

  test('the operators, when there were any', () => {
    expect(left('meting path:Work')).toEqual({
      kind: 'all',
      of: [{ kind: 'path', text: 'Work', fold: true }],
    })
  })
})

const NOTE = `# Meeting notes

Alpha met Beta on Monday.

## The quarter plan

Beta wrote it up.
`

const note = (over: Partial<SearchNote> = {}): SearchNote => ({
  path: '/space/Work/Meeting.md',
  relative: 'Work/Meeting.md',
  name: 'Meeting.md',
  body: NOTE,
  ...over,
})

/** The two passes over a note, and the one folded copy they share.
 *
 *  The saving is the whole reason `SearchNote.folded` exists, and it is invisible
 *  in an answer: both passes give the same rows whether they fold once or twice.
 *  So it is counted instead. */
describe('the fold both passes read', () => {
  function counted(body: string) {
    const calls = { made: 0 }
    const make = foldedOnce(body)

    return {
      calls,
      note: {
        path: '/space/a.md',
        relative: 'a.md',
        name: 'a.md',
        body,
        folded: () => {
          calls.made++
          return make()
        },
      } satisfies SearchNote,
    }
  }

  test('is folded once however often it is asked for', () => {
    const make = foldedOnce('The Quarter Plan')

    expect(make()).toBe('the quarter plan')
    // The same string back, not an equal one: the second ask folds nothing.
    expect(make()).toBe(make())
    expect(Object.is(make(), make())).toBe(true)
  })

  test('and both passes read it rather than folding their own', () => {
    const { calls, note: one } = counted(NOTE)
    const query = parseQuery('quater plan')

    expect(new Matcher(query).hits(one, 1)).toEqual([])
    expect(calls.made).toBe(1)

    expect(new Fuzzy(fuzzyTerms(query)).best(one)).not.toBeNull()
    // Twice asked and, by the test above, once folded.
    expect(calls.made).toBe(2)
  })

  test('and not at all for a query that never reads the words', () => {
    const { calls, note: one } = counted(NOTE)

    // `path:` asks about the note rather than about what it says, so nothing
    // ever wants the note folded and nothing folds it.
    expect(new Matcher(parseQuery('path:nowhere')).hits(one, 1)).toEqual([])
    expect(calls.made).toBe(0)
  })

  test('and a note offered none folds its own', () => {
    const query = parseQuery('quater plan')
    const plain = note()

    expect(new Fuzzy(fuzzyTerms(query)).best(plain)?.text).toBe('## The quarter plan')
  })
})

describe('a note, loosely', () => {
  const best = (source: string, over: Partial<SearchNote> = {}) =>
    new Fuzzy(fuzzyTerms(parseQuery(source))).best(note(over))

  test('offers its best line and says what matched', () => {
    const found = best('quater plan')
    expect(found?.text).toBe('## The quarter plan')
    expect(found?.line).toBe(4)
    expect(found?.ranges.length).toBeGreaterThan(0)
  })

  test('one row and no more, because a guess is worth one', () => {
    // Both the heading and the last line hold every letter of `bta`.
    const found = best('bta')
    expect(found).not.toBeNull()
    expect(found?.score).toBeGreaterThan(0)
  })

  test('needs every term on one line', () => {
    // `alpha` is on one line and `plan` on another, so no line holds both.
    expect(best('alpha plan')).toBeNull()
    expect(best('alpha monday')).not.toBeNull()
  })

  test('answers nothing when a letter is missing from the note', () => {
    expect(best('zzz')).toBeNull()
  })

  /** The walk keeps a moving cursor per term, and a term whose first letter runs
   *  out partway down a note has to end the walk rather than end the term: a line
   *  where only some of the terms were even looked for is not a line that holds
   *  them all. */
  test('and nothing for a note whose lines each hold only one of the terms', () => {
    const split = { body: 'qqq one\nxyz\nwww three\n' }
    expect(best('qqq www', split)).toBeNull()
  })

  test('while a note that answered earlier keeps the line it answered on', () => {
    const split = { body: 'qqq www\nxyz\nqqq alone\n' }
    expect(best('qqq www', split)?.text).toBe('qqq www')
  })

  test('and nothing at all when the query is not one to relax', () => {
    expect(best('"quarter plan"')).toBeNull()
  })

  test('marks where the letters are in the row, not in the note', () => {
    const found = best('meting')
    // The row is the heading with its hash and space trimmed off, so the marks
    // have moved with it.
    expect(found?.text).toBe('# Meeting notes')
    for (const range of found?.ranges ?? []) {
      expect(range.from).toBeGreaterThanOrEqual(0)
      expect(range.to).toBeLessThanOrEqual(found?.text.length ?? 0)
    }
    expect(found?.ranges.map((range) => found.text.slice(range.from, range.to)).join('')).toBe(
      'Meting',
    )
  })
})

describe('ranking notes against each other', () => {
  /** The paths of some notes in the order a loose search would list them. */
  function ranked(source: string, bodies: Record<string, string>): string[] {
    const fuzzy = new Fuzzy(fuzzyTerms(parseQuery(source)))

    return Object.entries(bodies)
      .flatMap(([path, body]) => {
        const found = fuzzy.best(note({ path, body }))
        return found ? [found] : []
      })
      .sort((a, b) => b.score - a.score)
      .map((hit) => hit.path)
  }

  test('puts the note that says the words first', () => {
    expect(
      ranked('quater plan', {
        '/exact.md': 'The quarter plan for the year',
        '/scattered.md': 'q u a t e r and a plan',
        '/middle.md': 'inequater complan',
      }),
    ).toEqual(['/exact.md', '/middle.md', '/scattered.md'])
  })

  test('and a note that answers nothing is not in the list', () => {
    expect(
      ranked('quater', { '/yes.md': 'the quarter', '/no.md': 'nothing of the kind here' }),
    ).toEqual(['/yes.md'])
  })
})
