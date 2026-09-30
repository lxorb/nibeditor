/** A web login as a lease: who may run one site's session now, decided on one clock.
 *
 *  Pure. Every function takes a lease as it stands and a view of the world - the
 *  hub's clock, which devices are alive and until when, which are in use - and
 *  answers the lease as it should stand and what each device must be told. The hub
 *  does the storing and the saying; everything worth testing about leases is here.
 *
 *  A lease is free when nobody holds it or its holder is not alive, held-active
 *  when its holder is alive and in use, and held-idle when it is alive and not.
 *  Its fence is a number that grows by one with every grant and never goes back:
 *  an upload made under an older fence is refused, which is what keeps a laptop
 *  that slept through losing its lease from writing over the one that took it.
 *  See docs/sync-v2.md section 6.2. */

/** How long a holder asked to hand over has to upload what it has. */
const HANDOVER_FOR = 10_000

export interface Lease {
  fence: number
  /** The newest state's version, counted by the hub as it accepts uploads. */
  version: number
  holder: string | null
  /** Devices told `busy`, to be told `free` when that stops being true. */
  waiting: string[]
  /** A handover under way: who it goes to, and until when the holder may take to
   *  hand over its latest state before it goes anyway. */
  handover: { to: string; until: number } | null
  /** The chunks the newest state names, so the ones no state names any more can
   *  be let go of; see bucket.ts. */
  chunks: string[]
}

export function freshLease(): Lease {
  return { fence: 0, version: 0, holder: null, waiting: [], handover: null, chunks: [] }
}

export interface World {
  now: number
  /** Until when a device is alive, by the hub's clock; zero for none. */
  aliveUntil(device: string): number
  /** Whether somebody is using that device. */
  active(device: string): boolean
}

/** What one device is to be told about this lease. `holder` is the device the
 *  lease is with (or is going to), which the hub turns into a name. */
export type Said =
  | { to: string; t: 'granted' }
  | { to: string; t: 'busy'; holder: string }
  | { to: string; t: 'flush' }
  | { to: string; t: 'lost'; holder: string }
  | { to: string; t: 'free' }

export interface Outcome {
  lease: Lease
  said: Said[]
}

const alive = (world: World, device: string | null): device is string =>
  device !== null && world.aliveUntil(device) > world.now

const without = (list: readonly string[], device: string): string[] =>
  list.filter((one) => one !== device)

const withOnce = (list: readonly string[], device: string): string[] =>
  list.includes(device) ? [...list] : [...list, device]

/** A device asks for the lease; `take` says somebody pressed Use here. */
export function acquire(lease: Lease, asking: string, take: boolean, world: World): Outcome {
  const handover = lease.handover

  if (handover) {
    // Somebody is already on the way in. The holder asking back with Use here
    // keeps it, and the one on the way in is told where it stayed; a second Use
    // here elsewhere takes the handover over, because the last press is the one
    // somebody is looking at. Anybody else waits for whoever it is going to.
    if (asking === handover.to) return { lease, said: [] }

    if (asking === lease.holder && take) {
      return {
        lease: {
          ...lease,
          handover: null,
          waiting: withOnce(without(lease.waiting, asking), handover.to),
        },
        said: [
          { to: handover.to, t: 'busy', holder: asking },
          { to: asking, t: 'granted' },
        ],
      }
    }

    if (take) {
      return {
        lease: {
          ...lease,
          handover: { ...handover, to: asking },
          waiting: withOnce(without(lease.waiting, asking), handover.to),
        },
        said: [{ to: handover.to, t: 'busy', holder: asking }],
      }
    }

    return {
      lease: { ...lease, waiting: withOnce(lease.waiting, asking) },
      said: [{ to: asking, t: 'busy', holder: handover.to }],
    }
  }

  // Free, or this device's already: granted, with a new fence only for a new
  // holder, so a device asking again for what it holds is told what it has.
  if (lease.holder === asking || !alive(world, lease.holder)) {
    const renewed = lease.holder === asking
    return {
      lease: {
        ...lease,
        holder: asking,
        fence: renewed ? lease.fence : lease.fence + 1,
        waiting: without(lease.waiting, asking),
      },
      said: [{ to: asking, t: 'granted' }],
    }
  }

  const holder = lease.holder

  // Held by somebody who is not using it, or asked for with Use here: the holder
  // hands over its latest state first, and the grant follows when it says it has
  // or when its time is up.
  if (take || !world.active(holder)) {
    return {
      lease: {
        ...lease,
        handover: { to: asking, until: world.now + HANDOVER_FOR },
        waiting: without(lease.waiting, asking),
      },
      said: [{ to: holder, t: 'flush' }],
    }
  }

  return {
    lease: { ...lease, waiting: withOnce(lease.waiting, asking) },
    said: [{ to: asking, t: 'busy', holder }],
  }
}

