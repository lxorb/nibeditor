// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import {
  bringsLayer,
  clearOf,
  cutOf,
  layersOver,
  noticeRows,
  watchArrivals,
  type Layer,
} from './covers'

const PAGE = { x: 300, y: 100, width: 900, height: 600 }

function float(x: number, y: number, width: number, height: number, radius = 8): Layer {
  return { box: { x, y, width, height }, radius, scrim: false }
}

const SCRIM: Layer = { box: { x: 0, y: 0, width: 1200, height: 800 }, radius: 0, scrim: true }

describe('what of a page the app is over', () => {
  test('nothing open is nothing over it', () => {
    expect(cutOf(PAGE, [])).toBeNull()
  })

  test('a menu over the file list leaves the page alone', () => {
    expect(cutOf(PAGE, [float(20, 200, 220, 300)])).toBeNull()
  })

  test("a tab's card over the strip and not the page leaves it alone", () => {
    expect(cutOf(PAGE, [float(320, 30, 256, 70)])).toBeNull()
  })

  test('a card hanging over the page is cut out of it, in the page’s own coordinates', () => {
    expect(cutOf(PAGE, [float(320, 30, 256, 216)])).toEqual({
      all: false,
      hollows: [{ x: 20, y: -70, width: 256, height: 216, radius: 8 }],
    })
  })

  test('each layer over the page is its own hollow', () => {
    const cut = cutOf(PAGE, [
      float(400, 120, 200, 300),
      float(620, 140, 180, 200),
      float(0, 0, 10, 10),
    ])
    expect(cut?.all).toBe(false)
    expect(cut?.hollows).toHaveLength(2)
  })

  test('a scrim covers all of the page, and the sheet on it is still its own hollow', () => {
    const cut = cutOf(PAGE, [SCRIM, float(400, 150, 500, 400, 12)])
    expect(cut?.all).toBe(true)
    expect(cut?.hollows).toEqual([{ x: 100, y: 50, width: 500, height: 400, radius: 12 }])
  })

  test('a layer with no size yet is not over anything', () => {
    expect(cutOf(PAGE, [float(400, 120, 0, 0)])).toBeNull()
  })

  test('a layer only touching the edge of the page is not over it', () => {
    expect(cutOf(PAGE, [float(100, 100, 200, 100)])).toBeNull()
  })
})

/** A toast floats over the foot of the panes (#218), so a page under it is cut round
 *  it like any other layer - each card, and not the row, whose empty tracks are the
 *  page's own. Which elements are found is all jsdom can say: it has no layout. */
describe("the notices row's cards", () => {
  function row(): { hole: HTMLElement; notices: HTMLElement; toast: HTMLElement } {
    document.body.innerHTML = `
      <div data-panes>
        <div class="hole"></div>
        <div class="notices" data-notices><div class="toast" role="status"><p>Deleted</p></div></div>
      </div>`
    const find = (selector: string) => document.querySelector<HTMLElement>(selector)!
    return { hole: find('.hole'), notices: find('[data-notices]'), toast: find('.toast') }
  }

  test('each card is a layer the page is cut round, and the row is not', () => {
    const { hole, notices, toast } = row()
    const found = layersOver(hole)
    expect(found.map((one) => one.node)).toEqual([toast])
    expect(found[0]?.scrim).toBe(false)
    expect(found[0]?.notice).toBe(true)
    expect(found.some((one) => one.node === notices)).toBe(false)
  })

  test('the row is what a page watches to hear a card come or go', () => {
    const { notices } = row()
    expect(noticeRows()).toEqual([notices])
  })
})

/** On an engine that cannot cut, a layer hides the page behind its still - and a notice is
 *  up until somebody answers it, the update notice for a day. So the page ends above the
 *  notices there, the way Chrome gives its download bar room of its own. */
