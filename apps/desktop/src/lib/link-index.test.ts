import { beforeEach, describe, expect, test, vi } from 'vitest'
import { scanNote } from './scan-note'
import type { Hit } from './search/match'
import type { Query } from './search/query'

/** The index reads a space through the platform shim. Under node there is none,
 *  so a folder of notes stands in for one - which is why the store is imported
 *  further down rather than at the top. */

const ROOT = '/space'

let notes: Record<string, string> = {}
let files: string[] = []
/** Every note that was written, so a rewrite can be read back. */
let written: string[] = []
/** How many notes have been read off the "disk" since the space was built. The
 *  index exists so that a surface drawn from the whole space does not read it again;
 *  a count says whether one did, where a clock says what the machine was doing. */
let reads = 0
/** Every note a snapshot was taken of, so "one snapshot per touched note" is a
 *  thing the test can see rather than a thing the comment claims. */
let snapshots: string[] = []

const stringOf = (args: Record<string, unknown> | undefined, name: string) => {
  const value = args?.[name]
  return typeof value === 'string' ? value : ''
}

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = stringOf(args, 'path')

    switch (command) {
      case 'scan_links':
        return {
          notes: Object.entries(notes).map(([one, content]) => scanNote(one, content)),
          files,
        }
      case 'read_note': {
        const relative = path.slice(ROOT.length + 1)
        const doc = notes[relative]
        if (doc === undefined) throw new Error(`no such note: ${path}`)
        reads += 1
        return doc
      }
      case 'write_note': {
        const relative = path.slice(ROOT.length + 1)
        notes[relative] = stringOf(args, 'content')
        written.push(relative)
        return undefined
      }
      case 'snapshot_note':
        snapshots.push(path.slice(ROOT.length + 1))
        return undefined
      default:
        return undefined
    }
  },
}))

/** The space search, stood in for. The index asks it for the mentions of a note,
 *  and the real one is either behind the Rust crate or inside a worker; neither is
 *  here. What matters is the shape of the question and the answer, so the matcher
 *  the app actually uses runs over the notes this file holds. */
vi.mock('./search/space', () => ({
  searchSpace: async (
    _root: string,
    query: Query,
    _terms: string[],
    limit: number,
    onFound: (found: { hits: Hit[]; loose: Hit[] }) => void,
    excluded: readonly string[] = [],
  ) => {
    const { Matcher } = await import('./search/match')
    const matcher = new Matcher(query)
    const hits: Hit[] = []

    for (const [one, content] of Object.entries(notes)) {
      if (excluded.some((left) => one === left || one.startsWith(`${left}/`))) continue

      hits.push(
        ...matcher.hits(
          {
            path: `${ROOT}/${one}`,
            relative: one,
            name: one.split('/').pop() ?? one,
            body: content,
          },
          limit,
        ),
      )
    }

    onFound({ hits, loose: [] })
  },
}))

const { links } = await import('./link-index.svelte')
const { startup } = await import('./startup.svelte')

// A space is scanned once its file list is on screen, which is what the launch
// says for itself; here it is said once so a scan is not waiting on a frame that
// never comes. See startup.svelte.ts.
void startup.shown()

async function space(contents: Record<string, string>, others: string[] = []) {
  notes = { ...contents }
  files = [...others]
  written = []
  snapshots = []
  reads = 0
  await links.build(ROOT)
}

const at = (relative: string) => `${ROOT}/${relative}`

beforeEach(() => {
  links.clear()
})

