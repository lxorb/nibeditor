/** A web login as a lease, against a hub that is stood in for: what a page is let do,
 *  what the pane shows, what goes up and what comes down, for every case of the web
 *  table in docs/sync-v2.md section 4. The hub itself is the Worker's and is tested
 *  there (services/sync/test/hub.test.ts); this is the computer's half. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { FromDevice, FromHub } from '../sync2/hub-frames'
import { LIGHT_AT_MOST, LIGHT_EVERY, LEASE_WAITS, RELEASE_AFTER } from '../backoff'
import { Leases, type Lease, type LeaseWorld } from './lease.svelte'
import { Page } from './pages.svelte'
import type { Captured } from './web-state'

/** The hub, as a list of what was said to it and a way to say things back. */
class FakeHub {
  leads = true
  state = 'open'
  sent: FromDevice[] = []
  private readonly listeners = new Map<string, Set<(frame: FromHub) => void>>()
  private readonly openers = new Set<() => void>()

  on<T extends FromHub['t']>(type: T, listener: (frame: Extract<FromHub, { t: T }>) => void) {
    const all = this.listeners.get(type) ?? new Set()
    this.listeners.set(type, all)
    all.add(listener as (frame: FromHub) => void)
    return () => all.delete(listener as (frame: FromHub) => void)
  }

  opened(run: () => void) {
    this.openers.add(run)
    return () => this.openers.delete(run)
  }

  send(frame: FromDevice): boolean {
    if (this.state !== 'open') return false
    this.sent.push(frame)
    return true
  }

  say(frame: FromHub): void {
    for (const listener of this.listeners.get(frame.t) ?? []) listener(frame)
  }

  reopen(): void {
    this.state = 'open'
    for (const run of this.openers) run()
  }

  acquired(): { key: string; take: boolean }[] {
    return this.sent.flatMap((one) => (one.t === 'acquire' ? [one] : []))
  }
}

const MAIL = 'k_mail_example_com_0000'
const NEWS = 'k_news_example_org_0000'

/** What the leases did, in order, where order is the point. */
let log: string[]
/** The tab each capture read through, or null for none. */
let reads: (string | null)[]
let hub: FakeHub
let held: Map<string, Page>
let digest: string
let version: number
let world: LeaseWorld
let leases: Leases

function captured(): Captured {
  return {
    folder: 'C:/web-state/out-0123456789abcdef',
    manifest: { name: 'manifest', size: 10 },
    chunks: [],
    named: [],
    digest,
    skipped: [],
    cookies: 1,
  }
}

function makeWorld(): LeaseWorld {
  return {
    hub,
    pages: {
      each: () => [...held.entries()],
      park: (tab) => {
        log.push(`park ${tab}`)
        const page = held.get(tab)
        if (page) page.live = false
        return Promise.resolve()
      },
      show: (tab) => {
        log.push(`show ${tab}`)
        const page = held.get(tab)
        if (page) page.live = true
        return Promise.resolve()
      },
    },
    placeOf: (page) => {
      const host = page.url ? new URL(page.url).hostname : ''
      return Promise.resolve(
        host ? { store: null, site: host.split('.').slice(-2).join('.') } : null,
      )
    },
    keyOf: (place) => Promise.resolve(place.site === 'example.com' ? MAIL : NEWS),
    capture: (lease: Lease, light: boolean, tab) => {
      log.push(`capture ${light ? 'light' : 'full'} fence ${String(lease.fence)}`)
      reads.push(tab)
      return Promise.resolve(captured())
    },
    upload: (lease: Lease) => {
      log.push(`upload fence ${String(lease.fence)}`)
      version += 1
      return Promise.resolve(version)
    },
    download: (lease: Lease) => {
      log.push('download')
      return Promise.resolve({ path: 'C:/in/manifest', version: lease.version })
    },
    restore: () => {
      log.push('restore')
      return Promise.resolve({
        cookies: 1,
        origins: 1,
        databases: 0,
        skipped: [],
        session: null,
        app: null,
        engine: 'webview2',
        at: 1,
        tabPath: null,
      })
    },
    session: () => Promise.resolve(),
    mirror: (place, device) => {
      log.push(`mirror ${place.site} ${device ?? 'here'}`)
    },
    note: () => undefined,
    usedElsewhere: () => false,
    using: () => undefined,
    now: () => Date.now(),
    every: (ms, tick) => {
      const timer = setInterval(tick, ms)
      return () => clearInterval(timer)
    },
    later: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
  }
}

/** A tab on `url`, on screen, with or without a page running. */
function tab(id: string, url: string, live = false): Page {
  const page = new Page()
  page.url = url
  page.live = live
  page.shown = live
  page.onScreen = true
  page.pane = { x: 0, y: 0, width: 800, height: 600 }
  held.set(id, page)
  return page
}

