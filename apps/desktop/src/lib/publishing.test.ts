import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Putting a space on the web: which space the sheet is about, what it asks the
 *  server for, and what it does with the answer. The account and the network are
 *  stood in for; the store is the real one. */

interface World {
  /** Which remote space each folder mirrors, if any. */
  mirrors: Record<string, string>
  /** Every call that was made, in order. */
  asked: string[]
  /** Set to make the next call fail. */
  refuse: string | null
  /** What a name check comes back with. */
  available: { available: boolean; reason?: string }
  /** What the domain routes answer with. */
  domain: { state: string; dns: never[]; detail: string | null }
  /** The answers the forms on the site have collected. */
  answers: { id: string; note: string; path: string; at: number; answers: Record<string, string> }[]
  /** Whether the site's forms have stopped taking answers. */
  full: boolean
}

const world = vi.hoisted((): World => ({
  mirrors: {},
  asked: [],
  refuse: null,
  available: { available: true },
  domain: { state: 'pending', dns: [], detail: null },
  answers: [],
  full: false,
}))

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  const answer = <T>(what: string, value: T): Promise<T> => {
    world.asked.push(what)
    if (world.refuse) return Promise.reject(new original.ApiError(403, world.refuse))
    return Promise.resolve(value)
  }

  return {
    ...original,
    api: {
      subdomainAvailable: (_token: string, name: string, space?: string) =>
        answer(`available ${name} for ${space ?? 'nobody'}`, world.available),
      publish: (_token: string, id: string, settings: Record<string, unknown>) =>
        answer(`publish ${id} ${JSON.stringify(settings)}`, {
          space: {},
          dns: [{ type: 'CNAME', name: 'notes', value: 'nibeditor.com' }],
        }),
      unpublish: (_token: string, id: string) => answer(`unpublish ${id}`, { ok: true }),
      site: (_token: string, id: string, settings: Record<string, unknown>) =>
        answer(`site ${id} ${JSON.stringify(settings)}`, { space: {}, site: {} }),
      sitePreview: (_token: string, id: string) =>
        answer(`preview ${id}`, { pages: 0, before: 0, adds: [], removes: [], more: false }),
      domainStatus: (_token: string, id: string) => answer(`status ${id}`, world.domain),
      answers: (_token: string, id: string) =>
        answer(`answers ${id}`, {
          answers: world.answers,
          more: false,
          keptDays: 180,
          full: world.full,
        }),
      answersCsv: (_token: string, id: string) =>
        answer(`answers.csv ${id}`, ['"when","Your name"', '"1","Ada"', ''].join('\n')),
      forgetAnswer: (_token: string, id: string, one: string) =>
        answer(`forget ${one} of ${id}`, { ok: true as const }),
      verifyDomain: (_token: string, id: string) => answer(`verify ${id}`, world.domain),
      listSpaces: () => Promise.resolve({ spaces: account.spaces, deleted: [] }),
    },
  }
})

vi.mock('./sync.svelte', () => ({
  sync: { remoteIdFor: (root: string) => world.mirrors[root] ?? null },
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    get spaces() {
      return Object.keys(world.mirrors).map((root) => ({ id: root, name: root, root }))
    },
  },
}))

vi.mock('./i18n.svelte', () => ({
  message: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}))

// Imported once, at module scope: a hook that re-imported the store graph would
// charge whichever test ran first for compiling it.
import { account } from './account.svelte'
import { publish } from './publishing.svelte'
import { canPublish } from './sharing.svelte'
import type { RemoteSpace } from './api'

/** A space on the account, with only the fields any of this reads. */
function remote(id: string, role: 'owner' | 'write' | 'read', blog = {}): RemoteSpace {
  return {
    id,
    name: id,
    role,
    blog: {
      enabled: false,
      subdomain: null,
      domain: null,
      title: null,
      note: null,
      dns: [],
      ...blog,
    },
  } as unknown as RemoteSpace
}

