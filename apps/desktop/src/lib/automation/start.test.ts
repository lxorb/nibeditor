import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The road a link comes in by, and what it says back.
 *
 *  Driven through the browser's road, which is the one road that needs no crate: the
 *  app reads the link out of its own address. Everything a link can reach beyond
 *  `dispatch` is stood in for, because what is under test is the answering. */

interface World {
  /** The address the app is sitting at, which is where the link arrives. */
  here: string
  /** What `dispatch` answers, and which verb it was asked for. */
  asked: string[]
  answer: { ok: true; value: unknown } | { ok: false; error: string }
  /** Every address the app left through, in order. */
  went: string[]
  /** What the reader was told, which is a different question from what a link hears. */
  said: string[]
}

const world = vi.hoisted((): World => ({
  here: 'https://nib.example/',
  asked: [],
  answer: { ok: true, value: {} },
  went: [],
  said: [],
}))

vi.stubGlobal('window', {
  location: {
    get href() {
      return world.here
    },
  },
  history: { replaceState: () => undefined },
})

/** The table itself, with only the running of a verb stood in: which verbs a link
 *  may ask for and which of them answers one is the thing being tested, so it is read
 *  off the real rows. */
vi.mock('./verbs', async () => {
  const real = await vi.importActual<typeof import('./verbs')>('./verbs')

  return {
    ...real,
    dispatch: (verb: string) => {
      world.asked.push(verb)
      return Promise.resolve(world.answer)
    },
  }
})

vi.mock('../tauri', () => ({
  isNative: false,
  isDesktop: false,
  invoke: () => Promise.resolve(null),
  openExternal: (url: string) => {
    world.went.push(url)
    return Promise.resolve()
  },
}))

/** The stores the table pulls in read the browser's storage and ask what kind of
 *  machine this is, and there is neither under node; see verbs.test.ts. */
vi.stubGlobal('localStorage', {
  length: 0,
  key: () => null,
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
} satisfies Storage)
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

const { startAutomation } = await import('./start')

/** The line across the top of the document, which is a different audience from a
 *  link: what it is told is counted, not read. The store itself is the real one, so
 *  what this watches is the call the road actually makes. */
const { busy } = await import('../busy.svelte')
vi.spyOn(busy, 'failed').mockImplementation((words: string) => {
  world.said.push(words)
})

/** Follows one link, the way a browser hands it over. */
async function arrives(uri: string): Promise<void> {
  const at = new URL('https://nib.example/')
  at.searchParams.set('nib', uri)
  world.here = at.href

  await startAutomation()
}

const BACK = 'https://elsewhere.example/done'

beforeEach(() => {
  world.asked = []
  world.went = []
  world.said = []
  world.answer = { ok: true, value: {} }
})

describe('a link that changed nothing', () => {
  test('tells the address it carries nothing at all', async () => {
    world.answer = { ok: true, value: { path: 'reading/Divorce.md', heading: null } }
    await arrives(`nib://open?path=Divorce&x-success=${encodeURIComponent(BACK)}`)

    // It opened: the verb ran and the reader is looking at the note.
    expect(world.asked).toEqual(['open'])
    // And whoever wrote the link learns none of that. A path said back is an answer
    // about what this person keeps notes about, from a scheme that may move a window.
    expect(world.went).toEqual([])
  })

  test('and tells it nothing when the note was not there either', async () => {
    // Two answers that cannot be told apart are one answer. Told apart, a hundred
    // links are a listing of somebody's space.
    world.answer = { ok: false, error: 'there is no note at reading/Divorce.md' }
    await arrives(`nib://open?path=Divorce&x-error=${encodeURIComponent(BACK)}`)

    expect(world.went).toEqual([])
    // The person at the keyboard is told, which is a different audience.
    expect(world.said.length).toBe(1)
  })

  test('which is also true of a search and of a command', async () => {
    world.answer = { ok: true, value: { query: 'tag:#work', running: false } }
    await arrives(`nib://search?query=tag:%23work&x-success=${encodeURIComponent(BACK)}`)

    world.answer = { ok: true, value: { id: 'save', ran: true } }
    await arrives(`nib://command?id=save&x-success=${encodeURIComponent(BACK)}`)

    expect(world.asked).toEqual(['search', 'commands.run'])
    expect(world.went).toEqual([])
  })

  test('and of a chain, so nothing gets out by pointing back at the app', async () => {
    world.answer = { ok: true, value: { path: 'reading/Divorce.md' } }
    const inner = `nib://open?x-success=${encodeURIComponent(BACK)}`
    await arrives(`nib://open?path=Divorce&x-success=${encodeURIComponent(inner)}`)

    expect(world.asked).toEqual(['open'])
    expect(world.went).toEqual([])
  })
})

describe('a link that made a note', () => {
  test('hears where it went, which is what the caller asked for', async () => {
    world.answer = { ok: true, value: { path: 'inbox/Idea.md', created: true } }
    await arrives(`nib://new?name=Idea&x-success=${encodeURIComponent(BACK)}`)

    expect(world.asked).toEqual(['new'])
    expect(world.went.length).toBe(1)

    const said = new URL(world.went[0] ?? '').searchParams
    expect(said.get('path')).toBe('inbox/Idea.md')
    expect(said.get('created')).toBe('true')
  })

  test('and hears why it did not', async () => {
    world.answer = { ok: false, error: 'Idea.md is already there: say append or prepend' }
    await arrives(`nib://new?name=Idea&x-error=${encodeURIComponent(BACK)}`)

    expect(new URL(world.went[0] ?? '').searchParams.get('error')).toContain('already there')
  })
})

describe('a link that added to a note', () => {
  test('is followed, and says whether the note was there already', async () => {
    world.answer = { ok: true, value: { path: 'Daily.md', added: true } }
    await arrives(
      `nib://append?path=Daily.md&content=A%20line.&x-success=${encodeURIComponent(BACK)}`,
    )

    expect(world.asked).toEqual(['append'])

    const said = new URL(world.went[0] ?? '').searchParams
    expect(said.get('path')).toBe('Daily.md')
    expect(said.get('added')).toBe('true')
  })
})

describe('a link the app will not take at all', () => {
  test('is declined to its face, which says nothing about any space', async () => {
    await arrives(`nib://files.delete?path=x&x-cancel=${encodeURIComponent(BACK)}`)

    expect(world.asked).toEqual([])
    expect(new URL(world.went[0] ?? '').searchParams.get('error')).toBe(
      'not something a link may ask for',
    )
  })

  test('and one naming nothing is simply wrong', async () => {
    await arrives(`nib://nonsense?x-error=${encodeURIComponent(BACK)}`)

    expect(new URL(world.went[0] ?? '').searchParams.get('error')).toBe('no action called nonsense')
  })
})
