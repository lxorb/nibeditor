import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Following a link, from this side of the wire: which of the join page's states
 *  each kind of link ends in, and what the page asks for on the way.
 *
 *  What is under test is that almost nothing is asked. A mailed invitation and an
 *  open link both land in the space with no page at all; the only link that shows
 *  anything is the one that asks the owner first, and the only line the app ever
 *  has to write is for a link that has stopped opening anything. */

interface World {
  /** What the peek answers, or null for a link that opens nothing. */
  about: {
    kind: 'invite' | 'link'
    space: string
    role: 'write' | 'read'
    email: string | null
    asks: boolean
    from: string | null
  } | null
  /** What walking through it answers. */
  through: Record<string, unknown>
  /** Set to make walking through it fail, the way a link that has run out does. */
  refuse: string | null
  /** Set to make the request never arrive, which says nothing about the link. */
  unreachable: boolean
  /** Every call that was made, in order, and what it carried. */
  asked: { key: string; options: Record<string, unknown> }[]
  /** Which space the app was shown, if any. */
  shown: string | null
  /** How many passes syncing was asked for. */
  passes: number
  /** What the address bar holds. */
  path: string
}

const world = vi.hoisted((): World => ({
  about: null,
  through: {},
  refuse: null,
  unreachable: false,
  asked: [],
  shown: null,
  passes: 0,
  path: '/',
}))

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  return {
    ...original,
    api: {
      invitation: () =>
        world.about
          ? Promise.resolve(world.about)
          : Promise.reject(new original.ApiError(404, 'that link has expired')),
      join: (key: string, options: Record<string, unknown> = {}) => {
        world.asked.push({ key, options })
        if (world.unreachable) return Promise.reject(new Error('the network is not there'))
        if (world.refuse) return Promise.reject(new original.ApiError(404, world.refuse))

        return Promise.resolve(world.through)
      },
      me: () => Promise.resolve({ guest: { id: 'g1', name: 'Windows wren' } }),
      listSpaces: () => Promise.resolve({ spaces: [], deleted: [] }),
    },
  }
})

vi.mock('./sync.svelte', () => ({
  sync: {
    pass: () => {
      world.passes += 1
      return Promise.resolve()
    },
    remoteIdFor: (root: string) => (root === '/Plans' ? 'space-1' : null),
  },
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    spaces: [{ id: 'here', name: 'Plans', root: '/Plans' }],
    showSpace: (id: string) => {
      world.shown = id
      return Promise.resolve()
    },
    // A machine with nothing on it, so the question a fresh account's session
    // asks about the notes already here has nothing to ask about; see settling.ts.
    hasLocalContent: () => Promise.resolve(false),
  },
}))

vi.mock('./i18n.svelte', () => ({
  t: (text: string) => text,
  message: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}))

// A device names itself for the guest a link hands out; what it is called is the
// rooms' business and is stood in for here.
vi.mock('./rooms/who', () => ({ deviceName: () => 'Windows' }))

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
vi.stubGlobal('window', {
  get location() {
    return { pathname: world.path }
  },
  history: {
    replaceState: (_state: unknown, _title: string, url: string) => {
      world.path = url
    },
  },
})

let joining: typeof import('./joining.svelte').joining
let account: typeof import('./account.svelte').account

/** The store graph, loaded once here rather than by whichever hook runs first;
 *  see docs/conventions.md. */
await import('./joining.svelte')

/** The token in a link, as the address bar carries it. */
const TOKEN = 'a'.repeat(64)

/** A space, with only the fields any of this reads. */
const space = { id: 'space-1', name: 'Plans', role: 'write' }

beforeEach(async () => {
  localStorage.clear()
  world.about = null
  world.through = {}
  world.refuse = null
  world.unreachable = false
  world.asked = []
  world.shown = null
  world.passes = 0
  world.path = `/join/${TOKEN}`

  vi.resetModules()
  ;({ joining } = await import('./joining.svelte'))
  ;({ account } = await import('./account.svelte'))
})

// Waiting on the owner asks again on a timer, and a timer left running would
// still be asking while the next test counted what was asked.
afterEach(() => joining.dismiss())

/** What the peek says about each kind of link. */
const invite = {
  kind: 'invite' as const,
  space: 'Plans',
  role: 'write' as const,
  email: 'ada@example.com',
  asks: false,
  from: 'Emil',
}
const open = {
  kind: 'link' as const,
  space: 'Plans',
  role: 'write' as const,
  email: null,
  asks: false,
  from: 'Emil',
}
const approval = { ...open, asks: true }

