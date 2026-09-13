import { describe, expect, test } from 'vitest'
import { emptyCanvas, isPage, type PageNode, PAPERS, readCanvas, writeCanvas } from './canvas'
import {
  added,
  blankPages,
  columnHeight,
  emptyPages,
  GROWTH,
  GUTTER,
  grown,
  laidOut,
  moved,
  newPage,
  onPage,
  pageAt,
  pageCount,
  pagesFromPdf,
  pageShowing,
  pagesOf,
  pdfPage,
  removed,
  reshaped,
  settled,
} from './pages'

/** A page with an id nobody has to read, so a test can name it. */
function page(id: string, extra: Partial<PageNode> = {}): PageNode {
  return { ...newPage(), id, ...extra }
}

describe('a page note as a file', () => {
  test('a blank one is one A4 page', () => {
    const canvas = readCanvas(blankPages())
    const pages = pagesOf(canvas)

    expect(pages).toHaveLength(1)
    expect(pages[0]?.width).toBe(PAPERS.a4.width)
    expect(pages[0]?.height).toBe(PAPERS.a4.height)
    expect(pages[0]?.pattern).toBe('blank')
  })

  test('writes each page as a spec node, so the file is JSON Canvas', () => {
    const written = JSON.parse(blankPages()) as {
      nodes: { id: string; type: string; label?: string }[]
      nib: { pages: { id: string }[] }
    }

    expect(written.nodes).toHaveLength(1)
    expect(written.nodes[0]?.type).toBe('group')
    expect(written.nodes[0]?.label).toBe('Page 1')
    expect(written.nib.pages).toHaveLength(1)
    // The record and the node are two halves of one page, joined by the id.
    expect(written.nib.pages[0]?.id).toBe(written.nodes[0]?.id)
  })

  test('a page with a PDF behind it is a file node with the page in its subpath', () => {
    const canvas = pagesFromPdf('Paper.pdf', [
      { width: 600, height: 800 },
      { width: 600, height: 800 },
    ])

    const written = JSON.parse(writeCanvas(canvas)) as {
      nodes: { type: string; file?: string; subpath?: string }[]
    }

    expect(written.nodes.map((node) => node.type)).toEqual(['file', 'file'])
    expect(written.nodes[0]?.file).toBe('Paper.pdf')
    expect(written.nodes[0]?.subpath).toBe('#page=1')
    expect(written.nodes[1]?.subpath).toBe('#page=2')
  })

  test('reads back everything it wrote, whole', () => {
    const paper = pagesFromPdf('Paper.pdf', [{ width: 600, height: 800 }])
    const first = pagesOf(paper)[0]
    if (!first) throw new Error('no page')

    const before = reshaped(added(paper).canvas, first.id, { pattern: 'grid' })
    expect(pagesOf(readCanvas(writeCanvas(before)))).toEqual(pagesOf(before))
  })

  test('written back byte for byte', () => {
    const once = writeCanvas(pagesFromPdf('Paper.pdf', [{ width: 600, height: 800 }]))
    expect(writeCanvas(readCanvas(once))).toBe(once)
  })

  test('a canvas with no pages is written exactly as it was, with no pages key', () => {
    const plain = writeCanvas(emptyCanvas())
    expect(plain).not.toContain('pages')
  })

  test('a record naming a card is not a page: the card stays a card', () => {
    const file = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 40, text: 'hello' }],
      edges: [],
      nib: { version: 1, pages: [{ id: 'a', paper: 'a4', pattern: 'lines' }] },
    })

    const canvas = readCanvas(file)
    expect(pagesOf(canvas)).toHaveLength(0)
    expect(canvas.nodes[0]?.type).toBe('text')
  })

  test('a page whose record was lost degrades to the frame it looks like', () => {
    const file = JSON.stringify({
      nodes: [{ id: 'a', type: 'group', x: 0, y: 0, width: 794, height: 1123, label: 'Page 1' }],
      edges: [],
    })

    const canvas = readCanvas(file)
    expect(pagesOf(canvas)).toHaveLength(0)
    expect(canvas.nodes[0]?.type).toBe('group')
  })

  test('a page keeps its place among the cards', () => {
    const canvas = emptyPages()
    const sheet = pagesOf(canvas)[0]
    const card = {
      id: 'card',
      type: 'text' as const,
      x: 10,
      y: 10,
      width: 100,
      height: 40,
      text: 'x',
    }

    const both = { ...canvas, nodes: [...canvas.nodes, card] }
    const back = readCanvas(writeCanvas(both))

    expect(back.nodes.map((node) => node.id)).toEqual([sheet?.id, 'card'])
  })
})

