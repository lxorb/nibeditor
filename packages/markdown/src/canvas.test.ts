import { describe, expect, test } from 'vitest'
import {
  blankCanvas,
  type Canvas,
  canvasArchivedEdit,
  canvasIconEdit,
  clampOpacity,
  DEFAULT_INK,
  freshId,
  FURTHEST,
  isShape,
  readCanvas,
  SHAPES,
  writeCanvas,
} from './canvas'

/** A canvas written the way the spec's own examples are: every node type, every
 *  optional field, and edges naming their sides and their ends.
 *
 *  https://jsoncanvas.org/spec/1.0/ */
const SPEC_EXAMPLE = {
  nodes: [
    { id: 'a', type: 'text', x: 0, y: 0, width: 250, height: 60, text: '# Hello', color: '1' },
    {
      id: 'b',
      type: 'file',
      x: 300,
      y: 0,
      width: 400,
      height: 400,
      file: 'Notes/Plan.md',
      subpath: '#Heading',
    },
    { id: 'c', type: 'link', x: 0, y: 200, width: 250, height: 80, url: 'https://example.com' },
    {
      id: 'd',
      type: 'group',
      x: -40,
      y: -40,
      width: 800,
      height: 500,
      label: 'Everything',
      background: 'assets/paper.png',
      backgroundStyle: 'cover',
      color: '#ff0000',
    },
  ],
  edges: [
    {
      id: 'e1',
      fromNode: 'a',
      fromSide: 'right',
      fromEnd: 'arrow',
      toNode: 'b',
      toSide: 'left',
      toEnd: 'none',
      color: '4',
      label: 'leads to',
    },
    { id: 'e2', fromNode: 'b', toNode: 'c' },
  ],
}

describe('reading a canvas', () => {
  const canvas = readCanvas(JSON.stringify(SPEC_EXAMPLE))

  test('takes every kind of node the spec names', () => {
    expect(canvas.nodes.map((node) => node.type)).toEqual(['text', 'file', 'link', 'group'])
  })

  test('keeps what each kind of node is made of', () => {
    const [text, file, link, group] = canvas.nodes
    expect(text).toMatchObject({ text: '# Hello', color: '1', x: 0, width: 250 })
    expect(file).toMatchObject({ file: 'Notes/Plan.md', subpath: '#Heading' })
    expect(link).toMatchObject({ url: 'https://example.com' })
    expect(group).toMatchObject({
      label: 'Everything',
      background: 'assets/paper.png',
      backgroundStyle: 'cover',
      color: '#ff0000',
    })
  })

  test('keeps the sides, the ends, the colour and the words of an edge', () => {
    expect(canvas.edges[0]).toEqual({
      id: 'e1',
      fromNode: 'a',
      fromSide: 'right',
      fromEnd: 'arrow',
      toNode: 'b',
      toSide: 'left',
      toEnd: 'none',
      color: '4',
      label: 'leads to',
    })
  })

  test('leaves out what an edge does not say, so the defaults stay the defaults', () => {
    expect(canvas.edges[1]).toEqual({ id: 'e2', fromNode: 'b', toNode: 'c' })
  })

  test('is an empty canvas for a file that is not one', () => {
    const empty = {
      nodes: [],
      edges: [],
      ink: [],
      at: {},
      gone: {},
      icon: null,
      iconColor: null,
      archived: null,
    }
    expect(readCanvas('')).toEqual(empty)
    expect(readCanvas('nonsense')).toEqual(empty)
    expect(readCanvas('[]')).toEqual(empty)
    expect(readCanvas('{}')).toEqual(empty)
  })
})

