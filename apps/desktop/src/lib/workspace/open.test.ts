import { describe, expect, test } from 'vitest'

/** One document per file, which is the thing this has to be right about.
 *
 *  Two documents over one file are two notes wearing one name: each honest about
 *  its own words, both reporting theirs as that file's, and whichever is written
 *  last is what the file ends up saying. The workspace's own tests drive that the
 *  long way round - two clicks on one row, a session and a click in the same second;
 *  see workspace.test.ts. What is here is the rule itself, said once. */

const { NoteDoc, Tab } = await import('./documents.svelte')
const { OpenDocuments } = await import('./open')
type Doc = import('./documents.svelte').NoteDoc
type DocumentStart = import('./documents.svelte').DocumentStart

/** A store of one pane's worth of tabs, and the documents open in it. `made`
 *  counts how many documents were built, which is the whole question. */
function open() {
  const tabs: (typeof Tab)['prototype'][] = []
  const made: string[] = []

  const documents = new OpenDocuments(
    () => tabs,
    (start: DocumentStart) => {
      made.push(start.path ?? start.name)
      return new NoteDoc(
        start,
        () => undefined,
        () => true,
      )
    },
  )

  /** What an opener does: reads the file, makes a document of it, puts it in a
   *  tab. The read is held open until `release` is called, which is the round trip
   *  a second open of the same file used to be started inside. */
  let releasing: () => void = () => undefined
  const reading = new Promise<void>((resolve) => {
    releasing = resolve
  })

  const opener = (path: string, text = '# a') => {
    return async (): Promise<Doc> => {
      await reading
      const note = documents.make({ kind: 'note', path, name: 'a.md', text, dirty: false })
      tabs.push(new Tab(note, 'p1'))
      return note
    }
  }

  return { documents, tabs, made, opener, release: () => releasing() }
}

describe('a file being opened', () => {
  test('is one open however many ask for it at once', async () => {
    const { documents, made, opener, release } = open()

    const both = Promise.all([
      documents.opening('/s/a.md', opener('/s/a.md')),
      documents.opening('/s/a.md', opener('/s/a.md')),
    ])
    release()
    const [first, second] = await both

    expect(made).toEqual(['/s/a.md'])
    expect(first).toBe(second)
  })

  test('and is not read at all once it is open', async () => {
    const { documents, made, opener, release } = open()

    release()
    const first = await documents.opening('/s/a.md', opener('/s/a.md'))
    const again = await documents.opening('/s/a.md', opener('/s/a.md', '# something else'))

    expect(made).toEqual(['/s/a.md'])
    expect(again).toBe(first)
  })

  test('while two files are two opens', async () => {
    const { documents, made, opener, release } = open()

    release()
    await documents.opening('/s/a.md', opener('/s/a.md'))
    await documents.opening('/s/b.md', opener('/s/b.md'))

    expect(made).toEqual(['/s/a.md', '/s/b.md'])
  })

  test('and a file that cannot be read leaves nothing behind to wait for', async () => {
    const { documents, made } = open()

    expect(await documents.opening('/s/gone.md', () => Promise.resolve(null))).toBeNull()
    expect(await documents.opening('/s/gone.md', () => Promise.resolve(null))).toBeNull()
    expect(made).toEqual([])
  })
})

describe('the document a file is open as', () => {
  test('is whichever pane is showing it', async () => {
    const { documents, tabs, opener, release } = open()

    release()
    const note = await documents.opening('/s/a.md', opener('/s/a.md'))
    // The same note in a second pane, which is one document and two tabs.
    if (note) tabs.push(new Tab(note, 'p2'))

    expect(documents.at('/s/a.md')).toBe(note)
    expect(documents.all).toEqual([note])
  })

  test('moves with a path that changes rather than leaving a second entry', async () => {
    const { documents, opener, release } = open()

    release()
    const note = await documents.opening('/s/a.md', opener('/s/a.md'))
    if (!note) throw new Error('the open did not happen')

    // A rename, a move, a website being given its first file: all of them are this.
    note.path = '/s/b.md'

    expect(documents.at('/s/a.md')).toBeNull()
    expect(documents.at('/s/b.md')).toBe(note)
  })

  test('and is nothing once no pane is showing it', async () => {
    const { documents, tabs, opener, release } = open()

    release()
    await documents.opening('/s/a.md', opener('/s/a.md'))
    tabs.length = 0

    expect(documents.at('/s/a.md')).toBeNull()
    expect(documents.all).toEqual([])
  })
})

describe('making a document', () => {
  test('hands back the one the file is already open as', async () => {
    const { documents, made, opener, release } = open()

    release()
    const note = await documents.opening('/s/a.md', opener('/s/a.md'))
    const again = documents.make({
      kind: 'note',
      path: '/s/a.md',
      name: 'a.md',
      text: '# and other words',
      dirty: true,
    })

    expect(again).toBe(note)
    expect(made).toEqual(['/s/a.md'])
  })

  test('but a document with no file of its own is its own document', () => {
    const { documents, tabs, made } = open()

    const start: DocumentStart = {
      kind: 'note',
      path: null,
      name: 'Untitled',
      text: '',
      dirty: false,
    }
    const first = documents.make(start)
    tabs.push(new Tab(first, 'p1'))
    const second = documents.make(start)

    expect(second).not.toBe(first)
    expect(made).toHaveLength(2)
  })
})

/** The launch race. A session is read a note at a time and its tabs go into the
 *  window when the last one lands, so for that second the documents it has made are
 *  open and no pane is showing them. */
describe('an arrangement being read', () => {
  test('holds what it makes open until its panes are in the window', async () => {
    const { documents, made } = open()

    await documents.arranging(async () => {
      const first = documents.make({
        kind: 'note',
        path: '/s/a.md',
        name: 'a.md',
        text: '# a',
        dirty: false,
      })

      // The second pane of the same arrangement, on the same note - and a note
      // clicked in that second, which is the same question asked from outside.
      expect(documents.at('/s/a.md')).toBe(first)
      expect(
        documents.make({ kind: 'note', path: '/s/a.md', name: 'a.md', text: '', dirty: false }),
      ).toBe(first)
      await Promise.resolve()
    })

    expect(made).toEqual(['/s/a.md'])
    // And once it is over, a document no pane is showing is not open.
    expect(documents.at('/s/a.md')).toBeNull()
  })

  test('and nests, so one pane finishing does not let the next one go', async () => {
    const { documents, made } = open()

    await documents.arranging(async () => {
      const first = documents.make({
        kind: 'note',
        path: '/s/a.md',
        name: 'a.md',
        text: '# a',
        dirty: false,
      })

      await documents.arranging(() => Promise.resolve())

      expect(documents.at('/s/a.md')).toBe(first)
    })

    expect(made).toEqual(['/s/a.md'])
  })
})
