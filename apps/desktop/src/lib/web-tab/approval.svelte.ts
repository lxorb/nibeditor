/** The web key on this computer: whether it has one, making the first, asking for it
 *  and giving it to another computer (docs/sync-v2.md section 6.6).
 *
 *  A computer holds the key only once its hub has handed it the key wrapped to it: a key
 *  in the keychain the account no longer knows about names leases nobody else can see,
 *  which is two computers on one login without either knowing. So `keyed` is what the
 *  hub said, and nothing else.
 *
 *  Three roads to it. The first computer ever makes the key without a word, wraps it to
 *  itself and is done. A computer on an account where another one holds it asks, and
 *  shows a quiet line with six digits while it waits; each computer that holds the key
 *  shows the same six digits in a small bubble, with Don't allow and Allow, and Allow
 *  wraps the key to the asking computer. A computer on an account whose computers are
 *  all gone makes a fresh key, which is the first road again: the old state is let go of
 *  on the account, and the person signs in to their sites once more. Until it has the
 *  key a computer takes no leases and uploads nothing: its pages run on its own state,
 *  like a new browser's. */

import { account } from '../account.svelte'
import { request } from '../api'
import { isRecord } from '../stored'
import type { Hub } from '../sync2/hub.svelte'
import type { HubFrame } from '../sync2/hub-frames'

/** A computer asking for the key, as a computer that has it shows the question. */
export interface Asking {
  device: string
  name: string
  pub: string
  digits: string
}

/** The account's computers, as `GET /v2/devices` answers them: which is this one, and
 *  which hold the key. */
export interface Known {
  id: string
  name: string
  current: boolean
  webKey: boolean
  lastSeenAt: number | null
}

/** What the approval needs from around it. */
export interface ApprovalWorld {
  hub: Pick<Hub, 'on' | 'send' | 'opened' | 'introduce' | 'leads'>
  /** This computer's public key, made the first time. */
  pub(): Promise<string>
  digits(pub: string): Promise<string>
  /** The web key wrapped to another computer. */
  wrap(pub: string): Promise<{ wrapped: string; generation: number }>
  /** Takes the key the hub handed over. */
  accept(wrapped: { wrapped: string; generation: number }): Promise<void>
  /** A new key, one generation on: answers the generation. */
  rotate(): Promise<number>
  devices(): Promise<Known[]>
  /** How long to give the hub to hand over a key it has, before asking for one. */
  settle(): Promise<void>
}

function readKnown(value: unknown): Known[] {
  if (!isRecord(value) || !Array.isArray(value.devices)) return []
  return value.devices.flatMap((one: unknown) =>
    isRecord(one) && typeof one.id === 'string'
      ? [
          {
            id: one.id,
            name: typeof one.name === 'string' ? one.name : '',
            current: one.current === true,
            webKey: one.webKey === true,
            lastSeenAt: typeof one.lastSeenAt === 'number' ? one.lastSeenAt : null,
          },
        ]
      : [],
  )
}

export class Approval {
  /** Whether this computer holds the web key, as its hub said. */
  keyed = $state(false)
  /** The computer this one waits on, and the digits, while it waits. */
  waiting = $state<{ device: string; digits: string } | null>(null)
  /** Computers asking this one for the key. */
  asking = $state<Asking[]>([])

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- who is listening; nothing renders from it
  private readonly heard = new Set<() => void>()
  /** Whether the road to the key is being walked, so a reconnect does not walk it
   *  twice. */
  private walking = false

  constructor(private readonly world: ApprovalWorld) {}

