/** The web key on a computer, against a hub and a keychain that are stood in for: the
 *  first computer makes it without a word, a new one asks and shows the six digits, one
 *  that has it is asked and answers, and only the hub handing it over makes a computer
 *  one that holds it. See docs/sync-v2.md section 6.6. */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FromDevice, FromHub } from '../sync2/hub-frames'
import { Approval, type ApprovalWorld, type Known } from './approval.svelte'

class FakeHub {
  leads = true
  sent: FromDevice[] = []
  private readonly listeners = new Map<string, Set<(frame: FromHub) => void>>()
  private readonly openers = new Set<() => void>()
  introduced: (() => Promise<{ pub?: string }>) | null = null

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

  introduce(run: () => Promise<{ pub?: string }>) {
    this.introduced = run
  }

  send(frame: FromDevice): boolean {
    this.sent.push(frame)
    return true
  }

  say(frame: FromHub): void {
    for (const listener of this.listeners.get(frame.t) ?? []) listener(frame)
  }

  open(): void {
    for (const run of this.openers) run()
  }
}

let hub: FakeHub
let devices: Known[]
let accepted: { wrapped: string; generation: number }[]
let rotated: number

function world(): ApprovalWorld {
  return {
    hub,
    pub: () => Promise.resolve('bXktcHVibGljLWtleQ=='),
    digits: (pub) => Promise.resolve(pub === 'bXktcHVibGljLWtleQ==' ? '482913' : '100200'),
    wrap: (pub) => Promise.resolve({ wrapped: `wrapped-for-${pub}`, generation: 1 }),
    accept: (wrapped) => {
      accepted.push(wrapped)
      return Promise.resolve()
    },
    rotate: () => {
      rotated += 1
      return Promise.resolve(1)
    },
    devices: () => Promise.resolve(devices),
    settle: () => Promise.resolve(),
  }
}

async function settle(): Promise<void> {
  for (let turns = 0; turns < 10; turns += 1) await Promise.resolve()
}

const ME: Known = { id: 'me-000001', name: 'Laptop', current: true, webKey: false, lastSeenAt: 1 }
const DESKTOP: Known = {
  id: 'desk-00001',
  name: 'Desktop',
  current: false,
  webKey: true,
  lastSeenAt: 5,
}

beforeEach(() => {
  hub = new FakeHub()
  devices = [ME]
  accepted = []
  rotated = 0
})

describe('the web key', () => {
  test('hello carries this computer’s public key', async () => {
    new Approval(world()).start()
    await expect(hub.introduced?.()).resolves.toEqual({ pub: 'bXktcHVibGljLWtleQ==' })
  })

  test('the first computer ever makes it, wraps it to itself, and holds it once the hub says so', async () => {
    const approval = new Approval(world())
    approval.start()
    hub.open()
    await settle()

    expect(rotated).toBe(1)
    expect(hub.sent).toEqual([
      { t: 'grant-key', to: ME.id, wrapped: 'wrapped-for-bXktcHVibGljLWtleQ==', generation: 1 },
    ])
    expect(approval.keyed).toBe(false)

    hub.say({ t: 'key', wrapped: 'wrapped-for-me', generation: 1 })
    await settle()
    expect(approval.keyed).toBe(true)
    expect(accepted).toEqual([{ wrapped: 'wrapped-for-me', generation: 1 }])
  })

  test('a new computer asks, and waits on the one that has it with the six digits', async () => {
    devices = [ME, DESKTOP]
    const approval = new Approval(world())
    approval.start()
    hub.open()
    await settle()

    expect(rotated).toBe(0)
    expect(hub.sent).toEqual([{ t: 'want-key', pub: 'bXktcHVibGljLWtleQ==' }])
    expect(approval.waiting).toEqual({ device: 'Desktop', digits: '482913' })

    hub.say({ t: 'key', wrapped: 'from-desktop', generation: 1 })
    await settle()
    expect(approval.waiting).toBeNull()
    expect(approval.keyed).toBe(true)
  })

  test('a computer that was refused stops waiting', async () => {
    devices = [ME, DESKTOP]
    const approval = new Approval(world())
    approval.start()
    hub.open()
    await settle()

    hub.say({ t: 'key-denied' })
    expect(approval.waiting).toBeNull()
    expect(approval.keyed).toBe(false)
  })

  test('a computer that has it is asked, with the asking computer’s digits, and Allow wraps it there', async () => {
    const approval = new Approval(world())
    approval.start()
    hub.say({ t: 'key', wrapped: 'mine', generation: 1 })
    await settle()

    hub.say({ t: 'key-wanted', device: 'new-000001', name: 'Desktop', pub: 'bmV3LWtleQ==' })
    await settle()
    const [asking] = approval.asking
    expect(asking).toEqual({
      device: 'new-000001',
      name: 'Desktop',
      pub: 'bmV3LWtleQ==',
      digits: '100200',
    })

    if (asking) await approval.allow(asking)
    expect(hub.sent.at(-1)).toEqual({
      t: 'grant-key',
      to: 'new-000001',
      wrapped: 'wrapped-for-bmV3LWtleQ==',
      generation: 1,
    })
    expect(approval.asking).toEqual([])
  })

  test('Don’t allow says so, and another computer answering closes the question here', async () => {
    const approval = new Approval(world())
    approval.start()
    hub.say({ t: 'key', wrapped: 'mine', generation: 1 })
    await settle()

    hub.say({ t: 'key-wanted', device: 'new-000001', name: 'Desktop', pub: 'bmV3LWtleQ==' })
    hub.say({ t: 'key-wanted', device: 'new-000002', name: 'Phone', pub: 'b3RoZXI=' })
    await settle()

    const first = approval.asking[0]
    if (first) approval.deny(first)
    expect(hub.sent.at(-1)).toEqual({ t: 'deny-key', to: 'new-000001' })

    hub.say({ t: 'key-settled', device: 'new-000002' })
    expect(approval.asking).toEqual([])
  })

  test('a computer without the key is asked nothing', async () => {
    const approval = new Approval(world())
    approval.start()
    hub.say({ t: 'key-wanted', device: 'new-000001', name: 'Desktop', pub: 'bmV3LWtleQ==' })
    await settle()
    expect(approval.asking).toEqual([])
  })

  test('says once when it comes to hold the key', async () => {
    const approval = new Approval(world())
    const told = vi.fn()
    approval.keyedNow(told)
    approval.start()
    hub.say({ t: 'key', wrapped: 'mine', generation: 1 })
    hub.say({ t: 'key', wrapped: 'mine', generation: 1 })
    await settle()
    expect(told).toHaveBeenCalledTimes(1)
  })
})