describe('backlinks', () => {
  test('find every note that points here, whichever way it was written', async () => {
    await space({
      'Plan.md': '# Plan',
      'One.md': 'see [[Plan]] for more',
      'Two.md': 'see [the plan](Plan.md)',
      'Three.md': 'nothing to do with it',
    })

    expect(links.backlinks(at('Plan.md')).map((one) => one.name)).toEqual(['One', 'Two'])
  })

  test('carry the line and the words around it', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'first\nsee [[Plan]] here' })

    expect(links.backlinks(at('Plan.md'))[0]).toMatchObject({
      path: 'One.md',
      line: 1,
      text: 'see [[Plan]] here',
    })
  })

  test('do not count a link that resolves to a different note of the same name', async () => {
    await space({
      'Plan.md': 'the one at the top',
      'ideas/Plan.md': 'the one in the folder',
      'ideas/One.md': 'see [[Plan]]',
    })

    // Written beside the folder's own Plan, so that is the one it means.
    expect(links.backlinks(at('ideas/Plan.md')).map((one) => one.path)).toEqual(['ideas/One.md'])
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })

  test('a path-qualified link reaches past the nearer note', async () => {
    await space({
      'Plan.md': 'the one at the top',
      'ideas/Plan.md': 'the one in the folder',
      // The extension alone does not say which; the folder does.
      'ideas/One.md': 'see [[ideas/Plan]] and not [[Plan.md]]',
    })

    expect(links.backlinks(at('ideas/Plan.md')).map((one) => one.path)).toEqual([
      'ideas/One.md',
      'ideas/One.md',
    ])
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })

  test('a note does not link to itself in this list', async () => {
    await space({ 'Plan.md': 'see [[Plan]]' })
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })

  test('a link in code is not a link', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'write `[[Plan]]` to link' })
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })
})

describe('links out', () => {
  test('say where each one goes, and which go nowhere', async () => {
    await space({
      'One.md': 'see [[Plan]] and [[Nowhere]] and [[ideas/Spark]]',
      'Plan.md': '# Plan',
      'ideas/Spark.md': '# Spark',
    })

    expect(links.outgoing(at('One.md'))).toEqual([
      expect.objectContaining({ target: 'Plan', to: 'Plan.md', name: 'Plan' }),
      expect.objectContaining({ target: 'Nowhere', to: null, name: 'Nowhere' }),
      expect.objectContaining({ target: 'ideas/Spark', to: 'ideas/Spark.md', name: 'Spark' }),
    ])
  })

  test('a link into the note itself is not a link out', async () => {
    await space({ 'One.md': '# Today\n\nsee [[#Today]]' })
    expect(links.outgoing(at('One.md'))).toEqual([])
  })
})

describe('mentions', () => {
  test('are the name written without a link to it', async () => {
    await space({
      'Plan.md': '# Plan',
      'One.md': 'the Plan is coming along',
      'Two.md': 'see [[Plan]]',
    })

    const found = await links.unlinked(at('Plan.md'), ROOT)
    expect(found.map((one) => one.path)).toEqual(['One.md'])
  })

  test('the name has to stand as a word of its own', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'Planning is not the Plan' })

    const found = await links.unlinked(at('Plan.md'), ROOT)
    expect(found).toHaveLength(1)
  })

  test('a name too short to search for finds nothing', async () => {
    await space({ 'A.md': '# A', 'One.md': 'A is a letter' })
    expect(await links.unlinked(at('A.md'), ROOT)).toEqual([])
  })
})

