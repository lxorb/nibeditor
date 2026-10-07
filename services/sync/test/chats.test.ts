/** Chats on the Worker (docs/chats.md 4.2 to 4.6): the routes against real SQL, and each
 *  chat's `ChatLog` against Node's SQLite, which has FTS5 as a Durable Object's does.
 *  Five people hold the space - its owner, a writer, a reader, and a guest at each role -
 *  and a sixth holds nothing. Every shape is `@nib/chats/wire`'s, read back through its
 *  own checks where the app would read it. */

import { chatText } from '@nib/chats'
import { MOST_BEHIND } from '@nib/chats/limits'
import { chatListOf, eventsPageOf, resultsOf, statePageOf } from '@nib/chats/wire'
import { subprotocol } from '@nib/rooms'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reachAs } from '../src/chats/reach'
import { sweepChats } from '../src/chats/sweep'
import { sweepLeftovers } from '../src/leftovers'
import { chatLogs, type ChatSocket, fire, hangUp, open, say } from './chat-fakes'
import { call, type ShareView, signIn, type TestEnv, testEnv } from './harness'
import { connect, hubs } from './hub-fakes'
import { doorway } from './room'

const T0 = Date.UTC(2026, 9, 7, 12)
const at = (ms: number) => vi.setSystemTime(T0 + ms)

interface People {
  owner: string
  writer: string
  reader: string
  guestWriter: string
  guestReader: string
  stranger: string
}

/** Somebody with no account who walked through the space's link at this role. */
async function guest(env: TestEnv, owner: string, spaceId: string, role: 'write' | 'read') {
  const { json } = await call<ShareView>(env, `/v1/spaces/${spaceId}/share/link`, {
    method: 'PUT',
    token: owner,
    body: { role, mode: 'open' },
  })
  const link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
  const walked = await call(env, `/v1/join/${link}`, { method: 'POST', body: { name: role } })
  return { token: walked.json.token, id: walked.json.guest.id }
}

let counter = 0
const id = (prefix = 'ev') => `${prefix}${String(++counter).padStart(8, '0')}`

function postOf(body: string, extra: Record<string, unknown> = {}) {
  return { kind: 'post', id: id(), message: id('msg'), body, ...extra }
}

