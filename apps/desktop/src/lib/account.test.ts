import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The session store on its own: what it does with a code, and the countdown
 *  beside the "send another" button. The network is stood in for, and so is
 *  the browser storage the token is kept in. */

const server = vi.hoisted(() => ({
  resendIn: 30,
  /** Set to make the code be refused. */
  refuse: false,
  /** How many of the first `me` calls fail, and how. `null` is a request that
   *  never arrived; a number is the account answering with that status. */
  meFails: 0,
  meStatus: null as number | null,
  /** How many `me` calls were made, so a retry can be counted. */
  meCalls: 0,
  /** Set to make listing the spaces fail, which is not a failed session. */
  spacesFail: false,
  /** Set to make `me` answer with a guest a link let in rather than an account. */
  meIsAGuest: false,
  /** The guest session a sign-in handed over, so what a link lent the device
   *  follows it into the account. */
  handedOver: null as string | null | undefined,
  /** How many codes were asked for, so a double press can be counted. */
  codes: 0,
  /** Set to make the account answer the emailed code with half a sign-in: one
   *  that asks for the code out of an authenticator app. */
  asksForSecond: false,
  /** Which road the six digits took, so a test can say which call was made. */
  asked: [] as string[],
}))

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>()

  return {
    ...original,
    api: {
      requestCode: () => {
        server.codes += 1
        return Promise.resolve({ ok: true as const, resendIn: server.resendIn })
      },
      verifyCode: (_email: string, _code: string, guest?: string) => {
        server.handedOver = guest ?? null
        server.asked.push('verifyCode')
        if (server.refuse) {
          return Promise.reject(new original.ApiError(400, 'that code is not right'))
        }

        // Half a sign-in: the account has a second factor, and what comes back
        // is the handle the code out of the app is checked against.
        if (server.asksForSecond) return Promise.resolve({ second: true, holding: 'held' })

        return Promise.resolve({
          token: 'session',
          user: { id: 'u1', email: 'me@example.com', name: null },
        })
      },
      verifySecond: (holding: string, _code: string) => {
        server.asked.push(`verifySecond ${holding}`)
        return server.refuse
          ? Promise.reject(new original.ApiError(400, 'that code is not right'))
          : Promise.resolve({
              token: 'session',
              user: { id: 'u1', email: 'me@example.com', name: null },
            })
      },
      me: () => {
        server.meCalls += 1
        if (server.meCalls <= server.meFails) {
          return Promise.reject(
            server.meStatus === null
              ? new Error('the network is not there yet')
              : new original.ApiError(server.meStatus, 'no'),
          )
        }

        return Promise.resolve(
          server.meIsAGuest
            ? { guest: { id: 'g1', name: 'Windows wren' } }
            : { user: { id: 'u1', email: 'me@example.com', name: null } },
        )
      },
      listSpaces: () =>
        server.spacesFail
          ? Promise.reject(new Error('the network is not there yet'))
          : Promise.resolve({ spaces: [], deleted: [] }),
      signOut: () => Promise.resolve({ ok: true as const }),
      usage: () => Promise.resolve({ used: 0, limit: 0 }),
    },
  }
})

// The connector store reads `message` from here and the trash store reads
// `plural`; the real module pulls the editor package and forty catalogues in
// behind it, which no test here reads. English, which is what a key already is.
vi.mock('./i18n.svelte', () => ({
  t: (text: string) => text,
  key: (text: string) => text,
  plural: (count: number, forms: { one?: string; other: string }) =>
    (count === 1 ? (forms.one ?? forms.other) : forms.other).replace('{count}', String(count)),
  amount: (value: number) => String(value),
  message: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}))

// Listing the spaces also asks after the files shared on their own, and the store
// that holds those reads the workspace, the sync and the rooms: the whole app, built
// again in the first test to sign in and after every `resetModules`. That test spent
// most of its thirty seconds compiling and ran out of them under load. What the list
// holds is sharing.test.ts's; here it is a call that answers nothing, which is what
// the account's stand-in network answered it with anyway.
vi.mock('./sharing.svelte', () => ({
  sharedWithYou: { load: () => Promise.resolve() },
}))

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

let account: typeof import('./account.svelte').account
let connectors: typeof import('./connectors.svelte').connectors
let usage: typeof import('./usage.svelte').usage

/** The store's graph, loaded here rather than by whichever `beforeEach` runs
 *  first, which was most of a hook's thirty-second budget spent compiling. See
 *  docs/conventions.md. */
