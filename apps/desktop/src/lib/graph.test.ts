import { describe, expect, test } from 'vitest'
import { buildGraph, neighbourhood, neighbours, type NoteGraph, signature, without } from './graph'
import { scanNote, type ScannedNote } from './scan-note'

/** A folder of notes, read the way the index reads one. */
const scan = (notes: Record<string, string>) =>
  Object.entries(notes).map(([path, content]) => scanNote(path, content))

/** The graph of already-read notes. The resolver is the index's, in its simplest
 *  honest form: a target names a note by its file name, or it names nothing. */
function graphOf(scanned: ScannedNote[]): NoteGraph {
  const byName = new Map(
    scanned.map((note) => [note.name.toLowerCase(), note.path] as const).reverse(),
  )

  return buildGraph(scanned, (_from, link) => {
    const wanted = (link.target.split('/').pop() ?? link.target)
      .replace(/\.(md|markdown)$/i, '')
      .toLowerCase()
    return byName.get(wanted) ?? null
  })
}

const space = (notes: Record<string, string>) => graphOf(scan(notes))

const named = (graph: NoteGraph) => graph.nodes.map((node) => node.name)

/** Every edge as the pair of names it joins, sorted, so a test can say what is
 *  connected without knowing the order the nodes came out in. */
function joins(graph: NoteGraph): string[] {
  return graph.edges
    .map((edge) => [graph.nodes[edge.a]?.name ?? '', graph.nodes[edge.b]?.name ?? ''].sort())
    .map((pair) => pair.join(' - '))
    .sort()
}

describe('the space as a graph', () => {
  test('a node per note, whether anything links to it or not', () => {
    const graph = space({ 'Plan.md': '# Plan', 'Alone.md': '# Alone' })

    expect(named(graph).sort()).toEqual(['Alone', 'Plan'])
    expect(graph.edges).toEqual([])
  })

  test('an edge for a wikilink, and for a markdown link', () => {
    const graph = space({
      'Plan.md': '# Plan',
      'Ideas.md': 'see [[Plan]]',
      'Notes.md': 'and [the plan](Plan.md)',
    })

    expect(joins(graph)).toEqual(['Ideas - Plan', 'Notes - Plan'])
  })

  test('one edge for a pair that links both ways, marked as both', () => {
    const graph = space({ 'One.md': 'see [[Two]]', 'Two.md': 'see [[One]]' })

    expect(joins(graph)).toEqual(['One - Two'])
    expect(graph.edges.map((edge) => edge.both)).toEqual([true])
  })

  test('and an edge one way round knows which way that is', () => {
    const graph = space({ 'One.md': 'see [[Two]]', 'Two.md': '' })
    const [edge] = graph.edges

    expect(edge?.both).toBe(false)
    expect(graph.nodes[edge?.a ?? -1]?.name).toBe('One')
    expect(graph.nodes[edge?.b ?? -1]?.name).toBe('Two')
  })

  test('a note linking a canvas is joined to it, since a canvas is a node', () => {
    const graph = space({
      'One.md': 'the board: [[Board.canvas]]',
      'Board.canvas': '{"nodes":[],"edges":[]}',
    })

    expect(joins(graph)).toEqual(['Board.canvas - One'])
  })

  test('a note carries its tags into the picture', () => {
    const graph = space({ 'One.md': '#Work/Nib and #plans', 'Two.md': 'nothing' })

    expect(graph.nodes.find((node) => node.name === 'One')?.tags).toEqual(['work/nib', 'plans'])
    expect(graph.nodes.find((node) => node.name === 'Two')?.tags).toEqual([])
  })

  test('and a note the space does not hold carries none', () => {
    const graph = space({ 'One.md': 'see [[Elsewhere]]' })

    expect(graph.nodes.find((node) => node.path === null)?.tags).toEqual([])
  })

  test('one edge however many times a note links to the same one', () => {
    const graph = space({ 'One.md': '[[Two]] and [[Two]] and [[Two#Heading]]', 'Two.md': '' })

    expect(joins(graph)).toEqual(['One - Two'])
  })

  test('a link into the note it is written in joins nothing', () => {
    const graph = space({ 'One.md': 'see [[One]] and [[One#Later]]' })

    expect(graph.edges).toEqual([])
  })

  test('degree counts the edges that touch a node', () => {
    const graph = space({
      'Plan.md': '# Plan',
      'One.md': '[[Plan]]',
      'Two.md': '[[Plan]]',
      'Three.md': '[[Plan]]',
    })

    const plan = graph.nodes.find((node) => node.name === 'Plan')
    expect(plan?.degree).toBe(3)
    expect(graph.nodes.find((node) => node.name === 'One')?.degree).toBe(1)
  })

  test('a target the space holds no note for is a node with no note', () => {
    const graph = space({ 'One.md': 'see [[Somewhere else]]' })

    const missing = graph.nodes.find((node) => node.name === 'Somewhere else')
    expect(missing?.path).toBeNull()
    expect(joins(graph)).toEqual(['One - Somewhere else'])
  })

  test('two notes asking for the same missing name ask for one node', () => {
    const graph = space({ 'One.md': '[[Plan]]', 'Two.md': '[[plan]]' })

    expect(graph.nodes.filter((node) => node.path === null)).toHaveLength(1)
    expect(joins(graph)).toEqual(['One - Plan', 'Plan - Two'])
  })

  test('an attachment is not a note that is missing', () => {
    const graph = space({ 'One.md': 'a picture: ![[shot.png]] and ![](diagram.svg)' })

    expect(named(graph)).toEqual(['One'])
    expect(graph.edges).toEqual([])
  })

  test('a link out at the web is not a link in the space', () => {
    const graph = space({ 'One.md': '[a page](https://example.com/thing)' })

    expect(named(graph)).toEqual(['One'])
  })
})