describe('reading a canvas somebody else wrote', () => {
  test('drops a node with no id, no known type, or nothing of its own in it', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [
          { type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'no id' },
          { id: 'x', type: 'sticky', x: 0, y: 0, width: 10, height: 10 },
          { id: 'y', type: 'text', x: 0, y: 0, width: 10, height: 10 },
          { id: 'z', type: 'file', x: 0, y: 0, width: 10, height: 10, file: '' },
          { id: 'ok', type: 'text', x: 0, y: 0, width: 10, height: 10, text: '' },
        ],
      }),
    )

    expect(canvas.nodes.map((node) => node.id)).toEqual(['ok'])
  })

  test('fills in a position and a size that were never written', () => {
    const [node] = readCanvas(
      JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: '' }] }),
    ).nodes

    expect(node).toMatchObject({ x: 0, y: 0, width: 250, height: 60 })
  })

  test('rounds a position to whole pixels, which is what the spec says', () => {
    const [node] = readCanvas(
      JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: '', x: 10.6, y: -3.2 }] }),
    ).nodes

    expect(node).toMatchObject({ x: 11, y: -3 })
  })

  test('keeps the first of two nodes sharing an id, which is what every edge meant', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'first' },
          { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'second' },
        ],
      }),
    )

    expect(canvas.nodes).toHaveLength(1)
    expect(canvas.nodes[0]).toMatchObject({ text: 'first' })
  })

  test('drops an edge that names a node the canvas does not hold', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, text: '' }],
        edges: [
          { id: 'e', fromNode: 'a', toNode: 'gone' },
          { id: 'f', fromNode: 'a', toNode: 'a' },
        ],
      }),
    )

    expect(canvas.edges.map((edge) => edge.id)).toEqual(['f'])
  })

  test('drops a side, an end or a background style it has never heard of', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, text: '' },
          {
            id: 'g',
            type: 'group',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            backgroundStyle: 'stretched',
          },
        ],
        edges: [{ id: 'e', fromNode: 'a', toNode: 'a', fromSide: 'sideways', toEnd: 'circle' }],
      }),
    )

    expect(canvas.nodes[1]).not.toHaveProperty('backgroundStyle')
    expect(canvas.edges[0]).not.toHaveProperty('fromSide')
    expect(canvas.edges[0]).not.toHaveProperty('toEnd')
  })

  test('drops a colour that is neither a preset nor a hex string', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '', color: 'red' },
          { id: 'b', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '', color: '7' },
          { id: 'c', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '', color: '#0f0' },
        ],
      }),
    )

    expect(canvas.nodes.map((node) => node.color)).toEqual([undefined, undefined, '#0f0'])
  })

  test('drops a subpath that does not begin with a hash, as the spec says it must', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'a.md', subpath: 'Top' },
        ],
      }),
    )

    expect(canvas.nodes[0]).not.toHaveProperty('subpath')
  })
})