describe('a note saved keeps the index up to date', () => {
  test('a link written now is a backlink now', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'nothing yet' })
    expect(links.backlinks(at('Plan.md'))).toEqual([])

    links.noteSaved(at('One.md'), 'now [[Plan]] is linked')
    expect(links.backlinks(at('Plan.md')).map((one) => one.path)).toEqual(['One.md'])
  })

  test('a note that has gone takes its links with it', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'see [[Plan]]' })
    links.noteGone(at('One.md'))
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })

  test('a note that moved answers to its new path', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'see [[Plan]]' })
    links.notesMoved(at('One.md'), at('deep/One.md'))
    expect(links.backlinks(at('Plan.md')).map((one) => one.path)).toEqual(['deep/One.md'])
  })

  test('the version moves only when something changed', async () => {
    await space({ 'Plan.md': '# Plan' })
    const was = links.version

    links.noteSaved(at('Plan.md'), '# Plan changed')
    expect(links.version).toBeGreaterThan(was)
  })

  test('the index handed to the editor is the same object until it changes', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': '# One' })

    // Compared by identity on the other side, so that a keystroke somewhere in
    // the app does not redraw every link on screen.
    const first = links.index(at('Plan.md'))
    expect(links.index(at('Plan.md'))).toBe(first)

    links.noteSaved(at('One.md'), '# One changed')
    expect(links.index(at('Plan.md'))).not.toBe(first)

    // And a different note being open is a different index, since which note is
    // open decides what `[[#Heading]]` and an ambiguous name mean.
    expect(links.index(at('One.md'))).not.toBe(links.index(at('Plan.md')))
  })

  test('a note read for an embed comes back, and comes back fresh after a save', async () => {
    await space({ 'Plan.md': '# Plan' })

    expect(await links.index(null).read('Plan.md')).toBe('# Plan')
    links.noteSaved(at('Plan.md'), '# Changed')
    expect(await links.index(null).read('Plan.md')).toBe('# Changed')
  })

  /** A website is a file the app writes as the reading moves: the keeper brings the
   *  `.url` up to date and the site's own mark arrives in it, which is what the row
   *  in the file list draws instead of the plain globe. Written while the app is
   *  running, so nothing rescans the space - and a row that waits for the next launch
   *  to wear the favicon is a row that says the wrong thing all afternoon. See
   *  web-tab/keep.ts. */
  test('a website written while the app runs hands the row the site’s own mark', async () => {
    await space({ 'Plan.md': '# Plan' })
    const site = at('A site.url')
    expect(links.faviconOf(site)).toBeNull()

    links.noteSaved(
      site,
      '[InternetShortcut]\nURL=https://a.example/read\nTitle=A site\n' +
        'Nib-Icon=https://a.example/icon.png\n',
    )

    expect(links.faviconOf(site)).toBe('https://a.example/icon.png')
  })

  test('and the same file written again with a new mark answers with the new one', async () => {
    await space({ 'Plan.md': '# Plan' })
    const site = at('A site.url')

    links.noteSaved(
      site,
      '[InternetShortcut]\nURL=https://a.example/\nNib-Icon=https://a/one.png\n',
    )
    links.noteSaved(
      site,
      '[InternetShortcut]\nURL=https://a.example/\nNib-Icon=https://a/two.png\n',
    )

    expect(links.faviconOf(site)).toBe('https://a/two.png')
  })
})

describe('a space of two thousand notes', () => {
  /** Two frames. Measured here at 3 ms cold and under 1 ms warm, so this is a
   *  ceiling with room for a loaded runner, not the expectation. */

  const many = () => {
    const built: Record<string, string> = { 'Plan.md': '# Plan' }
    for (let one = 0; one < 2000; one++) {
      built[`folder${one % 20}/Note ${one}.md`] =
        one % 5 === 0
          ? `# Note ${one}\n\nsee [[Plan]] and [[Note ${one + 1}]]\n`
          : `# Note ${one}\n\nnothing in particular about the plan\n`
    }
    return built
  }

  test('answers for a large space', async () => {
    await space(many())

    // Measured by hand at 3 ms cold; a clock in a test only reports the
    // machine's mood, so the answers are what is checked.
    expect(links.backlinks(at('Plan.md'))).toHaveLength(400)
    expect(links.outgoing(at('folder0/Note 0.md'))).toHaveLength(2)
  })

  test('a note saved is read on its own, not the space', async () => {
    await space(many())

    links.noteSaved(at('folder0/Note 0.md'), '# Note 0\n\nsee [[Plan]]\n')
    expect(links.outgoing(at('folder0/Note 0.md'))).toHaveLength(1)
  })
})

describe('what the editor is told about the tags', () => {
  test('every tag of the space, with the notes under each', async () => {
    await space({
      'Plan.md': '---\ntags: [work/nib]\n---\n\n# Plan\n\nwords #work/nib again\n',
      'One.md': 'filed under #work\n',
      'Two.md': 'and #reading\n',
    })

    expect(links.index(null).tags).toEqual([
      // A note counts once for a tag however often it writes it, and a nested
      // tag counts towards every level above it.
      { tag: 'work', notes: 2 },
      { tag: 'reading', notes: 1 },
      { tag: 'work/nib', notes: 1 },
    ])
  })

  test('a tag written now is offered now', async () => {
    await space({ 'Plan.md': '# Plan\n' })
    expect(links.index(null).tags).toEqual([])

    links.noteSaved(at('Plan.md'), '# Plan\n\n#later\n')
    expect(links.index(null).tags).toEqual([{ tag: 'later', notes: 1 }])
  })
})

