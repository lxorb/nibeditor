import { describe, expect, test } from 'vitest'

import { kindOf, notionDate, pagesIn } from './notion-database'

describe('a Notion date', () => {
  test('is a day, or a day and a minute, in ISO', () => {
    expect(notionDate('October 10, 2026')).toBe('2026-10-10')
    expect(notionDate('October 10, 2026 3:05 PM')).toBe('2026-10-10T15:05')
    expect(notionDate('October 10, 2026 12:30 AM')).toBe('2026-10-10T00:30')
    expect(notionDate('October 10, 2026 15:05 (GMT+2)')).toBe('2026-10-10T15:05')
    expect(notionDate('2026-10-10')).toBe('2026-10-10')
  })

  test('is nothing for a range or for words', () => {
    expect(notionDate('October 10, 2026 → October 12, 2026')).toBeNull()
    expect(notionDate('Someday, 2026')).toBeNull()
    expect(notionDate('Soon')).toBeNull()
  })
})

describe('a relation', () => {
  test('is the names of the pages it points at, ids off', () => {
    expect(
      pagesIn(
        'Plan (Projects%20aaaa/Plan%201a2b3c4d5e6f78901a2b3c4d5e6f7890.md), Kit, tent (Kit%2C%20tent.md)',
      ),
    ).toEqual(['Plan', 'Kit, tent'])
  })

  test('is nothing for words that happen to hold brackets', () => {
    expect(pagesIn('See the plan (draft)')).toBeNull()
    expect(pagesIn('(a.md)')).toBeNull()
  })
})

describe('what a column holds', () => {
  test('is the one kind every value in it reads as', () => {
    expect(kindOf(['Yes', 'No', ''])).toBe('checkbox')
    expect(kindOf(['12', '3.5', '-1'])).toBe('number')
    expect(kindOf(['12', '007'])).toBe('text')
    expect(kindOf(['March 4, 2026', 'May 1, 2026 9:00 AM'])).toBe('date')
    expect(kindOf([])).toBe('text')
  })

  test('is a list only where a label comes back in another row', () => {
    expect(kindOf(['Work, Home', 'Home'])).toBe('list')
    expect(kindOf(['Long, and worth it', 'Short'])).toBe('text')
    expect(kindOf(['Yes, it works. Mostly.', 'Yes, it works. Mostly.'])).toBe('text')
  })
})