describe('a mailed invitation', () => {
  beforeEach(() => {
    world.about = invite
    world.through = {
      token: 'session',
      user: { id: 'u1', email: 'ada@example.com', name: null },
      space,
    }
  })

  test('opens the space with nothing shown and nothing asked', async () => {
    await joining.start()

    expect(joining.step).toBeNull()
    expect(account.signedIn).toBe(true)
    expect(account.user?.email).toBe('ada@example.com')
    expect(world.shown).toBe('here')
  })

  test('takes the token out of the address bar before anything else', async () => {
    await joining.start()
    expect(world.path).toBe('/')
  })

  test('brings the space down in one pass', async () => {
    await joining.start()
    expect(world.passes).toBe(1)
  })

  test('settles the notes already here before the space arrives', async () => {
    await joining.start()

    // The answer to that question can be to erase what is here, so it is asked
    // before the space comes down rather than after; see settling.ts.
    expect(account.settling).toBe(false)
    expect(account.syncable).toBe(true)
  })
})

describe('a mailed invitation to an account that asks for a second code', () => {
  beforeEach(() => {
    world.about = invite
    world.through = { second: true, holding: 'half' }
  })

  test('signs nobody in, and asks for the code out of the app', async () => {
    await joining.start()

    expect(account.signedIn).toBe(false)
    expect(account.open).toBe(true)
    expect(account.step).toBe('second')
    expect(world.shown).toBeNull()
  })

  test('and keeps the link, which the account walks through once it is in', async () => {
    await joining.start()

    world.through = { space }
    await joining.walkThrough()

    expect(world.asked.map((one) => one.key)).toEqual([TOKEN, TOKEN])
  })
})

describe('a link anybody may follow', () => {
  beforeEach(() => {
    world.about = open
    world.through = { token: 'guest-session', guest: { id: 'g1', name: 'Windows wren' }, space }
  })

  test('lands in the space as a guest, with nothing shown and nothing asked', async () => {
    await joining.start()

    expect(joining.step).toBeNull()
    expect(account.guest?.name).toBe('Windows wren')
    expect(account.user).toBeNull()
    expect(account.signedIn).toBe(true)
    expect(world.shown).toBe('here')
  })

  test('says what this device is called, so the guest has a name', async () => {
    await joining.start()
    expect(world.asked[0]?.options.device).toBe('Windows')
  })

  test('is never asked to erase the notes already on this machine', async () => {
    await joining.start()
    // Nothing to join and nothing to erase: a guest has no account for the
    // writing already here to become part of.
    expect(account.settling).toBe(false)
    expect(account.syncable).toBe(true)
  })
})

describe('a link that asks first', () => {
  beforeEach(() => {
    world.about = approval
    world.through = { token: 'guest-session', guest: { id: 'g1', name: 'Ada' }, waiting: true }
  })

  test('asks one field, and nothing has been walked through yet', async () => {
    await joining.start()

    expect(joining.step).toBe('asking')
    expect(world.asked).toEqual([])
  })

  test('sends a name as a name', async () => {
    await joining.start()
    joining.told = ' Ada '
    await joining.tell()

    expect(world.asked[0]?.options.name).toBe('Ada')
    expect(world.asked[0]?.options.email).toBeUndefined()
  })

  test('sends an address as an address, which is what later claims the space', async () => {
    await joining.start()
    joining.told = 'ada@example.com'
    await joining.tell()

    expect(world.asked[0]?.options.email).toBe('ada@example.com')
    expect(world.asked[0]?.options.name).toBeUndefined()
  })

  test('asks nothing when the field is empty', async () => {
    await joining.start()
    joining.told = '  '
    await joining.tell()

    expect(world.asked).toEqual([])
  })

  test('waits on the owner, holding the session it was given', async () => {
    await joining.start()
    joining.told = 'Ada'
    await joining.tell()

    expect(joining.step).toBe('waiting')
    expect(account.guest?.name).toBe('Ada')
    expect(world.shown).toBeNull()
  })

  test('turns into the space when the owner accepts', async () => {
    await joining.start()
    joining.told = 'Ada'
    await joining.tell()

    world.through = { guest: { id: 'g1', name: 'Ada' }, space }
    await joining.walkThrough()

    expect(joining.step).toBeNull()
    expect(world.shown).toBe('here')
  })

  test('says so when the owner declines', async () => {
    await joining.start()
    joining.told = 'Ada'
    await joining.tell()

    world.through = { guest: { id: 'g1', name: 'Ada' }, declined: true }
    await joining.walkThrough()

    expect(joining.step).toBe('declined')
    expect(world.shown).toBeNull()
  })

  test('remembers the link while it waits, and forgets it once answered', async () => {
    await joining.start()
    joining.told = 'Ada'
    await joining.tell()

    expect(localStorage.getItem('nib:waiting')).toBe(TOKEN)

    world.through = { guest: { id: 'g1', name: 'Ada' }, space }
    await joining.walkThrough()
    expect(localStorage.getItem('nib:waiting')).toBeNull()
  })

  test('picks the wait back up on the next launch', async () => {
    // A launch where the address bar holds nothing: the link was taken out of it
    // when it was followed, and the guest session came back with the app.
    localStorage.setItem('nib:session', 'guest-session')
    localStorage.setItem('nib:waiting', TOKEN)
    world.path = '/'

    await account.restore()
    expect(account.guest?.name).toBe('Windows wren')

    await joining.start()
    expect(joining.step).toBe('waiting')
    expect(world.asked[0]?.key).toBe(TOKEN)
  })
})