  /** Listens to the hub. Answers how to stop. */
  start(): () => void {
    const { hub } = this.world
    hub.introduce(async () => ({ pub: await this.world.pub() }))

    const stops = [
      hub.on('key', (frame) => void this.given(frame)),
      hub.on('key-denied', () => {
        this.waiting = null
      }),
      hub.on('key-wanted', (frame) => void this.wanted(frame)),
      hub.on('key-settled', (frame) => {
        this.asking = this.asking.filter((one) => one.device !== frame.device)
      }),
      hub.on('refused', (frame) => {
        // Two computers made the first key at once, and the other one's landed: this
        // one asks for it instead.
        if (frame.to === 'grant-key' || frame.to === 'want-key') void this.walk()
      }),
      hub.opened(() => void this.walk()),
    ]
    return () => {
      for (const stop of stops) stop()
    }
  }

  /** Runs whenever this computer comes to hold the key. */
  keyedNow(run: () => void): () => void {
    this.heard.add(run)
    return () => this.heard.delete(run)
  }

  /** Gives the key to a computer that asked. */
  async allow(one: Asking): Promise<void> {
    this.asking = this.asking.filter((other) => other.device !== one.device)
    const wrapped = await this.world.wrap(one.pub)
    this.world.hub.send({ t: 'grant-key', to: one.device, ...wrapped })
  }

  /** Tells a computer that asked that it may not have it. */
  deny(one: Asking): void {
    this.asking = this.asking.filter((other) => other.device !== one.device)
    this.world.hub.send({ t: 'deny-key', to: one.device })
  }

  /** Hides a question without answering it; it is asked again after a reconnect. */
  dismiss(one: Asking): void {
    this.asking = this.asking.filter((other) => other.device !== one.device)
  }

  private async given(frame: HubFrame<'key'>): Promise<void> {
    try {
      await this.world.accept({ wrapped: frame.wrapped, generation: frame.generation })
    } catch {
      // Wrapped to a key this computer no longer has: it asks again below.
      return
    }
    this.waiting = null
    if (this.keyed) return
    this.keyed = true
    for (const run of this.heard) run()
  }

  private async wanted(frame: HubFrame<'key-wanted'>): Promise<void> {
    if (!this.keyed || this.asking.some((one) => one.device === frame.device)) return
    const digits = await this.world.digits(frame.pub).catch(() => null)
    if (digits === null) return
    this.asking = [
      ...this.asking,
      { device: frame.device, name: frame.name, pub: frame.pub, digits },
    ]
  }

  /** The road to the key, walked on every connect: nothing if the hub handed it over,
   *  the first key if nobody has one, and a request otherwise. */
  private async walk(): Promise<void> {
    // Once a device, not once a window: the window holding the socket walks it.
    if (this.walking || !this.world.hub.leads) return
    this.walking = true
    try {
      // The hub hands a key it has for this computer straight after `hello`.
      await this.world.settle()
      if (this.keyed) return

      const devices = await this.world.devices()
      const holders = devices.filter((one) => one.webKey && !one.current)
      if (!devices.some((one) => one.webKey)) {
        await this.make()
        return
      }
      if (devices.some((one) => one.webKey && one.current)) return

      const pub = await this.world.pub()
      this.world.hub.send({ t: 'want-key', pub })
      const newest = holders.sort(
        (one, other) => (other.lastSeenAt ?? 0) - (one.lastSeenAt ?? 0),
      )[0]
      this.waiting = { device: newest?.name ?? '', digits: await this.world.digits(pub) }
    } catch {
      // The account out of reach: the next connect walks it again.
    } finally {
      this.walking = false
    }
  }

  /** The first key on the account, wrapped to this computer: the hub hands it straight
   *  back as `key`, which is when this computer holds it. */
  private async make(): Promise<void> {
    const pub = await this.world.pub()
    await this.world.rotate()
    const wrapped = await this.world.wrap(pub)
    const device = (await this.world.devices()).find((one) => one.current)?.id
    if (device) this.world.hub.send({ t: 'grant-key', to: device, ...wrapped })
  }
}

/** The account's computers, from the account. */
export async function accountDevices(): Promise<Known[]> {
  const token = account.accountToken
  if (!token) return []
  return readKnown(await request<unknown>('/v2/devices', { token }))
}