/** The holder has uploaded what a handover asked it for. */
export function flushed(lease: Lease, device: string, world: World): Outcome {
  if (!lease.handover || lease.holder !== device) return { lease, said: [] }
  return handOver(lease, world)
}

/** The holder is done with the site. During a handover that is the same as
 *  having flushed: its latest state is up. */
export function release(lease: Lease, device: string, world: World): Outcome {
  if (lease.holder !== device) return { lease, said: [] }

  const letGo = { ...lease, holder: null }
  if (lease.handover) return handOver(letGo, world)

  return {
    lease: { ...letGo, waiting: [] },
    said: lease.waiting.map((to) => ({ to, t: 'free' as const })),
  }
}

/** A device is gone for good - revoked - and holds nothing any more. Its sockets
 *  are closed before this runs, so `settle` sees it as not alive as well. */
export function forget(lease: Lease, device: string, world: World): Outcome {
  return settle(
    {
      ...lease,
      holder: lease.holder === device ? null : lease.holder,
      waiting: without(lease.waiting, device),
    },
    world,
  )
}

/** Whatever time or a device's going has decided since the lease was last looked
 *  at: a handover whose holder did not answer in time or went away, and devices
 *  waiting on a lease that has become free or idle. What the alarm runs, and what
 *  a device going idle or closing its socket runs. */
export function settle(lease: Lease, world: World): Outcome {
  const handover = lease.handover
  if (handover) {
    const late = world.now >= handover.until
    if (late || !alive(world, lease.holder) || !alive(world, handover.to)) {
      return handOver(lease, world)
    }
    return { lease, said: [] }
  }

  if (!lease.waiting.length) return { lease, said: [] }

  const waiting = lease.waiting.filter((one) => alive(world, one))
  const held = alive(world, lease.holder) && world.active(lease.holder)
  if (held) return { lease: { ...lease, waiting }, said: [] }

  return {
    lease: { ...lease, waiting: [] },
    said: waiting.map((to) => ({ to, t: 'free' as const })),
  }
}

/** When the alarm must next look at this lease, or null for never: a handover's
 *  deadline, or the moment the holder somebody is waiting on stops being alive. */
export function due(lease: Lease, world: World): number | null {
  if (lease.handover) return lease.handover.until
  if (!lease.waiting.length || !alive(world, lease.holder)) return null
  return world.aliveUntil(lease.holder)
}

/** Whether the hub has to keep an eye on this lease at all. */
export function watched(lease: Lease): boolean {
  return lease.handover !== null || lease.waiting.length > 0
}

/** The grant at the end of a handover, with the old holder told where it went.
 *  A handover whose device has gone in the meantime goes nowhere: the holder keeps
 *  the lease, and is told so, since it stopped its pages when it was asked to
 *  hand over. */
function handOver(lease: Lease, world: World): Outcome {
  const handover = lease.handover
  if (!handover) return { lease, said: [] }

  const old = lease.holder
  const settled = { ...lease, handover: null }

  if (!alive(world, handover.to)) {
    if (alive(world, old)) return { lease: settled, said: [{ to: old, t: 'granted' }] }
    return settle({ ...settled, waiting: without(settled.waiting, handover.to) }, world)
  }

  const said: Said[] = [{ to: handover.to, t: 'granted' }]
  if (old && old !== handover.to) said.push({ to: old, t: 'lost', holder: handover.to })

  return {
    lease: {
      ...settled,
      holder: handover.to,
      fence: lease.fence + 1,
      waiting: without(lease.waiting, handover.to),
    },
    said,
  }
}