describe('the column', () => {
  test('lays the pages out top to bottom with a gutter between them', () => {
    const laid = laidOut([page('a'), page('b'), page('c')])

    expect(laid[0]?.y).toBe(0)
    expect(laid[1]?.y).toBe(PAPERS.a4.height + GUTTER)
    expect(laid[2]?.y).toBe(2 * (PAPERS.a4.height + GUTTER))
  })

  test('centres every page on the same middle, whatever their sizes', () => {
    const laid = laidOut([page('a'), page('b', { width: 500 })])

    expect(laid[0]?.x).toBe(-PAPERS.a4.width / 2)
    expect(laid[1]?.x).toBe(-250)
  })

  test('hands back the very same pages when nothing moved', () => {
    const pages = laidOut([page('a'), page('b')])
    expect(laidOut(pages)).toEqual(pages)
    expect(laidOut(pages)[0]).toBe(pages[0])
  })

  test('a canvas already settled is handed straight back', () => {
    const canvas = emptyPages()
    expect(settled(canvas)).toBe(canvas)
  })

  test('is as tall as its pages and their gutters, with no gutter after the last', () => {
    expect(columnHeight([page('a'), page('b')])).toBe(2 * PAPERS.a4.height + GUTTER)
    expect(columnHeight([])).toBe(0)
  })
})

describe('adding and taking away', () => {
  test('a page goes on the end and the note is laid out round it', () => {
    const { canvas, id } = added(emptyPages())
    const pages = pagesOf(canvas)

    expect(pages).toHaveLength(2)
    expect(pages[1]?.id).toBe(id)
    expect(pages[1]?.y).toBe(PAPERS.a4.height + GUTTER)
  })

  test('a page added after one goes after that one', () => {
    const three = added(added(emptyPages()).canvas).canvas
    const first = pagesOf(three)[0]
    const { canvas, id } = added(three, first?.id)

    expect(pagesOf(canvas).map((one) => one.id)[1]).toBe(id)
  })

  test('a page takes the size and the ruling of the one it follows', () => {
    const start = emptyPages()
    const sheet = pagesOf(start)[0]
    if (!sheet) throw new Error('no page')

    const { canvas } = added(reshaped(start, sheet.id, { pattern: 'lines' }))
    expect(pagesOf(canvas)[1]?.pattern).toBe('lines')
  })

  test('taking a page away takes what was written on it', () => {
    const two = added(emptyPages()).canvas
    const pages = pagesOf(two)
    const second = pages[1]
    if (!second) throw new Error('no second page')

    const withInk = {
      ...two,
      nodes: [
        ...two.nodes,
        {
          id: 'card',
          type: 'text' as const,
          x: second.x + 10,
          y: second.y + 10,
          width: 80,
          height: 30,
          text: 'on the second',
        },
      ],
      ink: [
        {
          id: 'stroke',
          tool: 'pen' as const,
          color: '1',
          size: 2,
          points: [{ x: second.x + 5, y: second.y + 5, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 }],
        },
      ],
    }

    const left = removed(withInk, second.id)
    expect(pagesOf(left)).toHaveLength(1)
    expect(left.nodes.some((node) => node.id === 'card')).toBe(false)
    expect(left.ink).toHaveLength(0)
  })

  test('the last page is never taken away', () => {
    const one = emptyPages()
    expect(removed(one, pagesOf(one)[0]?.id ?? '')).toBe(one)
  })
})

describe('reordering', () => {
  test('a page moved carries what is on it', () => {
    const two = added(emptyPages()).canvas
    const pages = pagesOf(two)
    const second = pages[1]
    if (!second) throw new Error('no second page')

    const withCard = {
      ...two,
      nodes: [
        ...two.nodes,
        {
          id: 'card',
          type: 'text' as const,
          x: second.x + 10,
          y: second.y + 20,
          width: 80,
          height: 30,
          text: 'on the second',
        },
      ],
    }

    const swapped = moved(withCard, second.id, 0)
    const card = swapped.nodes.find((node) => node.id === 'card')

    expect(pagesOf(swapped)[0]?.id).toBe(second.id)
    // The page it was on is now first, so what was on it is 20 from the top.
    expect(card?.y).toBe(20)
  })

  test('a page already where it is asked to go comes back unchanged', () => {
    const two = added(emptyPages()).canvas
    expect(moved(two, pagesOf(two)[0]?.id ?? '', 0)).toBe(two)
  })

  test('an id that names no page changes nothing', () => {
    const one = emptyPages()
    expect(moved(one, 'nothing', 3)).toBe(one)
  })
})