describe('writing a canvas', () => {
  test('writes only the fields the spec defines', () => {
    const written = JSON.parse(writeCanvas(readCanvas(JSON.stringify(SPEC_EXAMPLE)))) as {
      nodes: Record<string, unknown>[]
      edges: Record<string, unknown>[]
    }

    expect(Object.keys(written.nodes[0] ?? {})).toEqual([
      'id',
      'type',
      'x',
      'y',
      'width',
      'height',
      'color',
      'text',
    ])
    expect(Object.keys(written.edges[1] ?? {})).toEqual(['id', 'fromNode', 'toNode'])
  })

  test('leaves out what is absent rather than writing it as null', () => {
    const written = writeCanvas({
      nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '' }],
      edges: [],
      ink: [],
      at: {},
      gone: {},
    })

    expect(written).not.toContain('color')
    expect(written).not.toContain('null')
  })

  test('is read back as what went in', () => {
    const canvas = readCanvas(JSON.stringify(SPEC_EXAMPLE))
    expect(readCanvas(writeCanvas(canvas))).toEqual(canvas)
  })

  test('is byte for byte the same on its own output', () => {
    const once = writeCanvas(readCanvas(JSON.stringify(SPEC_EXAMPLE)))
    const twice = writeCanvas(readCanvas(once))

    expect(twice).toBe(once)
  })

  test('holds two empty lists before anybody has drawn on it', () => {
    expect(readCanvas(blankCanvas())).toEqual({
      nodes: [],
      edges: [],
      ink: [],
      at: {},
      gone: {},
      icon: null,
      iconColor: null,
      archived: null,
    })
    // Nothing of Nib's in a canvas that has none of Nib's in it.
    expect(blankCanvas()).not.toContain('nib')
    expect(blankCanvas().endsWith('\n')).toBe(true)
  })

  test('keeps the order the nodes were in, which is the order they stack in', () => {
    const canvas: Canvas = {
      nodes: ['c', 'a', 'b'].map((id) => ({
        id,
        type: 'text' as const,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        text: '',
      })),
      edges: [],
      ink: [],
      at: {},
      gone: {},
    }

    expect(readCanvas(writeCanvas(canvas)).nodes.map((node) => node.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('a fresh id', () => {
  test('is sixteen hex characters, which is what Obsidian writes', () => {
    expect(freshId()).toMatch(/^[0-9a-f]{16}$/)
  })

  test('is not the last one', () => {
    const seen = new Set(Array.from({ length: 200 }, () => freshId()))
    expect(seen.size).toBe(200)
  })
})

/** What Nib keeps beyond the spec, and where.
 *
 *  Obsidian's own reader was checked to settle this: an unknown top-level key is
 *  kept whole through a load and a save, an unknown key on a node is swept into
 *  `unknownData` and written back, but a node whose `type` it does not know is
 *  skipped on load and gone from the file on the next save, taking its edges
 *  with it. So ink and shapes go under one top-level key and never into `nodes`,
 *  and these tests hold that line. */
describe('what Nib keeps beyond the spec', () => {
  const drawn: Canvas = {
    nodes: [
      { id: 'card', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'hello' },
      { id: 'box', type: 'shape', shape: 'rect', x: 200, y: 0, width: 80, height: 40, color: '3' },
      { id: 'ray', type: 'shape', shape: 'arrow', x: 0, y: 200, width: 80, height: 40, up: true },
    ],
    edges: [],
    ink: [
      {
        id: 'ink1',
        tool: 'fountain',
        color: '#123456',
        size: 4,
        points: [
          { x: 1, y: 2, pressure: 0.4, tiltX: 3, tiltY: -4, t: 0 },
          { x: 5, y: 6, pressure: 0.8, tiltX: 3, tiltY: -4, t: 16 },
        ],
      },
    ],
    at: { card: 1000, box: 1001 },
    gone: { old: 900 },
    icon: null,
    iconColor: null,
    archived: null,
  }

  const written = writeCanvas(drawn)
  const parsed = JSON.parse(written) as Record<string, unknown>

  test('writes the spec half as the spec, with no shape in it', () => {
    expect((parsed.nodes as { id: string }[]).map((node) => node.id)).toEqual(['card'])
  })

  test('keeps everything else under one key of its own', () => {
    expect(Object.keys(parsed)).toEqual(['nodes', 'edges', 'nib'])
  })

  test('reads its own file back exactly, shapes, ink, order and times', () => {
    expect(readCanvas(written)).toEqual(drawn)
  })

  test('is byte for byte the same on its own output', () => {
    expect(writeCanvas(readCanvas(written))).toBe(written)
  })

  test('keeps the z order a shape sits at among the cards', () => {
    const back: Canvas = { ...drawn, nodes: [drawn.nodes[1]!, drawn.nodes[0]!, drawn.nodes[2]!] }
    expect(readCanvas(writeCanvas(back)).nodes.map((node) => node.id)).toEqual([
      'box',
      'card',
      'ray',
    ])
  })

  /** Seven shapes, and a body that can hold a name. A shape in a diagram is a shape
   *  with a name in it far more often than it is a shape, and all of it stays under
   *  `nib`: to every other reader of the format the file is the spec exactly. */
  test('keeps all seven shapes, and the words inside one', () => {
    const diagram: Canvas = {
      nodes: SHAPES.map((shape, at) => ({
        id: shape,
        type: 'shape' as const,
        shape,
        x: at * 100,
        y: 0,
        width: 80,
        height: 40,
        ...(shape === 'rhombus' ? { text: 'Ready?' } : {}),
      })),
      edges: [],
      ink: [],
      at: {},
      gone: {},
      icon: null,
      iconColor: null,
      archived: null,
    }

    const back = readCanvas(writeCanvas(diagram))
    expect(back).toEqual(diagram)
    expect(JSON.parse(writeCanvas(diagram)).nodes).toEqual([])
  })

  test('drops words that are not words, and writes none where there are none', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [],
        nib: {
          shapes: [
            { id: 'a', shape: 'rect', x: 0, y: 0, width: 1, height: 1, text: 7 },
            { id: 'b', shape: 'rect', x: 0, y: 0, width: 1, height: 1, text: '' },
          ],
        },
      }),
    )

    expect(canvas.nodes[0]).not.toHaveProperty('text')
    expect(canvas.nodes[1]).not.toHaveProperty('text')
  })

  test('a shape with no size falls back to the same box a card does', () => {
    // The height fell back to the default *width*, so a shape from a file that
    // recorded no size came in four times as tall as it should be.
    const canvas = readCanvas(
      JSON.stringify({ nodes: [], nib: { shapes: [{ id: 'a', shape: 'rect', x: 0, y: 0 }] } }),
    )
    const card = readCanvas(JSON.stringify({ nodes: [{ id: 'b', type: 'text', text: 'hi' }] }))

    expect(canvas.nodes[0]?.width).toBe(card.nodes[0]?.width)
    expect(canvas.nodes[0]?.height).toBe(card.nodes[0]?.height)
  })

  test('says which names are shapes', () => {
    for (const shape of SHAPES) expect(isShape(shape), shape).toBe(true)
    expect(isShape('blob')).toBe(false)
    expect(isShape(undefined)).toBe(false)
  })

  test('still opens a canvas whose nib block is nonsense', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '' }],
        nib: 'what',
      }),
    )

    expect(canvas.nodes).toHaveLength(1)
    expect(canvas.ink).toEqual([])
  })

  /** One point is a dot, which is what a pen tapped once on the plane leaves.
   *  It reads back as the stroke it is; a shape with no shape does not. */
  test('keeps a stroke of one point and drops a shape with no shape', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [],
        nib: {
          ink: [{ id: 'a', tool: 'pen', color: '1', size: 2, points: [1, 2, 0.5, 0, 0, 0] }],
          shapes: [{ id: 'b', shape: 'blob', x: 0, y: 0, width: 1, height: 1 }],
        },
      }),
    )

    expect(canvas.ink.map((one) => one.points.length)).toEqual([1])
    expect(canvas.ink[0]?.points[0]).toEqual({
      x: 1,
      y: 2,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      t: 0,
    })
    expect(canvas.nodes).toEqual([])
  })

  test('drops a stroke with no points at all', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [],
        nib: { ink: [{ id: 'a', tool: 'pen', color: '1', size: 2, points: [] }] },
      }),
    )

    expect(canvas.ink).toEqual([])
  })

  test('a card Obsidian added to a canvas of ours arrives on top', () => {
    const theirs = JSON.parse(written) as { nodes: Record<string, unknown>[] }
    theirs.nodes.push({ id: 'new', type: 'text', x: 9, y: 9, width: 1, height: 1, text: 'theirs' })

    expect(readCanvas(JSON.stringify(theirs)).nodes.map((node) => node.id)).toEqual([
      'card',
      'box',
      'ray',
      'new',
    ])
  })
})

