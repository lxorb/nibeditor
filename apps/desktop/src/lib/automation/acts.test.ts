/** Opening a note by the name a link wrote, and where the judging happens.
 *
 *  `nib://open?path=Plan` names no path: it names a note, and the app's own file
 *  index answers with the path it holds under. That answer is a path like any
 *  other by the time it reaches `insideSpace`, so it goes through the judge too -
 *  resolve first, then judge, in that order and in one place, so a caller that
 *  hands a name and a caller that hands a path cannot come to different ends. */

import { describe, expect, test, vi } from 'vitest'

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const space = { id: 'work', name: 'Work', root: '/Work' }

/** What the index answers for a bare name, which each test sets.
 *
 *  `named` is what the note resolver answers - the road a `[[wikilink]]` takes -
 *  and `beside` is what the list of files beside the notes answers. They are two
 *  different questions and the index keeps them apart: a note is in `notes` and a
 *  picture is in `files`, so asking the file list for a note is asking the wrong
 *  half and always answers nothing. */
let named: string | null = null
let beside: string | null = null

/** The scan in flight, and how many times it was waited for. */
let scanning: Promise<void> = Promise.resolve()
let scans = 0

/** Every path the workspace was asked to open. */
const opened: string[] = []

/** What the space holds, by path, which `noteText` answers out of. */
const held = new Map<string, string>()

/** The replacements the workspace was handed, and the notes it was asked to make. */
const written: { path: string; before: string; after: string }[] = []
const made: { folder: string; name: string }[] = []

vi.mock('../link-index.svelte', () => ({
  links: {
    fileNamed: () => beside,
    targetOf: (_from: string | null, link: { target: string }) =>
      link.target.includes('/') ? null : named,
    // The scan the index does off the launch's critical path. A link that starts
    // the app is followed while it is still in flight, so what it answers before
    // it lands is nothing at all.
    scanned: () => {
      scans += 1
      return scanning
    },
    outgoing: () => [],
    backlinks: () => [],
  },
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [space],
    activeSpace: space,
    activeSpaceId: space.id,
    active: null,
    files: [],
    panes: { focusedId: null },
    tabs: [{ path: '/Work/notes/Plan.md' }],
    flush: () => undefined,
    showSpace: () => Promise.resolve(),
    openEntry: (path: string) => {
      opened.push(path)
      return Promise.resolve()
    },
    activeTabId: null,
    noteText: (path: string) => Promise.resolve(held.get(path) ?? null),
    replaceInNotes: (changes: { path: string; before: string; after: string }[]) => {
      for (const change of changes) {
        written.push({ path: change.path, before: change.before, after: change.after })
        held.set(change.path, change.after)
      }
      return Promise.resolve()
    },
    createNote: (folder: string, name: string) => {
      made.push({ folder, name })
      return Promise.resolve()
    },
    replace: () => undefined,
    save: () => Promise.resolve(),
    open: (path: string) => {
      opened.push(path)
      return Promise.resolve()
    },
    close: () => undefined,
    activate: () => undefined,
  },
}))

/** The rows the registry answers with, and which of them were run. A row that says
 *  `byHand` is one only somebody at the keyboard may press; see commands.ts. */
const rows = [
  { id: 'files', label: 'File list', run: () => ran.push('files') },
  { id: 'record', label: 'Record', byHand: true, run: () => ran.push('record') },
  { id: 'shut', label: 'Shut', disabled: true, run: () => ran.push('shut') },
]
const ran: string[] = []

vi.mock('../commands', () => ({ appCommands: () => rows }))
vi.mock('../views.svelte', () => ({ views: { of: () => undefined } }))

const { appendNote, openNote, runCommand } = await import('./acts')

describe('a note named rather than pathed', () => {
  test('is opened at the path the index holds it under', async () => {
    named = 'notes/Plan.md'

    expect(await openNote({ path: 'Plan' })).toEqual({
      path: 'notes/Plan.md',
      heading: null,
      block: null,
    })
    expect(opened).toEqual(['/Work/notes/Plan.md'])
  })

  test('and an index answer no space would take is refused like any other path', async () => {
    // Nothing in the app writes such a row, which is exactly why the judge is
    // here: the index is a map somebody's own notes filled in, and a caller of
    // this that skipped the judge because the index answered would be a hole
    // somewhere nobody is looking.
    named = '../../outside.md'
    opened.length = 0

    await expect(openNote({ path: 'outside' })).rejects.toThrow(/not a path inside the space/)
    expect(opened).toEqual([])
  })

  /** The index keeps notes and the files beside them apart, and a name is looked
   *  up among the notes: `nib://open?path=Plan` is documented as finding the note
   *  the way a `[[wikilink]]` does. It used to ask the file list, which holds the
   *  pictures and the PDFs and never a note, so the answer was always nothing and
   *  every link written by hand with a name in it said it could not be followed.
   *  A path was never affected, which is why it went unseen. */
  test('asks the notes rather than the files beside them', async () => {
    named = 'notes/Plan.md'
    beside = null
    opened.length = 0

    expect(await openNote({ path: 'Plan' })).toEqual({
      path: 'notes/Plan.md',
      heading: null,
      block: null,
    })
    expect(opened).toEqual(['/Work/notes/Plan.md'])
  })

  /** The index is built off the launch's critical path, so a link that starts the
   *  app is followed while the scan is still in flight. Asking it then is asking an
   *  empty index: the note is there, the name is right, and the answer is nothing.
   *  So the name waits for the scan, which answers at once when none is running. */
  test('waits for the scan the launch started before asking it anything', async () => {
    named = null
    opened.length = 0
    scans = 0
    scanning = new Promise((landed) => {
      setTimeout(() => {
        named = 'notes/Plan.md'
        landed()
      }, 20)
    })

    expect(await openNote({ path: 'Plan' })).toEqual({
      path: 'notes/Plan.md',
      heading: null,
      block: null,
    })
    expect(scans).toBe(1)
    expect(opened).toEqual(['/Work/notes/Plan.md'])

    scanning = Promise.resolve()
  })

  test('and a path is taken as written, whatever the index would say about it', async () => {
    named = 'notes/Somewhere else.md'
    opened.length = 0

    expect(await openNote({ path: 'notes/Plan.md' })).toEqual({
      path: 'notes/Plan.md',
      heading: null,
      block: null,
    })
    expect(opened).toEqual(['/Work/notes/Plan.md'])
  })
})