describe('a page on an engine that cannot cut, over the notices', () => {
  function notice(x: number, y: number, width: number, height: number): Layer {
    return { ...float(x, y, width, height), notice: true }
  }

  test('ends above the notices, and is cut by nothing', () => {
    const clear = clearOf(PAGE, [notice(850, 640, 330, 52)])
    expect(clear.box).toEqual({ x: 300, y: 100, width: 900, height: 540 })
    expect(cutOf(clear.box, clear.layers)).toBeNull()
  })

  test('above the highest of them', () => {
    const clear = clearOf(PAGE, [notice(850, 640, 330, 52), notice(600, 620.6, 200, 72)])
    expect(clear.box.height).toBe(520)
  })

  test('and a menu over it at the same time is still a layer over the page', () => {
    const menu = float(400, 150, 220, 300)
    const clear = clearOf(PAGE, [notice(850, 640, 330, 52), menu])
    expect(clear.layers).toEqual([menu])
    expect(cutOf(clear.box, clear.layers)?.hollows).toHaveLength(1)
  })

  test('a notice beside the page leaves the page its whole height', () => {
    expect(clearOf(PAGE, [notice(20, 640, 240, 52)]).box).toEqual(PAGE)
  })

  test('notices that would leave less than half of it are layers like any other', () => {
    const tall = notice(850, 300, 330, 380)
    const clear = clearOf(PAGE, [tall])
    expect(clear.box).toEqual(PAGE)
    expect(clear.layers).toEqual([tall])
  })
})

/** A layer that arrives by no press and by no overlay stack - a hint, a second toast in a
 *  row that did not change size, a card a row puts up under the pointer - was a layer the
 *  page never heard of, drawn behind the page. */
describe('a layer arriving by itself', () => {
  function record(target: Node, added: Node[] = [], removed: Node[] = []) {
    const list = (nodes: Node[]) => nodes as unknown as NodeList
    return { target, addedNodes: list(added), removedNodes: list(removed) }
  }

  test('is heard as it comes, and as it goes', () => {
    document.body.innerHTML = '<div class="nib-layer"></div><p>words</p>'
    const layer = document.querySelector('.nib-layer')!
    const words = document.querySelector('p')!
    expect(bringsLayer(record(document.body, [layer]))).toBe(true)
    expect(bringsLayer(record(document.body, [], [layer]))).toBe(true)
    expect(bringsLayer(record(document.body, [words, document.createTextNode('x')]))).toBe(false)
  })

  test('inside whatever brought it', () => {
    document.body.innerHTML = '<section><div><span class="nib-bubble"></span></div></section>'
    expect(bringsLayer(record(document.body, [document.querySelector('section')!]))).toBe(true)
  })

  test('and any card in the notices row, which once taken out is in no row', () => {
    document.body.innerHTML = '<div data-notices></div>'
    const card = document.createElement('div')
    expect(bringsLayer(record(document.querySelector('[data-notices]')!, [], [card]))).toBe(true)
  })

  test('every page is told, by one watch on the window', async () => {
    document.body.innerHTML = '<main></main>'
    let one = 0
    let other = 0
    const stopOne = watchArrivals(() => (one += 1))
    const stopOther = watchArrivals(() => (other += 1))

    document
      .querySelector('main')!
      .append(Object.assign(document.createElement('div'), { className: 'nib-screen' }))
    await Promise.resolve()
    expect([one, other]).toEqual([1, 1])

    // Typing in a note beside the page is no layer, and says nothing.
    document.querySelector('main')!.append(document.createElement('p'))
    await Promise.resolve()
    expect([one, other]).toEqual([1, 1])

    stopOne()
    document.querySelector('.nib-screen')!.remove()
    await Promise.resolve()
    expect([one, other]).toEqual([1, 2])

    stopOther()
    document
      .querySelector('main')!
      .append(Object.assign(document.createElement('div'), { className: 'nib-layer' }))
    await Promise.resolve()
    expect([one, other]).toEqual([1, 2])
  })
})