/** How much of the colour a stroke lands is the pen's, not the tool's: a hand
 *  that turned a highlighter solid or a biro faint has said something about that
 *  stroke, and the file has to carry it. A stroke that says nothing goes on
 *  meaning "however this kind of pen comes", so an old canvas is untouched. */
describe('how translucent a stroke was drawn', () => {
  const one = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      nodes: [],
      nib: {
        ink: [
          {
            id: 'a',
            tool: 'highlighter',
            color: '2',
            size: 18,
            points: [1, 2, 0.5, 0, 0, 0, 9, 8, 0.6, 0, 0, 16],
            ...over,
          },
        ],
      },
    })

  test('is not there at all in a canvas that never said', () => {
    expect(readCanvas(one()).ink[0]?.opacity).toBeUndefined()
  })

  test('is read back as it was written', () => {
    expect(readCanvas(one({ opacity: 0.55 })).ink[0]?.opacity).toBe(0.55)
  })

  test('is written down only by a stroke that has one', () => {
    const canvas = readCanvas(one())
    const plain = JSON.parse(writeCanvas(canvas)) as {
      nib: { ink: Record<string, unknown>[] }
    }

    expect(plain.nib.ink[0]).not.toHaveProperty('opacity')
  })

  test('rides through a whole write and read unchanged', () => {
    const drawn: Canvas = {
      nodes: [],
      edges: [],
      ink: [
        {
          id: 'a',
          tool: 'pen',
          color: '1',
          size: 3,
          opacity: 0.3,
          points: [
            { x: 0, y: 0, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 },
            { x: 4, y: 4, pressure: 0.5, tiltX: 0, tiltY: 0, t: 8 },
          ],
        },
      ],
      at: {},
      gone: {},
      icon: null,
      iconColor: null,
      archived: null,
    }

    const written = writeCanvas(drawn)
    expect(readCanvas(written)).toEqual(drawn)
    expect(writeCanvas(readCanvas(written))).toBe(written)
  })

  test('is brought back inside what paint can use when a file says otherwise', () => {
    expect(readCanvas(one({ opacity: 40 })).ink[0]?.opacity).toBe(1)
    expect(readCanvas(one({ opacity: -3 })).ink[0]?.opacity).toBe(0.05)
    expect(readCanvas(one({ opacity: 'blue' })).ink[0]?.opacity).toBeUndefined()
  })

  test('a stroke nobody can see is not a stroke, so nought is not allowed', () => {
    expect(clampOpacity(0)).toBe(0.05)
    expect(clampOpacity(1)).toBe(1)
    expect(clampOpacity(0.4449)).toBe(0.44)
    expect(clampOpacity(Number.NaN)).toBe(1)
  })
})

