import { describe, expect, it } from 'vitest'
import { sizeOf } from './size'

const desktop = { cols: 180, rows: 50 }
const laptop = { cols: 120, rows: 36 }
const phone = { cols: 44, rows: 20 }

describe('sizeOf', () => {
  it('has no size before anybody typed', () => {
    expect(sizeOf([])).toBeNull()
  })

  it('is the typist’s while only they type', () => {
    expect(sizeOf([{ who: 'emil', at: 1, ...desktop }])).toEqual(desktop)
  })

  it('stays the desktop’s while a phone only watches (a watcher never types)', () => {
    const typed = [
      { who: 'emil', at: 1, ...desktop },
      { who: 'emil', at: 5, ...desktop },
    ]
    expect(sizeOf(typed)).toEqual(desktop)
  })

  it('is the phone’s once the phone types, and the desktop’s again after', () => {
    const typed = [
      { who: 'emil', at: 1, ...desktop },
      { who: 'emil', at: 2, ...phone },
    ]
    expect(sizeOf(typed)).toEqual(phone)
    expect(sizeOf([...typed, { who: 'emil', at: 3, ...desktop }])).toEqual(desktop)
  })

  it('follows whoever typed last, not the smallest', () => {
    const typed = [
      { who: 'ana', at: 10, ...phone },
      { who: 'emil', at: 20, ...laptop },
      { who: 'ana', at: 15, ...phone },
    ]
    expect(sizeOf(typed)).toEqual(laptop)
  })

  it('gives a tie to the input listed later, as the later frame to arrive', () => {
    const typed = [
      { who: 'ana', at: 7, ...phone },
      { who: 'emil', at: 7, ...laptop },
    ]
    expect(sizeOf(typed)).toEqual(laptop)
    expect(sizeOf([...typed].reverse())).toEqual(phone)
  })

  it('passes over an input from a screen not yet measured', () => {
    const typed = [
      { who: 'emil', at: 1, ...laptop },
      { who: 'ana', at: 2, cols: 0, rows: 0 },
      { who: 'ana', at: 3, cols: Number.NaN, rows: 24 },
    ]
    expect(sizeOf(typed)).toEqual(laptop)
    expect(sizeOf(typed.slice(1))).toBeNull()
  })
})
