import { describe, expect, test } from 'vitest'
import { fuzzyAny, rank, recentFirst } from './fuzzy'

describe('ranking by any of several readings', () => {
  test('takes the best of them', () => {
    expect(fuzzyAny('uni', ['Lecture 3', 'Uni/Lecture 3'])).not.toBeNull()
    expect(fuzzyAny('zzz', ['Lecture 3', 'Uni/Lecture 3'])).toBeNull()
  })

  test('finds a note by the folder it is in', () => {
    const notes = ['Lecture 3', 'Plan']
    const paths: Record<string, string> = { 'Lecture 3': 'Uni/Lecture 3', Plan: 'Home/Plan' }
    expect(rank('uni/lec', notes, (one) => [one, paths[one] ?? one])).toEqual(['Lecture 3'])
  })
})

describe('what was used lately goes first', () => {
  const items = ['a', 'b', 'c', 'd']

  test('moves the named ones to the front, most recent first', () => {
    expect(recentFirst(items, ['c', 'a'], (one) => one)).toEqual(['c', 'a', 'b', 'd'])
  })

  test('ignores a name nothing answers to', () => {
    expect(recentFirst(items, ['gone', 'b'], (one) => one)).toEqual(['b', 'a', 'c', 'd'])
  })

  test('is the order of an empty field, and breaks a tie once something is typed', () => {
    const notes = ['Plan A', 'Plan B', 'Other']
    expect(
      rank(
        '',
        recentFirst(notes, ['Other'], (one) => one),
        (one) => one,
      ),
    ).toEqual(['Other', 'Plan A', 'Plan B'])
    expect(
      rank(
        'plan',
        recentFirst(notes, ['Plan B'], (one) => one),
        (one) => one,
      ),
    ).toEqual(['Plan B', 'Plan A'])
  })
})