/** The wait is the one state that lasts, and it asks again every three seconds.
 *
 *  The bug these are about: every failure used to read as a link that had run
 *  out, so one dropped request in the three seconds before the owner pressed
 *  Accept ended the wait, forgot the link, and told somebody to ask for another
 *  one. The same reasoning as restoring a session in account.svelte.ts: only the
 *  service refusing it says anything about the credential. */
describe('waiting on the owner', () => {
  beforeEach(async () => {
    world.about = approval
    world.through = { token: 'guest-session', guest: { id: 'g1', name: 'Ada' }, waiting: true }

    await joining.start()
    joining.told = 'Ada'
    await joining.tell()
  })

  test('keeps waiting when a request never arrives', async () => {
    world.unreachable = true
    await joining.walkThrough()

    expect(joining.step).toBe('waiting')
    // Still remembered, so the next launch picks the wait back up.
    expect(localStorage.getItem('nib:waiting')).toBe(TOKEN)
    expect(joining.error).toBe('the network is not there')
  })

  test('is let in by the ask after the one that did not arrive', async () => {
    world.unreachable = true
    await joining.walkThrough()

    world.unreachable = false
    world.through = { guest: { id: 'g1', name: 'Ada' }, space }
    await joining.walkThrough()

    expect(joining.step).toBeNull()
    expect(world.shown).toBe('here')
  })

  test('ends when the service says the link is finished', async () => {
    world.refuse = 'that link has expired'
    await joining.walkThrough()

    expect(joining.step).toBe('gone')
    expect(localStorage.getItem('nib:waiting')).toBeNull()
  })

  test('asks once at a time, however often it is asked', async () => {
    // The timer and the button reach the same method, and two asks in flight
    // together would land twice: two sessions handed out, and the second answer
    // applied over the first.
    const asks = world.asked.length
    await Promise.all([joining.walkThrough(), joining.walkThrough()])

    expect(world.asked.length).toBe(asks + 1)
  })
})

describe('a link that opens nothing', () => {
  test('says one line, and the code is what is left', async () => {
    world.about = null
    await joining.start()

    expect(joining.step).toBe('gone')
    expect(account.signedIn).toBe(false)
  })

  test('says why, when the walk through is what refused', async () => {
    world.about = invite
    world.refuse = 'that invitation was sent to another address'
    await joining.start()

    expect(joining.step).toBe('gone')
    expect(joining.error).toBe('that invitation was sent to another address')
  })

  test('is gone from the screen once it has been read', async () => {
    world.about = null
    await joining.start()
    joining.dismiss()

    expect(joining.step).toBeNull()
  })
})

describe('a link in an address bar that has none', () => {
  test('does nothing at all', async () => {
    world.path = '/'
    await joining.start()

    expect(joining.step).toBeNull()
    expect(world.asked).toEqual([])
  })

  test('is not a token because it looks like one', async () => {
    world.path = '/join/not-hexadecimal'
    await joining.start()

    expect(joining.step).toBeNull()
    expect(world.asked).toEqual([])
  })
})