await import('./account.svelte')
await import('./connectors.svelte')
await import('./usage.svelte')

/** Every test starts from the store graph evaluated again, which on a machine running
 *  the rest of the gate beside it has outlasted the project's thirty seconds - the
 *  flake this file was known for. The budget is this hook's own rather than the
 *  project's, because it is this file that pays for it; it is a wall a slow honest run
 *  must not hit, and nothing here asserts on time. */
const REEVALUATING = 120_000

beforeEach(async () => {
  localStorage.clear()
  server.refuse = false
  server.resendIn = 30
  server.meFails = 0
  server.meStatus = null
  server.meCalls = 0
  server.spacesFail = false
  server.meIsAGuest = false
  server.handedOver = undefined
  server.codes = 0
  server.asksForSecond = false
  server.asked.length = 0

  vi.resetModules()
  ;({ account } = await import('./account.svelte'))
  // Imported for what they register with the session, not for what they hold:
  // whatever was read for one account has to go when that account does.
  ;({ connectors } = await import('./connectors.svelte'))
  ;({ usage } = await import('./usage.svelte'))
  account.email = 'me@example.com'
}, REEVALUATING)

describe('the countdown to another code', () => {
  test('runs at one a second, however often a code is asked for', async () => {
    vi.useFakeTimers()

    try {
      await account.requestCode()
      expect(account.resendIn).toBe(30)

      await vi.advanceTimersByTimeAsync(5000)
      expect(account.resendIn).toBe(25)

      // Asking again used to start a second timer beside the first, and the
      // two together took a second off twice a second.
      await account.requestCode()
      expect(account.resendIn).toBe(30)

      await vi.advanceTimersByTimeAsync(5000)
      expect(account.resendIn).toBe(25)
    } finally {
      vi.useRealTimers()
    }
  })

  test('sends one code however many times the form is submitted', async () => {
    // Enter in the address field submits the form whatever the button says, so
    // two quick presses used to be two codes - and the service invalidates the
    // first when it writes the second, which is the code the reader is reading.
    await Promise.all([account.requestCode(), account.requestCode()])

    expect(server.codes).toBe(1)
    expect(account.step).toBe('code')
  })

  test('stops once there is nothing left to wait for', async () => {
    vi.useFakeTimers()

    try {
      server.resendIn = 2
      await account.requestCode()

      await vi.advanceTimersByTimeAsync(10_000)
      expect(account.resendIn).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a code that is refused', () => {
  test('leaves the sheet open with something to read', async () => {
    server.refuse = true

    expect(await account.verify('000000')).toBe(false)
    expect(account.signedIn).toBe(false)
    expect(account.error).toBe('that code is not right')
    expect(localStorage.getItem('nib:session')).toBeNull()
  })
})

describe('a code that is accepted', () => {
  test('signs in and holds syncing back until the notes here are settled', async () => {
    expect(await account.verify('123456')).toBe(true)

    expect(account.signedIn).toBe(true)
    expect(account.settling).toBe(true)
    expect(account.syncable).toBe(false)
    expect(localStorage.getItem('nib:session')).toBe('session')

    account.settled()
    expect(account.syncable).toBe(true)
  })

  test('signing out forgets the session and everything about it', async () => {
    await account.verify('123456')
    account.settled()

    await account.signOut()

    expect(account.signedIn).toBe(false)
    expect(account.token).toBeNull()
    expect(account.spaces).toEqual([])
    expect(localStorage.getItem('nib:session')).toBeNull()
  })

  test('signing out takes what was read for that account with it', async () => {
    await account.verify('123456')
    account.settled()

    // A token the connector minted is a bearer credential shown once, and the
    // bytes and the clients belong to whoever has just left. None of it is this
    // machine's to keep, and none of it describes whoever signs in next.
    connectors.freshToken = 'mcp-secret'
    connectors.clients = [
      { id: 'c1', name: 'Claude', readOnly: true, createdAt: 0, lastUsedAt: null },
    ]
    connectors.token = { exists: true, readOnly: true, lastUsedAt: null }
    usage.used = 900
    usage.limit = 1000
    usage.dismissed = true

    await account.signOut()

    expect(connectors.freshToken).toBeNull()
    expect(connectors.clients).toEqual([])
    expect(connectors.token).toBeNull()
    // The warning in the corner is drawn from these, so stale numbers are a
    // toast about somebody else's storage sitting over a signed-out app.
    expect(usage.limit).toBe(0)
    expect(usage.warning).toBe(false)
  })
})

/** Coming back to a session that is already on this machine.
 *
 *  The bug these are about: every failure used to be read as a revoked token, so
 *  a launch that began before the network did threw the session away and asked
 *  for an emailed code instead. On a phone, where the plugin starts while the
 *  WebView is still finding its feet, that was every launch. */
/** Six digits typed into the row of boxes, on either half of a sign-in.
 *
 *  An account with a second factor signs in twice: the code that was emailed,
 *  and then the one an authenticator app is showing. The sheet draws one row of
 *  six boxes for both - "what is typed into them is six digits either way" - and
 *  what it did with them was always `verify`, the emailed half. So an account
 *  with the factor turned on could not be signed in on a new device at all: the
 *  app's code went to the wrong road, the server answered 400, and the boxes
 *  cleared themselves for another go at the same wall. The recovery code beside
 *  them went to the right one, which is what made the miss hard to see.
 *
 *  So the store says which half it is on, and the sheet asks the store. */
describe('six digits, on whichever half of the sign-in', () => {
  test('are the emailed code while that is what is being asked for', async () => {
    expect(account.step).toBe('email')
    expect(await account.code('123456')).toBe(true)

    expect(server.asked).toEqual(['verifyCode'])
    expect(account.signedIn).toBe(true)
  })

  test('and the code out of the app once the account has asked for one', async () => {
    server.asksForSecond = true
    expect(await account.code('123456')).toBe(false)
    expect(account.step).toBe('second')
    expect(account.signedIn).toBe(false)

    server.asksForSecond = false
    expect(await account.code('654321')).toBe(true)

    expect(server.asked).toEqual(['verifyCode', 'verifySecond held'])
    expect(account.signedIn).toBe(true)
  })

  test('and a refused one leaves the second half where it was, to try again', async () => {
    server.asksForSecond = true
    await account.code('123456')

    server.asksForSecond = false
    server.refuse = true
    expect(await account.code('000000')).toBe(false)

    expect(account.step).toBe('second')
    expect(account.signedIn).toBe(false)
    expect(server.asked).toEqual(['verifyCode', 'verifySecond held'])
  })
})

describe('restoring a session', () => {
  /** Runs the whole retry ladder without waiting for it. */
  async function restore(): Promise<void> {
    vi.useFakeTimers()
    try {
      const restoring = account.restore()
      await vi.advanceTimersByTimeAsync(10_000)
      await restoring
    } finally {
      vi.useRealTimers()
    }
  }

  test('keeps a token the account could not be asked about', async () => {
    localStorage.setItem('nib:session', 'session')
    server.meFails = Infinity

    await restore()

    // Signed out for now, because there is no account to show. Not signed out
    // for good: the token is still here for the next launch.
    expect(account.signedIn).toBe(false)
    expect(localStorage.getItem('nib:session')).toBe('session')
  })

  test('settles into signed in when the first try came too early', async () => {
    localStorage.setItem('nib:session', 'session')
    server.meFails = 2

    await restore()

    expect(account.signedIn).toBe(true)
    expect(server.meCalls).toBe(3)
    expect(localStorage.getItem('nib:session')).toBe('session')
  })

  test('signs out only when the account refuses the token', async () => {
    localStorage.setItem('nib:session', 'session')
    server.meFails = Infinity
    server.meStatus = 401

    await restore()

    expect(account.signedIn).toBe(false)
    expect(localStorage.getItem('nib:session')).toBeNull()
    // Refused is refused: there is nothing a second ask would change.
    expect(server.meCalls).toBe(1)
  })

  test('keeps the session when the spaces cannot be listed', async () => {
    localStorage.setItem('nib:session', 'session')
    server.spacesFail = true

    await restore()

    expect(account.signedIn).toBe(true)
    expect(localStorage.getItem('nib:session')).toBe('session')
  })
})

/** The second store, which only the Even plugin registers: a packed plugin's
 *  page has no origin whose storage outlives a launch, so the phone app is asked
 *  to keep the token as well. */
describe('a host that keeps the token too', () => {
  function vault(held: { token: string | null }) {
    return {
      read: () => Promise.resolve(held.token),
      write: (token: string) => {
        held.token = token
        return Promise.resolve()
      },
      clear: () => {
        held.token = null
        return Promise.resolve()
      },
    }
  }

  test('signs back in from the host when the page kept nothing', async () => {
    account.alsoKeepIn(vault({ token: 'from-the-host' }))

    await account.restore()

    expect(account.token).toBe('from-the-host')
    expect(account.signedIn).toBe(true)
    // Put back where everything else here reads it, so the two agree.
    expect(localStorage.getItem('nib:session')).toBe('from-the-host')
  })

  test('says it is still looking while the stores are being asked', async () => {
    // Signed out and not known yet are different states. On a phone the stores
    // take seconds to answer, and a foot row that offers a sign-in inside those
    // seconds is how a session that was there gets typed in again.
    let answer: (token: string | null) => void = () => undefined
    account.alsoKeepIn({
      read: () =>
        new Promise<string | null>((resolve) => {
          answer = resolve
        }),
      write: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    })

    const restoring = account.restore()
    await vi.waitFor(() => expect(account.restoring).toBe(true))
    expect(account.signedIn).toBe(false)

    answer('from-the-host')
    await restoring

    expect(account.restoring).toBe(false)
    expect(account.signedIn).toBe(true)
  })

  test('lets the stores decide between them, rather than the page alone', async () => {
    // The page's own storage is the one a packed plugin loses, so asking it
    // first means preferring the empty answer. The vault asks every store at
    // once and answers with whichever kept a token; which of them wins is its
    // business, and it puts the page's own first.
    localStorage.setItem('nib:session', 'session')
    account.alsoKeepIn(vault({ token: 'from-the-host' }))

    await account.restore()

    expect(account.token).toBe('from-the-host')
  })

  test('falls back to the page when there is no vault at all', async () => {
    // Which is every browser and the desktop app: nothing registers one there.
    localStorage.setItem('nib:session', 'session')

    await account.restore()

    expect(account.token).toBe('session')
  })

  test('hands a fresh token to the host, and takes it back on the way out', async () => {
    const held: { token: string | null } = { token: null }
    account.alsoKeepIn(vault(held))

    await account.verify('123456')
    await vi.waitFor(() => expect(held.token).toBe('session'))

    await account.signOut()
    await vi.waitFor(() => expect(held.token).toBeNull())
  })
})

describe('a session a share link handed out', () => {
  test('is a guest: signed in, with no account behind it', async () => {
    server.meIsAGuest = true
    localStorage.setItem('nib:session', 'guest-session')

    await account.restore()

    expect(account.signedIn).toBe(true)
    expect(account.guest?.name).toBe('Windows wren')
    expect(account.user).toBeNull()
    // Which is what everything account-wide asks for, so none of it is asked.
    expect(account.accountToken).toBeNull()
    expect(account.name).toBe('Windows wren')
  })

  test('hands itself to the sign-in, so what a link lent it follows it in', async () => {
    server.meIsAGuest = true
    localStorage.setItem('nib:session', 'guest-session')
    await account.restore()

    expect(await account.verify('123456')).toBe(true)

    expect(server.handedOver).toBe('guest-session')
    expect(account.guest).toBeNull()
    expect(account.user?.email).toBe('me@example.com')
    expect(account.accountToken).toBe('session')
  })

  test('is not handed over by a sign-in that was nobody', async () => {
    expect(await account.verify('123456')).toBe(true)
    expect(server.handedOver).toBeNull()
  })

  test('arrives from a link rather than from a code, and asks nothing', async () => {
    await account.arrive('guest-session', { guest: { id: 'g1', name: 'iPhone lark' } })

    expect(account.signedIn).toBe(true)
    expect(localStorage.getItem('nib:session')).toBe('guest-session')
    // A guest has no account for the notes already here to join, so syncing is
    // not held back on a question nobody is going to be asked.
    expect(account.settling).toBe(false)
    expect(account.syncable).toBe(true)
  })

  test('holds syncing back when the link opened an account instead', async () => {
    await account.arrive('session', { user: { id: 'u1', email: 'ada@example.com', name: null } })

    expect(account.settling).toBe(true)
    expect(account.syncable).toBe(false)
    expect(account.accountToken).toBe('session')
  })

  test('is nobody again once the session is let go of', async () => {
    server.meIsAGuest = true
    localStorage.setItem('nib:session', 'guest-session')
    await account.restore()

    await account.signOut()

    expect(account.guest).toBeNull()
    expect(account.signedIn).toBe(false)
    expect(account.name).toBeNull()
  })
})