describe('the blocks the whole space holds', () => {
  test('are found by their own words, with the name each already carries', async () => {
    await space({
      'Plan.md': '# Plan\n\nthe second half of it ^a1b2c3\n',
      'One.md': '# One\n\nnothing about halves\n',
    })

    expect(await links.searchBlocks('second half', 10)).toEqual([
      // The name is the link's, not the row's: what is shown is what the line says.
      { path: 'Plan.md', line: 2, text: 'the second half of it', id: 'a1b2c3' },
    ])
  })

  test('a word too short to search for finds nothing, and asks nothing', async () => {
    await space({ 'Plan.md': '# Plan\n\na line\n' })

    expect(await links.searchBlocks('a', 10)).toEqual([])
  })

  test('leave out the notes the space leaves out', async () => {
    await space({
      'Plan.md': '# Plan\n\nthe second half of it\n',
      'archive/Old.md': '# Old\n\nthe second half of that\n',
    })

    const { workspace } = await import('./workspace.svelte')
    // The list itself is kept per space on the device, and there is no space open
    // here: what matters is that the search is asked to skip what it holds.
    const left = vi.spyOn(workspace.excluded, 'of').mockReturnValue(['archive'])

    try {
      expect((await links.searchBlocks('second half', 10)).map((one) => one.path)).toEqual([
        'Plan.md',
      ])
    } finally {
      left.mockRestore()
    }
  })
})

describe('renaming a note rewrites the links to it', () => {
  test('every note that pointed at it, and no others', async () => {
    await space({
      'Plan.md': '# Plan',
      'One.md': 'see [[Plan]] now',
      'Two.md': 'and [the plan](Plan.md)',
      'Three.md': 'nothing here',
    })

    const touched = await links.retarget(at('Plan.md'), at('Roadmap.md'), ROOT)

    expect(touched).toBe(2)
    expect(notes['One.md']).toBe('see [[Roadmap]] now')
    expect(notes['Two.md']).toBe('and [the plan](Roadmap.md)')
    expect(notes['Three.md']).toBe('nothing here')
    expect(written.sort()).toEqual(['One.md', 'Two.md'])
  })

  test('one snapshot per note it touched, and none for the rest', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': '[[Plan]]', 'Two.md': 'nothing' })

    await links.retarget(at('Plan.md'), at('Roadmap.md'), ROOT)
    expect(snapshots).toEqual(['One.md'])
  })

  test('the index knows the new links straight away', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': '[[Plan]]' })

    await links.retarget(at('Plan.md'), at('Roadmap.md'), ROOT)
    links.notesMoved(at('Plan.md'), at('Roadmap.md'))

    expect(links.backlinks(at('Roadmap.md')).map((one) => one.path)).toEqual(['One.md'])
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })

  test('rewriting back is the same rewrite the other way round', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'see [[Plan]] now' })

    // The order the app does it in: the links are found against the space as it
    // was, and only then is the index told the note moved.
    await links.retarget(at('Plan.md'), at('Roadmap.md'), ROOT)
    links.notesMoved(at('Plan.md'), at('Roadmap.md'))

    await links.retarget(at('Roadmap.md'), at('Plan.md'), ROOT)
    links.notesMoved(at('Roadmap.md'), at('Plan.md'))

    expect(notes['One.md']).toBe('see [[Plan]] now')
  })

  test('a note whose name did not change is left alone', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': '[[Plan]]' })
    expect(await links.retarget(at('Plan.md'), at('Plan.md'), ROOT)).toBe(0)
  })
})

describe('naming a block of another note', () => {
  test('writes the name at the end of the block and answers with it', async () => {
    await space({ 'Plan.md': '# Plan\n\nfirst line\nsecond line\n\nanother block\n' })

    const id = await links.nameBlock('Plan.md', 2, ROOT)
    expect(id).toMatch(/^[a-z0-9]{6}$/)
    expect(notes['Plan.md']).toBe(
      `# Plan\n\nfirst line\nsecond line ^${id ?? ''}\n\nanother block\n`,
    )
    expect(snapshots).toEqual(['Plan.md'])
  })

  test('a block that already has a name keeps it', async () => {
    await space({ 'Plan.md': '# Plan\n\na line ^kept\n' })

    expect(await links.nameBlock('Plan.md', 2, ROOT)).toBe('kept')
    expect(written).toEqual([])
  })

  test('the name it gives is one the note has not used', async () => {
    await space({ 'Plan.md': 'one ^aaaaaa\n\ntwo\n' })

    const id = await links.nameBlock('Plan.md', 2, ROOT)
    expect(id).not.toBe('aaaaaa')
  })
})