/** A canvas can arrive from a share, a room or a paste, so what it says about
 *  where things are is a claim and not a fact. A coordinate from past the plane
 *  turns every sum after it into infinity - the box round the canvas, the camera
 *  that frames it, every hit test from then on - so it is brought back to
 *  somewhere a canvas can be looked at. */
describe('a canvas from somewhere else', () => {
  test('brings a node from beyond the plane back onto it', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', x: 1e308, y: -1e308, width: 1e308, height: 5, text: 'far' },
        ],
      }),
    )

    const [node] = canvas.nodes
    expect(node?.x).toBe(FURTHEST)
    expect(node?.y).toBe(-FURTHEST)
    expect(node?.width).toBe(FURTHEST)
    expect(Number.isFinite((node?.x ?? 0) + (node?.width ?? 0))).toBe(true)
  })

  test('brings a stroke drawn beyond the plane back onto it', () => {
    const canvas = readCanvas(
      JSON.stringify({
        nodes: [],
        nib: {
          ink: [
            {
              id: 'a',
              tool: 'pen',
              color: '1',
              size: 1e308,
              points: [1e308, -1e308, 400, 0, 0, 0, 2, 2, 0.5, 0, 0, 8],
            },
          ],
        },
      }),
    )

    const stroke = canvas.ink[0]
    expect(stroke?.points[0]).toMatchObject({ x: FURTHEST, y: -FURTHEST, pressure: 1 })
    expect(stroke?.size).toBeLessThanOrEqual(FURTHEST)
  })

  test('drops a stroke colour that is neither a preset, a hex, nor the page ink', () => {
    const one = (color: unknown) =>
      readCanvas(
        JSON.stringify({
          nodes: [],
          nib: {
            ink: [
              {
                id: 'a',
                tool: 'pen',
                color,
                size: 2,
                points: [0, 0, 0.5, 0, 0, 0, 1, 1, 0.5, 0, 0, 8],
              },
            ],
          },
        }),
      ).ink[0]?.color

    expect(one('3')).toBe('3')
    expect(one('#abcdef')).toBe('#abcdef')
    expect(one(DEFAULT_INK)).toBe(DEFAULT_INK)
    expect(one('"><script>alert(1)</script><path fill="')).toBe(DEFAULT_INK)
    expect(one('toString')).toBe(DEFAULT_INK)
  })
})

