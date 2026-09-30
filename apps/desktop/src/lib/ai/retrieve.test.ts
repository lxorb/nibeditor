import { describe, expect, test } from 'vitest'
import type { Found } from '../search/space'
import type { Hit } from '../search/match'
import type { Query } from '../search/query'
import {
  citationLinks,
  citedIn,
  contextFor,
  fitted,
  frontPassages,
  linesSaying,
  linkedAnswer,
  type Passage,
  passagesOf,
  queryFor,
  ranked,
  retrieve,
  searchWords,
  type Space,
  tokensIn,
  uncited,
} from './retrieve'

/** What the Ask panel hands a model: numbered passages of the reader's notes, bounded
 *  and relevant, and nothing of what the space leaves out. And the citations read back
 *  out of an answer. Everything here is arithmetic on strings except `retrieve`, which
 *  is driven with a space of strings and a search that answers from them. */

function hit(path: string, line: number, text: string, ranges = [{ from: 0, to: 1 }]): Hit {
  return { path, name: path.split('/').pop() ?? path, line, text, ranges }
}

describe('the words a question is searched by', () => {
  test('leave the grammar out, in English and in German', () => {
    expect(searchWords('Where do herons stand in the winter?')).toEqual([
      'herons',
      'stand',
      'winter',
    ])
    expect(searchWords('Wo stehen die Reiher im Winter?')).toEqual(['stehen', 'reiher', 'winter'])
  })

  test('keep the longest when there are too many, in the order they were asked', () => {
    expect(searchWords('ab cd efgh ijklmn op qrs', 3)).toEqual(['efgh', 'ijklmn', 'qrs'])
  })

  test('are one of each and split on any script’s own punctuation', () => {
    expect(searchWords('kestrel, Kestrel; kestrel!')).toEqual(['kestrel'])
    expect(searchWords('Ποιος πετάει; ώρα')).toEqual(['ποιος', 'πετάει', 'ώρα'])
  })

  test('ask for nothing where the question is nothing but grammar', () => {
    expect(searchWords('what is it?')).toEqual([])
  })

  test('go to the space as any of them, folded', () => {
    expect(queryFor(['one', 'two'])).toEqual({
      kind: 'any',
      of: [
        { kind: 'text', text: 'one', fold: true },
        { kind: 'text', text: 'two', fold: true },
      ],
    })
  })
})

describe('the notes a search found, ranked', () => {
  test('put a note that says the rare word above one that says only the common one', () => {
    const hits = [
      hit('/s/a.md', 1, 'the heron stands'),
      hit('/s/b.md', 1, 'the heron'),
      hit('/s/c.md', 1, 'the heron'),
      hit('/s/d.md', 4, 'a kestrel hovers'),
    ]

    const order = ranked(hits, ['heron', 'kestrel']).map((one) => one.path)
    expect(order[0]).toBe('/s/d.md')
  })

  test('count a word in a note’s own name twice', () => {
    const hits = [hit('/s/Kestrels.md', 0, 'nothing here', []), hit('/s/other.md', 3, 'kestrels')]
    expect(ranked(hits, ['kestrels'])[0]?.path).toBe('/s/Kestrels.md')
  })

  test('break ties by lines, then by path, so the same question picks the same notes', () => {
    const hits = [hit('/s/b.md', 1, 'wind'), hit('/s/a.md', 1, 'wind'), hit('/s/c.md', 1, 'wind')]
    hits.push(hit('/s/c.md', 5, 'wind again'))

    expect(ranked(hits, ['wind']).map((one) => one.path)).toEqual(['/s/c.md', '/s/a.md', '/s/b.md'])
  })

  test('leave a paper to the Search panel and a name match without lines', () => {
    const paper = { ...hit('/s/p.pdf', 0, 'wind'), page: 3 }
    const named = hit('/s/Wind.md', 0, '', [])
    const found = ranked([paper, named], ['wind'])

    expect(found.map((one) => one.path)).toEqual(['/s/Wind.md'])
    expect(found[0]?.lines).toEqual([])
  })
})

