/** A web login as a lease: which of the person's computers may run a site's session now.
 *
 *  Emil, 2026-09-30: *"you LOCK a web page while using it. If another device of the same
 *  account tries opening the same web note, it gets a message making clear it's in use
 *  somewhere else right now. There's a button to acquire the lock, and then the other
 *  device loses it and shows that message instead. After some inactivity the lock is
 *  automatically released, including if the PC crashes from one millisecond to the
 *  next."*
 *
 *  What is locked is a site in its web store, not a note: a Gmail note and a Calendar
 *  note are one Google login, and two computers running one login is two clients
 *  presenting one refresh token, which a site answers by signing both out. So every
 *  page of a site in a store needs the lease, and one computer holds it for all of its
 *  tabs. The account's hub decides, on its own clock (services/sync/src/hub/leases.ts);
 *  this is the computer's half, and it only ever sends frames:
 *
 *  - **Before a page runs** - built, or sent to an address somebody typed - the lease is
 *    asked for. Held already: at once. Otherwise the page waits for the hub's answer, a
 *    round trip on a socket that is already open, and no longer than `LEASE_WAITS`: a
 *    hub that is slow is a hub the page does not wait for, and one out of reach is an
 *    offline computer, whose pages run on their own state (section 6.2, "Offline").
 *  - **`busy`**: another computer is using it. No page; the pane says where it is open,
 *    with Use here (WebLocked.svelte). **Use here** asks with `take`, and the other
 *    computer hands over.
 *  - **`flush`**: this computer is handing over. Its latest state is captured, its pages
 *    of the site are stopped and uploaded under the fence, and the hub is told.
 *    **`lost`** names who took it; every tab of that site in that store shows so.
 *  - **`free`**: whoever had it let go or went away. A tab of the site on screen asks
 *    again, and its page comes back by itself.
 *  - **`granted` with a newer version**, and **`state`** while nothing here runs the site:
 *    the newest state is downloaded and put into this computer's store before a page of
 *    the site runs again, so opening a site used elsewhere is usually instant.
 *
 *  And when the state goes up (section 6.5): in full on a handover, on letting go, on
 *  going idle and as the window closes; while somebody is using the site, its cookies
 *  and localStorage every couple of minutes if they changed, and after a page settles at
 *  most once a minute. Everything behind the account's `web_sync` switch, and only where
 *  this engine can carry a site's state at all: nib's own Chromium cannot yet, and there
 *  nothing here runs, so nothing is ever held that could not be handed over. */

import { LEASE_WAITS, LIGHT_AT_MOST, LIGHT_EVERY, RELEASE_AFTER } from '../backoff'
import type { Hub } from '../sync2/hub.svelte'
import type { HubFrame } from '../sync2/hub-frames'
import type { Uploaded } from './lease-transfer'
import type { Lock, Page, Rect } from './pages.svelte'
import type { Captured, Restored } from './web-state'

/** The longest a page waits for a newer state to be put in before it runs anyway, on
 *  what this computer has. A restore is seconds at most; a stalled download is not a
 *  reason to leave a tab empty. */
const RESTORE_WAITS = 20_000

/** Where a lease stands on this computer.
 *
 *  `loose` is nobody asked yet, or the hub out of reach; `asking` is waiting for an
 *  answer and `taking` the same after Use here; `held` is this computer's; `busy` is
 *  another's that this one waits on; `lost` is another's that took it from here; and
 *  `handing` is this computer handing its state over. */
export type Status = 'loose' | 'asking' | 'taking' | 'held' | 'busy' | 'lost' | 'handing'

/** A site in a store, as the lease knows it. */
export interface Place {
  store: string | null
  site: string
}

/** One site's lease on this computer. */
export class Lease {
  status: Status = 'loose'
  /** The computer that has it elsewhere, by name. */
  holder = ''
  fence = 0
  /** The newest version of the state the account has, as last heard. */
  version = 0
  /** The version this computer's store holds. */
  applied = 0
  /** What the last upload said, so an unchanged state is not uploaded again. */
  digest = ''
  /** When the last light upload was. */
  lightAt = 0
  /** Chunks already on the account. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping; nothing renders from it
  readonly sent = new Set<string>()
  /** The site's origins this computer has been on, which a capture reads. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
  readonly origins = new Set<string>()
  /** Pages waiting to hear whether they may run. */
  waiters: ((go: boolean) => void)[] = []
  /** When the lease was last asked for. */
  askedAt = 0
  /** The work on this lease that has to happen in order: a restore, an upload. */
  work: Promise<void> = Promise.resolve()
  /** The countdown to letting go, once its last tab has closed. */
  letGo: (() => void) | null = null
  /** The web note whose tab gets the sessionStorage a restore handed back. */
  session: { path: string; origin: string; items: [string, string][] } | null = null

