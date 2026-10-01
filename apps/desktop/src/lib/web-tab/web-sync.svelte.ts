/** Web logins that travel, started: where lease.svelte.ts, approval.svelte.ts and
 *  activity.ts meet the app - the hub, the pages, the crate's capture and restore, the
 *  account's routes, the windows beside this one and the close.
 *
 *  Started only where the account's `web_sync` switch is on, on a desktop, and on an
 *  engine that can carry a site's state: nib's own Chromium cannot yet (see
 *  src-tauri/src/web_state.rs), and a lease this computer could not hand over would be
 *  a lock with nothing behind it, so there nothing starts and every page runs as before.
 *  See lib/sync2/connect.svelte.ts for the switch. */

import { mount, untrack, unmount } from 'svelte'
import { account } from '../account.svelte'
import { agentMarks } from '../agent-marks.svelte'
import { request } from '../api'
import { log } from '../log'
import { handsBack } from '../parting'
import { hub } from '../sync2/hub.svelte'
import { invoke } from '../tauri'
import { waited } from '../timing'
import { workspace } from '../workspace.svelte'
import { Activity, listenForInput, readSystemInput } from './activity'
import { accountDevices, Approval } from './approval.svelte'
import { carriedIn, carriedOut } from './carried'
import { download, upload } from './lease-transfer'
import { Leases, type Lease, type LeaseWorld, type Place } from './lease.svelte'
import { pages } from './pages.svelte'
import { hostOf, siteOf } from './web-data'
import { webData } from './web-data.svelte'
import { webKey, webState } from './web-state'
import WebApprove from './WebApprove.svelte'

/** What nib's own Chromium says to a capture; see `NOT_HERE` in web_state.rs. */
const NOT_ON_THIS_ENGINE = 'this engine'

let started: Promise<void> | null = null

/** Starts web logins that travel, once. */
export function startWebSync(): Promise<void> {
  return (started ??= begin())
}

/** Whether this engine can carry a site's state: asked of the crate with a question it
 *  refuses either way, and read off how it refuses. */
async function carries(): Promise<boolean> {
  const said = await invoke('web_state_wants', { store: null, site: '', manifestPath: '' }).then(
    () => '',
    (error: unknown) => String(error),
  )
  return !said.includes(NOT_ON_THIS_ENGINE)
}

async function begin(): Promise<void> {
  if (!(await carries())) return

  const approval = new Approval({
    hub,
    pub: () => webKey.device(),
    digits: (pub) => webKey.digits(pub),
    wrap: (pub) => webKey.wrap(pub),
    accept: async (wrapped) => {
      await webKey.accept(wrapped)
    },
    rotate: () => webKey.rotate(),
    devices: accountDevices,
    settle: () => waited(1500),
  })

  const leases = new Leases(leaseWorld(approval))
  const activity = new Activity({
    now: () => Date.now(),
    system: async () => readSystemInput(await invoke<unknown>('input_idle')),
    busy: () =>
      pages.each().some(([, page]) => page.playing) ||
      agentMarks.holding ||
      Object.values(agentMarks.on).some((one) => !one.paused),
    listen: listenForInput,
    every: (ms, tick) => {
      const timer = setInterval(tick, ms)
      return () => clearInterval(timer)
    },
  })

  pages.watch = {
    admit: (tab, page) => leases.admit(tab, page),
    moved: (tab, page, settled) => {
      leases.moved(tab, page, settled)
    },
    closed: (tab) => {
      leases.closed(tab)
    },
  }
  handsBack({
    owes: () => leases.holding(),
    send: () => leases.handBack(),
  })
  // Signing out forgets this computer's keys: what it holds of the account's web
  // logins is the account's, and the next account starts without them.
  account.forgetWithSession(() => {
    approval.keyed = false
    void webKey.forget().catch(() => undefined)
  })

  approval.start()
  leases.start()
  activity.start()
  activity.changed((active) => {
    leases.activity(active)
  })
  approval.keyedNow(() => void leases.keyed())

  $effect.root(() => {
    // The quiet line under a web tab's bar while this computer waits for the key.
    $effect(() => {
      const waiting = approval.waiting
      untrack(() => (pages.waiting = waiting))
    })

    // A computer asking this one for the key: the bubble, while one asks.
    const asking = $derived(approval.asking.length > 0)
    $effect(() => {
      if (!asking) return
      const bubble = untrack(() =>
        mount(WebApprove, { target: document.body, props: { approval } }),
      )
      return () => void unmount(bubble, { outro: true })
    })

    // Which store each space's pages go in is the account's now; a space whose store
    // changed has its open pages built again in the new one.
    $effect(() => {
      const spaces = account.spaces
      untrack(() => {
        for (const space of webData.follow(spaces, writeStoreUp)) void pages.restore(space)
      })
    })
  })
}