/** What the Attachments switch asks for: the files the notes embed, in the picture
 *  as nodes of their own. A second graph rather than a mask, because a picture the
 *  notes have to make room for is a different arrangement; see `GraphOptions`. */
describe('the files a space embeds', () => {
  const withFiles = (notes: Record<string, string>) =>
    buildGraph(scan(notes), () => null, { attachments: true })

  test('are nodes of their own, joined to the notes that embed them', () => {
    const graph = withFiles({ 'One.md': 'a picture: ![[shot.png]] and ![](assets/other.png)' })

    expect(named(graph).sort()).toEqual(['One', 'other.png', 'shot.png'])
    expect(joins(graph)).toEqual(['One - other.png', 'One - shot.png'])
  })

  test('and say so, so the picture can draw one as something other than a note', () => {
    const graph = withFiles({ 'One.md': '![[shot.png]]' })
    const file = graph.nodes.find((node) => node.name === 'shot.png')

    expect(file?.attachment).toBe(true)
    expect(file?.path).toBeNull()
    expect(graph.nodes.find((node) => node.name === 'One')?.attachment).toBeUndefined()
  })

  test('a picture, a PDF, a sound and a film, and nothing else', () => {
    const graph = withFiles({
      'One.md': '![[shot.png]] ![[paper.pdf]] ![[voice.m4a]] ![[clip.mp4]] ![[Board.canvas]]',
    })

    // The canvas is a note to the index and always was a node, so it is not one of
    // these; it is in the picture either way, here as the one this space has not got.
    expect(named(graph).sort()).toEqual([
      'Board.canvas',
      'One',
      'clip.mp4',
      'paper.pdf',
      'shot.png',
      'voice.m4a',
    ])
    expect(
      graph.nodes
        .filter((node) => node.attachment)
        .map((node) => node.name)
        .sort(),
    ).toEqual(['clip.mp4', 'paper.pdf', 'shot.png', 'voice.m4a'])
  })

  /** A file is named by its own name in a vault, so two notes reaching for it by
   *  different paths are reaching for the one picture. */
  test('one node per file, however many notes embed it and by whatever path', () => {
    const graph = withFiles({
      'One.md': '![[shot.png]]',
      'Two.md': '![](assets/shot.png)',
      'Three.md': '![[SHOT.PNG]]',
    })

    expect(graph.nodes.filter((node) => node.attachment)).toHaveLength(1)
    expect(joins(graph)).toEqual(['One - shot.png', 'Three - shot.png', 'Two - shot.png'])
  })

  test('a link to a file rather than an embed of it is still not a node', () => {
    const graph = withFiles({ 'One.md': 'see [[shot.png]] and [it](assets/other.png)' })

    expect(named(graph)).toEqual(['One'])
  })

  test('and nothing at all where the switch is off, which is the picture as it was', () => {
    const graph = space({ 'One.md': '![[shot.png]] and ![](assets/other.png)' })

    expect(named(graph)).toEqual(['One'])
    expect(graph.edges).toEqual([])
  })
})

/** A line of five notes, each linking to the next: One - Two - Three - Four -
 *  Five, plus one note off to the side of Two. */
const line = () =>
  space({
    'One.md': '[[Two]]',
    'Two.md': '[[Three]] and [[Aside]]',
    'Three.md': '[[Four]]',
    'Four.md': '[[Five]]',
    'Five.md': '',
    'Aside.md': '',
  })