describe('chats', () => {
  let env: TestEnv
  let logs: ReturnType<typeof chatLogs>
  let running: ReturnType<typeof hubs>
  let people: People
  let ids: Record<keyof People, string>
  let spaceId: string

  async function userId(token: string): Promise<string> {
    return (await call(env, '/v1/me', { token })).json.user.id
  }

  async function makeChat(token = people.owner, space = spaceId) {
    return await call<{ v: number; chat: string; error: string }>(env, '/v2/chats', {
      token,
      body: { space },
    })
  }

  async function chatOfOwner(): Promise<string> {
    return (await makeChat()).json.chat
  }

  async function send(token: string, chat: string, ...events: unknown[]) {
    const answer = await call(env, `/v2/chats/${chat}/events`, { token, body: { events } })
    return { status: answer.status, results: resultsOf(answer.json)?.results ?? [] }
  }

  async function list(token: string) {
    const { json } = await call(env, '/v2/chats', { token })
    const read = chatListOf(json)
    if (!read) throw new Error(`not a chat list: ${JSON.stringify(json)}`)
    return read.chats.map((one, at) => ({
      ...one,
      role: (json as unknown as { chats: { role: string }[] }).chats[at]?.role,
    }))
  }

  async function state(token: string, chat: string) {
    const { json } = await call(env, `/v2/chats/${chat}/state`, { token })
    const page = statePageOf(json)
    if (!page) throw new Error(`not a state page: ${JSON.stringify(json)}`)
    return page
  }

  async function events(token: string, chat: string, query = '') {
    const { json } = await call(env, `/v2/chats/${chat}/events${query}`, { token })
    const page = eventsPageOf(json)
    if (!page) throw new Error(`not an events page: ${JSON.stringify(json)}`)
    return page
  }

  /** A socket into a chat, let in at the role the door would have given. */
  async function socketOf(who: keyof People, chat: string, since?: number): Promise<ChatSocket> {
    const guestly = who === 'guestWriter' || who === 'guestReader'
    const person = { id: ids[who], guest: guestly }
    const reached = await reachAs(env, person, chat)
    if (!reached) throw new Error(`${who} does not reach ${chat}`)
    return await open(
      logs.of(chat),
      {
        ...person,
        who: guestly ? `guest:${person.id}` : `user:${person.id}`,
        role: reached.role,
        device: `device-${who}`,
      },
      { chat, space: reached.space },
      since,
    )
  }

  async function chatFile(path: string, content: string, space = spaceId): Promise<string> {
    const made = await call(env, `/v1/spaces/${space}/notes`, {
      token: people.owner,
      body: { path, content },
    })
    if (made.status !== 201) throw new Error(made.text)
    return made.json.note.id
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    env = testEnv()
    logs = chatLogs(env)
    env.CHATS = logs.CHATS
    running = hubs(env)
    env.HUB = running.HUB

    const owner = await signIn(env, 'owner@example.com')
    spaceId = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Thesis' } })).json.space
      .id
    const tokens: Partial<People> = { owner }
    for (const [role, key, step] of [
      ['write', 'writer', 1],
      ['read', 'reader', 2],
    ] as const) {
      const email = `${key}@example.com`
      await call(env, `/v1/spaces/${spaceId}/share/invite`, { token: owner, body: { email, role } })
      at(31_000 * step)
      tokens[key] = await signIn(env, email)
    }
    const guestWriter = await guest(env, owner, spaceId, 'write')
    const guestReader = await guest(env, owner, spaceId, 'read')
    at(100_000)
    const stranger = await signIn(env, 'stranger@example.com')
    people = {
      owner,
      writer: tokens.writer ?? '',
      reader: tokens.reader ?? '',
      guestWriter: guestWriter.token,
      guestReader: guestReader.token,
      stranger,
    }
    ids = {
      owner: await userId(owner),
      writer: await userId(people.writer),
      reader: await userId(people.reader),
      guestWriter: guestWriter.id,
      guestReader: guestReader.id,
      stranger: await userId(stranger),
    }
    at(200_000)
  })

  afterEach(() => {
    vi.useRealTimers()
    env.close()
  })

  describe('made and listed', () => {
    test('a writer makes one and is answered with its pointer; a reader cannot', async () => {
      const made = await makeChat()
      expect(made.status).toBe(201)
      expect(made.json).toEqual({ v: 1, chat: expect.stringMatching(/^c_[0-9a-f]{32}$/) })

      expect((await makeChat(people.writer)).status).toBe(201)
      expect((await makeChat(people.guestWriter)).status).toBe(201)
      expect((await makeChat(people.reader)).status).toBe(403)
      expect((await makeChat(people.guestReader)).status).toBe(403)
      expect((await makeChat(people.stranger)).status).toBe(404)
    })

    test('everybody the space reaches lists it at their role, and nobody else', async () => {
      const chat = await chatOfOwner()
      const roles = {
        owner: 'owner',
        writer: 'write',
        reader: 'read',
        guestWriter: 'write',
        guestReader: 'read',
      } as const
      for (const [who, role] of Object.entries(roles)) {
        const listed = await list(people[who as keyof People])
        expect(
          listed.map((one) => [one.id, one.role, one.members]),
          who,
        ).toEqual([[chat, role, 5]])
      }
      expect(await list(people.stranger)).toEqual([])
      expect((await call(env, `/v2/chats/${chat}/events`, { token: people.stranger })).status).toBe(
        404,
      )
    })

    test('its members are everybody the space reaches, by name and role, with no address', async () => {
      const chat = await chatOfOwner()
      const { json } = await call<{ members: { who: string; role: string }[] }>(
        env,
        `/v2/chats/${chat}/members`,
        { token: people.guestReader },
      )
      expect(json.members.map((one) => one.who).sort()).toEqual(
        [
          `user:${ids.owner}`,
          `user:${ids.writer}`,
          `user:${ids.reader}`,
          `guest:${ids.guestWriter}`,
          `guest:${ids.guestReader}`,
        ].sort(),
      )
      expect(json.members[0]).toMatchObject({ who: `user:${ids.owner}`, role: 'owner' })
      expect(JSON.stringify(json)).not.toContain('@example.com')
    })
  })

  describe('who may do what (4.6)', () => {
    test('writers post and readers are refused, guests at their role', async () => {
      const chat = await chatOfOwner()
      for (const who of ['owner', 'writer', 'guestWriter'] as const) {
        const { results } = await send(people[who], chat, postOf(`hello from ${who}`))
        expect(results[0], who).toMatchObject({ seq: expect.any(Number) })
      }
      for (const who of ['reader', 'guestReader'] as const) {
        const { results } = await send(people[who], chat, postOf('let me in'))
        expect(results[0], who).toMatchObject({ refused: 'role' })
      }
      expect((await send(people.stranger, chat, postOf('hi'))).status).toBe(404)

      const page = await events(people.reader, chat)
      expect(page.events.map((one) => one.author)).toEqual([
        `user:${ids.owner}`,
        `user:${ids.writer}`,
        `guest:${ids.guestWriter}`,
      ])
    })

    test('edits are the author’s; deletes the author’s or the owner’s', async () => {
      const chat = await chatOfOwner()
      const mine = postOf('owner words')
      const theirs = postOf('writer words')
      await send(people.owner, chat, mine)
      await send(people.writer, chat, theirs)

      const edit = (target: string) => ({ kind: 'edit', id: id(), target, body: 'changed' })
      const remove = (target: string) => ({ kind: 'delete', id: id(), target })
      expect((await send(people.writer, chat, edit(mine.message))).results[0]).toMatchObject({
        refused: 'role',
      })
      expect((await send(people.writer, chat, edit(theirs.message))).results[0]?.id).toBeTruthy()
      expect((await send(people.writer, chat, remove(mine.message))).results[0]).toMatchObject({
        refused: 'role',
      })
      expect((await send(people.owner, chat, remove(theirs.message))).results[0]).toMatchObject({
        seq: expect.any(Number),
      })
      // A delete stands over an edit in either order.
      expect((await send(people.writer, chat, edit(theirs.message))).results[0]).toMatchObject({
        refused: 'gone',
      })

      const page = await state(people.reader, chat)
      expect(page.messages.map((one) => one.id)).toEqual([mine.message])
      expect(page.seq).toBe(4)
    })

    test('an edit keeps the earlier wording as history', async () => {
      const chat = await chatOfOwner()
      const post = postOf('first')
      await send(people.writer, chat, post)
      at(201_000)
      await send(people.writer, chat, {
        kind: 'edit',
        id: id(),
        target: post.message,
        body: 'second',
      })
      const [message] = (await state(people.owner, chat)).messages
      expect(message).toMatchObject({
        body: 'second',
        editedAt: T0 + 201_000,
        history: [{ body: 'first', at: T0 + 200_000 }],
      })
    })

    test('the owner decides who may post; writers set the topic', async () => {
      const chat = await chatOfOwner()
      const patch = (token: string, body: Record<string, unknown>) =>
        call(env, `/v2/chats/${chat}`, { method: 'PATCH', token, body })
      expect((await patch(people.writer, { posting: 'owner' })).json.error).toBe('role')
      expect((await patch(people.guestWriter, { topic: 'Drafts' })).status).toBe(200)
      expect((await patch(people.guestReader, { topic: 'Mine' })).json.error).toBe('role')
      expect((await patch(people.writer, { topic: 'Chapters' })).status).toBe(200)
      expect((await patch(people.owner, { posting: 'owner' })).status).toBe(200)
      expect((await send(people.writer, chat, postOf('may I?'))).results[0]).toMatchObject({
        refused: 'posting',
      })
      expect((await send(people.reader, chat, postOf('and I?'))).results[0]).toMatchObject({
        refused: 'role',
      })
      expect((await send(people.owner, chat, postOf('announcement'))).results[0]?.id).toBeTruthy()

      at(202_000)
      await fire(logs.of(chat))
      expect((await list(people.writer))[0]?.meta).toEqual({
        topic: 'Chapters',
        posting: 'owner',
        slowmode: 0,
      })
      expect((await state(people.writer, chat)).meta.topic).toBe('Chapters')
    })

    test('slowmode holds a writer, not the owner', async () => {
      const chat = await chatOfOwner()
      await call(env, `/v2/chats/${chat}`, {
        method: 'PATCH',
        token: people.owner,
        body: { slowmode: 30 },
      })
      expect((await send(people.writer, chat, postOf('one'))).results[0]?.id).toBeTruthy()
      expect((await send(people.writer, chat, postOf('two'))).results[0]).toMatchObject({
        refused: 'slow',
      })
      expect((await send(people.owner, chat, postOf('a'), postOf('b'))).results).toHaveLength(2)
      at(231_000)
      expect((await send(people.writer, chat, postOf('three'))).results[0]).toMatchObject({
        seq: expect.any(Number),
      })
    })

    test('a resend is the same event, answered with the place it already has', async () => {
      const chat = await chatOfOwner()
      const post = postOf('once')
      const first = await send(people.writer, chat, post)
      at(205_000)
      const again = await send(people.writer, chat, post)
      expect(again.results).toEqual(first.results)
      expect((await events(people.owner, chat)).events).toHaveLength(1)
    })

    test('a body with an event that does not check is refused whole', async () => {
      const chat = await chatOfOwner()
      const bad = await send(people.writer, chat, postOf('fine'), { kind: 'post', id: id() })
      expect(bad.status).toBe(400)
      expect((await events(people.owner, chat)).events).toEqual([])
    })

    test('reactions and votes are sets per person, and a poll stops at its end', async () => {
      const chat = await chatOfOwner()
      const poll = postOf('', {
        poll: { question: 'When?', answers: ['Mon', 'Tue'], several: false, ends: T0 + 300_000 },
      })
      await send(people.owner, chat, poll)
      const react = (on: boolean) => ({
        kind: 'react',
        id: id(),
        target: poll.message,
        emoji: '👍',
        on,
      })
      const vote = (answers: number[]) => ({
        kind: 'vote',
        id: id(),
        target: poll.message,
        answers,
      })

      await send(people.writer, chat, react(true), react(true), vote([1]))
      await send(people.guestWriter, chat, react(true), vote([0]))
      await send(people.writer, chat, react(false))
      expect((await send(people.writer, chat, vote([0, 1]))).results[0]).toMatchObject({
        refused: 'invalid',
      })
      expect((await send(people.reader, chat, react(true))).results[0]).toMatchObject({
        refused: 'role',
      })

      const [message] = (await state(people.owner, chat)).messages
      expect(message?.reactions).toEqual({ '👍': [`guest:${ids.guestWriter}`] })
      expect(message?.poll?.votes).toEqual({
        [`user:${ids.writer}`]: [1],
        [`guest:${ids.guestWriter}`]: [0],
      })

      at(400_000)
      expect((await send(people.writer, chat, vote([0]))).results[0]).toMatchObject({
        refused: 'gone',
      })
    })

    test('ten posts in ten seconds is the most one person sends', async () => {
      const chat = await chatOfOwner()
      const posts = Array.from({ length: 11 }, (_, at) => postOf(`burst ${at}`))
      const { results } = await send(people.writer, chat, ...posts)
      expect(results.slice(0, 10).every((one) => 'seq' in one)).toBe(true)
      expect(results[10]).toMatchObject({ refused: 'rate' })
      at(211_000)
      expect((await send(people.writer, chat, postOf('later'))).results[0]).toMatchObject({
        seq: expect.any(Number),
      })
    })

    test('a reply moves its message’s count, and needs a message to answer', async () => {
      const chat = await chatOfOwner()
      const top = postOf('top')
      await send(people.owner, chat, top)
      expect(
        (await send(people.writer, chat, postOf('under', { parent: top.message }))).results[0],
      ).toMatchObject({ seq: 2 })
      expect(
        (await send(people.writer, chat, postOf('nowhere', { parent: 'msg-missing' }))).results[0],
      ).toMatchObject({ refused: 'gone' })
      const page = await state(people.owner, chat)
      expect(page.messages.find((one) => one.id === top.message)?.replies).toBe(1)
    })
  })

  describe('live', () => {
    test('a post reaches every other socket, and its sender hears its place', async () => {
      const chat = await chatOfOwner()
      const owner = await socketOf('owner', chat)
      const writer = await socketOf('writer', chat)
      owner.take()
      writer.take()

      const post = postOf('live')
      await say(logs.of(chat), writer, { t: 'send', event: post })
      expect(writer.take()).toEqual([{ t: 'placed', id: post.id, seq: 1, at: T0 + 200_000 }])
      const [heard] = owner.takeOf('events')
      expect(heard?.events).toMatchObject([
        { kind: 'post', id: post.id, body: 'live', seq: 1, author: `user:${ids.writer}` },
      ])
    })

    test('a device catches up from the seq it holds, or is told it is too far behind', async () => {
      const chat = await chatOfOwner()
      await send(people.owner, chat, postOf('one'), postOf('two'), postOf('three'))
      const again = await socketOf('writer', chat, 1)
      expect(again.takeOf('events')[0]?.events.map((one) => one.seq)).toEqual([2, 3])

      logs.of(chat).state.db
        .exec(`with recursive n(i) as (select 4 union all select i + 1 from n where i < ${MOST_BEHIND + 4})
        insert into events (seq, id, kind, author, at, body)
        select i, 'filler' || i, 'meta', 'user:x', 1, '{"kind":"meta","id":"x","topic":""}' from n`)
      const behind = await socketOf('writer', chat, 1)
      expect(behind.takeOf('behind')).toEqual([{ t: 'behind', seq: MOST_BEHIND + 4 }])
    })

    test('a reader’s socket is refused a post, and types nothing', async () => {
      const chat = await chatOfOwner()
      const reader = await socketOf('reader', chat)
      const owner = await socketOf('owner', chat)
      reader.take()
      owner.take()
      const post = postOf('sneaky')
      await say(logs.of(chat), reader, { t: 'send', event: post })
      expect(reader.take()).toEqual([{ t: 'refused', id: post.id, error: 'role' }])
      await say(logs.of(chat), reader, { t: 'typing' })
      expect(owner.take()).toEqual([])
      await say(logs.of(chat), reader, 'not a frame')
      expect(reader.take()).toEqual([{ t: 'refused', id: null, error: 'invalid' }])
    })

    test('typing is relayed at most every three seconds and never stored', async () => {
      const chat = await chatOfOwner()
      const owner = await socketOf('owner', chat)
      const writer = await socketOf('writer', chat)
      owner.take()
      await say(logs.of(chat), writer, { t: 'typing' })
      await say(logs.of(chat), writer, { t: 'typing' })
      expect(owner.take()).toEqual([{ t: 'typing', who: `user:${ids.writer}` }])
      at(203_100)
      await say(logs.of(chat), writer, { t: 'typing', parent: 'msg00000001' })
      expect(owner.take()).toEqual([
        { t: 'typing', who: `user:${ids.writer}`, parent: 'msg00000001' },
      ])
    })

    test('who is here is said as people come and go', async () => {
      const chat = await chatOfOwner()
      const owner = await socketOf('owner', chat)
      await socketOf('writer', chat)
      const writer = logs.of(chat).state.getWebSockets(`user:${ids.writer}`)[0]
      expect(owner.takeOf('here').at(-1)?.who.sort()).toEqual(
        [`user:${ids.owner}`, `user:${ids.writer}`].sort(),
      )
      if (writer) await hangUp(logs.of(chat), writer)
      expect(owner.takeOf('here').at(-1)?.who).toEqual([`user:${ids.owner}`])
    })

    test('read places follow the reader’s devices, and everybody sees them in a small chat', async () => {
      const chat = await chatOfOwner()
      await send(people.owner, chat, postOf('one'), postOf('two'))
      const owner = await socketOf('owner', chat)
      const laptop = await socketOf('writer', chat)
      const phone = await socketOf('writer', chat)
      for (const one of [owner, laptop, phone]) one.take()

      await say(logs.of(chat), laptop, { t: 'read', seq: 2 })
      const read = { t: 'read', who: `user:${ids.writer}`, seq: 2 }
      expect(phone.take()).toEqual([read])
      expect(owner.take()).toEqual([read])
      expect(laptop.take()).toEqual([])

      // A device arriving later is told where everybody has read to.
      const late = await socketOf('reader', chat)
      expect(late.takeOf('read')).toContainEqual(read)
    })

    test('taking somebody out closes their socket', async () => {
      const chat = await chatOfOwner()
      const writer = await socketOf('writer', chat)
      const reader = await socketOf('reader', chat)
      expect(env.db.prepare('select count(*) as n from chat_sockets').get()).toEqual({ n: 2 })

      await call(env, `/v1/spaces/${spaceId}/share/members/writer@example.com`, {
        method: 'DELETE',
        token: people.owner,
      })
      expect(writer.closed).toBe(true)
      expect(writer.closedWith?.code).toBe(1008)
      expect(reader.closed).toBe(false)
      expect(env.db.prepare('select count(*) as n from chat_sockets').get()).toEqual({ n: 1 })
    })

    test('a writer taken down to reading keeps the socket and posts no more', async () => {
      const chat = await chatOfOwner()
      const writer = await socketOf('writer', chat)
      await call(env, `/v1/spaces/${spaceId}/share/members/writer@example.com`, {
        method: 'PATCH',
        token: people.owner,
        body: { role: 'read' },
      })
      writer.take()
      const post = postOf('still?')
      await say(logs.of(chat), writer, { t: 'send', event: post })
      expect(writer.closed).toBe(false)
      expect(writer.take()).toEqual([{ t: 'refused', id: post.id, error: 'role' }])
    })

    test('a guest taken out is closed out by the id the link gave them', async () => {
      const chat = await chatOfOwner()
      const socket = await socketOf('guestWriter', chat)
      await call(env, `/v1/spaces/${spaceId}/share/guests/${ids.guestWriter}`, {
        method: 'DELETE',
        token: people.owner,
      })
      expect(socket.closed).toBe(true)
    })
  })

  describe('counted and poked', () => {
    test('mentions count until read, and the listing says so within a second', async () => {
      const chat = await chatOfOwner()
      await send(people.owner, chat, postOf('look', { mentions: [`user:${ids.writer}`] }))
      at(201_000)
      await fire(logs.of(chat))

      expect((await list(people.writer))[0]).toMatchObject({
        id: chat,
        lastSeq: 1,
        lastAt: T0 + 200_000,
        lastBy: `user:${ids.owner}`,
        readSeq: 0,
        mentions: 1,
      })
      // The author read what they wrote.
      expect((await list(people.owner))[0]).toMatchObject({ readSeq: 1, mentions: 0 })

      const read = await call(env, `/v2/chats/${chat}/read`, {
        token: people.writer,
        body: { seq: 1 },
      })
      expect(read.status).toBe(200)
      at(203_000)
      await fire(logs.of(chat))
      expect((await list(people.writer))[0]).toMatchObject({ readSeq: 1, mentions: 0 })

      // Mark unread moves it back only when asked to.
      await call(env, `/v2/chats/${chat}/read`, { token: people.writer, body: { seq: 0 } })
      await call(env, `/v2/chats/${chat}/read`, {
        token: people.writer,
        body: { seq: 0, back: true },
      })
      at(205_000)
      await fire(logs.of(chat))
      expect((await list(people.writer))[0]).toMatchObject({ readSeq: 0 })
    })

    test('a reply calls whoever it answers, and @everyone calls everybody', async () => {
      const chat = await chatOfOwner()
      const top = postOf('question')
      await send(people.writer, chat, top)
      await send(people.owner, chat, postOf('answer', { parent: top.message }))
      await send(people.guestWriter, chat, postOf('all of you', { mentions: ['everyone'] }))
      at(201_000)
      await fire(logs.of(chat))
      expect((await list(people.writer))[0]).toMatchObject({ mentions: 2 })
      expect((await list(people.reader))[0]).toMatchObject({ mentions: 1 })
      expect((await list(people.guestWriter))[0]).toMatchObject({ mentions: 0 })
    })

    test('people with no socket open are poked through their hub, two seconds apart', async () => {
      const chat = await chatOfOwner()
      await socketOf('owner', chat)
      running.asked.length = 0
      const asks = () => running.asked.filter((one) => one.ask === 'chat')

      await send(people.owner, chat, postOf('first', { mentions: [`user:${ids.writer}`] }))
      expect(
        asks()
          .map((one) => one.id)
          .sort(),
      ).toEqual([ids.writer, ids.reader, ids.guestWriter, ids.guestReader].sort())
      expect(
        asks()
          .find((one) => one.id === ids.writer)
          ?.headers.get('x-nib-mention'),
      ).toBe('yes')
      expect(
        asks()
          .find((one) => one.id === ids.reader)
          ?.headers.get('x-nib-mention'),
      ).toBe('no')

      running.asked.length = 0
      at(200_500)
      await send(people.owner, chat, postOf('second'))
      at(201_000)
      await send(people.owner, chat, postOf('third'))
      expect(asks()).toEqual([])

      at(202_000)
      await fire(logs.of(chat))
      const coalesced = asks().filter((one) => one.id === ids.writer)
      expect(coalesced).toHaveLength(1)
      expect(coalesced[0]?.headers.get('x-nib-seq')).toBe('3')
    })

    test('a hub tells every device of the account, with no words', async () => {
      const chat = await chatOfOwner()
      const device = connect(running.of(ids.writer).hub, {
        device: 'device-laptop',
        who: ids.writer,
      })
      await send(people.owner, chat, postOf('secret words'))
      expect(device.take()).toEqual([
        { t: 'chat', chat, seq: 1, at: T0 + 200_000, by: `user:${ids.owner}`, mention: false },
      ])
    })
  })

  describe('scheduled', () => {
    test('a post held for its time goes as its author then, and can be taken back before', async () => {
      const chat = await chatOfOwner()
      const later = postOf('good morning')
      const kept = { kind: 'schedule', id: id(), sendAt: T0 + 260_000, post: later }
      expect((await send(people.writer, chat, kept)).results[0]).toEqual({
        id: kept.id,
        seq: 0,
        at: T0 + 260_000,
      })
      const listed = await call<{ scheduled: { id: string }[] }>(
        env,
        `/v2/chats/${chat}/scheduled`,
        { token: people.writer },
      )
      expect(listed.json.scheduled.map((one) => one.id)).toEqual([kept.id])
      expect((await events(people.owner, chat)).events).toEqual([])
      expect(logs.of(chat).state.alarm).toBe(T0 + 260_000)

      at(260_000)
      await fire(logs.of(chat))
      expect((await events(people.owner, chat)).events).toMatchObject([
        { id: later.id, author: `user:${ids.writer}` },
      ])

      const another = postOf('never mind')
      await send(people.writer, chat, {
        kind: 'schedule',
        id: id(),
        sendAt: T0 + 900_000,
        post: another,
      })
      const taken = await send(people.writer, chat, {
        kind: 'delete',
        id: id(),
        target: another.message,
      })
      expect(taken.results[0]).toMatchObject({ seq: 0 })
      const left = await call<{ scheduled: unknown[] }>(env, `/v2/chats/${chat}/scheduled`, {
        token: people.writer,
      })
      expect(left.json.scheduled).toEqual([])
    })

    test('one whose author lost the space stays, refused', async () => {
      const chat = await chatOfOwner()
      const later = postOf('from the past')
      await send(people.writer, chat, {
        kind: 'schedule',
        id: id(),
        sendAt: T0 + 260_000,
        post: later,
      })
      await call(env, `/v1/spaces/${spaceId}/share/members/writer@example.com`, {
        method: 'DELETE',
        token: people.owner,
      })
      at(260_000)
      await fire(logs.of(chat))
      expect((await events(people.owner, chat)).events).toEqual([])
      expect(logs.of(chat).state.db.prepare('select refused from scheduled').get()).toEqual({
        refused: 'role',
      })
    })
  })

  describe('search', () => {
    test('words as prefixes and modifiers, in one chat and across them, newest first', async () => {
      await call(env, '/v1/me', { method: 'PATCH', token: people.writer, body: { name: 'Lucile' } })
      const thesis = await chatOfOwner()
      const other = await chatOfOwner()
      await send(people.owner, thesis, postOf('the figures look off on page four'))
      await send(people.writer, thesis, postOf('reading it tonight https://example.org'))
      at(200_500)
      await send(people.owner, other, postOf('figure it out tonight'))

      const find = async (chat: string, q: string, token = people.reader) =>
        (
          await call<{ hits: { body: string }[] }>(
            env,
            `/v2/chats/${chat}/search?q=${encodeURIComponent(q)}`,
            { token },
          )
        ).json.hits.map((hit) => hit.body)

      expect(await find(thesis, 'fig')).toEqual(['the figures look off on page four'])
      expect(await find(thesis, 'from:@Lucile')).toEqual(['reading it tonight https://example.org'])
      expect(await find(thesis, 'has:link')).toEqual(['reading it tonight https://example.org'])
      expect(await find(thesis, 'tonight -reading')).toEqual([])

      const across = await call<{ hits: { chat: string; message: { body: string } }[] }>(
        env,
        '/v2/chats/search?q=tonight',
        { token: people.guestReader },
      )
      expect(across.json.hits.map((hit) => hit.chat)).toEqual([other, thesis])
      const outside = await call<{ hits: unknown[] }>(env, '/v2/chats/search?q=tonight', {
        token: people.stranger,
      })
      expect(outside.json.hits).toEqual([])
    })

    test('an edited message is found by its new words and not its old', async () => {
      const chat = await chatOfOwner()
      const post = postOf('draft wording')
      await send(people.owner, chat, post)
      await send(people.owner, chat, {
        kind: 'edit',
        id: id(),
        target: post.message,
        body: 'final text',
      })
      const count = async (q: string) =>
        (
          await call<{ hits: unknown[] }>(env, `/v2/chats/${chat}/search?q=${q}`, {
            token: people.owner,
          })
        ).json.hits.length
      expect(await count('draft')).toBe(0)
      expect(await count('final')).toBe(1)
    })
  })

  describe('files', () => {
    async function upload(token: string, bytes: Uint8Array): Promise<string> {
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const hash = [...new Uint8Array(digest)]
        .map((one) => one.toString(16).padStart(2, '0'))
        .join('')
      const put = await call(env, `/v2/blobs/${hash}`, {
        method: 'PUT',
        token,
        raw: bytes,
        headers: { 'content-type': 'image/png' },
      })
      expect(put.status).toBeLessThan(300)
      return hash
    }

    const file = (hash: string) => ({ hash, name: 'figure.png', size: 4, type: 'image/png' })

    test('are named only once their bytes are there, and fetched by members alone', async () => {
      const chat = await chatOfOwner()
      const refused = await send(
        people.writer,
        chat,
        postOf('look', { files: [file('f'.repeat(64))] }),
      )
      expect(refused.results[0]).toMatchObject({ refused: 'invalid' })

      const hash = await upload(people.writer, new Uint8Array([1, 2, 3, 4]))
      const post = postOf('look', { files: [file(hash)] })
      expect((await send(people.writer, chat, post)).results[0]).toMatchObject({ seq: 1 })

      const read = await call(env, `/v2/chats/${chat}/files/${hash}`, { token: people.guestReader })
      expect(read.status).toBe(200)
      expect(read.text).toBe('\u0001\u0002\u0003\u0004')
      const outside = await call(env, `/v2/chats/${chat}/files/${hash}`, { token: people.stranger })
      expect(outside.status).toBe(404)

      await send(people.writer, chat, { kind: 'delete', id: id(), target: post.message })
      const gone = await call(env, `/v2/chats/${chat}/files/${hash}`, { token: people.owner })
      expect(gone.status).toBe(404)
    })

    test('a guest holds no blobs, so attaches none', async () => {
      const chat = await chatOfOwner()
      const hash = await upload(people.owner, new Uint8Array([9]))
      const post = postOf('mine now', { files: [file(hash)] })
      expect((await send(people.guestWriter, chat, post)).results[0]).toMatchObject({
        refused: 'invalid',
      })
    })
  })

  describe('its pointer, on sync v1', () => {
    test('a v1 account makes a chat, writes its pointer, posts and lists it', async () => {
      const chat = await chatOfOwner()
      const file = await chatFile('Thesis.chat', chatText({ v: 1, chat }))
      expect(env.db.prepare('select file_id from chats where id = ?').get(chat)).toEqual({
        file_id: file,
      })
      // The writer's v1 device reads the pointer through the v1 feed and opens the chat.
      const feed = await call(env, `/v1/spaces/${spaceId}/changes`, { token: people.writer })
      expect(feed.json.notes.map((one) => one.path)).toContain('Thesis.chat')
      expect((await send(people.writer, chat, postOf('from v1'))).results[0]).toMatchObject({
        seq: 1,
      })
      expect((await list(people.writer)).map((one) => one.id)).toEqual([chat])
    })

    test('a pointer copied into another space reaches nothing for its people', async () => {
      const chat = await chatOfOwner()
      await chatFile('Thesis.chat', chatText({ v: 1, chat }))
      const elsewhere = (
        await call(env, '/v1/spaces', { token: people.stranger, body: { name: 'Mine' } })
      ).json.space.id
      const copy = await call(env, `/v1/spaces/${elsewhere}/notes`, {
        token: people.stranger,
        body: { path: 'Copied.chat', content: chatText({ v: 1, chat }) },
      })
      expect(copy.status).toBe(201)
      expect((await call(env, `/v2/chats/${chat}/events`, { token: people.stranger })).status).toBe(
        404,
      )
      expect(await list(people.stranger)).toEqual([])
      // And the copy is not the chat's file.
      expect(env.db.prepare('select file_id from chats where id = ?').get(chat)).not.toEqual({
        file_id: copy.json.note.id,
      })
    })

    test('a private chat is its pointer shared on its own', async () => {
      const team = await chatOfOwner()
      const secret = await chatOfOwner()
      const file = await chatFile('Private.chat', chatText({ v: 1, chat: secret }))
      await call(env, `/v1/spaces/${spaceId}/share/invite?item=${file}`, {
        token: people.owner,
        body: { email: 'stranger@example.com', role: 'write' },
      })
      expect((await list(people.stranger)).map((one) => [one.id, one.role])).toEqual([
        [secret, 'write'],
      ])
      expect((await send(people.stranger, secret, postOf('hi'))).results[0]).toMatchObject({
        seq: 1,
      })
      expect((await send(people.stranger, team, postOf('hi'))).status).toBe(404)
    })

    test('a pointer in Recently deleted is still the chat; purged, the chat ends a month on', async () => {
      const chat = await chatOfOwner()
      const file = await chatFile('Thesis.chat', chatText({ v: 1, chat }))
      await send(people.owner, chat, postOf('kept'))
      await call(env, `/v1/notes/${file}`, { method: 'DELETE', token: people.owner })
      expect((await events(people.owner, chat)).events).toHaveLength(1)

      env.db.prepare('delete from notes where id = ?').run(file)
      await sweepChats(env, T0 + 300_000)
      expect(await list(people.owner)).toEqual([])
      expect(await sweepChats(env, T0 + 300_000 + 29 * 86_400_000)).toBe(0)
      expect(await sweepChats(env, T0 + 300_000 + 31 * 86_400_000)).toBe(1)
      expect(env.db.prepare('select count(*) as n from chats').get()).toEqual({ n: 0 })

      await sweepLeftovers(env)
      expect(env.db.prepare('select count(*) as n from leftovers').get()).toEqual({ n: 0 })
      const tables = logs
        .of(chat)
        .state.db.prepare("select count(*) as n from sqlite_master where type = 'table'")
        .get()
      expect(tables).toEqual({ n: 0 })
    })

    test('a pointer is never a room', async () => {
      const chat = await chatOfOwner()
      const file = await chatFile('Thesis.chat', chatText({ v: 1, chat }))
      const knock = await call(env, `/rooms/${file}`, {
        headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(people.owner) },
      })
      expect(knock.status).toBe(404)
    })
  })

  describe('Move to space', () => {
    test('takes the history along and changes who reaches it', async () => {
      const chat = await chatOfOwner()
      await send(people.writer, chat, postOf('before the move'))
      const writer = await socketOf('writer', chat)
      const elsewhere = (
        await call(env, '/v1/spaces', { token: people.owner, body: { name: 'Private' } })
      ).json.space.id

      const refused = await call(env, `/v2/chats/${chat}`, {
        method: 'PATCH',
        token: people.writer,
        body: { space: elsewhere },
      })
      expect(refused.status).toBe(404)

      const moved = await call(env, `/v2/chats/${chat}`, {
        method: 'PATCH',
        token: people.owner,
        body: { space: elsewhere },
      })
      expect(moved.status).toBe(200)
      expect(writer.closed).toBe(true)
      expect((await call(env, `/v2/chats/${chat}/events`, { token: people.writer })).status).toBe(
        404,
      )
      expect((await events(people.owner, chat)).events).toHaveLength(1)
      expect((await list(people.owner)).map((one) => one.space)).toEqual([elsewhere])
    })
  })

  describe('notifications', () => {
    test('what pings is the person’s per chat, and every device reads it back', async () => {
      const chat = await chatOfOwner()
      const set = await call<{ notify: string; mutedUntil: number }>(env, `/v2/chats/${chat}/me`, {
        method: 'PUT',
        token: people.reader,
        body: { notify: 'mentions', mutedUntil: T0 + 3_600_000 },
      })
      expect(set.json).toEqual({ notify: 'mentions', mutedUntil: T0 + 3_600_000 })
      await call(env, `/v2/chats/${chat}/me`, {
        method: 'PUT',
        token: people.reader,
        body: { mutedUntil: null },
      })
      expect((await list(people.reader))[0]).toMatchObject({ notify: 'mentions', mutedUntil: null })
      const wrong = await call(env, `/v2/chats/${chat}/me`, {
        method: 'PUT',
        token: people.reader,
        body: { notify: 'sometimes' },
      })
      expect(wrong.status).toBe(400)
    })
  })

  describe('the door', () => {
    test('lets in whoever reaches the chat, and says at what role', async () => {
      const chat = await chatOfOwner()
      const door = doorway()
      env.CHATS = door.ROOMS
      const knock = (token: string) =>
        call(env, `/v2/chats/${chat}/socket`, {
          headers: {
            upgrade: 'websocket',
            'sec-websocket-protocol': `${subprotocol(token)}, nib.device.device-one`,
          },
        })

      for (const [who, role] of [
        ['owner', 'owner'],
        ['writer', 'write'],
        ['reader', 'read'],
        ['guestWriter', 'write'],
        ['guestReader', 'read'],
      ] as const) {
        expect((await knock(people[who])).status, who).toBe(200)
        const told = door.asked.at(-1)
        expect(told?.get('x-nib-role'), who).toBe(role)
        expect(told?.get('x-nib-chat-ask'), who).toBe('join')
        expect(told?.get('x-nib-space'), who).toBe(spaceId)
        expect(told?.get('x-nib-device'), who).toBe('device-one')
      }
      expect((await knock(people.stranger)).status).toBe(404)
      expect((await knock('not-a-session')).status).toBe(401)
    })
  })
})