/** A space's store choice, written to the account. */
async function writeStoreUp(space: string, choice: string): Promise<void> {
  const token = account.accountToken
  if (!token) return
  await request(`/v2/spaces/${encodeURIComponent(space)}/web-store`, {
    method: 'PUT',
    token,
    body: { store: choice },
  })
}

/** Which windows of this computer use which leases, heard over a channel, so a window
 *  closing does not let go of a site another window still has open. */
function windows(): {
  usedElsewhere(key: string): boolean
  using(keys: string[]): void
} {
  const self = crypto.randomUUID()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- what the other windows said; nothing renders from it
  const others = new Map<string, Set<string>>()
  let mine: string[] = []
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('nib:leases') : null

  const say = () => channel?.postMessage({ window: self, keys: mine })
  if (channel) {
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const said = event.data as { window?: unknown; keys?: unknown; ask?: unknown }
      if (said.ask === true) say()
      if (typeof said.window !== 'string' || !Array.isArray(said.keys)) return
      others.set(said.window, new Set(said.keys.filter((one) => typeof one === 'string')))
    }
    channel.postMessage({ ask: true })
    addEventListener('pagehide', () => {
      mine = []
      say()
    })
  }

  return {
    usedElsewhere: (key) => [...others.values()].some((keys) => keys.has(key)),
    using: (keys) => {
      mine = keys
      say()
    },
  }
}

/** The app's side of every question a lease asks. */
function leaseWorld(approval: Approval): LeaseWorld {
  const between = windows()
  const spaces = () => workspace.spaces.map((one) => ({ id: one.id, root: one.root }))

  const placeOf = async (page: {
    space: string | null
    url: string | null
  }): Promise<Place | null> => {
    const host = hostOf(page.url)
    if (!host) return null
    const { getDomain } = await import('tldts')
    return {
      store: await webData.store(page.space, page.url),
      site: siteOf(host, (one) => getDomain(one, { allowPrivateDomains: true })),
    }
  }

  const token = () => {
    const held = account.accountToken
    if (!held) throw new Error('signed out')
    return held
  }

  return {
    hub,
    pages,
    placeOf,
    // Only once the hub has handed this computer the key: a key in the keychain the
    // account does not know would name leases no other computer can see.
    keyOf: async (place) =>
      approval.keyed ? await webKey.lease(place.store, place.site).catch(() => null) : null,
    capture: async (lease: Lease, light, tab, notes) => {
      // A frozen page answers nothing, so the one read is woken first; see `thaw`.
      if (tab !== null) await pages.thaw(tab)
      return webState.capture(
        lease.store,
        lease.site,
        [...lease.origins],
        tab ?? undefined,
        carriedOut(
          lease.origins,
          notes,
          tab === null ? null : (pages.of(tab).path ?? null),
          spaces(),
        ),
        light,
      )
    },
    upload: async (lease, captured) => {
      const generation = await webKey.current()
      if (generation === null) return null
      return upload(token(), lease, captured, lease.fence, generation)
    },
    download: (lease) => download(token(), lease),
    restore: async (lease, path) => {
      const restored = await webState.restore(lease.store, lease.site, path)
      return { ...restored, tabPath: carriedIn(restored.app, spaces()) }
    },
    session: async (tab, origin, items) => {
      await webState.session(tab, { origin, items })
    },
    mirror: (place, device) => {
      void invoke('web_lease_elsewhere', { store: place.store, site: place.site, device }).catch(
        () => undefined,
      )
    },
    note: (line) => {
      log('info', `web login ${line}`)
    },
    usedElsewhere: (key) => between.usedElsewhere(key),
    using: (keys) => {
      between.using(keys)
    },
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