describe('the neighbourhood of one note', () => {
  test('at depth one, the note and what it is linked to', () => {
    const around = neighbourhood(line(), 'Two.md', 1)

    expect(named(around).sort()).toEqual(['Aside', 'One', 'Three', 'Two'])
    expect(joins(around)).toEqual(['Aside - Two', 'One - Two', 'Three - Two'])
  })

  test('at depth two, their neighbours as well', () => {
    const around = neighbourhood(line(), 'Two.md', 2)

    // Four is two links out, through Three. Five is three, so it stays out.
    expect(named(around).sort()).toEqual(['Aside', 'Four', 'One', 'Three', 'Two'])
    expect(joins(around)).toEqual(['Aside - Two', 'Four - Three', 'One - Two', 'Three - Two'])
  })

  test('the note asked about comes first, so the picture has a middle', () => {
    expect(neighbourhood(line(), 'Four.md', 2).nodes[0]?.name).toBe('Four')
  })

  test('a note nothing links to is a picture of itself', () => {
    const around = neighbourhood(line(), 'Five.md', 1)

    expect(named(around)).toEqual(['Five', 'Four'])
  })

  test('degrees are counted within the slice, not the space', () => {
    // Three is linked to Two and to Four in the space, but at depth one from Two
    // only the one edge is in the picture.
    const around = neighbourhood(line(), 'Two.md', 1)

    expect(around.nodes.find((node) => node.name === 'Three')?.degree).toBe(1)
    expect(around.nodes.find((node) => node.name === 'Two')?.degree).toBe(3)
  })

  test('a note the space does not hold has no neighbourhood', () => {
    expect(neighbourhood(line(), 'Nowhere.md', 2)).toEqual({ nodes: [], edges: [] })
  })

  test('a depth of nothing is the note on its own', () => {
    const around = neighbourhood(line(), 'Two.md', 0)

    expect(named(around)).toEqual(['Two'])
    expect(around.edges).toEqual([])
  })
})

describe('a space of two thousand notes and four thousand links', () => {
  /** The space the graph is measured on: two thousand notes in twenty folders,
   *  each linking to the next note and to one seven along, and every fifth one to
   *  a hub as well. That is a little over four thousand links, in a shape that has
   *  both a hub and long chains in it, which is what a space of notes looks
   *  like. */
  function many(): Record<string, string> {
    const built: Record<string, string> = { 'Plan.md': '# Plan' }

    for (let one = 0; one < 2000; one++) {
      const hub = one % 5 === 0 ? ' and [[Plan]]' : ''
      built[`folder${one % 20}/Note ${one}.md`] =
        `# Note ${one}\n\nsee [[Note ${one + 1}]] and [[Note ${one + 7}]]${hub}\n`
    }

    return built
  }

  test('builds the whole space', () => {
    // Read outside the timing: reading a space is the index's one pass over it,
    // and the graph is what is being measured here.
    const scanned = scan(many())

    // Measured by hand at 8 ms here and 60 ms in the browser; a clock in a
    // test only reports the machine's mood, so the shape is what is checked.
    const graph = graphOf(scanned)

    expect(graph.nodes).toHaveLength(2008)
    expect(graph.edges.length).toBeGreaterThan(4000)
  })

  test('takes a neighbourhood out of it', () => {
    const graph = space(many())
    const around = neighbourhood(graph, 'Plan.md', 2)

    expect(around.nodes.length).toBeGreaterThan(400)
  })
})

/** The notes a space leaves out are not in the picture at all, rather than hidden
 *  in it: the space has said they are not part of what it says about itself. */
describe('a space with notes left out of it', () => {
  const held = () =>
    space({
      'Plan.md': 'see [[Ink]] and [[Archive/Old]]',
      'Ink.md': 'back to [[Plan]]',
      'Archive/Old.md': 'about [[Plan]]',
      'Archive/Older.md': 'about [[Elsewhere]]',
    })

  test('keeps the graph itself when nothing is left out', () => {
    const graph = held()
    expect(without(graph, [])).toBe(graph)
  })

  test('drops a note, and the links that touched it', () => {
    const graph = without(held(), ['Archive/Old.md'])

    expect(named(graph).sort()).toEqual(['Elsewhere', 'Ink', 'Older', 'Plan'])
    expect(joins(graph)).toEqual(['Elsewhere - Older', 'Ink - Plan'])
  })

  test('and a folder stands for everything under it', () => {
    const graph = without(held(), ['Archive'])

    expect(named(graph).sort()).toEqual(['Ink', 'Plan'])
    expect(joins(graph)).toEqual(['Ink - Plan'])
  })

  test('and counts what is left, so a note s size is about the picture', () => {
    const graph = without(held(), ['Archive'])

    expect(graph.nodes.find((node) => node.name === 'Plan')?.degree).toBe(1)
  })

  test('and a note the space has not got goes when the last note asking for it does', () => {
    expect(named(without(held(), ['Archive/Older.md']))).not.toContain('Elsewhere')
  })

  test('and a path that is not a note of its own leaves everything in place', () => {
    const graph = held()
    expect(without(graph, ['Archiv'])).toEqual(graph)
    expect(without(graph, ['Plan.md.old'])).toEqual(graph)
  })
})