/** `nib://command?id=…` is the one action a link may ask for that is a whole list
 *  rather than one act, and a few of those rows reach for a microphone or a camera
 *  or sign the machine out. A link is written by anybody and followed by a click. */
describe('a row of the palette', () => {
  test('runs for the command line and for a link alike', () => {
    ran.length = 0

    expect(runCommand({ id: 'files' }, 'link')).toEqual({ id: 'files', label: 'File list' })
    expect(runCommand({ id: 'files' }, 'here')).toEqual({ id: 'files', label: 'File list' })
    expect(ran).toEqual(['files', 'files'])
  })

  test('unless it is one only somebody at the keyboard may press', () => {
    ran.length = 0

    expect(() => runCommand({ id: 'record' }, 'link')).toThrow(/not something a link may run/)
    expect(ran).toEqual([])

    // The command line is this machine, behind a secret only this user can read.
    expect(runCommand({ id: 'record' }, 'here')).toEqual({ id: 'record', label: 'Record' })
    expect(ran).toEqual(['record'])
  })

  test('and a row that cannot run just now says so rather than doing nothing', () => {
    ran.length = 0

    expect(() => runCommand({ id: 'shut' }, 'here')).toThrow(/cannot run just now/)
    expect(() => runCommand({ id: 'nothing' }, 'here')).toThrow(/there is no command/)
    expect(() => runCommand({}, 'here')).toThrow(/say which command/)
    expect(ran).toEqual([])
  })
})

/** Words onto the end of a note, which is `nib://append` and `nib append`.
 *
 *  The point of the action is that a caller does not have to know whether the note is
 *  there: a shortcut that files a line into today's note is the same shortcut on the
 *  first of the month. So both roads are checked - the note that is there is added to,
 *  the note that is not is made - along with the path being judged exactly as every
 *  other path a link writes is. */
describe('words appended to a note', () => {
  test('go onto the end of the one that is there, once', async () => {
    held.set('/Work/Daily.md', '# Monday\n\nA kestrel.')
    written.length = 0
    made.length = 0

    expect(await appendNote({ path: 'Daily.md', content: 'And a buzzard.' })).toEqual({
      path: 'Daily.md',
      added: true,
    })

    expect(made).toEqual([])
    expect(written).toHaveLength(1)
    expect(written[0]?.after).toBe('# Monday\n\nA kestrel.\n\nAnd a buzzard.\n')
    // One blank line between them however the first ended, and the words that were
    // there are still there.
    expect(written[0]?.before).toBe('# Monday\n\nA kestrel.')
  })

  test('make the note when it is not there, rather than refusing', async () => {
    held.clear()
    written.length = 0
    made.length = 0

    expect(await appendNote({ path: 'notes/Fresh.md', content: 'A line.' })).toEqual({
      path: 'notes/Fresh.md',
      added: false,
    })

    expect(made).toEqual([{ folder: '/Work/notes', name: 'Fresh.md' }])
    expect(written).toEqual([])
  })

  test('never reach a path the space would not take', async () => {
    held.clear()
    written.length = 0
    made.length = 0

    await expect(appendNote({ path: '../../outside.md', content: 'x' })).rejects.toThrow(
      /not a path inside the space/,
    )
    expect(written).toEqual([])
    expect(made).toEqual([])
  })

  test('and the top of the note is not what append means', async () => {
    held.set('/Work/Daily.md', 'Already here.')
    written.length = 0

    // `prepend` is `new`'s to offer. A link that asked this action for the top of the
    // note gets the end of it, which is what the action is called.
    await appendNote({ path: 'Daily.md', content: 'Added.', prepend: true })
    expect(written[0]?.after).toBe('Already here.\n\nAdded.\n')
  })
})