  constructor(
    readonly key: string,
    readonly store: string | null,
    readonly site: string,
  ) {}
}

/** What the leases need from around them. The app's is in web-sync.svelte.ts; a test hands
 *  in its own. */
export interface LeaseWorld {
  hub: Pick<Hub, 'on' | 'send' | 'opened' | 'leads'> & { readonly state: string }
  pages: {
    each(): [string, Page][]
    park(tab: string): Promise<void>
    show(tab: string, url: string, pane: Rect, visible?: boolean): Promise<void>
  }
  /** The site and store a page is on, or null for a page not on the web. */
  placeOf(page: Page): Promise<Place | null>
  /** The opaque name of a site in a store, or null before this computer has the key. */
  keyOf(place: Place): Promise<string | null>
  capture(lease: Lease, light: boolean, tab: string | null, notes: string[]): Promise<Captured>
  upload(lease: Lease, captured: Captured): Promise<Uploaded>
  /** The newest state downloaded; null when the account has none. */
  download(lease: Lease): Promise<{ path: string; version: number } | null>
  /** A downloaded state put into the store, and what it carried put back. */
  restore(lease: Lease, path: string): Promise<Restored & { tabPath: string | null }>
  /** A web note's tab given its sessionStorage back. */
  session(tab: string, origin: string, items: [string, string][]): Promise<void>
  /** Tells the agents' side who holds a site elsewhere; see agents/leases.rs. */
  mirror(place: Place, device: string | null): void
  /** A line in the app's log: what happened to a lease, by site, for a person working
   *  out why a page did what it did. */
  note(line: string): void
  /** Whether another window of this computer has a tab of this lease. */
  usedElsewhere(key: string): boolean
  /** Says to the other windows which leases this one uses. */
  using(keys: string[]): void
  now(): number
  every(ms: number, tick: () => void): () => void
  later(ms: number, run: () => void): () => void
}

/** Whether a lease is another computer's as far as this one knows. */
function elsewhere(lease: Lease): boolean {
  return ['busy', 'lost', 'handing', 'taking'].includes(lease.status)
}

/** Whether a lease is this computer's now: a question asked after a wait, which is when
 *  the answer can have changed. */
function held(lease: Lease): boolean {
  return lease.status === 'held'
}

/** A site's origin, for the capture to read, or null for an address that is not one. */
function originOf(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null
  } catch {
    return null
  }
}

export class Leases {
  /** Whether somebody is at this computer, as activity.ts last said. */
  active = true

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping; what is drawn is each page's own `lock`
  private readonly byKey = new Map<string, Lease>()
  /** Which lease each tab needs, by tab. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
  private readonly tabs = new Map<string, string>()
  private stops: (() => void)[] = []
  /** Each site's opaque name, by store and site, once the crate has worked it out: a
   *  pane asks about its page on every look, and the name does not change under one key. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping; nothing renders from it
  private readonly names = new Map<string, string>()

  constructor(private readonly world: LeaseWorld) {}

  /** Listens to the hub and keeps the time. Answers how to stop. */
  start(): () => void {
    const { hub } = this.world
    this.stops = [
      hub.on('granted', (frame) => void this.granted(frame)),
      hub.on('busy', (frame) => void this.elsewhere(frame, 'busy')),
      hub.on('lost', (frame) => void this.elsewhere(frame, 'lost')),
      hub.on('flush', (frame) => void this.flush(frame)),
      hub.on('free', (frame) => {
        this.free(frame)
      }),
      hub.on('state', (frame) => {
        this.newer(frame)
      }),
      hub.on('refused', (frame) => {
        this.refused(frame)
      }),
      hub.opened(() => {
        this.reconnected()
      }),
      this.world.every(LIGHT_EVERY, () => {
        this.keepLight()
      }),
    ]
    // Pages already running when leases began - opened before the account answered -
    // are this computer's own state until the hub has said otherwise.
    void this.reconcile()
    return () => {
      for (const stop of this.stops) stop()
      this.stops = []
    }
  }

  /* ── Pages ────────────────────────────────────────────────────────────── */