/** The icon a canvas wears. A note keeps its own in front matter; JSON has none,
 *  so a canvas keeps it under the one key the spec leaves for what is ours - which
 *  is what makes it the canvas's own rather than this machine's note about it. */
describe('the icon a canvas wears', () => {
  const applied = (text: string, name: string | null, tint: string | null = null) => {
    const edit = canvasIconEdit(text, name, tint)
    return edit === null ? null : text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
  }

  test('is read off the key that already carries the ink', () => {
    const file = JSON.stringify({ nodes: [], edges: [], nib: { version: 1, icon: 'rocket' } })
    expect(readCanvas(file).icon).toBe('rocket')
  })

  test('and an emoji, which is what a vault out of Iconize holds', () => {
    expect(readCanvas('{"nib":{"icon":"🚀"}}').icon).toBe('🚀')
  })

  test('is nothing where the file says nothing it could be drawn from', () => {
    expect(readCanvas('{"nodes":[],"edges":[]}').icon).toBeNull()
    expect(readCanvas('{"nib":{"icon":"   "}}').icon).toBeNull()
    expect(readCanvas('{"nib":{"icon":42}}').icon).toBeNull()
    expect(readCanvas('not json').icon).toBeNull()
  })

  test('is written first inside the key, and nowhere near the spec half', () => {
    const written = writeCanvas({ ...readCanvas(blankCanvas()), icon: 'rocket' })
    const parsed = JSON.parse(written) as { nib: Record<string, unknown> }

    expect(Object.keys(parsed)).toEqual(['nodes', 'edges', 'nib'])
    expect(Object.keys(parsed.nib)).toEqual(['version', 'icon'])
  })

  test('rides a write and a read back unchanged', () => {
    const written = writeCanvas({ ...readCanvas(blankCanvas()), icon: 'file-text' })
    expect(readCanvas(written).icon).toBe('file-text')
    expect(writeCanvas(readCanvas(written))).toBe(written)
  })

  /** The twin of `frontMatterEdit`: what changes is written and not the whole file,
   *  so an open canvas takes the change without being replaced under its reader. */
  test('goes in as an edit of the few characters that moved', () => {
    const before = blankCanvas()
    const edit = canvasIconEdit(before, 'rocket')

    expect(edit).not.toBeNull()
    // The spec half is untouched: the cut starts past `"edges": []`.
    expect(before.slice(0, edit?.from ?? 0)).toContain('"edges"')
    expect(edit?.insert).toContain('"icon": "rocket"')
    expect(readCanvas(applied(before, 'rocket') ?? '').icon).toBe('rocket')
  })

  test('replaces the one that was there', () => {
    const marked = applied(blankCanvas(), 'rocket') ?? ''
    expect(readCanvas(applied(marked, 'anchor') ?? '').icon).toBe('anchor')
  })

  test('and taking it away leaves the file as it was before it', () => {
    const before = blankCanvas()
    const marked = applied(before, 'rocket') ?? ''

    expect(applied(marked, null)).toBe(before)
  })

  test('is no edit at all where the file already says that', () => {
    const marked = applied(blankCanvas(), 'rocket') ?? ''

    expect(canvasIconEdit(marked, 'rocket')).toBeNull()
    expect(canvasIconEdit(blankCanvas(), null)).toBeNull()
  })

  /** An unreadable file reads as an empty canvas, which is what lets a truncated
   *  one be drawn on. Writing that back would be writing over somebody's file. */
  test('is refused on a file that is not JSON, rather than written over it', () => {
    expect(canvasIconEdit('not json at all', 'rocket')).toBeNull()
    expect(canvasIconEdit('[1, 2, 3]', 'rocket')).toBeNull()
  })

  test('but a file with nothing in it yet takes one', () => {
    expect(readCanvas(applied('', 'rocket') ?? '').icon).toBe('rocket')
  })

  test('takes a colour beside it, under a key of its own', () => {
    const marked = applied(blankCanvas(), 'rocket', 'violet') ?? ''
    const read = readCanvas(marked)

    expect(read.icon).toBe('rocket')
    expect(read.iconColor).toBe('violet')
    expect(Object.keys((JSON.parse(marked) as { nib: object }).nib)).toEqual([
      'version',
      'icon',
      'iconColor',
    ])
  })

  test('and a colour with no icon to colour is no colour at all', () => {
    const marked = applied(blankCanvas(), 'rocket', 'violet') ?? ''
    const bare = applied(marked, null, 'violet') ?? ''

    expect(readCanvas(bare).icon).toBeNull()
    expect(readCanvas(bare).iconColor).toBeNull()
    expect(bare).toBe(blankCanvas())
  })

  test('changing only the colour is still an edit', () => {
    const marked = applied(blankCanvas(), 'rocket', 'violet') ?? ''
    expect(readCanvas(applied(marked, 'rocket', 'teal') ?? '').iconColor).toBe('teal')
    expect(readCanvas(applied(marked, 'rocket', null) ?? '').iconColor).toBeNull()
  })

  test('leaves the cards, the ink and the times exactly where they were', () => {
    const drawn = readCanvas(writeCanvas({ ...readCanvas(blankCanvas()), at: { card: 7 } }))
    const after = readCanvas(applied(writeCanvas(drawn), 'rocket') ?? '')

    expect(after.at).toEqual(drawn.at)
    expect(after.nodes).toEqual(drawn.nodes)
  })
})