describe('the passages of a note', () => {
  const note = (text: string) => ({ path: 'n.md', name: 'n', text })
  const lines = (count: number) => Array.from({ length: count }, (_, at) => `line ${at}`)

  test('are the matching lines and three either side, and nothing else', () => {
    const text = lines(30).join('\n')
    const [one, ...rest] = passagesOf(note(text), [15], 1000)

    expect(rest).toEqual([])
    expect(one?.line).toBe(15)
    expect(one?.text.split('\n')).toEqual(lines(30).slice(12, 19))
  })

  test('join runs that touch and keep runs that do not apart, each with its own line', () => {
    const text = lines(40).join('\n')
    const found = passagesOf(note(text), [5, 8, 30], 1000)

    expect(found.map((one) => one.line)).toEqual([5, 30])
    expect(found[0]?.text.split('\n')).toEqual(lines(40).slice(2, 12))
  })

  test('are the head of the note, past its front matter, where nothing matched', () => {
    const text = '---\ntags: [a]\n---\n# Title\n\nFirst words.'
    const [one] = passagesOf(note(text), [], 1000)

    expect(one?.line).toBe(3)
    expect(one?.text).toBe('# Title\n\nFirst words.')
  })

  test('stay within their budget, cut at a line', () => {
    const text = lines(400).join('\n')
    const found = passagesOf(note(text), [], 50)

    expect(tokensIn(found.map((one) => one.text).join(''))).toBeLessThanOrEqual(50)
    expect(found[0]?.text.endsWith('line')).toBe(false)
  })

  test('and fitting cuts at a line rather than in a word', () => {
    expect(fitted('short', 10)).toBe('short')
    expect(fitted('aaaa\nbbbb\ncccc\ndddd', 3)).toBe('aaaa\nbbbb')
  })
})

describe('the note in front', () => {
  test('goes whole while it is short, citing the first line the question names', () => {
    const text = '# Herons\n\nA heron stands still.\n'
    const [one, ...rest] = frontPassages({ path: 'h.md', name: 'Herons', text }, ['stands'])

    expect(rest).toEqual([])
    expect(one?.text).toBe('# Herons\n\nA heron stands still.')
    expect(one?.line).toBe(2)
  })

  test('goes as its passages about the question where it is long', () => {
    const long = Array.from({ length: 2000 }, (_, at) => `filler ${at}`)
    long[1500] = 'the kestrel faces the wind'
    const found = frontPassages({ path: 'l.md', name: 'L', text: long.join('\n') }, ['kestrel'])

    expect(found).toHaveLength(1)
    expect(found[0]?.line).toBe(1500)
    expect(found[0]?.text).not.toContain('filler 0')
  })

  test('and says nothing for a note with no words past its front matter', () => {
    expect(frontPassages({ path: 'e.md', name: 'E', text: '---\na: b\n---\n' }, ['a'])).toEqual([])
  })

  test('is found line by line, folded', () => {
    expect(linesSaying('One\nTWO two\nthree', ['two'])).toEqual([1])
    expect(linesSaying('anything', [])).toEqual([])
  })
})

describe('what the model is shown', () => {
  const passages: Passage[] = [
    { path: 'a.md', name: 'A "quoted"', line: 4, text: 'first' },
    { path: 'b/c.md', name: 'C', line: 0, text: 'second' },
  ]

  test('is the passages numbered from one, each with its note and line', () => {
    const [message] = contextFor(passages, '')

    expect(message?.role).toBe('system')
    expect(message?.content).toContain(
      '<passage n="1" note="A \'quoted\'" line="5">\nfirst\n</passage>',
    )
    expect(message?.content).toContain('<passage n="2" note="C" line="1">')
  })

  test('with the selection as a message of its own, and nothing where there is none', () => {
    expect(contextFor([], '')).toEqual([])
    expect(contextFor([], 'picked')[0]?.content).toContain('<selection>\npicked\n</selection>')
  })
})

describe('the citations in an answer', () => {
  test('become links the panel answers, for the passages it was given and no others', () => {
    expect(citationLinks('It is so [1]. And so [2, 3]. Not [9].', 3)).toBe(
      'It is so [1](#cite-1). And so [2](#cite-2)[3](#cite-3). Not [9].',
    )
  })

  test('are left alone in code, in a footnote and in a link of the answer’s own', () => {
    const answer = 'Use `list[1]` and\n```\nx[2]\n```\nsee[^1] and [1](https://x)'
    expect(citationLinks(answer, 3)).toBe(answer)
  })

  test('are read back in the order first cited, once each', () => {
    expect(citedIn('b [2] a [1] b again [2][3] `[1]`', 2)).toEqual([2, 1])
  })

  test('are taken out of an answer that goes back as history', () => {
    expect(uncited('It is so [1]. And so [2, 3].')).toBe('It is so. And so.')
  })

  test('become wikilinks once the answer leaves the panel, the same one once', () => {
    const sources = [
      { path: 'Birds/Herons.md', name: 'Herons' },
      { path: 'Kestrels.md', name: 'Kestrels' },
    ]
    expect(linkedAnswer('Still [1][1]. Hovers [2]. Nothing [7].', sources)).toBe(
      'Still [[Birds/Herons|Herons]]. Hovers [[Kestrels]]. Nothing [7].',
    )
  })
})