  /** Whether a page may run: see the top of this file. */
  async admit(tab: string, page: Page): Promise<boolean> {
    const lease = await this.leaseFor(tab, page)
    if (!lease) return true

    switch (lease.status) {
      case 'held':
        page.lock = null
        return true
      case 'busy':
      case 'lost':
      case 'handing':
      case 'taking':
        this.again(lease)
        this.paint(lease)
        return false
      case 'asking':
        return this.answer(lease)
      case 'loose':
        // No hub to ask: this computer's own state, until there is one.
        if (this.world.hub.state !== 'open') return true
        this.acquire(lease, false)
        return this.answer(lease)
    }
  }

  /** A page said where it is: a link may have led to another site, and a page that
   *  has finished loading is a moment to keep its login. */
  moved(tab: string, page: Page, settled: boolean): void {
    void this.leaseFor(tab, page).then((lease) => {
      if (!lease) return
      if (lease.status === 'loose' && this.world.hub.state === 'open') {
        this.acquire(lease, false)
      } else if (lease.status === 'busy' || lease.status === 'lost') {
        // Arrived by a link at a site another computer is using: stopped, as a page
        // opened on it would never have started.
        void this.world.pages.park(tab)
        this.paint(lease)
      }
      if (settled && lease.status === 'held' && this.active) this.upload(lease, true)
      this.gaveSession(tab, page, lease)
    })
  }

  /** A tab has closed. The last tab of a site lets go of its lease, a moment later. */
  closed(tab: string): void {
    const key = this.tabs.get(tab)
    this.tabs.delete(tab)
    this.said()
    if (key !== undefined) this.left(key)
  }

  /** Use here: this computer takes the site, and the other one hands over. */
  take(lease: Lease): void {
    // Only a site another computer has: a press on a surface already on its way out is
    // a press on nothing.
    if (this.world.hub.state !== 'open' || !(lease.status === 'busy' || lease.status === 'lost')) {
      return
    }
    this.world.note(`${lease.site}: use here`)
    this.acquire(lease, true)
    this.paint(lease)
  }

  /** Every lease this window holds, handed back as the window goes: the state in full,
   *  then let go of. What the close waits for, at most as long as it waits for anything. */
  async handBack(): Promise<void> {
    await Promise.all(this.handable().map((lease) => this.release(lease)))
  }

  /** Whether this window holds a lease no other window of this computer uses: what the
   *  close asks before it decides to wait. */
  holding(): boolean {
    return this.handable().length > 0
  }

  /** This computer has just been given the web key: every page already running is
   *  taken on, the way pages that ran before the hub answered are. */
  async keyed(): Promise<void> {
    this.names.clear()
    await this.reconcile()
  }

  private handable(): Lease[] {
    return [...this.byKey.values()].filter(
      (lease) => lease.status === 'held' && !this.world.usedElsewhere(lease.key),
    )
  }

  /* ── Activity ─────────────────────────────────────────────────────────── */

  /** Somebody came back to this computer, or went away. Said to the hub by the window
   *  holding its socket, once for the device. */
  activity(active: boolean): void {
    this.active = active
    if (this.world.hub.leads) this.world.hub.send({ t: active ? 'active' : 'idle' })

    for (const lease of this.byKey.values()) {
      // Going away: the next computer gets the latest without a handover.
      if (!active && lease.status === 'held') this.upload(lease, false)
      // Coming back: a site on screen is asked for again, and comes back newer if it
      // was used elsewhere meanwhile.
      if (active && this.onScreen(lease)) this.acquire(lease, false)
    }
  }

  /* ── The hub ──────────────────────────────────────────────────────────── */

  private async granted(frame: HubFrame<'granted'>): Promise<void> {
    const lease = this.byKey.get(frame.key)
    if (!lease) return

    lease.fence = frame.fence
    lease.version = Math.max(lease.version, frame.version)
    lease.status = 'held'
    lease.holder = ''
    this.world.note(`${lease.site}: held, fence ${String(frame.fence)}, v${String(frame.version)}`)
    this.world.mirror(lease, null)

    if (lease.version > lease.applied) {
      // A newer state than this computer's: every page of the site stops, the state
      // goes in, and the ones that were on screen come back on it.
      const running = this.tabsOf(lease).filter(([, page]) => page.live)
      const back = running.flatMap(([tab, page]) =>
        page.shown && page.pane && page.url ? [{ tab, url: page.url, pane: page.pane }] : [],
      )
      await this.serial(lease, async () => {
        await Promise.all(running.map(([tab]) => this.world.pages.park(tab)))
        await this.bringDown(lease)
      })
      // Taken elsewhere while the state was on its way down.
      if (!held(lease)) return
      this.paint(lease)
      this.settle(lease, true)
      for (const one of back) void this.world.pages.show(one.tab, one.url, one.pane)
      return
    }

    this.paint(lease)
    this.settle(lease, true)
  }