const local = (name: string) => ({ id: name, name, root: name })

beforeEach(() => {
  world.mirrors = { Notes: 'space-1' }
  world.asked = []
  world.refuse = null
  world.available = { available: true }
  world.domain = { state: 'pending', dns: [], detail: null }
  world.answers = []
  world.full = false

  account.token = 'session'
  account.user = { id: 'u1', email: 'owner@example.com', name: 'Emil' }
  account.spaces = [remote('space-1', 'owner')]

  publish.close()
  publish.error = null
  publish.dns = []
  publish.status = null
  publish.fill(undefined)
  publish.confirmed = false
})

describe('who may publish a space', () => {
  test('nobody, while nobody is signed in', () => {
    account.token = null
    account.user = null

    expect(canPublish(local('Notes'))).toBe(false)
  })

  test('nobody, for a folder the account has never seen', () => {
    world.mirrors = {}

    expect(canPublish(local('Notes'))).toBe(false)
  })

  test('nobody, for a space somebody shared with them', () => {
    account.spaces = [remote('space-1', 'write')]

    expect(canPublish(local('Notes'))).toBe(false)
  })

  test('the owner', () => {
    expect(canPublish(local('Notes'))).toBe(true)
  })
})

describe('the Publish sheet', () => {
  test('opens on the space it was asked about', () => {
    publish.show(local('Notes'))

    expect(publish.open).toBe(true)
    expect(publish.space?.name).toBe('Notes')
    expect(publish.remote?.id).toBe('space-1')
  })

  test('does not open on a folder the account has never seen', () => {
    world.mirrors = {}
    publish.show(local('Elsewhere'))

    expect(publish.open).toBe(false)
  })

  test('is filled from what the account holds', () => {
    account.spaces = [
      remote('space-1', 'owner', {
        enabled: true,
        domain: 'notes.example.com',
        note: 'Read me.md',
      }),
    ]
    publish.show(local('Notes'))
    publish.fill(publish.blog)

    expect(publish.address).toBe('domain')
    expect(publish.domain).toBe('notes.example.com')
    expect(publish.note).toBe('Read me.md')
    expect(publish.published).toBe(true)
  })

  test('the shared name is the address until a space has one of its own', () => {
    account.spaces = [remote('space-1', 'owner', { enabled: true, subdomain: 'emil' })]
    publish.show(local('Notes'))
    publish.fill(publish.blog)

    expect(publish.address).toBe('subdomain')
    expect(publish.subdomain).toBe('emil')
  })

  test('sends only the address that was chosen, and the note with it', async () => {
    publish.show(local('Notes'))
    publish.subdomain = 'emil'
    publish.note = 'Read me.md'
    await publish.publish()

    // The site's own decisions first, then the address: one press of Publish is
    // one statement, and the rules decide what the address then serves.
    expect(world.asked).toEqual([
      'site space-1 {"rules":{"include":[],"exclude":[],"otherwise":"all"},"description":"","theme":null,"analytics":null}',
      'publish space-1 {"subdomain":"emil","note":"Read me.md"}',
    ])
  })

  test('the whole space is a note of none rather than an empty name', async () => {
    publish.show(local('Notes'))
    publish.address = 'domain'
    publish.domain = 'notes.example.com'
    publish.note = ''
    await publish.publish()

    expect(world.asked).toEqual([
      'site space-1 {"rules":{"include":[],"exclude":[],"otherwise":"all"},"description":"","theme":null,"analytics":null}',
      'publish space-1 {"domain":"notes.example.com","note":null}',
    ])
  })

  test('keeps the records the server answered with', async () => {
    publish.show(local('Notes'))
    publish.subdomain = 'emil'
    await publish.publish()

    expect(publish.dns).toHaveLength(1)
  })

  test('says what went wrong rather than pretending it worked', async () => {
    publish.show(local('Notes'))
    publish.subdomain = 'emil'
    world.refuse = 'that name is taken'
    await publish.publish()

    expect(publish.error).toBe('that name is taken')
    expect(publish.busy).toBe(false)
  })

  test('takes a space back off the web, and forgets its records', async () => {
    publish.show(local('Notes'))
    publish.dns = [{ type: 'CNAME', name: 'notes', value: 'nibeditor.com' }]
    await publish.unpublish()

    expect(world.asked).toEqual(['unpublish space-1'])
    expect(publish.dns).toEqual([])
  })

  test('is not ready until there is an address to publish at', () => {
    publish.show(local('Notes'))
    expect(publish.ready).toBe(false)

    publish.subdomain = 'emil'
    expect(publish.ready).toBe(true)

    publish.address = 'domain'
    expect(publish.ready).toBe(false)

    publish.domain = 'notes.example.com'
    expect(publish.ready).toBe(true)
  })

  test('a name is asked about for the space it would belong to', async () => {
    publish.show(local('Notes'))
    await publish.checkSubdomain('emil')

    expect(world.asked).toEqual(['available emil for space-1'])
    expect(publish.availability.available).toBe(true)
  })

  test('a name too short to be one is not asked about at all', async () => {
    publish.show(local('Notes'))
    await publish.checkSubdomain('e')

    expect(world.asked).toEqual([])
    expect(publish.availability.available).toBeNull()
  })

  test('only the characters a name may hold are typed into it', () => {
    publish.show(local('Notes'))
    publish.typeSubdomain('Emil’s Notes!')

    expect(publish.subdomain).toBe('emilsnotes')
  })

  test('the rules and whether there is a password come off the listing', () => {
    account.spaces = [
      remote('space-1', 'owner', {
        enabled: true,
        site: {
          rules: { include: ['Public'], exclude: ['Drafts'], otherwise: 'none' },
          description: 'Notes from the field.',
          password: true,
        },
      }),
    ]
    publish.show(local('Notes'))
    publish.fill(publish.blog)

    expect(publish.rules).toEqual({
      include: ['Public'],
      exclude: ['Drafts'],
      otherwise: 'none',
    })
    expect(publish.description).toBe('Notes from the field.')
    expect(publish.hasPassword).toBe(true)
    // Never the password itself: the account does not hand one back.
    expect(publish.password).toBe('')
  })

  test('a folder is in one list or the other, never both', () => {
    publish.show(local('Notes'))

    publish.rule('exclude', 'Drafts', true)
    expect(publish.rules.exclude).toEqual(['Drafts'])

    publish.rule('include', 'Drafts', true)
    publish.rule('exclude', 'Drafts', false)
    expect(publish.rules).toEqual({ include: ['Drafts'], exclude: [], otherwise: 'all' })
  })

  test('what the rules would change is asked of the server that serves them', async () => {
    publish.show(local('Notes'))
    publish.otherwise('none')
    await publish.askChanges()

    expect(world.asked).toEqual(['preview space-1'])
    expect(publish.changes?.pages).toBe(0)
  })

  test('an empty password field is not a password being taken off', async () => {
    publish.show(local('Notes'))
    publish.subdomain = 'emil'
    publish.password = ''
    await publish.publish()

    expect(world.asked[0]).not.toContain('password')
  })

  test('and taking one off is its own request', async () => {
    publish.show(local('Notes'))
    await publish.removePassword()

    expect(world.asked).toEqual(['site space-1 {"password":null}'])
    expect(publish.hasPassword).toBe(false)
  })

  test('a note is named to the server relative to its own space', () => {
    publish.show(local('Notes'))

    expect(publish.relativeTo('Notes\\folder\\Read me.md')).toBe('folder/Read me.md')
  })

  test('verifying asks the server, and keeps what it said', async () => {
    account.spaces = [remote('space-1', 'owner', { enabled: true, domain: 'notes.example.com' })]
    publish.show(local('Notes'))
    world.domain = { state: 'active', dns: [], detail: null }
    await publish.verifyDomain()

    expect(world.asked).toEqual(['verify space-1'])
    expect(publish.status?.state).toBe('active')
  })

  /** A refusal to a verify is an answer: the server says which state the domain
   *  is in, and that is what the sheet shows. */
  test('a domain that is not answering yet is a state, not a failure', async () => {
    account.spaces = [remote('space-1', 'owner', { enabled: true, domain: 'notes.example.com' })]
    publish.show(local('Notes'))
    await publish.verifyDomain()

    expect(publish.status?.state).toBe('pending')
    expect(publish.error).toBeNull()
  })

  test('nothing is asked about a domain a space does not have', async () => {
    publish.show(local('Notes'))
    await publish.watchDomain()

    expect(world.asked).toEqual([])
    expect(publish.status).toBeNull()
    publish.stopWatchingDomain()
  })

  test('closing it stops asking after the domain', async () => {
    account.spaces = [remote('space-1', 'owner', { enabled: true, domain: 'notes.example.com' })]
    publish.show(local('Notes'))
    await publish.watchDomain()
    expect(world.asked).toEqual(['status space-1'])

    publish.close()
    expect(publish.open).toBe(false)
  })
})