/** When a plane was put away. Beside the icon in the file and beside the icon here,
 *  because it is the same kind of fact about the same key: something about the file
 *  rather than about the plane. Every case has its twin in `links.rs`, which reads it on
 *  the pass over the space; see docs/archive.md. */
describe('when a plane was archived', () => {
  const applied = (text: string, when: string | null) => {
    const edit = canvasArchivedEdit(text, when)
    return edit === null ? null : text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
  }

  const WHEN = '2026-09-14T10:00:00.000Z'

  test('is read off the nib key', () => {
    const file = JSON.stringify({ nodes: [], edges: [], nib: { version: 1, archived: WHEN } })
    expect(readCanvas(file).archived).toBe(WHEN)
  })

  test('and a plane nobody put away says nothing', () => {
    expect(readCanvas('{"nodes":[],"edges":[]}').archived).toBeNull()
    expect(readCanvas('{"nib":{"archived":"   "}}').archived).toBeNull()
    expect(readCanvas('{"nib":{"archived":true}}').archived).toBeNull()
    expect(readCanvas('not json').archived).toBeNull()
  })

  test('is written into the file, and taken back out of it', () => {
    const away = applied(blankCanvas(), WHEN) ?? ''
    expect(readCanvas(away).archived).toBe(WHEN)

    const back = applied(away, null) ?? ''
    expect(readCanvas(back).archived).toBeNull()
    // Byte for byte what it was, which is what "exactly where it was before" means for
    // the file as much as for the row.
    expect(back).toBe(blankCanvas())
  })

  test('says nothing where the file already says it', () => {
    const away = applied(blankCanvas(), WHEN) ?? ''
    expect(canvasArchivedEdit(away, WHEN)).toBeNull()
    expect(canvasArchivedEdit(blankCanvas(), null)).toBeNull()
  })

  test('never writes over a file that is not a canvas', () => {
    expect(canvasArchivedEdit('# Not JSON at all', WHEN)).toBeNull()
  })

  test('leaves the icon, the cards, the ink and the times where they were', () => {
    const drawn = readCanvas(
      writeCanvas({ ...readCanvas(blankCanvas()), icon: 'rocket', at: { card: 7 } }),
    )
    const after = readCanvas(applied(writeCanvas(drawn), WHEN) ?? '')

    expect(after.icon).toBe('rocket')
    expect(after.at).toEqual(drawn.at)
    expect(after.nodes).toEqual(drawn.nodes)
  })

  test('and sits after the icon under nib, which is the order a person reads', () => {
    const away = applied(writeCanvas({ ...readCanvas(blankCanvas()), icon: 'rocket' }), WHEN) ?? ''

    expect(Object.keys((JSON.parse(away) as { nib: object }).nib)).toEqual([
      'version',
      'icon',
      'archived',
    ])
  })
})