describe('a picture named by an embed', () => {
  test('is found wherever in the space it lives', async () => {
    await space({ 'Plan.md': '![[shot.png]]' }, ['assets/deep/shot.png', 'other.png'])

    expect(links.fileNamed('shot.png')).toBe('assets/deep/shot.png')
    expect(links.fileNamed('other.png')).toBe('other.png')
    expect(links.fileNamed('missing.png')).toBeNull()
  })
})

/** The icon a row wears, which rides along on the same pass. A file list asks
 *  this once per row, so what it must never be is a read of the file. */
describe('the icon a note says it wears', () => {
  test('comes off the scan of the space', async () => {
    await space({
      'Plan.md': '---\nicon: rocket\n---\n\n# Plan',
      'Plain.md': '# Plain',
    })

    expect(links.iconOf(at('Plan.md'))).toBe('rocket')
    expect(links.iconOf(at('Plain.md'))).toBeNull()
  })

  test('as written, whichever convention wrote it', async () => {
    await space({
      'Obsidian.md': '---\nicon: LiFileText\n---\n',
      'Emoji.md': '---\nicon: 🚀\n---\n',
    })

    expect(links.iconOf(at('Obsidian.md'))).toBe('LiFileText')
    expect(links.iconOf(at('Emoji.md'))).toBe('🚀')
  })

  test('by the path a row knows, wherever the row is', async () => {
    await space({ 'ideas/Plan.md': '---\nicon: rocket\n---\n' })

    // The tree knows where the file is; a bookmark and a search hit know it
    // relative to the space.
    expect(links.iconOf(at('ideas/Plan.md'))).toBe('rocket')
    expect(links.iconOf('ideas/Plan.md')).toBe('rocket')
  })

  test('and changes the moment the note does, without the space being read again', async () => {
    await space({ 'Plan.md': '# Plan' })
    expect(links.iconOf(at('Plan.md'))).toBeNull()

    links.noteSaved(at('Plan.md'), '---\nicon: anchor\n---\n\n# Plan')
    expect(links.iconOf(at('Plan.md'))).toBe('anchor')

    links.noteSaved(at('Plan.md'), '# Plan')
    expect(links.iconOf(at('Plan.md'))).toBeNull()
  })

  test('a note outside the space wears nothing', async () => {
    await space({ 'Plan.md': '---\nicon: rocket\n---\n' })
    expect(links.iconOf('/elsewhere/Plan.md')).toBeNull()
  })
})

/** The tags of a space, counted off the index rather than read off the disk.
 *
 *  Asking the space read every body again to count them - twenty-two megabytes of
 *  strings on the thread the search panel was opening on. The scan that finds a
 *  note's links writes down its tags on the way past, so the answer is already in
 *  hand. What is counted here is rows read: none. */