  private async elsewhere(frame: HubFrame<'busy' | 'lost'>, status: 'busy' | 'lost') {
    const lease = this.byKey.get(frame.key)
    if (!lease) return

    lease.status = status
    lease.holder = frame.name
    this.world.note(`${lease.site}: ${status} (${frame.name || frame.device})`)
    this.world.mirror(lease, frame.name || frame.device)
    this.settle(lease, false)
    // Drawn first, so a page that is still being built is put away as it lands; see
    // `build` in pages.svelte.ts.
    this.paint(lease)
    await Promise.all(
      this.tabsOf(lease)
        .filter(([, page]) => page.live)
        .map(([tab]) => this.world.pages.park(tab)),
    )
  }

  /** A handover: the latest state, captured while the page is still there to read,
   *  then the pages stopped, then the state uploaded under the fence and the hub told. */
  private async flush(frame: HubFrame<'flush'>): Promise<void> {
    const lease = this.byKey.get(frame.key)
    if (!lease) return
    // Another window has the pages, and is the one to hand them over.
    if (!this.tabsOf(lease).length && this.world.usedElsewhere(lease.key)) return

    lease.status = 'handing'
    lease.fence = frame.fence
    this.world.note(`${lease.site}: handing over`)
    this.paint(lease)

    await this.serial(lease, async () => {
      const running = this.tabsOf(lease).filter(([, page]) => page.live)
      const captured = await this.taken(lease, false)
      await Promise.all(running.map(([tab]) => this.world.pages.park(tab)))
      if (captured) await this.send(lease, captured)
    })
    this.world.hub.send({ t: 'flushed', key: lease.key })
  }

  private free(frame: HubFrame<'free'>): void {
    const lease = this.byKey.get(frame.key)
    if (!lease) return
    if (this.onScreen(lease)) this.acquire(lease, false)
    else lease.status = 'loose'
  }

  /** Another computer uploaded: fetched and put in now while nothing here runs the
   *  site, so opening it is instant. */
  private newer(frame: HubFrame<'state'>): void {
    const lease = this.byKey.get(frame.key)
    if (!lease) return
    lease.version = Math.max(lease.version, frame.version)
    if (lease.status === 'held' || this.tabsOf(lease).some(([, page]) => page.live)) return

    void this.serial(lease, () => this.bringDown(lease))
  }

  private refused(frame: HubFrame<'refused'>): void {
    if (frame.to !== 'acquire' || frame.key === null) return
    const lease = this.byKey.get(frame.key)
    if (!lease) return
    // Not this computer's to ask about yet, or asked too often: its own state, for now.
    lease.status = 'loose'
    this.paint(lease)
    this.settle(lease, true)
  }

  /** The hub is back: every site with a page running or a tab on screen is asked for
   *  again, and the idle or active this computer is. */
  private reconnected(): void {
    if (this.world.hub.leads) this.world.hub.send({ t: this.active ? 'active' : 'idle' })
    for (const lease of this.byKey.values()) {
      const wanted = this.tabsOf(lease).some(([, page]) => page.live) || this.onScreen(lease)
      if (wanted && lease.status !== 'handing') this.acquire(lease, false)
    }
  }

  /* ── Moving state ─────────────────────────────────────────────────────── */

  /** The newest state, into this computer's store. */
  private async bringDown(lease: Lease): Promise<void> {
    if (lease.version <= lease.applied) return
    try {
      const got = await this.world.download(lease)
      if (!got) {
        lease.applied = lease.version
        return
      }
      const restored = await this.world.restore(lease, got.path)
      this.world.note(`${lease.site}: v${String(got.version)} put in`)
      lease.applied = Math.max(lease.applied, got.version)
      lease.digest = ''
      lease.session =
        restored.session && restored.tabPath
          ? { path: restored.tabPath, ...restored.session }
          : null
    } catch (error) {
      // Not here this time: the page runs on what this computer has, and the next
      // grant tries again.
      this.world.note(`${lease.site}: not put in, ${String(error)}`)
    }
  }