describe('a long page', () => {
  test('grows in whole steps to hold what reaches past it', () => {
    const start = emptyPages()
    const sheet = pagesOf(start)[0]
    if (!sheet) throw new Error('no page')

    const endless = reshaped(start, sheet.id, { paper: 'long' })
    const taller = grown(endless, new Map([[sheet.id, PAPERS.a4.height + 400]]))
    const height = pagesOf(taller)[0]?.height ?? 0

    expect(height).toBeGreaterThan(PAPERS.a4.height)
    // In whole screenfuls, so the page grows in steps a scroll can follow.
    expect((height - PAPERS.a4.height) % GROWTH).toBe(0)
  })

  test('a page with nothing reaching past it is left where it is', () => {
    const start = emptyPages()
    const sheet = pagesOf(start)[0]
    if (!sheet) throw new Error('no page')

    const endless = reshaped(start, sheet.id, { paper: 'long' })
    expect(grown(endless, new Map([[sheet.id, 10]]))).toBe(endless)
  })

  test('A4 never grows: writing past the bottom of a sheet is writing off it', () => {
    const start = emptyPages()
    const sheet = pagesOf(start)[0]
    if (!sheet) throw new Error('no page')

    expect(grown(start, new Map([[sheet.id, 9_000]]))).toBe(start)
  })

  test('made A4 again it goes back to A4', () => {
    const start = emptyPages()
    const sheet = pagesOf(start)[0]
    if (!sheet) throw new Error('no page')

    const endless = reshaped(start, sheet.id, { paper: 'long' })
    const taller = grown(endless, new Map([[sheet.id, PAPERS.a4.height + 900]]))
    const back = reshaped(taller, sheet.id, { paper: 'a4' })

    expect(pagesOf(back)[0]?.height).toBe(PAPERS.a4.height)
  })
})

describe('which page a thing is on', () => {
  test('a point on a page, and a point in a gutter', () => {
    const pages = laidOut([page('a'), page('b')])
    const second = pages[1]
    if (!second) throw new Error('no second page')

    expect(pageAt(pages, { x: 0, y: 10 })?.id).toBe('a')
    expect(pageAt(pages, { x: 0, y: second.y + 10 })?.id).toBe('b')
    expect(pageAt(pages, { x: 0, y: PAPERS.a4.height + 5 })).toBeNull()
  })

  test('a stroke belongs to the page the pen went down on', () => {
    const pages = laidOut([page('a'), page('b')])
    const first = pages[0]
    if (!first) throw new Error('no page')

    const box = { x: first.x, y: first.y, width: first.width, height: first.height }
    const over = {
      points: [
        { x: 0, y: first.height - 4 },
        { x: 0, y: first.height + 200 },
      ],
    }

    expect(onPage(over, box)).toBe(true)
    expect(onPage({ points: [] }, box)).toBe(false)
  })

  test('the page being looked at is the one under the middle of the view', () => {
    const pages = laidOut([page('a'), page('b'), page('c')])

    expect(pageShowing(pages, 0, 600)).toBe(1)
    expect(pageShowing(pages, PAPERS.a4.height + GUTTER, 600)).toBe(2)
    expect(pageShowing(pages, 99_999, 600)).toBe(3)
    expect(pageShowing([], 0, 600)).toBe(0)
  })
})

describe('a page out of a PDF', () => {
  test('is the size the paper says, page by page', () => {
    const canvas = pagesFromPdf('Paper.pdf', [
      { width: 600, height: 800 },
      { width: 800, height: 600 },
    ])
    const pages = pagesOf(canvas)

    expect(pages[0]).toMatchObject({ width: 600, height: 800, file: 'Paper.pdf', page: 1 })
    expect(pages[1]).toMatchObject({ width: 800, height: 600, file: 'Paper.pdf', page: 2 })
  })

  test('says which paper each page is, so a Letter paper is not called A4', () => {
    const canvas = pagesFromPdf('Paper.pdf', [
      { width: PAPERS.letter.width, height: PAPERS.letter.height },
      { width: PAPERS.a4.width, height: PAPERS.a4.height },
      // Neither, which is most of the papers in the world: the page is its own size
      // and the name falls back to the one every other page note starts as.
      { width: 400, height: 1200 },
    ])
    const pages = pagesOf(canvas)

    expect(pages.map((one) => one.paper)).toEqual(['letter', 'a4', 'a4'])
    // And the size is still the paper's own, whatever it is called.
    expect(pages[2]).toMatchObject({ width: 400, height: 1200 })
  })

  test('a page named Letter keeps Letter when the file is read back', () => {
    const once = pagesFromPdf('Paper.pdf', [
      { width: PAPERS.letter.width, height: PAPERS.letter.height },
    ])
    expect(pagesOf(readCanvas(writeCanvas(once)))[0]?.paper).toBe('letter')
  })

  test('a paper with no pages still gives somewhere to write', () => {
    expect(pagesOf(pagesFromPdf('Paper.pdf', []))).toHaveLength(1)
  })

  test('one page is a page and nothing else', () => {
    const one = pdfPage('Paper.pdf', 3, 600, 800)
    expect(isPage(one)).toBe(true)
    expect(one.page).toBe(3)
  })

  test('counts its pages', () => {
    expect(pageCount(pagesFromPdf('Paper.pdf', [{ width: 1, height: 1 }]))).toBe(1)
    expect(pageCount(emptyCanvas())).toBe(0)
  })
})