/** What the forms on a site collected, which is the one thing the sheet shows
 *  that came from somebody other than the reader of it. */
describe('the answers a site has collected', () => {
  const one = {
    id: 'answer-1',
    note: 'note-1',
    path: 'Say hello.md',
    at: 1,
    answers: { 'Your name': 'Ada' },
  }

  test('are read for a site that is live', async () => {
    account.spaces = [remote('space-1', 'owner', { enabled: true, subdomain: 'field' })]
    world.answers = [one]

    publish.show(local('Notes'))
    await publish.readAnswers()

    expect(world.asked).toContain('answers space-1')
    expect(publish.answers).toEqual([one])
  })

  test('with how long they are kept and whether the forms still take more', async () => {
    account.spaces = [remote('space-1', 'owner', { enabled: true, subdomain: 'field' })]
    world.answers = [one]
    world.full = true

    publish.show(local('Notes'))
    await publish.readAnswers()
    expect(publish.kept).toEqual({ days: 180, full: true })

    // And none of it is carried to the next space the sheet opens on.
    publish.show(local('Notes'))
    expect(publish.kept).toBeNull()
  })

  test('and not for a space that is not published at all', async () => {
    world.answers = [one]

    publish.show(local('Notes'))
    await publish.readAnswers()

    expect(world.asked).toEqual([])
    expect(publish.answers).toEqual([])
  })

  test('a site with no forms on it shows nothing rather than an error', async () => {
    account.spaces = [remote('space-1', 'owner', { enabled: true, subdomain: 'field' })]
    world.refuse = 'no answers here'

    publish.show(local('Notes'))
    await publish.readAnswers()

    expect(publish.answers).toEqual([])
    expect(publish.error).toBeNull()
  })

  test('one can be forgotten, and the list is the shorter one', async () => {
    account.spaces = [remote('space-1', 'owner', { enabled: true, subdomain: 'field' })]
    world.answers = [one]

    publish.show(local('Notes'))
    await publish.readAnswers()
    await publish.forget(one)

    expect(world.asked).toContain('forget answer-1 of space-1')
    expect(publish.answers).toEqual([])
  })

  test('and the spreadsheet is the server’s, not the sheet’s', async () => {
    // What a column is called is decided where an answer is stored, so the file
    // is asked for rather than assembled here.
    account.spaces = [remote('space-1', 'owner', { enabled: true, subdomain: 'field' })]

    publish.show(local('Notes'))
    const csv = await publish.answersCsv()

    expect(world.asked).toContain('answers.csv space-1')
    expect(csv).toContain('"when"')
  })
})
