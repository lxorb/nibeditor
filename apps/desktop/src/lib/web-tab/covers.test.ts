// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { cutOf, layersOver, noticeRows, type Layer } from './covers'

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
    expect(found.some((one) => one.node === notices)).toBe(false)
  })

  test('the row is what a page watches to hear a card come or go', () => {
    const { notices } = row()
    expect(noticeRows()).toEqual([notices])
  })
})
