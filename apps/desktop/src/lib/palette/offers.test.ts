import { describe, expect, test } from 'vitest'
import { makeable, typedAddress, withOffers } from './offers'
import type { Row } from './rows'
import { command, named, tab } from './world.fixture'

const taken = new Set(['plan.md', 'uni/lecture 3.md'])

const RUN: Row = { kind: 'command', command: command('print', 'Print') }

describe('the note a name typed would make', () => {
  test('is offered for a name nothing has', () => {
    expect(makeable('Groceries', taken)).toEqual({ folder: '', name: 'Groceries.md' })
    expect(makeable('Uni/Lecture 4', taken)).toEqual({ folder: 'Uni', name: 'Lecture 4.md' })
  })

  test('is not offered for one the space already has, whatever its case', () => {
    expect(makeable('plan', taken)).toBeNull()
    expect(makeable('Uni/lecture 3', taken)).toBeNull()
  })

  test('is not offered where the words do not read as a name', () => {
    expect(makeable('What?', taken)).toBeNull()
    expect(makeable('', taken)).toBeNull()
  })
})

describe('where the offers go', () => {
  const make = { folder: '', name: 'Print it.md' }

  test('after everything that was found, so Enter still takes the command', () => {
    expect(withOffers([RUN], 'print it', null, make).map(named)).toEqual([
      '> Print',
      'new Print it.md',
    ])
  })

  test('first, where nothing was found, so Enter makes the note', () => {
    expect(
      withOffers([], 'Groceries', null, { folder: '', name: 'Groceries.md' }).map(named),
    ).toEqual(['new Groceries.md'])
  })

  test('an address typed goes last, unless it is written out in full', () => {
    const address = { url: 'https://svelte.dev/', shown: 'svelte.dev' }
    expect(withOffers([RUN], 'svelte.dev', address, null).map(named)).toEqual([
      '> Print',
      'go svelte.dev',
    ])
    expect(withOffers([RUN], 'https://svelte.dev', address, null).map(named)).toEqual([
      'go svelte.dev',
      '> Print',
    ])
  })

  test('an address a row already goes to is that row', () => {
    const address = { url: 'https://svelte.dev/', shown: 'svelte.dev' }
    const open: Row = {
      kind: 'tab',
      tab: tab('w', 'Svelte', { kind: 'web', url: 'https://svelte.dev/' }),
      folder: null,
      shared: false,
    }
    expect(withOffers([open], 'svelte.dev', address, null).map(named)).toEqual(['tab Svelte'])
  })
})

describe('an address typed', () => {
  test('is an address where it reads as one, and nothing for words', () => {
    expect(typedAddress('svelte.dev')).toBe('https://svelte.dev')
    expect(typedAddress('https://svelte.dev/docs')).toBe('https://svelte.dev/docs')
    expect(typedAddress('svelte docs')).toBeNull()
    expect(typedAddress('plan')).toBeNull()
  })
})