  /** Uploads the state, light (cookies and localStorage) or in full. A light one is
   *  sent at most once a minute and only when it changed. */
  private upload(lease: Lease, light: boolean): void {
    if (light && this.world.now() - lease.lightAt < LIGHT_AT_MOST) return
    if (light) lease.lightAt = this.world.now()

    void this.serial(lease, async () => {
      if (lease.status !== 'held') return
      const captured = await this.taken(lease, light)
      if (!captured || (light && captured.digest === lease.digest)) return
      await this.send(lease, captured)
    })
  }

  private async send(lease: Lease, captured: Captured): Promise<void> {
    const version = await this.world.upload(lease, captured)
    this.world.note(`${lease.site}: up, ${String(version)}`)
    if (version === 'fenced') {
      this.fenced(lease)
      return
    }
    if (typeof version !== 'number') return
    lease.version = Math.max(lease.version, version)
    lease.applied = lease.version
    lease.digest = captured.digest
  }

  /** A capture, or nothing where the engine could not take one, said in the log. */
  private async taken(lease: Lease, light: boolean): Promise<Captured | null> {
    try {
      return await this.capture(lease, light)
    } catch (error) {
      this.world.note(`${lease.site}: not captured, ${String(error)}`)
      return null
    }
  }

  private capture(lease: Lease, light: boolean): Promise<Captured> {
    const tabs = this.tabsOf(lease)
    const notes = tabs.flatMap(([, page]) => (page.path ? [page.path] : []))
    // The web note looked at last, whose sessionStorage goes with the state: a running
    // one before a frozen one, which has to be woken to be read (see web-sync.svelte.ts).
    const tab =
      tabs
        .filter(([, page]) => page.live && page.path !== null)
        .sort(
          ([, one], [, other]) =>
            Number(one.frozen) - Number(other.frozen) || other.looked - one.looked,
        )[0]?.[0] ?? null
    return this.world.capture(lease, light, tab, notes)
  }

  /** The account refused an upload made under this lease's fence: another computer has
   *  had the site since, and this one never heard - it slept with its socket open, or was
   *  held still. Its pages stop at once, and the hub is asked whose the site is now. */
  private fenced(lease: Lease): void {
    if (lease.status !== 'held') return
    lease.status = 'loose'
    for (const [tab, page] of this.tabsOf(lease)) {
      if (page.live) void this.world.pages.park(tab)
    }
    if (this.world.hub.state === 'open') this.acquire(lease, false)
  }

  /** Let go of: the state in full, then the hub told. */
  private async release(lease: Lease): Promise<void> {
    if (lease.status !== 'held') return
    await this.serial(lease, async () => {
      const captured = await this.taken(lease, false)
      if (captured) await this.send(lease, captured)
    })
    this.world.hub.send({ t: 'release', key: lease.key })
    lease.status = 'loose'
  }

  /** Every couple of minutes while somebody is here: the cookies and localStorage of
   *  each site this computer is using. Not of a site whose every page is frozen, which has
   *  changed nothing since it froze; it keeps its lease all the same. */
  private keepLight(): void {
    if (!this.active) return
    for (const lease of this.byKey.values()) {
      const running = this.tabsOf(lease).some(([, page]) => page.live && !page.frozen)
      if (lease.status === 'held' && running) this.upload(lease, true)
    }
  }

  /** A web note's tab, freshly built after a restore, given the sessionStorage that came
   *  with it; once. */
  private gaveSession(tab: string, page: Page, lease: Lease): void {
    const session = lease.session
    if (!session || !page.live || page.path !== session.path) return
    lease.session = null
    void this.world.session(tab, session.origin, session.items)
  }

  /* ── Bookkeeping ──────────────────────────────────────────────────────── */

  /** The lease a tab's page needs, made the first time a site in a store is met, or
   *  null for a page that needs none: not on the web, or no key on this computer yet. */
  private async leaseFor(tab: string, page: Page): Promise<Lease | null> {
    const place = await this.world.placeOf(page)
    const key = place ? await this.nameOf(place) : null
    if (!place || key === null) {
      if (this.tabs.delete(tab)) this.said()
      return null
    }

    let lease = this.byKey.get(key)
    if (!lease) {
      lease = new Lease(key, place.store, place.site)
      this.byKey.set(key, lease)
    }
    if (this.tabs.get(tab) !== key) {
      const before = this.tabs.get(tab)
      this.tabs.set(tab, key)
      this.said()
      // A tab that left a site for another may have been that site's last.
      if (before !== undefined) this.left(before)
    }
    lease.letGo?.()
    lease.letGo = null
    const origin = originOf(page.url)
    if (origin) lease.origins.add(origin)
    return lease
  }