describe('asking the space', () => {
  /** A space of strings, searched the way the crate searches: every line that says
   *  any of the words, skipping what it is told to leave out before reading it. */
  function spaceOf(notes: Record<string, string>, extra: Partial<Space> = {}) {
    const asked: { excluded: readonly string[] }[] = []
    const search: NonNullable<Space['search']> = (
      _root: string,
      query: Query,
      _terms: string[],
      _limit: number,
      onFound: (found: Found) => void,
      left?: readonly string[],
    ) => {
      const excluded = left ?? []
      asked.push({ excluded })
      const words =
        query.kind === 'any' ? query.of.flatMap((one) => ('text' in one ? [one.text] : [])) : []
      const hits: Hit[] = []
      for (const [path, text] of Object.entries(notes)) {
        if (excluded.includes(path)) continue
        text.split('\n').forEach((line, at) => {
          if (words.some((word) => line.toLowerCase().includes(word))) {
            hits.push(hit(`/s/${path}`, at, line))
          }
        })
      }
      onFound({ hits, loose: [] })
      return Promise.resolve()
    }

    const space: Space = {
      root: '/s',
      excluded: [],
      relative: (path) => (path.startsWith('/s/') ? path.slice(3) : null),
      read: (path) => Promise.resolve(notes[path.slice(3)] ?? null),
      search,
      ...extra,
    }
    return { space, asked }
  }

  test('sends the note in front first, then the space’s passages, never the front twice', async () => {
    const { space } = spaceOf({
      'Herons.md': '# Herons\n\nA heron stands in the wind.',
      'Kestrels.md': '# Kestrels\n\nA kestrel faces the wind.',
    })
    const front = {
      path: 'Herons.md',
      name: 'Herons',
      text: '# Herons\n\nA heron stands in the wind.',
    }

    const found = await retrieve('Which way does the wind blow?', space, front)
    expect(found.map((one) => one.path)).toEqual(['Herons.md', 'Kestrels.md'])
    expect(found[1]?.name).toBe('Kestrels')
  })

  test('hands the search what the space leaves out, which is how the archive stays out', async () => {
    const { space, asked } = spaceOf(
      { 'Old.md': 'a secret roost', 'New.md': 'a roost' },
      { excluded: ['Old.md'] },
    )

    const found = await retrieve('Where is the roost?', space, null)
    expect(asked[0]?.excluded).toEqual(['Old.md'])
    expect(found.map((one) => one.path)).toEqual(['New.md'])
  })

  test('asks nothing of the space for a question of nothing but grammar', async () => {
    const { space, asked } = spaceOf({ 'A.md': 'what is it' })

    expect(await retrieve('What is it?', space, null)).toEqual([])
    expect(asked).toEqual([])
  })

  test('goes with what has arrived once the deadline passes', async () => {
    const { space } = spaceOf({})
    const late: NonNullable<Space['search']> = (_root, _query, _terms, _limit, onFound) => {
      onFound({ hits: [hit('/s/Early.md', 0, 'wind')], loose: [] })
      return new Promise((resolve) => {
        setTimeout(() => {
          onFound({ hits: [hit('/s/Late.md', 0, 'wind')], loose: [] })
          resolve()
        }, 200)
      })
    }
    const read = (path: string) =>
      Promise.resolve(path.endsWith('Early.md') ? 'wind early' : 'wind late')

    const found = await retrieve('wind', { ...space, search: late, read, deadline: 20 }, null)
    expect(found.map((one) => one.path)).toEqual(['Early.md'])
  })

  test('keeps within its budget however much the space says', async () => {
    const notes: Record<string, string> = {}
    for (let at = 0; at < 20; at++)
      notes[`n${at}.md`] = Array(200).fill('wind words here').join('\n')
    const { space } = spaceOf(notes)

    const found = await retrieve('wind', space, null)
    const spent = found.reduce((sum, one) => sum + tokensIn(one.text), 0)
    expect(found.length).toBeLessThanOrEqual(10)
    expect(spent).toBeLessThanOrEqual(3000)
  })
})