/** What set of notes and links a graph is, as one number.
 *
 *  The view is handed a fresh graph whenever anything in the space is saved, and it
 *  has to know whether that is really another graph before it lays the arrangement
 *  out again. It used to ask by joining every id and every pair into one string:
 *  three hundred kilobytes over five thousand notes, per save. So what matters is
 *  that the answer still tells the graphs apart, and that asking twice costs
 *  nothing. */
describe('the signature of a graph', () => {
  const notes = { 'Plan.md': 'see [[Ink]]', 'Ink.md': '# Ink', 'Alone.md': '# Alone' }

  test('is the same for the same notes and links, read twice', () => {
    expect(signature(space(notes))).toBe(signature(space(notes)))
  })

  test('and is worked out once for a graph however often it is asked', () => {
    const graph = space(notes)
    let walked = 0

    // Counted through the nodes themselves: the walk reads every id, so a getter
    // that counts says how many walks there were. One, for six asks.
    const counting = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        get id() {
          walked += 1
          return node.path ?? ''
        },
      })),
    }

    const first = signature(counting)
    const after = walked
    for (let again = 0; again < 5; again++) expect(signature(counting)).toBe(first)

    expect(after).toBe(graph.nodes.length)
    expect(walked).toBe(after)
  })

  test('differs when a note is added, taken away, or renamed', () => {
    const whole = signature(space(notes))

    // One more note, one fewer, and one under another name.
    expect(signature(space({ ...notes, 'More.md': '# More' }))).not.toBe(whole)
    expect(signature(space({ 'Plan.md': 'see [[Ink]]', 'Ink.md': '# Ink' }))).not.toBe(whole)
    expect(
      signature(space({ 'Plan.md': 'see [[Ink]]', 'Ink.md': '# Ink', 'Lonely.md': '# Lonely' })),
    ).not.toBe(whole)
  })

  test('differs when a link is made or broken, and not when a word is written', () => {
    const whole = signature(space(notes))

    expect(signature(space({ ...notes, 'Alone.md': 'now see [[Ink]]' }))).not.toBe(whole)
    expect(signature(space({ ...notes, 'Plan.md': '# Plan' }))).not.toBe(whole)
    // The same notes and the same links, with more written in one of them: the
    // arrangement must not be laid out again for this, which is the whole point.
    expect(signature(space({ ...notes, 'Plan.md': 'a line, and see [[Ink]]' }))).toBe(whole)
  })
})

/** Who a node is joined to.
 *
 *  Lighting up what the pointer is over walked every edge in the space, on every
 *  pointer move that changed which note was under it - ten thousand of them over five
 *  thousand notes. The list per node is built once for a graph and kept with it. */
describe('the neighbours of a node', () => {
  const held = () =>
    space({
      'Hub.md': 'see [[One]] and [[Two]] and [[Three]]',
      'One.md': '# One',
      'Two.md': '# Two',
      'Three.md': '# Three',
      'Alone.md': '# Alone',
    })

  test('are the nodes one link away and nothing else', () => {
    const graph = held()
    const at = (name: string) => graph.nodes.findIndex((node) => node.name === name)
    const names = (node: number) =>
      [...neighbours(graph, node)].map((one) => graph.nodes[one]?.name).sort()

    expect(names(at('Hub'))).toEqual(['One', 'Three', 'Two'])
    expect(names(at('One'))).toEqual(['Hub'])
    expect(names(at('Alone'))).toEqual([])
  })

  test('and the list is built once for a graph, not once per question', () => {
    const graph = held()
    let walked = 0

    const counting = {
      ...graph,
      // The build walks the edges; a getter that counts says how many walks there
      // were. The old way walked them once per question.
      get edges() {
        walked += 1
        return graph.edges
      },
    }

    for (let again = 0; again < 20; again++) neighbours(counting, 0)
    expect(walked).toBe(1)
  })

  test('and two graphs keep a list each', () => {
    const one = held()
    const other = space({ 'A.md': 'see [[B]]', 'B.md': '# B' })

    expect(neighbours(one, 0)).not.toBe(neighbours(other, 0))
    expect(neighbours(other, 0)).toHaveLength(1)
  })
})