describe("a space's tags", () => {
  test('come off the index without a row being read', async () => {
    await space({
      'Plan.md': '#work/nib and #paper, and #work again\n',
      'Ink.md': '#paper on #paper\n',
      'Kestrel.md': 'nothing tagged here\n',
    })

    const before = reads
    // A row per level: Plan is one note under `work` and under `work/nib` both, and
    // it is one note under `work` whether it wrote the tag once or twice.
    expect(links.spaceTags).toEqual([
      { tag: 'paper', notes: 2 },
      { tag: 'work', notes: 1 },
      { tag: 'work/nib', notes: 1 },
    ])

    // Not one note read to answer it, however many times it is asked.
    expect(links.spaceTags).toEqual(links.spaceTags)
    expect(reads - before).toBe(0)
  })

  test('count the notes carrying one, not the times it was written', async () => {
    await space({ 'Plan.md': '#work #work #work\n', 'Ink.md': '#Work\n' })

    // Three uses in one note and one in another, spelled two ways: two notes.
    expect(links.spaceTags).toEqual([{ tag: 'work', notes: 2 }])
  })

  test('and a note under two branches of one tag counts once for the branch', async () => {
    await space({ 'Plan.md': '#work/nib and #work/lab\n' })

    expect(links.spaceTags).toEqual([
      { tag: 'work', notes: 1 },
      { tag: 'work/lab', notes: 1 },
      { tag: 'work/nib', notes: 1 },
    ])
  })

  test('and follow a note being saved, without the space being read again', async () => {
    await space({ 'Plan.md': '#work\n' })
    const before = reads

    links.noteSaved(at('Plan.md'), '#paper\n')
    expect(links.spaceTags).toEqual([{ tag: 'paper', notes: 1 }])
    expect(reads - before).toBe(0)
  })

  test('and are the same list the editor is handed for its own popup', async () => {
    await space({ 'Plan.md': '#work/nib\n', 'Ink.md': '#paper\n' })

    // One answer, two surfaces: the `#` completion reads it off the index it is
    // handed, and the tag tree reads it off the store. Neither counts its own.
    expect(links.index(at('Plan.md')).tags).toEqual(links.spaceTags)
    expect(links.spaceTags).toEqual([
      { tag: 'paper', notes: 1 },
      { tag: 'work', notes: 1 },
      { tag: 'work/nib', notes: 1 },
    ])
  })
})

/** What drawing a page of links costs, counted.
 *
 *  Every surface that draws one asks `targetOf`, and the thing it must not do is
 *  ask the space about each link in turn. The reading view used to: it filtered
 *  every note in the space per link, so a note of eighteen hundred links over five
 *  thousand notes compared nine million paths to draw one page - 1.7 seconds of the
 *  five that page took, all of it folding paths. Counted rather than timed, for the
 *  reason the counter's own comment gives. */
describe('resolving a page of links', () => {
  /** A space of five hundred notes, and one note linking to three hundred of them,
   *  which is the shape of a long note with a link every few lines. */
  async function page() {
    const contents: Record<string, string> = {}
    for (let one = 0; one < 500; one++) contents[`note-${one}.md`] = `# Note ${one}\n`

    const lines: string[] = []
    for (let one = 0; one < 300; one++) lines.push(`See [[note-${one}]] on this.`)
    contents['long.md'] = lines.join('\n')

    await space(contents)
    return lines.map((_, one) => `note-${one}`)
  }

  test('compares the links, not the links times the space', async () => {
    const targets = await page()
    // What asking the space per link walks, per link: all of it.
    expect(links.index(at('long.md')).notes).toHaveLength(501)

    const before = links.examined
    for (const target of targets) links.targetOf(at('long.md'), { kind: 'wikilink', target })

    // One candidate per link and no more: three hundred comparisons, against the
    // hundred and fifty thousand the same page cost when every link asked the
    // whole space.
    expect(links.examined - before).toBe(targets.length)
  })

  test('asks once for a target however many links name it', async () => {
    const targets = await page()

    const before = links.examined
    for (let round = 0; round < 5; round++) {
      for (const target of targets) links.targetOf(at('long.md'), { kind: 'wikilink', target })
    }

    // Five passes over the same page, and only the first one asks: what a target
    // means is remembered until the space changes.
    expect(links.examined - before).toBe(targets.length)
  })

  test('answers what walking the whole space answers', async () => {
    const { resolveNote } = await import('@nib/editor')

    await space({
      'Plan.md': '# Plan',
      'ideas/Plan.md': '# The other plan',
      'ideas/Later.md': '---\naliases:\n  - Eventually\n---\n',
      'Notes/Today.md': 'a note that links out',
    })

    const asked = ['Plan', 'ideas/Plan', 'Later', 'ideas/later', 'Eventually', 'Nowhere', 'PLAN']

    for (const from of ['Notes/Today.md', 'ideas/Later.md']) {
      const index = links.index(at(from))
      for (const target of asked) {
        expect(links.targetOf(at(from), { kind: 'wikilink', target })).toBe(
          resolveNote(index, target)?.path ?? null,
        )
      }
    }
  })
})