/** Lets every promise waiting on another run. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

/** A tab whose lease this computer holds, at `fence` and version `at`. */
async function holding(id: string, url: string, fence = 1, at = 0): Promise<Page> {
  const page = tab(id, url)
  const going = leases.admit(id, page)
  await settle()
  hub.say({ t: 'granted', key: keyOf(url), fence, version: at, rotate: false })
  await expect(going).resolves.toBe(true)
  page.live = true
  page.shown = true
  return page
}

function keyOf(url: string): string {
  return url.includes('example.com') ? MAIL : NEWS
}

beforeEach(() => {
  vi.useFakeTimers()
  log = []
  reads = []
  hub = new FakeHub()
  held = new Map()
  digest = 'd1'
  version = 0
  world = makeWorld()
  leases = new Leases(world)
  leases.start()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('opening a site nobody else is using', () => {
  test('asks for its lease and loads the page once it is granted', async () => {
    const page = tab('t1', 'https://mail.example.com/inbox')
    const going = leases.admit('t1', page)
    await settle()

    expect(hub.acquired()).toEqual([{ t: 'acquire', key: MAIL, take: false }])
    hub.say({ t: 'granted', key: MAIL, fence: 1, version: 0, rotate: false })

    await expect(going).resolves.toBe(true)
    expect(page.lock).toBeNull()
  })

  test('a second tab of the same site needs no second trip to the hub', async () => {
    await holding('t1', 'https://mail.example.com/')
    const calendar = tab('t2', 'https://calendar.example.com/')

    await expect(leases.admit('t2', calendar)).resolves.toBe(true)
    expect(hub.acquired()).toHaveLength(1)
  })

  test('the newest state is put in before the page runs', async () => {
    const page = tab('t1', 'https://mail.example.com/')
    const going = leases.admit('t1', page)
    await settle()
    hub.say({ t: 'granted', key: MAIL, fence: 4, version: 7, rotate: false })

    await expect(going).resolves.toBe(true)
    expect(log.filter((one) => one === 'download' || one === 'restore')).toEqual([
      'download',
      'restore',
    ])
  })
})

describe('a site another computer is using', () => {
  test('is not loaded, and the pane says where it is open', async () => {
    const page = tab('t1', 'https://mail.example.com/')
    const going = leases.admit('t1', page)
    await settle()
    hub.say({ t: 'busy', key: MAIL, device: 'laptop-00000001', name: 'Laptop' })

    // No page is built, so nothing of the site's ran here.
    await expect(going).resolves.toBe(false)
    expect(page.lock).toMatchObject({ device: 'Laptop', pressed: false })
    expect(log).toContain('mirror example.com Laptop')
  })

  test('Use here takes it, pressed until the state has landed, and then the page loads', async () => {
    const page = tab('t1', 'https://mail.example.com/')
    void leases.admit('t1', page)
    await settle()
    hub.say({ t: 'busy', key: MAIL, device: 'laptop-00000001', name: 'Laptop' })
    await settle()

    page.lock?.take()
    expect(hub.acquired().at(-1)).toEqual({ t: 'acquire', key: MAIL, take: true })
    expect(page.lock?.pressed).toBe(true)

    hub.say({ t: 'granted', key: MAIL, fence: 2, version: 3, rotate: false })
    await settle()

    expect(log).toContain('restore')
    expect(page.lock).toBeNull()
    await expect(leases.admit('t1', page)).resolves.toBe(true)
  })

  test('comes back by itself when it is free and a tab of it is on screen', async () => {
    const page = tab('t1', 'https://mail.example.com/')
    void leases.admit('t1', page)
    await settle()
    hub.say({ t: 'busy', key: MAIL, device: 'laptop-00000001', name: 'Laptop' })
    await settle()

    hub.say({ t: 'free', key: MAIL })
    expect(hub.acquired().at(-1)).toEqual({ t: 'acquire', key: MAIL, take: false })
    hub.say({ t: 'granted', key: MAIL, fence: 2, version: 0, rotate: false })
    await settle()

    // The pane asks for its page again as the lock goes; see WebTab.svelte.
    expect(page.lock).toBeNull()
  })

  test('a page that ran before the answer came is stopped when it is busy after all', async () => {
    const page = tab('t1', 'https://mail.example.com/', true)
    const going = leases.admit('t1', page)
    await vi.advanceTimersByTimeAsync(LEASE_WAITS)
    // The hub was slow: the page went ahead on this computer's own state.
    await expect(going).resolves.toBe(true)

    hub.say({ t: 'busy', key: MAIL, device: 'laptop-00000001', name: 'Laptop' })
    await settle()

    expect(log).toContain('park t1')
    expect(page.lock).toMatchObject({ device: 'Laptop' })
  })
})

describe('a site taken from this computer', () => {
  test('asks again when its tab is looked at, and keeps the surface until the hub answers', async () => {
    const page = await holding('t1', 'https://mail.example.com/')
    hub.say({ t: 'lost', key: MAIL, device: 'desktop-0000001', name: 'Desktop' })
    await settle()
    expect(page.lock).toMatchObject({ device: 'Desktop' })

    // Half a minute on, the pane looks at its tab again.
    await vi.advanceTimersByTimeAsync(31_000)
    const going = leases.admit('t1', page)
    await expect(going).resolves.toBe(false)
    expect(hub.acquired().at(-1)).toEqual({ t: 'acquire', key: MAIL, take: false })
    // Still another computer's, however long the answer takes: no page runs meanwhile.
    expect(page.lock).toMatchObject({ device: 'Desktop' })
    await vi.advanceTimersByTimeAsync(LEASE_WAITS * 2)
    await expect(leases.admit('t1', page)).resolves.toBe(false)

    hub.say({ t: 'busy', key: MAIL, device: 'desktop-0000001', name: 'Desktop' })
    await settle()
    expect(page.lock).toMatchObject({ device: 'Desktop' })
  })

  test('Use here on a surface already going does nothing', async () => {
    const page = await holding('t1', 'https://mail.example.com/')
    expect(page.lock).toBeNull()
    hub.say({ t: 'busy', key: MAIL, device: 'desktop-0000001', name: 'Desktop' })
    await settle()
    const taking = page.lock
    hub.say({ t: 'granted', key: MAIL, fence: 2, version: 0, rotate: false })
    await settle()

    const before = hub.sent.length
    taking?.take()
    expect(hub.sent).toHaveLength(before)
    expect(page.lock).toBeNull()
  })
})

describe('handing over', () => {
  test('the latest state is captured, the pages stopped, uploaded under the fence, and the hub told', async () => {
    await holding('t1', 'https://mail.example.com/', 1)
    log = []

    hub.say({ t: 'flush', key: MAIL, fence: 2 })
    await settle()

    expect(log).toEqual(['capture full fence 2', 'park t1', 'upload fence 2'])
    expect(hub.sent.at(-1)).toEqual({ t: 'flushed', key: MAIL })
  })

  test('lost: every tab of that site in that store shows it, and no other site', async () => {
    const mail = await holding('t1', 'https://mail.example.com/')
    const calendar = tab('t2', 'https://calendar.example.com/', true)
    await leases.admit('t2', calendar)
    const news = await holding('t3', 'https://www.example.org/')

    hub.say({ t: 'lost', key: MAIL, device: 'desktop-0000001', name: 'Desktop' })
    await settle()

    expect(mail.lock).toMatchObject({ device: 'Desktop' })
    expect(calendar.lock).toMatchObject({ device: 'Desktop' })
    expect(news.lock).toBeNull()
    expect(log).toEqual(expect.arrayContaining(['park t1', 'park t2']))
    expect(log).not.toContain('park t3')
  })
})

describe('coming and going', () => {
  test('going idle tells the hub and sends the latest state up in full', async () => {
    await holding('t1', 'https://mail.example.com/')
    log = []

    leases.activity(false)
    await settle()

    expect(hub.sent.at(-1)).toEqual({ t: 'idle' })
    expect(log).toEqual(['capture full fence 1', 'upload fence 1'])
  })

  test('coming back with a newer state elsewhere puts it in before the page runs again', async () => {
    await holding('t1', 'https://mail.example.com/', 1, 1)
    leases.activity(false)
    await settle()
    log = []

    // Another computer used the site meanwhile, while this one was away from its hub.
    leases.activity(true)
    expect(hub.acquired().at(-1)).toEqual({ t: 'acquire', key: MAIL, take: false })
    hub.say({ t: 'granted', key: MAIL, fence: 5, version: 9, rotate: false })
    await settle()

    expect(log.filter((one) => !one.startsWith('mirror'))).toEqual([
      'park t1',
      'download',
      'restore',
      'show t1',
    ])
  })

  test('offline, a page runs on this computer’s own state and is asked for when the hub is back', async () => {
    hub.state = 'off'
    const page = tab('t1', 'https://mail.example.com/', false)

    await expect(leases.admit('t1', page)).resolves.toBe(true)
    expect(hub.sent).toEqual([])

    page.live = true
    hub.reopen()
    expect(hub.acquired()).toEqual([{ t: 'acquire', key: MAIL, take: false }])
  })

  test('the last tab of a site closing lets go of it, with the state in full first', async () => {
    await holding('t1', 'https://mail.example.com/')
    log = []

    held.delete('t1')
    leases.closed('t1')
    await vi.advanceTimersByTimeAsync(RELEASE_AFTER)

    expect(log).toEqual(['capture full fence 1', 'upload fence 1'])
    expect(hub.sent.at(-1)).toEqual({ t: 'release', key: MAIL })
  })

  test('the window going hands every lease back', async () => {
    await holding('t1', 'https://mail.example.com/')
    expect(leases.holding()).toBe(true)

    await leases.handBack()

    expect(hub.sent.at(-1)).toEqual({ t: 'release', key: MAIL })
    expect(leases.holding()).toBe(false)
  })
})

describe('a computer that slept through losing a site', () => {
  test('stops its pages when an upload is fenced, and asks whose the site is', async () => {
    await holding('t1', 'https://mail.example.com/')
    world.upload = () => Promise.resolve('fenced' as const)
    log = []

    leases.activity(false)
    await settle()

    expect(log).toContain('park t1')
    expect(hub.acquired().at(-1)).toEqual({ t: 'acquire', key: MAIL, take: false })
    hub.say({ t: 'busy', key: MAIL, device: 'desktop-0000001', name: 'Desktop' })
    await settle()
    expect(held.get('t1')?.lock).toMatchObject({ device: 'Desktop' })
  })
})

describe('what goes up while somebody uses a site', () => {
  test('is light, at most once a minute, and nothing when it did not change', async () => {
    const page = await holding('t1', 'https://mail.example.com/')
    log = []

    // Ten minutes of pages settling every five seconds, and the two-minute clock.
    for (let at = 0; at < 10 * 60_000; at += 5_000) {
      leases.moved('t1', page, true)
      await vi.advanceTimersByTimeAsync(5_000)
    }

    const light = log.filter((one) => one.startsWith('capture light'))
    expect(light.length).toBeLessThanOrEqual((10 * 60_000) / LIGHT_AT_MOST + 1)
    expect(light.length).toBeGreaterThan(0)
    // The state never changed, so only the first went up.
    expect(log.filter((one) => one.startsWith('upload'))).toHaveLength(1)
  })

  test('goes up again when it changed, on the two-minute clock', async () => {
    await holding('t1', 'https://mail.example.com/')
    log = []

    await vi.advanceTimersByTimeAsync(LIGHT_EVERY)
    digest = 'd2'
    await vi.advanceTimersByTimeAsync(LIGHT_EVERY)

    expect(log.filter((one) => one.startsWith('upload'))).toHaveLength(2)
  })

  test('nothing goes up from a computer nobody is at', async () => {
    await holding('t1', 'https://mail.example.com/')
    leases.activity(false)
    await settle()
    log = []

    await vi.advanceTimersByTimeAsync(3 * LIGHT_EVERY)
    expect(log).toEqual([])
  })
})

/** A page out of sight is frozen after a while (resting.ts), and keeps its lease: which
 *  computer runs the site has not changed. */
describe('a site whose pages are frozen', () => {
  test('keeps its lease, and sends nothing on the two-minute clock, having changed nothing', async () => {
    const page = await holding('t1', 'https://mail.example.com/')
    page.onScreen = false
    page.frozen = true
    log = []
    hub.sent = []

    await vi.advanceTimersByTimeAsync(3 * LIGHT_EVERY)
    expect(log).toEqual([])
    expect(hub.sent.map((one) => one.t)).not.toContain('release')
  })

  test('is read through a page that runs rather than a frozen one', async () => {
    const frozen = await holding('t1', 'https://mail.example.com/a')
    frozen.path = '/space/A.url'
    frozen.frozen = true
    frozen.looked = Date.now() + 1_000
    const running = tab('t2', 'https://mail.example.com/b')
    await leases.admit('t2', running)
    running.live = true
    running.path = '/space/B.url'
    reads = []

    leases.activity(false)
    await settle()
    expect(reads).toEqual(['t2'])
  })
})

describe('what needs no lease', () => {
  test('a page not on the web', async () => {
    const page = tab('t1', 'about:blank')
    await expect(leases.admit('t1', page)).resolves.toBe(true)
    expect(hub.sent).toEqual([])
  })

  test('any page before this computer has the web key', async () => {
    world.keyOf = () => Promise.resolve(null)
    const page = tab('t1', 'https://mail.example.com/')
    await expect(leases.admit('t1', page)).resolves.toBe(true)
    expect(hub.sent).toEqual([])
  })
})