  private async nameOf(place: Place): Promise<string | null> {
    const said = `${place.store ?? ''}
${place.site}`
    const known = this.names.get(said)
    if (known !== undefined) return known
    const key = await this.world.keyOf(place).catch(() => null)
    if (key !== null) this.names.set(said, key)
    return key
  }

  /** A tab is no longer on a lease's site: the last one lets go of it, a moment later,
   *  so a tab closed and the site opened again is not two trips to the hub. */
  private left(key: string): void {
    const lease = this.byKey.get(key)
    if (!lease || this.tabsOf(lease).length) return

    lease.letGo?.()
    lease.letGo = this.world.later(RELEASE_AFTER, () => {
      lease.letGo = null
      if (!this.tabsOf(lease).length) void this.release(lease)
    })
  }

  private tabsOf(lease: Lease): [string, Page][] {
    return this.world.pages.each().filter(([tab]) => this.tabs.get(tab) === lease.key)
  }

  private onScreen(lease: Lease): boolean {
    return this.tabsOf(lease).some(([, page]) => page.onScreen)
  }

  private acquire(lease: Lease, take: boolean): void {
    if (!this.world.hub.send({ t: 'acquire', key: lease.key, take })) return
    lease.askedAt = this.world.now()
    // Asking again about a site another computer has is still another computer's until
    // the hub says otherwise: the pane keeps saying so, and no page runs meanwhile.
    if (take) lease.status = 'taking'
    else if (lease.status !== 'held' && !elsewhere(lease)) lease.status = 'asking'
  }

  /** A tab of a site another computer has, come back on screen: asked about again, at
   *  most once in a while, since the hub says `free` of its own accord to a computer
   *  that is waiting and not to one the site was taken from. */
  private again(lease: Lease): void {
    if (lease.status !== 'lost') return
    if (this.world.now() - lease.askedAt < 30_000) return
    this.acquire(lease, false)
  }

  /** Waits for the hub's answer, or not for long. */
  private answer(lease: Lease): Promise<boolean> {
    return new Promise((go) => {
      let done = false
      const once = (ok: boolean) => {
        if (done) return
        done = true
        stop()
        go(ok)
      }
      // Only while nothing has been answered: a grant whose state is on its way down
      // is waited for, since the page must not run on the state it replaces - but not
      // for ever, since a download can stall where a socket did not.
      const quick = this.world.later(LEASE_WAITS, () => {
        if (lease.status !== 'asking') return
        this.world.note(`${lease.site}: no answer yet, this computer's own state`)
        once(true)
      })
      const late = this.world.later(RESTORE_WAITS, () => {
        once(lease.status === 'held' || lease.status === 'asking' || lease.status === 'loose')
      })
      const stop = () => {
        quick()
        late()
      }
      lease.waiters.push(once)
    })
  }

  private settle(lease: Lease, go: boolean): void {
    const waiting = lease.waiters
    lease.waiters = []
    for (const one of waiting) one(go)
  }

  /** Draws the lease on every tab of it: another computer's name and Use here, or
   *  nothing. */
  private paint(lease: Lease): void {
    const lock: Lock | null = elsewhere(lease)
      ? {
          device: lease.holder,
          pressed: lease.status === 'taking',
          take: () => {
            this.take(lease)
          },
        }
      : null
    for (const [, page] of this.tabsOf(lease)) page.lock = lock
  }

  /** Runs one piece of work on a lease after the one before it. */
  private serial(lease: Lease, work: () => Promise<void>): Promise<void> {
    const next = lease.work.then(work, work).catch(() => undefined)
    lease.work = next
    return next
  }

  /** Tells the other windows which leases this one uses. */
  private said(): void {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away here
    this.world.using([...new Set(this.tabs.values())])
  }

  /** Every page already running, taken on: what it needs, and the hub asked. */
  private async reconcile(): Promise<void> {
    for (const [tab, page] of this.world.pages.each()) {
      if (!page.live) continue
      const lease = await this.leaseFor(tab, page)
      if (lease?.status === 'loose' && this.world.hub.state === 'open') this.acquire(lease, false)
    }
  }
}
