/** Pokes: a space moved, and every device that can reach it hears so, except the
 *  one whose write it was. See hub/poke.ts and docs/sync-v2.md section 5.12. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { pokeSpace } from '../src/hub/poke'
import { type TestEnv, testEnv } from './harness'
import { type Computer, computer, connect, type Hubs, hubs } from './hub-fakes'

/** A request's `waitUntil`, whose work a test can wait for. */
function later(): { waitUntil(work: Promise<unknown>): void; done(): Promise<unknown[]> } {
  const pending: Promise<unknown>[] = []
  return {
    waitUntil: (work) => pending.push(work),
    done: () => Promise.all(pending),
  }
}

describe('a poke', () => {
  let env: TestEnv
  let running: Hubs
  let laptop: Computer
  let desktop: Computer
  let space: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 8, 30, 12))
    env = testEnv()
    running = hubs(env)
    env.HUB = running.HUB

    laptop = await computer(env, running, 'owner@example.com', 'Laptop')
    desktop = await computer(env, running, 'owner@example.com', 'Desktop')
    space = (
      env.db.prepare('select id from spaces where user_id = ?').get(laptop.user) as { id: string }
    ).id
  })

  afterEach(() => {
    vi.useRealTimers()
    env.close()
  })

  test('reaches the owner, a member and a guest, and not the device that wrote', async () => {
    const member = await computer(env, running, 'member@example.com', 'Member')
    const stranger = await computer(env, running, 'stranger@example.com', 'Stranger')
    env.db
      .prepare(
        `insert into space_members (space_id, email, item, role, created_at, joined_at)
         values (?, 'member@example.com', '', 'write', 1, 1)`,
      )
      .run(space)
    env.db.prepare(`insert into guests (id, name, created_at) values ('guest-1', 'Owl', 1)`).run()
    env.db
      .prepare(
        `insert into guest_members (space_id, guest_id, item, role, joined_at, created_at)
         values (?, 'guest-1', '', 'read', 1, 1)`,
      )
      .run(space)
    const guest = connect(running.of('guest-1').hub, {
      device: 'device-guest',
      who: 'guest-1',
      guest: true,
    })

    const work = later()
    await expect(pokeSpace(env, work, space, 7, laptop.id)).resolves.toBeUndefined()
    await work.done()

    const poke = { t: 'poke', space, seq: 7 }
    expect(desktop.socket.take()).toEqual([poke])
    expect(member.socket.take()).toEqual([poke])
    expect(guest.take()).toEqual([poke])
    expect(laptop.socket.take()).toEqual([])
    expect(stranger.socket.take()).toEqual([])
  })

  test('reaches no guest a link has not let in yet', async () => {
    env.db.prepare(`insert into guests (id, name, created_at) values ('guest-2', 'Wren', 1)`).run()
    env.db
      .prepare(
        `insert into guest_members (space_id, guest_id, item, role, created_at)
         values (?, 'guest-2', '', 'read', 1)`,
      )
      .run(space)

    const work = later()
    await pokeSpace(env, work, space, 1)
    await work.done()

    expect(running.asked.map((one) => one.id)).not.toContain('guest-2')
    // Without a device to leave out, the writer's own devices hear it too.
    expect(laptop.socket.take()).toEqual([{ t: 'poke', space, seq: 1 }])
  })

  test('is one request per account, with nothing stored to make it', async () => {
    const work = later()
    await pokeSpace(env, work, space, 3, laptop.id)
    await work.done()

    expect(running.asked.filter((one) => one.ask === 'poke').map((one) => one.id)).toEqual([
      laptop.user,
    ])
    expect(running.of(laptop.user).state.kept.size).toBe(0)
  })

  test('never fails the write it is about', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    env.HUB = {
      idFromName: () => {
        throw new Error('the namespace is unwell')
      },
    } as unknown as DurableObjectNamespace
    env.DB.prepare = () => {
      throw new Error('the database is unwell')
    }

    const work = later()
    await expect(pokeSpace(env, work, space, 1)).resolves.toBeUndefined()
    await expect(work.done()).resolves.toBeDefined()
    quiet.mockRestore()
  })

  test('is nothing at all where there are no hubs', async () => {
    delete env.HUB
    const work = later()
    await pokeSpace(env, work, space, 1)
    expect(await work.done()).toEqual([])
  })
})
