import { describe, expect, test } from 'vitest'
import { completion, frecency, shownAddress, suggested } from './omnibox'
import type { Visit } from './visits'

const NOW = Date.UTC(2026, 8, 27)
const DAY = 24 * 60 * 60 * 1000

function visit(url: string, over: Partial<Visit> = {}): Visit {
  return { url, title: '', visits: 1, typed: 0, last: NOW, ...over }
}

const MOODLE = visit('https://moodle-app2.let.ethz.ch/course/view.php?id=12', {
  title: 'Parallel Programming',
  visits: 4,
})

/** The field finishing what was typed: Emil's own example first. */
describe('the rest of an address, in the field', () => {
  test('finishes a site from its first letters, to the site and not the page', () => {
    expect(completion([MOODLE], 'moo', NOW)).toEqual({
      text: 'moodle-app2.let.ethz.ch',
      url: 'https://moodle-app2.let.ethz.ch/',
    })
  })

  test('keeps what was typed as it was typed', () => {
    expect(completion([MOODLE], 'MOO', NOW)?.text).toBe('MOOdle-app2.let.ethz.ch')
  })

  test('with or without the www and the scheme', () => {
    const google = visit('https://www.google.com/')

    expect(completion([google], 'goo', NOW)?.text).toBe('google.com')
    expect(completion([google], 'www.goo', NOW)?.text).toBe('www.google.com')
    expect(completion([google], 'ww', NOW)?.text).toBe('www.google.com')
    expect(completion([google], 'https://goo', NOW)?.text).toBe('https://google.com')
    expect(completion([google], 'https://www.g', NOW)?.text).toBe('https://www.google.com')
  })

  test('only on the scheme the site was on, where one is typed', () => {
    const local = visit('http://localhost:1420/')

    expect(completion([local], 'https://loc', NOW)).toBe(null)
    expect(completion([local], 'http://loc', NOW)?.url).toBe('http://localhost:1420/')
  })

  test('to a whole address once the typing has gone past the site', () => {
    expect(completion([MOODLE], 'moodle-app2.let.ethz.ch/c', NOW)).toEqual({
      text: 'moodle-app2.let.ethz.ch/course/view.php?id=12',
      url: MOODLE.url,
    })
  })

  test('never to something the typing is not the start of', () => {
    expect(completion([MOODLE], 'ethz', NOW)).toBe(null)
    expect(completion([MOODLE], 'parallel', NOW)).toBe(null)
    expect(completion([MOODLE], 'moodle-app2.let.ethz.ch/x', NOW)).toBe(null)
  })

  test('never for words, which are a search', () => {
    expect(completion([MOODLE], 'moo ', NOW)).toBe(null)
    expect(completion([MOODLE], 'moodle login', NOW)).toBe(null)
    expect(completion([MOODLE], '', NOW)).toBe(null)
    expect(completion([MOODLE], 'https://', NOW)).toBe(null)
  })

  test('says a site typed out in full is the site, with the scheme it was on', () => {
    const local = visit('http://localhost:1420/notes')

    expect(completion([local], 'localhost:1420', NOW)).toEqual({
      text: 'localhost:1420',
      url: 'http://localhost:1420/',
    })
  })

  test('offers the site somebody lives on over a page opened once', () => {
    const lived = [
      visit('https://mail.example.com/a', { visits: 3 }),
      visit('https://mail.example.com/b', { visits: 3 }),
    ]
    const once = visit('https://maps.example.org/', { visits: 4 })

    expect(completion([once, ...lived], 'ma', NOW)?.url).toBe('https://mail.example.com/')
  })

  test('and a site somebody typed over one a link led to twice as often', () => {
    const followed = visit('https://news.example.com/', { visits: 8 })
    const typed = visit('https://nib.example.com/', { visits: 1, typed: 1 })

    expect(completion([followed, typed], 'n', NOW)?.url).toBe('https://nib.example.com/')
  })
})

describe('what a row counts', () => {
  test('a typed visit counts ten', () => {
    expect(frecency(visit('https://a.example/', { visits: 1, typed: 1 }), NOW)).toBe(11)
  })

  test('and fades with how long ago it was', () => {
    const fresh = frecency(visit('https://a.example/', { visits: 5 }), NOW)
    const month = frecency(visit('https://a.example/', { visits: 5, last: NOW - 20 * DAY }), NOW)
    const year = frecency(visit('https://a.example/', { visits: 5, last: NOW - 365 * DAY }), NOW)

    expect(fresh).toBeGreaterThan(month)
    expect(month).toBeGreaterThan(year)
  })
})

/** The list under the field. */
describe('the pages offered', () => {
  const pages = [
    MOODLE,
    visit('https://svelte.dev/docs/svelte/what-are-runes', { title: 'What are runes?', visits: 2 }),
    visit('https://example.com/about', { title: 'About the moon', visits: 1 }),
  ]

  test('finds a page by a word from the middle of its address or its title', () => {
    expect(suggested(pages, 'ethz', NOW)).toEqual([MOODLE])
    expect(suggested(pages, 'runes', NOW).map((one) => one.title)).toEqual(['What are runes?'])
    expect(suggested(pages, 'programming', NOW)).toEqual([MOODLE])
  })

  test('wants every word found', () => {
    expect(suggested(pages, 'moodle parallel', NOW)).toEqual([MOODLE])
    expect(suggested(pages, 'moodle runes', NOW)).toEqual([])
  })

  test('puts the start of a site above a word inside a title', () => {
    expect(suggested(pages, 'moo', NOW)[0]).toBe(MOODLE)
  })

  test('leads with the site the field finished the word to, however little it weighs', () => {
    const eth = visit('https://www.ethz.ch/en.html', { visits: 1 })
    const rows = suggested([MOODLE, eth], 'eth', NOW)

    expect(completion([MOODLE, eth], 'eth', NOW)?.text).toBe('ethz.ch')
    expect(rows).toEqual([eth, MOODLE])
  })

  test('finds a letter or two only at the front of something', () => {
    // `ethz` and `example` start with it; `svelte` and `are` only have it inside.
    const found = suggested(pages, 'e', NOW).map((one) => one.url)
    expect(found).toHaveLength(2)
    expect(found.some((url) => url.includes('svelte'))).toBe(false)
  })

  test('reads past a scheme typed in front', () => {
    expect(suggested(pages, 'https://svelte', NOW)).toHaveLength(1)
  })

  test('offers a few, not the whole history', () => {
    const many = Array.from({ length: 40 }, (_, index) => visit(`https://site${index}.example/`))
    expect(suggested(many, 'site', NOW)).toHaveLength(5)
  })

  test('nothing for nothing', () => {
    expect(suggested(pages, '   ', NOW)).toEqual([])
  })
})

describe('an address as the list shows it', () => {
  test('without the https, the www and a front page slash', () => {
    expect(shownAddress('https://www.google.com/')).toBe('google.com')
    expect(shownAddress('https://svelte.dev/docs?x=1')).toBe('svelte.dev/docs?x=1')
  })

  test('with the http an insecure page is on', () => {
    expect(shownAddress('http://localhost:1420/')).toBe('http://localhost:1420')
  })
})
