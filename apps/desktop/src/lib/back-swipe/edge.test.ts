import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { chainOf, type Scroller, taken } from './edge'

const NOWHERE = { left: false, right: false }

const scroller = (left: number, range: number, extra: Partial<Scroller> = {}): Scroller => ({
  left,
  range,
  rtl: false,
  keeps: false,
  ...extra,
})

describe('which way the content would still scroll', () => {
  test('nothing that scrolls sideways takes nothing', () => {
    expect(taken([])).toEqual(NOWHERE)
  })

  test('a scroller in the middle takes both ways, and one at an edge only the other', () => {
    expect(taken([scroller(300, 1500)])).toEqual({ left: true, right: true })
    expect(taken([scroller(0, 1500)])).toEqual({ left: false, right: true })
    expect(taken([scroller(1500, 1500)])).toEqual({ left: true, right: false })
    // A zoomed page stops a fraction short of its edge.
    expect(taken([scroller(1499.7, 1500)])).toEqual({ left: true, right: false })
  })

  test('right to left counts from nought down', () => {
    expect(taken([scroller(0, 1500, { rtl: true })])).toEqual({ left: true, right: false })
    expect(taken([scroller(-1500, 1500, { rtl: true })])).toEqual({ left: false, right: true })
  })

  test('any scroller along the chain can take it', () => {
    expect(taken([scroller(0, 100), scroller(40, 900)])).toEqual({ left: true, right: true })
  })

  test('a scroller that keeps its overscroll takes both ways, and the chain stops there', () => {
    expect(taken([scroller(0, 0, { keeps: true })])).toEqual({ left: true, right: true })
    expect(taken([scroller(0, 100, { keeps: true }), scroller(40, 900)])).toEqual({
      left: true,
      right: true,
    })
  })
})

describe('the chain under the pointer', () => {
  const { window } = new JSDOM(`<div id="pane" style="overscroll-behavior: none">
    <div id="table" style="overflow-x: auto"><span id="cell">x</span></div>
    <div id="plain" style="overflow-x: hidden; overscroll-behavior-x: contain"><b id="in">y</b></div>
    <p id="words">z</p>
  </div>`)
  const at = (id: string): HTMLElement => {
    const one = window.document.getElementById(id)
    if (!one) throw new Error(`no #${id}`)
    return one
  }
  const sized = (id: string, scrollWidth: number, clientWidth: number, scrollLeft: number) =>
    Object.defineProperties(at(id), {
      scrollWidth: { value: scrollWidth },
      clientWidth: { value: clientWidth },
      scrollLeft: { value: scrollLeft },
    })
  sized('table', 1200, 400, 80)

  test('a wide table is a scroller, from inside it', () => {
    expect(chainOf(at('cell'), at('words').parentElement as Element)).toEqual([scroller(80, 800)])
  })

  test('words in no scroller are no chain, whatever the pane itself says above them', () => {
    // The pane's root says `none` for the window's own sake, and the root is not a scroll
    // container sideways, so it keeps nothing.
    expect(chainOf(at('words'), at('pane'))).toEqual([])
  })

  test('a container that keeps its overscroll is in the chain though it scrolls nowhere', () => {
    expect(chainOf(at('in'), at('pane'))).toEqual([scroller(0, 0, { keeps: true })])
  })
})
