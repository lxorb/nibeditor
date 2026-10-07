/** Three devices, one chat, an account that places what they send (docs/chats.md 6.2,
 *  lane 4's simulator): posts, replies, edits, deletes and reactions made offline and
 *  crossing, devices that crash with an outbox full, and every device ending with the
 *  one state the reducer makes of the account's log. */

import { type Event, type Message, ulid, type Who } from '@nib/chats'
import { afterEach, describe, expect, test } from 'vitest'
import { MemoryCache } from './cache'
import { ChatEngine } from './engine'
import { keepsRow } from './fold'
import { Account, CHAT, random } from './test-account'

interface Device {
  who: Who
  online: boolean
  cache: MemoryCache
  engine: ChatEngine
}

const engines: ChatEngine[] = []

afterEach(() => {
  for (const engine of engines.splice(0)) engine.stop()
})

async function device(account: Account, who: Who, cache = new MemoryCache()): Promise<Device> {
  const made: Device = { who, online: true, cache, engine: null as unknown as ChatEngine }
  made.engine = new ChatEngine(
    cache,
    account.remote(who, () => made.online),
    () => who,
  )
  engines.push(made.engine)
  await made.engine.load()
  return made
}

/** Everything a device keeps of the chat, by id: the chat itself, and every message's
 *  replies under it. */
async function kept(one: Device): Promise<Map<string, Message>> {
  const out = new Map<string, Message>()
  const asked = new Set<string>()
  let rows = await one.cache.window({ chat: CHAT, limit: 100_000 })
  while (rows.length) {
    const next = []
    for (const row of rows) {
      out.set(row.message.id, row.message)
      if (asked.has(row.message.id)) continue
      asked.add(row.message.id)
      next.push(...(await one.cache.window({ chat: CHAT, parent: row.message.id, limit: 100_000 })))
    }
    rows = next
  }
  return out
}

/** Every device online, sending and catching up until nothing moves. */
async function settle(devices: readonly Device[]): Promise<void> {
  for (const one of devices) one.online = true
  for (let round = 0; round < 4; round++) {
    for (const one of devices) {
      await one.engine.flushAll()
      await one.engine.refresh()
      await one.engine.sync(CHAT)
      while (await one.engine.fill(CHAT)) {
        // A page at a time, to the chat's first message.
      }
    }
  }
}

async function expectOneState(account: Account, devices: readonly Device[]): Promise<void> {
  const truth = new Map([...account.state()].filter(([, message]) => keepsRow(message)))
  for (const one of devices) {
    expect(await kept(one), one.who).toEqual(truth)
    // What is left is only what crossed a delete on another device: refused as gone.
    const left = one.engine.pending(CHAT).map((row) => row.refused)
    expect(
      left.filter((refused) => refused !== 'gone'),
      one.who,
    ).toEqual([])
  }
}

describe('three devices in one chat', () => {
  test('offline posts, edits and deletes crossing end in one state', async () => {
    for (let seed = 1; seed <= 25; seed++) {
      const next = random(seed)
      const account = new Account()
      const devices = [
        await device(account, 'user:ana'),
        await device(account, 'user:ben'),
        await device(account, 'guest:cy'),
      ]
      let clock = 1_000
      const id = () => ulid((clock += 1), next)

      for (let step = 0; step < 60; step++) {
        const one = devices[Math.floor(next() * devices.length)]!
        const roll = next()
        if (roll < 0.1) {
          one.online = !one.online
          continue
        }
        if (roll < 0.2) {
          await one.engine.sync(CHAT)
          continue
        }
        const known = [...(await kept(one)).values()].filter((message) => !message.deleted)
        const target = known[Math.floor(next() * known.length)]
        let event: Event
        if (!target || roll < 0.5) {
          const parent = target && next() < 0.3 ? target.id : undefined
          event = {
            kind: 'post',
            id: id(),
            message: id(),
            body: `said ${String(step)}`,
            ...(parent ? { parent } : {}),
          }
        } else if (roll < 0.65) {
          event = { kind: 'edit', id: id(), target: target.id, body: `again ${String(step)}` }
        } else if (roll < 0.75) {
          event = { kind: 'delete', id: id(), target: target.id }
        } else {
          event = { kind: 'react', id: id(), target: target.id, emoji: '👍', on: next() < 0.7 }
        }
        // An edit or a delete of somebody else's message is one the composer never offers.
        if ((event.kind === 'edit' || event.kind === 'delete') && target?.author !== one.who)
          continue
        await one.engine.queue(CHAT, event)
      }

      await settle(devices)
      await expectOneState(account, devices)
    }
  })

  test('an outbox outlives a crash and is placed once', async () => {
    const account = new Account()
    const cache = new MemoryCache()
    const first = await device(account, 'user:ana', cache)
    first.online = false
    const next = random(9)
    let clock = 1_000
    const id = () => ulid((clock += 1), next)
    const message = id()
    await first.engine.queue(CHAT, { kind: 'post', id: id(), message, body: 'before the crash' })
    await first.engine.queue(CHAT, { kind: 'edit', id: id(), target: message, body: 'and after' })

    // The account placed the post but its answer was lost, then the app died.
    const [post] = await cache.outbox()
    if (post) account.place('user:ana', post.event)
    first.engine.stop()

    const again = await device(account, 'user:ana', cache)
    expect(again.engine.pending(CHAT)).toHaveLength(2)
    await settle([again])

    expect(account.log.map((one) => one.kind)).toEqual(['post', 'edit'])
    await expectOneState(account, [again])
    expect((await kept(again)).get(message)?.body).toBe('and after')
  })

  test('a refusal stays until the reader retries or lets it go', async () => {
    const account = new Account()
    const ana = await device(account, 'user:ana')
    await ana.engine.queue(CHAT, { kind: 'delete', id: 'e1', target: 'nobody' })
    await settle([ana])
    expect(ana.engine.pending(CHAT).map((row) => row.refused)).toEqual(['gone'])

    await ana.engine.drop(['e1'])
    expect(ana.engine.pending(CHAT)).toEqual([])
    expect(await ana.cache.outbox()).toEqual([])
  })
})
