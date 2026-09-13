import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { type Canvas, type InkStroke, readCanvas, writeCanvas } from '@nib/markdown/canvas'
import { stamped } from '@nib/markdown/canvas-merge'
import { awarenessUpdate, receive, subprotocol, syncStep1, syncUpdate, TEXT } from '@nib/rooms'
import { pushPlane, readPlane } from '@nib/rooms/plane'
import * as Y from 'yjs'
import { roomsRevoked } from '../src/rooms'
import { writesOf } from '../src/rooms/kind'
import { NoteRoom } from '../src/rooms/room'
import { call, signIn, type ShareView, type TestEnv, testEnv } from './harness'
import { doorway, FakeSocket, type FakeState, join, room, running, say } from './room'

/** What the note holds before anybody writes in it. */
const OPENING = '# Together\n'

/** A device in a room, the way the app's client is one: its own document, its own
 *  awareness, and the same protocol run over whatever the room says. */
class Device {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)
  readonly text = this.doc.getText(TEXT)

  constructor(readonly socket: FakeSocket) {}

  get words(): string {
    return this.text.toJSON()
  }

  /** What this device would send after typing: the update its own document made. */
  type(at: number, words: string): Uint8Array {
    const before = Y.encodeStateVector(this.doc)
    this.text.insert(at, words)
    return syncUpdate(Y.encodeStateAsUpdate(this.doc, before))
  }
}

/** A device joining, through the whole handshake: the room says what it holds and
 *  who is in it, the device says what it holds, and both catch up. */
async function arrive(
  made: NoteRoom,
  state: FakeState,
  note: { id: string; spaceId: string },
): Promise<Device> {
  const device = new Device(await join(made, note))
  await say(made, state, device.socket, syncStep1(device.doc))
  await settle(made, state, [device])
  return device
}

/** Everything waiting on the wire, in both directions, until nothing is left. */
async function settle(made: NoteRoom, state: FakeState, devices: readonly Device[]) {
  for (let round = 0; round < 12; round++) {
    let moved = false

    for (const device of devices) {
      for (const message of device.socket.take()) {
        moved = true
        const answer = receive(message, device.doc, device.awareness, 'room')
        if (answer) await say(made, state, device.socket, answer)
      }
    }

    if (!moved) return
  }

  throw new Error('the room and the devices never stopped talking')
}

describe('a room', () => {
  let env: TestEnv
  let token: string
  let spaceId: string
  let noteId: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'writer@example.com')

    const space = await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })
    spaceId = space.json.space.id

    const note = await call(env, `/v1/spaces/${spaceId}/notes`, {
      token,
      body: { path: 'together.md', content: '# Together\n' },
    })
    noteId = note.json.note.id
  })

  afterEach(() => env.close())

  test('opens on the note as the store holds it', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    expect(one.words).toBe('# Together\n')
  })

  test('carries what one device types to the other', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    const two = await arrive(made, state, { id: noteId, spaceId })

    await say(made, state, one.socket, one.type(11, 'from one\n'))
    await settle(made, state, [one, two])

    expect(two.words).toBe('# Together\nfrom one\n')
  })

  test('settles two devices typing in the same place into one text', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    const two = await arrive(made, state, { id: noteId, spaceId })

    // Both write at the end of the same line before either has heard the other.
    const first = one.type(11, 'one\n')
    const second = two.type(11, 'two\n')

    await say(made, state, one.socket, first)
    await say(made, state, two.socket, second)
    await settle(made, state, [one, two])

    expect(one.words).toBe(two.words)
    expect(one.words).toContain('one')
    expect(one.words).toContain('two')
  })

  test('keeps both when one device was away while the other wrote', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.type(11, 'written here\n'))
    await settle(made, state, [one])

    // A device that had the note open all along, offline, and now reconnects.
    const away = new Device(new FakeSocket())
    Y.applyUpdate(away.doc, Y.encodeStateAsUpdate(one.doc))
    const alone = away.type(away.words.length, 'written there\n')

    const back = await arrive(made, state, { id: noteId, spaceId })
    Y.applyUpdate(back.doc, Y.encodeStateAsUpdate(away.doc))
    await say(made, state, back.socket, alone)
    await settle(made, state, [one, back])

    expect(back.words).toContain('written here')
    expect(back.words).toContain('written there')
    expect(one.words).toBe(back.words)
  })

  describe('a note something wrote without going through the room', () => {
    /** The exact sequence that lost somebody's paragraph, as requests.
     *
     *  Two devices with one note open. The first can reach the account but not its
     *  room - every network that allows HTTPS and blocks WebSockets - so the file is
     *  the only way its words travel, and it pushes the whole file naming the version
     *  it read. Nothing about that push is wrong: the account takes it. But the room
     *  is still holding words of its own, and its settle is a whole-file write too. It
     *  used to write straight over the push, and every word in it that the room did
     *  not have went with it - out of the account, and then out of the pushing
     *  device's own disk on its next pass, with nothing said and no copy anywhere.
     *
     *  So the settle keeps what it is about to stop holding, under the same name the
     *  app gives such a copy; see `keptBeside` in src/rooms/room.ts. */
    async function overwritten() {
      const { room: made, state } = room(env)
      const inside = await arrive(made, state, { id: noteId, spaceId })

      // Somebody in the room types, and the room settles it: version 2.
      await say(made, state, inside.socket, inside.type(11, 'from the room\n'))
      await made.alarm()

      const held = await call(env, `/v1/notes/${noteId}`, { token })
      expect(held.json.note.version).toBe(2)

      // The device that cannot reach the room pushes the file it holds, naming the
      // version it last read. Its own line, and not the room's, because it never
      // heard the room.
      const pushed = await call(env, `/v1/notes/${noteId}`, {
        token,
        method: 'PUT',
        body: {
          path: 'together.md',
          content: '# Together\nfrom the other device\n',
          baseVersion: 2,
        },
      })
      expect(pushed.status).toBe(200)
      expect(pushed.json.note.version).toBe(3)

      // And the person in the room carries on typing, which is the settle that used
      // to write over it.
      await say(made, state, inside.socket, inside.type(inside.words.length, 'and more\n'))
      await made.alarm()

      return { made, state, inside }
    }

    test('is kept beside the note when the room settles over it', async () => {
      await overwritten()

      const page = await call(env, `/v1/spaces/${spaceId}/changes?since=0`, { token })
      const notes = (page.json.notes as { id: string; path: string }[]).filter(
        (one) => one.path !== 'together.md',
      )

      expect(notes).toHaveLength(1)
      expect(notes[0]?.path).toMatch(/^together \(from another device \d{4}-\d\d-\d\d\)\.md$/)

      const beside = await call(env, `/v1/notes/${notes[0]?.id}`, { token })
      expect(beside.json.content).toBe('# Together\nfrom the other device\n')
    })

    test('and the room&apos;s own words are what the note ends up holding', async () => {
      await overwritten()

      const read = await call(env, `/v1/notes/${noteId}`, { token })
      expect(read.json.content).toBe('# Together\nfrom the room\nand more\n')
    })

    test('is copied once however many times the same words are offered again', async () => {
      const { made, state, inside } = await overwritten()

      // A device whose room it cannot reach offers the same file on every pass until
      // somebody looks at it. A second copy of a copy says nothing the first did not.
      for (const line of ['once more\n', 'and again\n']) {
        await call(env, `/v1/notes/${noteId}`, {
          token,
          method: 'PUT',
          body: {
            path: 'together.md',
            content: '# Together\nfrom the other device\n',
            baseVersion: (await call(env, `/v1/notes/${noteId}`, { token })).json.note.version,
          },
        })

        await say(made, state, inside.socket, inside.type(inside.words.length, line))
        await made.alarm()
      }

      const page = await call(env, `/v1/spaces/${spaceId}/changes?since=0`, { token })
      const notes = (page.json.notes as { path: string; deleted?: boolean }[]).filter(
        (one) => !one.deleted && one.path !== 'together.md',
      )

      expect(notes).toHaveLength(1)
    })

    test('settles as it always did when nothing else has written the note', async () => {
      const { room: made, state } = room(env)
      const one = await arrive(made, state, { id: noteId, spaceId })

      await say(made, state, one.socket, one.type(11, 'one\n'))
      await made.alarm()
      await say(made, state, one.socket, one.type(one.words.length, 'two\n'))
      await made.alarm()

      const page = await call(env, `/v1/spaces/${spaceId}/changes?since=0`, { token })
      expect(page.json.notes).toHaveLength(1)

      const read = await call(env, `/v1/notes/${noteId}`, { token })
      expect(read.json.content).toBe('# Together\none\ntwo\n')
      expect(read.json.note.version).toBe(3)
    })
  })

  test('writes the words into the note store when the typing stops', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    await say(made, state, one.socket, one.type(11, 'settled\n'))
    expect(state.takeAlarm()).not.toBeNull()

    await made.alarm()

    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.content).toBe('# Together\nsettled\n')
    // An ordinary save: the version moved on, so every device that is not in the
    // room reads it as an edit made somewhere else.
    expect(read.json.note.version).toBe(2)
  })

  /** The versions of a note, newest first. */
  function versionsOf(id: string): { by: string }[] {
    return env.db
      .prepare('select by from note_versions where note_id = ? order by at desc')
      .all(id) as { by: string }[]
  }

  /** A note keeps a version from the moment it was made, and another is only kept
   *  once that one is old enough to be worth a second; see `keepVersion`. So the one
   *  it arrived with is aged out of the way, which is what every other test of the
   *  versions does. */
  function longAgo() {
    env.db.exec('update note_versions set at = at - 600000')
  }

  /** Which device a version of a note says it came from.
   *
   *  Every other way a note is written names the device in a header, and the history
   *  sheet puts that name beside the moment. A settle named nobody, so a note being
   *  written in together - the one kind of note whose versions arrive thickest - had
   *  a history of blank rows. The room knows: what a device calls itself is what it
   *  announced to everybody else in the room, and which of them was typing is
   *  whoever's update put this settle on the clock. */
  test('says which device was typing when it settled', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    longAgo()
    one.awareness.setLocalStateField('who', { name: 'Ada’s Mac', accent: 'violet' })
    await say(made, state, one.socket, awarenessUpdate(one.awareness, [one.doc.clientID]))
    await say(made, state, one.socket, one.type(11, 'typed here\n'))
    await made.alarm()

    const kept = versionsOf(noteId)
    expect(kept[0]?.by).toBe('Ada’s Mac')
  })

  test('and names the one of them who was typing, not the room', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    const two = await arrive(made, state, { id: noteId, spaceId })

    longAgo()
    for (const [device, who] of [
      ['Ada’s Mac', one],
      ['Bella’s phone', two],
    ] as const) {
      who.awareness.setLocalStateField('who', { name: device, accent: 'violet' })
      await say(made, state, who.socket, awarenessUpdate(who.awareness, [who.doc.clientID]))
    }
    await settle(made, state, [one, two])

    // The second of them types, and hers is the keystroke the settle is about.
    await say(made, state, two.socket, two.type(11, 'from the phone\n'))
    await made.alarm()

    const kept = versionsOf(noteId)
    expect(kept[0]?.by).toBe('Bella’s phone')
  })

  test('and names nobody when nothing in the room said what it was', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    longAgo()
    // A device that never announced itself: there is no name to put on the row, and
    // an invented one would be worse than none.
    await say(made, state, one.socket, one.type(11, 'from nowhere\n'))
    await made.alarm()

    const kept = versionsOf(noteId)
    expect(kept[0]?.by).toBe('')
  })

  test('writes nothing when the words did not change', async () => {
    const { room: made, state } = room(env)
    await arrive(made, state, { id: noteId, spaceId })

    await made.alarm()

    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.note.version).toBe(1)
  })

  test('settles when the last device leaves', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.type(11, 'and then away\n'))

    await made.webSocketClose(one.socket as unknown as WebSocket)

    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.content).toBe('# Together\nand then away\n')
  })

  test('folds the pile of updates into one snapshot', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    for (let at = 0; at < 240; at++) {
      await say(made, state, one.socket, one.type(11 + at, 'x'))
    }

    const kept = [...state.kept.keys()]
    expect(kept.filter((key) => key.startsWith('state:')).length).toBeGreaterThan(0)
    expect(kept.filter((key) => key.startsWith('log:')).length).toBeLessThan(240)
  })

  test('reads itself back after the runtime has put it to sleep', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.type(11, 'slept on it\n'))
    // The settle is where what arrived reaches storage; see `record` in state.ts.
    await made.alarm()

    // A second room over the same storage is what waking up looks like: every
    // field is gone, and what matters came back out of the object.
    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    const back = await arrive(woken, state, { id: noteId, spaceId })

    expect(back.words).toBe('# Together\nslept on it\n')
  })

  test('asks the devices that were here for what it slept through', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    // Typed, and no settle: those keystrokes are in the room's memory and in this
    // device, and nowhere else.
    await say(made, state, one.socket, one.type(11, 'never written down\n'))
    one.socket.take()

    // The same storage, a new object, and the device still connected. Its greeting
    // is what asks the device to say what it has.
    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    await woken.webSocketMessage(
      one.socket as unknown as WebSocket,
      syncStep1(one.doc).slice().buffer,
    )
    await state.idle()
    await settle(woken, state, [one])

    await woken.alarm()
    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.content).toBe('# Together\nnever written down\n')
  })

  test('takes a caret away when its device leaves', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    const two = await arrive(made, state, { id: noteId, spaceId })

    one.awareness.setLocalStateField('user', { name: 'One' })
    await say(made, state, one.socket, awarenessUpdate(one.awareness, [one.doc.clientID]))
    await settle(made, state, [one, two])
    expect(two.awareness.getStates().has(one.doc.clientID)).toBe(true)

    await made.webSocketClose(one.socket as unknown as WebSocket)
    await settle(made, state, [two])

    expect(two.awareness.getStates().has(one.doc.clientID)).toBe(false)
  })
})

describe('a reader in a room', () => {
  let env: TestEnv
  let spaceId: string
  let noteId: string

  beforeEach(async () => {
    env = testEnv()
    const token = await signIn(env, 'owner@example.com')

    const space = await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })
    spaceId = space.json.space.id

    const note = await call(env, `/v1/spaces/${spaceId}/notes`, {
      token,
      body: { path: 'together.md', content: OPENING },
    })
    noteId = note.json.note.id
  })

  afterEach(() => env.close())

  /** A device the door let in to read and not to write; see rooms/index.ts. */
  async function reading(made: NoteRoom, state: FakeState): Promise<Device> {
    const device = new Device(await join(made, { id: noteId, spaceId }, false))
    await say(made, state, device.socket, syncStep1(device.doc))
    await settle(made, state, [device])
    return device
  }

  test('is given what the room holds', async () => {
    const { room: made, state } = room(env)
    const reader = await reading(made, state)

    expect(reader.words).toBe(OPENING)
  })

  test('sees what somebody else writes, as it is written', async () => {
    const { room: made, state } = room(env)
    const writer = await arrive(made, state, { id: noteId, spaceId })
    const reader = await reading(made, state)

    await say(made, state, writer.socket, writer.type(OPENING.length, 'a line'))
    await settle(made, state, [writer, reader])

    expect(reader.words).toBe(`${OPENING}a line`)
  })

  test('cannot write into it, and nobody else hears them try', async () => {
    const { room: made, state } = room(env)
    const writer = await arrive(made, state, { id: noteId, spaceId })
    const reader = await reading(made, state)
    writer.socket.take()

    await say(made, state, reader.socket, reader.type(0, 'not mine to write'))
    await settle(made, state, [writer])

    expect(writer.words).toBe(OPENING)
    expect(writer.socket.take()).toEqual([])
  })

  test('cannot write into it by having been away, either', async () => {
    // What a device that was closed sends to put its own words back is an
    // ordinary update, so it is refused in exactly the same way.
    const { room: made, state } = room(env)
    const reader = await reading(made, state)

    reader.text.insert(0, 'written while away')
    await say(made, state, reader.socket, syncStep1(reader.doc))
    await settle(made, state, [reader])

    const { room: again, state: theirs } = room(env)
    theirs.kept.set('note', { noteId, spaceId })
    const after = await arrive(again, theirs, { id: noteId, spaceId })
    expect(after.words).not.toContain('written while away')
  })

  test('leaves the note in the store as it was', async () => {
    const { room: made, state } = room(env)
    const reader = await reading(made, state)

    await say(made, state, reader.socket, reader.type(0, 'no'))
    await state.idle()
    await made.alarm()

    const token = await signIn(env, 'looking@example.com')
    // Read through the database, because the account that owns it has already
    // used its one code above and asking for a second inside the resend gap
    // gets none.
    env.db.exec(
      `insert into space_members (space_id, email, role, created_at)
       values ('${spaceId}', 'looking@example.com', 'read', 1)`,
    )
    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.content).toBe(OPENING)
  })

  test('still has a caret, which everybody else sees', async () => {
    const { room: made, state } = room(env)
    const writer = await arrive(made, state, { id: noteId, spaceId })
    const reader = await reading(made, state)

    reader.awareness.setLocalStateField('who', { name: 'Ada', accent: 'violet' })
    await say(made, state, reader.socket, awarenessUpdate(reader.awareness, [reader.doc.clientID]))
    await settle(made, state, [writer, reader])

    expect(writer.awareness.getStates().get(reader.doc.clientID)).toEqual({
      who: { name: 'Ada', accent: 'violet' },
    })
  })

  /** A socket's attachment has a hard ceiling of a couple of kilobytes and the
   *  list of what it announced only ever grew, so one message naming a few hundred
   *  carets took it past the ceiling - and the write that threw threw inside the
   *  handler for that message. Which is a room one client stops for everybody. */
  test('cannot make the room remember an unbounded list of carets', async () => {
    const { room: made, state } = room(env)
    const writer = await arrive(made, state, { id: noteId, spaceId })
    const reader = await reading(made, state)

    // Every caret announced at once, each from a document of its own, which is
    // what one hand-made awareness message can carry.
    const crowd = new Awareness(new Y.Doc())
    crowd.setLocalState(null)
    for (let one = 0; one < 400; one++) {
      const each = new Awareness(new Y.Doc())
      each.setLocalStateField('who', { name: `n${one}` })
      applyAwarenessUpdate(crowd, encodeAwarenessUpdate(each, [each.doc.clientID]), 'crowd')
    }

    const named = [...crowd.getStates().keys()]
    expect(named.length).toBeGreaterThan(300)
    await say(made, state, reader.socket, awarenessUpdate(crowd, named))
    await settle(made, state, [writer, reader])

    const kept = reader.socket.deserializeAttachment() as { clients: number[]; mayWrite: boolean }
    expect(kept.clients.length).toBeLessThanOrEqual(32)
    expect(JSON.stringify(kept).length).toBeLessThan(2048)
    // Still a reader, which is the other half of what the attachment carries.
    expect(kept.mayWrite).toBe(false)
  })

  test('forgets a caret its socket stopped announcing', async () => {
    const { room: made, state } = room(env)
    const writer = await arrive(made, state, { id: noteId, spaceId })
    const reader = await reading(made, state)

    reader.awareness.setLocalStateField('who', { name: 'Ada' })
    await say(made, state, reader.socket, awarenessUpdate(reader.awareness, [reader.doc.clientID]))
    await settle(made, state, [writer, reader])
    expect((reader.socket.deserializeAttachment() as { clients: number[] }).clients).toContain(
      reader.doc.clientID,
    )

    reader.awareness.setLocalState(null)
    await say(made, state, reader.socket, awarenessUpdate(reader.awareness, [reader.doc.clientID]))
    await settle(made, state, [writer, reader])

    expect((reader.socket.deserializeAttachment() as { clients: number[] }).clients).toEqual([])
  })
})

describe('the door to a room', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv()
  })

  afterEach(() => env.close())

  test('lets in whoever the space was shared with, and says what they may do', async () => {
    const door = doorway()
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    const owner = await signIn(env, 'owner@example.com')
    const space = await call(env, '/v1/spaces', { token: owner, body: { name: 'Notes' } })
    const spaceId = space.json.space.id
    const note = await call(env, `/v1/spaces/${spaceId}/notes`, {
      token: owner,
      body: { path: 'shared.md', content: 'together' },
    })
    const noteId = note.json.note.id

    const sessions: Record<string, string> = { owner }
    for (const role of ['write', 'read'] as const) {
      const email = `${role}@example.com`
      await call(env, `/v1/spaces/${spaceId}/share/invite`, { token: owner, body: { email, role } })
      sessions[role] = await signIn(env, email)
    }

    for (const [who, writes] of [
      ['owner', 'yes'],
      ['write', 'yes'],
      ['read', 'no'],
    ] as const) {
      const answer = await call(env, `/rooms/${noteId}`, {
        headers: {
          upgrade: 'websocket',
          'sec-websocket-protocol': subprotocol(sessions[who] ?? ''),
        },
      })

      expect(answer.status, who).toBe(200)
      expect(door.asked.at(-1)?.get('x-nib-write'), who).toBe(writes)
      expect(door.asked.at(-1)?.get('x-nib-space'), who).toBe(spaceId)
    }

    // And somebody nobody shared it with is a note that is not there.
    const outside = await signIn(env, 'nobody@example.com')
    const refused = await call(env, `/rooms/${noteId}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(outside) },
    })
    expect(refused.status).toBe(404)
  })

  test('lets in a guest a link let in, at what the link said', async () => {
    const door = doorway()
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    const owner = await signIn(env, 'owner@example.com')
    const spaceId = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Notes' } })).json
      .space.id
    const noteId = (
      await call(env, `/v1/spaces/${spaceId}/notes`, {
        token: owner,
        body: { path: 'shared.md', content: 'together' },
      })
    ).json.note.id

    /** Somebody with no account who followed the space's link. */
    async function guest(role: 'write' | 'read', mode: 'open' | 'approval'): Promise<string> {
      const { json } = await call<ShareView>(env, `/v1/spaces/${spaceId}/share/link`, {
        method: 'PUT',
        token: owner,
        body: { role, mode },
      })
      const token = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
      const walked = await call(env, `/v1/join/${token}`, { method: 'POST', body: { name: 'Ada' } })

      return walked.json.token
    }

    for (const [role, writes] of [
      ['write', 'yes'],
      ['read', 'no'],
    ] as const) {
      const answer = await call(env, `/rooms/${noteId}`, {
        headers: {
          upgrade: 'websocket',
          'sec-websocket-protocol': subprotocol(await guest(role, 'open')),
        },
      })

      expect(answer.status, role).toBe(200)
      expect(door.asked.at(-1)?.get('x-nib-write'), role).toBe(writes)
      expect(door.asked.at(-1)?.get('x-nib-space'), role).toBe(spaceId)
    }

    // A canvas is the same door and the same guest: the kind is read off the
    // file's name in the very query that answered the guest's session.
    const boardId = (
      await call(env, `/v1/spaces/${spaceId}/notes`, {
        token: owner,
        body: { path: 'Board.canvas', content: '' },
      })
    ).json.note.id

    const drawing = await call(env, `/rooms/${boardId}`, {
      headers: {
        upgrade: 'websocket',
        'sec-websocket-protocol': subprotocol(await guest('write', 'open')),
      },
    })

    expect(drawing.status).toBe(200)
    expect(door.asked.at(-1)?.get('x-nib-kind')).toBe('plane')
    expect(door.asked.at(-1)?.get('x-nib-write')).toBe('yes')

    // Waiting on the owner is not being in, so the note is not there yet.
    const waiting = await call(env, `/rooms/${noteId}`, {
      headers: {
        upgrade: 'websocket',
        'sec-websocket-protocol': subprotocol(await guest('write', 'approval')),
      },
    })
    expect(waiting.status).toBe(404)
  })

  test('turns away a socket with no session', async () => {
    const answer = await call(env, '/rooms/whatever', {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol('not-a-token') },
    })

    expect(answer.status).toBe(401)
  })

  test('turns away a note that belongs to another account', async () => {
    const mine = await signIn(env, 'mine@example.com')
    const theirs = await signIn(env, 'theirs@example.com')

    const space = await call(env, '/v1/spaces', { token: theirs, body: { name: 'Theirs' } })
    const note = await call(env, `/v1/spaces/${space.json.space.id}/notes`, {
      token: theirs,
      body: { path: 'secret.md', content: 'shh' },
    })

    const answer = await call(env, `/rooms/${note.json.note.id}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(mine) },
    })

    expect(answer.status).toBe(404)
  })

  test('is not a page to be read', async () => {
    const token = await signIn(env, 'reader@example.com')
    const answer = await call(env, '/rooms/whatever', {
      headers: { 'sec-websocket-protocol': subprotocol(token) },
    })

    expect(answer.status).toBe(426)
  })

  /** Whether a socket may write is the door's to say and the room's to enforce, so
   *  the room reads the header the door said it on and nothing else. It read
   *  anything but the word `no` as permission, so a header left out was a socket
   *  that could write - the wrong way round for the one flag standing between a
   *  reader and the words, and the opposite of what the room does with an
   *  attachment it cannot read. */
  test('only the word yes says a socket may write', () => {
    expect(writesOf('yes')).toBe(true)

    for (const said of ['no', null, undefined, '', 'YES', 'true', 'maybe', 1, {}]) {
      expect(writesOf(said), JSON.stringify(said ?? null)).toBe(false)
    }
  })

  test('says which shape the room holds, from the name of the file', async () => {
    const door = doorway()
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    const token = await signIn(env, 'both@example.com')
    const space = await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })
    const spaceId = space.json.space.id

    for (const [path, kind] of [
      ['a.md', 'words'],
      ['Board.canvas', 'plane'],
    ] as const) {
      const note = await call(env, `/v1/spaces/${spaceId}/notes`, {
        token,
        body: { path, content: '' },
      })

      await call(env, `/rooms/${note.json.note.id}`, {
        headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(token) },
      })

      expect(door.asked.at(-1)?.get('x-nib-kind'), path).toBe(kind)
    }
  })

  /** The door's query is four joins wide because a share can be about a space or
   *  about one file, and one person can hold both: a reader of the space who was
   *  given this note to write in. Four joins that each matched would be four rows
   *  in anything but this - the item is part of every key, so each matches at most
   *  one - and the whole of it has to stay one row and one round trip, because a
   *  scalar subquery over two rows would be the door quietly picking one of the
   *  two roles. */
  test('lets somebody who holds both the space and the file in at the stronger', async () => {
    for (const [space, item, writes] of [
      ['read', 'write', 'yes'],
      ['write', 'read', 'yes'],
      ['read', 'read', 'no'],
    ] as const) {
      const door = doorway()
      env.close()
      env = testEnv({ ROOMS: door.ROOMS })

      const owner = await signIn(env, 'owner@example.com')
      const spaceId = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Notes' } }))
        .json.space.id
      const noteId = (
        await call(env, `/v1/spaces/${spaceId}/notes`, {
          token: owner,
          body: { path: 'both.md', content: 'together' },
        })
      ).json.note.id

      const email = 'both@example.com'
      await call(env, `/v1/spaces/${spaceId}/share/invite`, {
        token: owner,
        body: { email, role: space },
      })
      await call(env, `/v1/spaces/${spaceId}/share/invite?item=${noteId}`, {
        token: owner,
        body: { email, role: item },
      })

      // Both memberships are really there, or the rest of this says nothing.
      expect(
        env.db.prepare('select count(*) as held from space_members where email = ?').get(email),
      ).toEqual({ held: 2 })

      const said = `${space} of the space, ${item} of the file`
      const answer = await call(env, `/rooms/${noteId}`, {
        headers: {
          upgrade: 'websocket',
          'sec-websocket-protocol': subprotocol(await signIn(env, email)),
        },
      })

      expect(answer.status, said).toBe(200)
      // One row: one space, one role, one ask.
      expect(door.asked, said).toHaveLength(1)
      expect(door.asked[0]?.get('x-nib-space'), said).toBe(spaceId)
      expect(door.asked[0]?.get('x-nib-write'), said).toBe(writes)
    }
  })

  /** D1 takes a hundred parameters and the door is in front of every socket a file
   *  opens, so what it asks must not grow with what anybody holds. */
  test('asks the same three things however many shares somebody has', async () => {
    const door = doorway()
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    const owner = await signIn(env, 'owner@example.com')
    const spaceId = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Notes' } })).json
      .space.id

    const notes: string[] = []
    for (let made = 0; made < 8; made++) {
      notes.push(
        (
          await call(env, `/v1/spaces/${spaceId}/notes`, {
            token: owner,
            body: { path: `note-${made}.md`, content: 'x' },
          })
        ).json.note.id,
      )
    }

    const email = 'many@example.com'
    for (const noteId of notes) {
      await call(env, `/v1/spaces/${spaceId}/share/invite?item=${noteId}`, {
        token: owner,
        body: { email, role: 'write' },
      })
    }

    const token = await signIn(env, email)
    const answer = await call(env, `/rooms/${notes[0] ?? ''}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(token) },
    })

    expect(answer.status).toBe(200)
    expect(door.asked[0]?.get('x-nib-write')).toBe('yes')
    // The widest thing anything bound while all of that ran, the door included.
    expect(env.widest().count).toBeLessThan(20)
  })
})

/** A device on a plane, the way the app's client is one: its own document, and the
 *  same two maps both ends of the real thing ask for. */
class Plane {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)

  constructor(readonly socket: FakeSocket) {}

  get canvas(): Canvas {
    return readPlane(this.doc)
  }

  /** What this device would send after drawing: the update its own document made. */
  draws(...strokes: InkStroke[]): Uint8Array {
    const before = Y.encodeStateVector(this.doc)
    const was = this.canvas
    const now = { ...was, ink: [...was.ink, ...strokes] }
    this.doc.transact(() => pushPlane(this.doc, was, stamped(was, now, 5000)))
    return syncUpdate(Y.encodeStateAsUpdate(this.doc, before))
  }

  /** A card moved, which is an edit to an object rather than one more of them. */
  moves(id: string, x: number, y: number): Uint8Array {
    const before = Y.encodeStateVector(this.doc)
    const was = this.canvas
    const now = {
      ...was,
      nodes: was.nodes.map((node) => (node.id === id ? { ...node, x, y } : node)),
    }
    this.doc.transact(() => pushPlane(this.doc, was, stamped(was, now, 6000)))
    return syncUpdate(Y.encodeStateAsUpdate(this.doc, before))
  }
}

function penStroke(id: string, count: number, colour = '1'): InkStroke {
  return {
    id,
    tool: 'pen',
    color: colour,
    size: 6,
    points: Array.from({ length: count }, (_, at) => ({
      x: at * 4,
      y: at * 2,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      t: at * 8,
    })),
  }
}

async function onPlane(
  made: NoteRoom,
  state: FakeState,
  note: { id: string; spaceId: string },
  writes = true,
): Promise<Plane> {
  const device = new Plane(await join(made, { ...note, kind: 'plane' }, writes))
  await say(made, state, device.socket, syncStep1(device.doc))
  await drain(made, state, [device])
  return device
}

/** Everything waiting on the wire, in both directions, until nothing is left.
 *  The same as `settle` above; a plane's devices are another shape. */
async function drain(made: NoteRoom, state: FakeState, devices: readonly Plane[]) {
  for (let round = 0; round < 12; round++) {
    let moved = false

    for (const device of devices) {
      for (const message of device.socket.take()) {
        moved = true
        const answer = receive(message, device.doc, device.awareness, 'room')
        if (answer) await say(made, state, device.socket, answer)
      }
    }

    if (!moved) return
  }

  throw new Error('the room and the devices never stopped talking')
}

describe('a canvas in a room', () => {
  let env: TestEnv
  let token: string
  let spaceId: string
  let noteId: string

  /** A canvas with one card and one stroke already on it. */
  const DRAWN: Canvas = {
    nodes: [{ id: 'card', type: 'text', x: 0, y: 0, width: 250, height: 60, text: 'a card' }],
    edges: [],
    ink: [penStroke('first', 5)],
    at: { card: 1000, first: 1000 },
    gone: {},
  }

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'drawer@example.com')

    const space = await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })
    spaceId = space.json.space.id

    const note = await call(env, `/v1/spaces/${spaceId}/notes`, {
      token,
      body: { path: 'Board.canvas', content: writeCanvas(DRAWN) },
    })
    noteId = note.json.note.id
  })

  afterEach(() => env.close())

  test('opens on the file as the store holds it', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })

    expect(writeCanvas(one.canvas)).toBe(writeCanvas(DRAWN))
  })

  test('carries a stroke to the other device, whole', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })
    const two = await onPlane(made, state, { id: noteId, spaceId })

    await say(made, state, one.socket, one.draws(penStroke('mine', 300, '2')))
    await drain(made, state, [one, two])

    const held = two.canvas.ink.find((stroke) => stroke.id === 'mine')
    expect(held?.points).toHaveLength(300)
    expect(held?.color).toBe('2')
  })

  test('keeps both strokes when two devices draw at once', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })
    const two = await onPlane(made, state, { id: noteId, spaceId })

    const first = one.draws(penStroke('from-one', 8))
    const second = two.draws(penStroke('from-two', 8))
    await say(made, state, one.socket, first)
    await say(made, state, two.socket, second)
    await drain(made, state, [one, two])

    for (const device of [one, two]) {
      expect(device.canvas.ink.map((stroke) => stroke.id)).toEqual([
        'first',
        'from-one',
        'from-two',
      ])
    }
  })

  test('one card moved on one device and coloured on the other keeps both', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })
    const two = await onPlane(made, state, { id: noteId, spaceId })

    const moved = one.moves('card', 400, 120)
    const coloured = (() => {
      const was = two.canvas
      const before = Y.encodeStateVector(two.doc)
      const now = {
        ...was,
        nodes: was.nodes.map((node) => (node.id === 'card' ? { ...node, color: '5' } : node)),
      }
      two.doc.transact(() => pushPlane(two.doc, was, stamped(was, now, 6000)))
      return syncUpdate(Y.encodeStateAsUpdate(two.doc, before))
    })()

    await say(made, state, one.socket, moved)
    await say(made, state, two.socket, coloured)
    await drain(made, state, [one, two])

    for (const device of [one, two]) {
      expect(device.canvas.nodes[0]).toMatchObject({ x: 400, y: 120, color: '5' })
    }
  })

  test('writes the canvas into the note store when the drawing stops', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })

    await say(made, state, one.socket, one.draws(penStroke('settled', 12, '3')))
    expect(state.takeAlarm()).not.toBeNull()

    await made.alarm()

    const read = await call(env, `/v1/notes/${noteId}`, { token })
    // Exactly the file the app would have written from the same plane, so
    // Obsidian, the exports and an offline device's merge all read it as one.
    expect(read.json.content).toBe(writeCanvas(one.canvas))
    expect(readCanvas(read.json.content).ink.map((stroke) => stroke.id)).toEqual([
      'first',
      'settled',
    ])
    expect(read.json.note.version).toBe(2)
  })

  test('writes nothing when nobody drew', async () => {
    const { room: made, state } = room(env)
    await onPlane(made, state, { id: noteId, spaceId })

    await made.alarm()

    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.note.version).toBe(1)
  })

  test('a reader sees every stroke and can add none', async () => {
    const { room: made, state } = room(env)
    const writer = await onPlane(made, state, { id: noteId, spaceId })
    const reader = await onPlane(made, state, { id: noteId, spaceId }, false)

    await say(made, state, writer.socket, writer.draws(penStroke('theirs', 6)))
    await drain(made, state, [writer, reader])
    expect(reader.canvas.ink.map((stroke) => stroke.id)).toEqual(['first', 'theirs'])

    // And what the reader draws goes nowhere at all.
    writer.socket.take()
    await say(made, state, reader.socket, reader.draws(penStroke('refused', 6)))
    await drain(made, state, [writer])

    expect(writer.canvas.ink.map((stroke) => stroke.id)).toEqual(['first', 'theirs'])

    await made.alarm()
    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(readCanvas(read.json.content).ink.map((stroke) => stroke.id)).toEqual([
      'first',
      'theirs',
    ])
  })

  test('folds the pile of strokes into one snapshot', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })

    for (let at = 0; at < 240; at++) {
      await say(made, state, one.socket, one.draws(penStroke(`s${at}`, 4)))
    }

    const kept = [...state.kept.keys()]
    expect(kept.filter((key) => key.startsWith('state:')).length).toBeGreaterThan(0)
    expect(kept.filter((key) => key.startsWith('log:')).length).toBeLessThan(240)
    // And nothing was lost to the folding.
    expect(one.canvas.ink).toHaveLength(241)
  })

  test('reads itself back after the runtime has put it to sleep', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.draws(penStroke('slept-on', 20)))
    await made.alarm()

    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    const back = await onPlane(woken, state, { id: noteId, spaceId })

    expect(back.canvas.ink.map((stroke) => stroke.id)).toEqual(['first', 'slept-on'])
    // And it knows it is a plane rather than a note, which is what it kept.
    expect(back.canvas.nodes[0]?.id).toBe('card')
  })

  test('a card deleted here stays deleted there', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })
    const two = await onPlane(made, state, { id: noteId, spaceId })

    const before = one.canvas
    const without = { ...before, nodes: [] }
    const sent = (() => {
      const mark = Y.encodeStateVector(one.doc)
      one.doc.transact(() => pushPlane(one.doc, before, stamped(before, without, 7000)))
      return syncUpdate(Y.encodeStateAsUpdate(one.doc, mark))
    })()

    await say(made, state, one.socket, sent)
    await drain(made, state, [one, two])

    expect(two.canvas.nodes).toEqual([])
    expect(two.canvas.gone.card).toBe(7000)

    await made.alarm()
    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(readCanvas(read.json.content).gone.card).toBe(7000)
  })
})

describe('somebody who stops being in the space while the file is open', () => {
  const WRITER = 'writer@example.com'

  let env: TestEnv
  let live: ReturnType<typeof running>
  let owner: string
  let writer: string
  let writerId: string
  let spaceId: string
  let noteId: string

  beforeEach(async () => {
    env = testEnv()
    // The rooms have to be able to reach the same database the routes use, so the
    // namespace is put in afterwards; nothing has asked for it yet.
    live = running(env)
    env.ROOMS = live.ROOMS

    owner = await signIn(env, 'owner@example.com')
    spaceId = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json.space
      .id
    noteId = (
      await call(env, `/v1/spaces/${spaceId}/notes`, {
        token: owner,
        body: { path: 'together.md', content: OPENING },
      })
    ).json.note.id

    await call(env, `/v1/spaces/${spaceId}/share/invite`, {
      token: owner,
      body: { email: WRITER, role: 'write' },
    })
    writer = await signIn(env, WRITER)
    writerId = (await call(env, '/v1/me', { token: writer })).json.user.id
  })

  afterEach(() => env.close())

  /** The room this note's sockets are in, and a socket in it, joined the way the
   *  door joins one: with whose it is. */
  async function open(who: string, writes = true): Promise<FakeSocket> {
    const { room: made } = live.of(noteId)
    return await join(made, { id: noteId, spaceId, who }, writes)
  }

  test('is written down as having it open, and not once they have closed it', async () => {
    const socket = await open(writerId)

    const held = env.db
      .prepare('select space_id, who from room_sockets where note_id = ?')
      .all(noteId)
    expect(held).toEqual([{ space_id: spaceId, who: writerId }])

    const { room: made } = live.of(noteId)
    await made.webSocketClose(socket as unknown as WebSocket)

    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 0 })
  })

  test('has the socket closed when the owner takes them out', async () => {
    const socket = await open(writerId)

    await call(env, `/v1/spaces/${spaceId}/share/members/${WRITER}`, {
      method: 'DELETE',
      token: owner,
    })

    expect(socket.closed).toBe(true)
    expect(socket.closedWith?.code).toBe(1008)
    // And the row goes with it: a close this side asked for brings no handler.
    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 0 })
  })

  test('and the owner’s own socket in the same room is left alone', async () => {
    const ownerId = (await call(env, '/v1/me', { token: owner })).json.user.id
    const theirs = await open(ownerId)
    const socket = await open(writerId)

    await call(env, `/v1/spaces/${spaceId}/share/members/${WRITER}`, {
      method: 'DELETE',
      token: owner,
    })

    expect(socket.closed).toBe(true)
    expect(theirs.closed).toBe(false)
  })

  test('keeps the socket but stops writing when the role drops to reading', async () => {
    const socket = await open(writerId)
    const { room: made, state } = live.of(noteId)

    await call(env, `/v1/spaces/${spaceId}/share/members/${WRITER}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'read' },
    })

    expect(socket.closed).toBe(false)

    // The same socket, the same room, and a line it types now changes nothing.
    const device = new Device(socket)
    await say(made, state, socket, syncStep1(device.doc))
    await settle(made, state, [device])
    await say(made, state, socket, device.type(OPENING.length, 'a line'))

    await made.alarm()
    const read = await call(env, `/v1/notes/${noteId}`, { token: owner })
    expect(read.json.content).toBe(OPENING)
  })

  test('is a guest the same way, by the id the link handed out', async () => {
    const { json } = await call<ShareView>(env, `/v1/spaces/${spaceId}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'write', mode: 'open' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''

    const arrived = await call(env, `/v1/join/${link}`, {
      method: 'POST',
      body: { device: 'Windows' },
    })
    const guestId = arrived.json.guest.id
    const socket = await open(guestId)

    await call(env, `/v1/spaces/${spaceId}/share/guests/${guestId}`, {
      method: 'DELETE',
      token: owner,
    })

    expect(socket.closed).toBe(true)
  })

  test('is a person letting themselves out, on their other devices', async () => {
    const socket = await open(writerId)

    await call(env, `/v1/spaces/${spaceId}/share/me`, { method: 'DELETE', token: writer })

    expect(socket.closed).toBe(true)
  })

  test('and a room nobody is in is told without being woken', async () => {
    // Nothing has ever opened this note, so there is no row and no object to ask.
    await call(env, `/v1/spaces/${spaceId}/share/members/${WRITER}`, {
      method: 'DELETE',
      token: owner,
    })

    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 0 })
  })
})

/** A room that is a moment from answering.
 *
 *  A room is a Durable Object, and the commonest reason one is not there is a
 *  deploy: every object whose code changed is reset, and the fetch in flight
 *  throws. This service deploys on every push, so that is every note anybody had
 *  open at the time - which is what four 500s on `GET /rooms/{id}` in one day
 *  were. A 500 is the wrong answer twice over: it reads as a bug in what was
 *  asked, and nothing in it says that asking again is the whole of the fix. */
describe('a room that is not answering', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv()
  })

  afterEach(() => {
    env.close()
    vi.restoreAllMocks()
  })

  /** Every line the log was written with while `work` ran. */
  async function logged(work: () => Promise<unknown>): Promise<string[]> {
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })

    await work()
    return lines
  }

  /** A note of somebody's own, with the door's namespace already in place. */
  async function opening(door: ReturnType<typeof doorway>): Promise<[string, string]> {
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    const token = await signIn(env, 'owner@example.com')
    const spaceId = (await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })).json.space
      .id
    const noteId = (
      await call(env, `/v1/spaces/${spaceId}/notes`, {
        token,
        body: { path: 'open.md', content: OPENING },
      })
    ).json.note.id

    return [noteId, token]
  }

  function knock(noteId: string, token: string) {
    return call(env, `/rooms/${noteId}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(token) },
    })
  }

  test('is a wait rather than a bug, and says how long', async () => {
    const door = doorway(2)
    const [noteId, token] = await opening(door)

    let status = 0
    let said: unknown = null
    let wait: string | null = null
    const lines = await logged(async () => {
      const answer = await knock(noteId, token)
      status = answer.status
      said = answer.json.error
      wait = answer.headers.get('retry-after')
    })

    expect(status).toBe(503)
    expect(said).toBe('this room is not answering - try again')
    expect(wait).toBe('1')

    // And it is written down, once, with the room it was about: a room that fails
    // every time is a bug rather than a deploy, and this is where the two part.
    expect(lines).toHaveLength(1)
    const written = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(written.failed).toBe(`room ${noteId}`)
    expect(String(written.said)).toContain('code was updated')
  })

  test('is asked once more, because a deploy replaces the object it reset', async () => {
    const door = doorway(1)
    const [noteId, token] = await opening(door)

    let status = 0
    const lines = await logged(async () => {
      status = (await knock(noteId, token)).status
    })

    // The second ask landed on the object that replaced the one that went, so
    // nobody waited and nothing was written down.
    expect(status).toBe(200)
    expect(door.asked).toHaveLength(2)
    expect(lines).toEqual([])
  })

  test('is asked twice and no more', async () => {
    const door = doorway(5)
    const [noteId, token] = await opening(door)

    await logged(() => knock(noteId, token))

    expect(door.asked).toHaveLength(2)
  })
})

/** What a room does when a store under it is the thing that is unwell.
 *
 *  Opening a room reaches two of them - its own storage and the note store - and a
 *  failure used to be kept as though it were the room: `opened` held the
 *  rejection, so every later join, every message and every settle was handed the
 *  same moment again for as long as the object lived, and the store being well
 *  again changed nothing about it. */
describe('a room that could not be opened', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv()
  })

  afterEach(() => env.close())

  /** A note store that refuses until it is told to stop. */
  function refusing(): { NOTES: R2Bucket; well: () => void } {
    let failing = true
    const notes = {
      get: () =>
        failing
          ? Promise.reject(new Error('the note store is not answering'))
          : Promise.resolve({ text: () => Promise.resolve(OPENING) }),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    }

    return {
      NOTES: notes as unknown as R2Bucket,
      well: () => {
        failing = false
      },
    }
  }

  test('opens on the next join once the store is answering again', async () => {
    const store = refusing()
    env.close()
    env = testEnv({ NOTES: store.NOTES })
    const { room: made } = room(env)

    await expect(join(made, { id: 'n1', spaceId: 's1', who: 'u1' })).rejects.toThrow(
      'not answering',
    )

    store.well()
    const socket = await join(made, { id: 'n1', spaceId: 's1', who: 'u1' })

    // Greeted with what the room holds, which is what being in one is.
    expect(socket.sent.length).toBeGreaterThan(0)
  })

  test('settles nothing while it has never held the file', async () => {
    const store = refusing()
    env.close()
    env = testEnv({ NOTES: store.NOTES })
    const { room: made, state } = room(env)

    await expect(join(made, { id: 'n1', spaceId: 's1', who: 'u1' })).rejects.toThrow()

    // The alarm finds a room that knows which file it is and cannot read it, and
    // what it must not do is write the empty document it is holding over the file.
    await expect(made.alarm()).rejects.toThrow()
    expect(env.keys()).toEqual([])
    expect(state.getWebSockets()).toEqual([])
  })

  test('takes no socket when the row saying who has it open cannot be written', async () => {
    const { room: made, state } = room(env)
    env.db.exec('drop table room_sockets')

    await expect(join(made, { id: 'n1', spaceId: 's1', who: 'u1' })).rejects.toThrow('room_sockets')

    // A socket in the room that no row names is one an owner cannot close, so
    // there is no socket: the door answers 503 and the client asks again.
    expect(state.getWebSockets()).toEqual([])
  })

  test('is one row and not a conflict when the same person joins again', async () => {
    const { room: made } = room(env)

    for (const again of [1, 2, 3]) {
      const socket = await join(made, { id: 'n1', spaceId: 's1', who: 'u1' })
      expect(socket.sent.length, String(again)).toBeGreaterThan(0)
    }

    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 1 })
  })
})

/** A file renamed from a note into a canvas, or back, while its room held it.
 *
 *  A room's document is the shape of the file it was opened for - one `Y.Text` of
 *  prose, or a map of the objects on a plane - and those two cannot be turned into
 *  each other. A rename across them makes the file a different kind of thing while
 *  the room goes on holding the old one.
 *
 *  What used to happen is that the next join said the new kind, the room wrote that
 *  down as though it had always been so, and the settle then read the document
 *  through the wrong serialiser. A plane read as words is the empty string, so a
 *  canvas somebody had drawn on was written over with nothing at all. */
describe('a file that changed which kind of room it is', () => {
  let env: TestEnv
  let token: string
  let spaceId: string

  /** A canvas with a card and a stroke already on it. */
  const DRAWN: Canvas = {
    nodes: [{ id: 'card', type: 'text', x: 0, y: 0, width: 250, height: 60, text: 'a card' }],
    edges: [],
    ink: [penStroke('first', 5)],
    at: { card: 1000, first: 1000 },
    gone: {},
  }

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'renamer@example.com')
    spaceId = (await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })).json.space.id
  })

  afterEach(() => {
    env.close()
    vi.restoreAllMocks()
  })

  /** Every line the log was written with while `work` ran. */
  async function logged(work: () => Promise<unknown>): Promise<string[]> {
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })

    await work()
    return lines
  }

  async function fileAt(path: string, content: string): Promise<string> {
    const made = await call(env, `/v1/spaces/${spaceId}/notes`, { token, body: { path, content } })
    return made.json.note.id
  }

  /** The rename itself, as the app makes it: the same note id, a path whose name
   *  says the other kind, and the bytes it already had. */
  async function renameTo(noteId: string, path: string): Promise<void> {
    const read = await call(env, `/v1/notes/${noteId}`, { token })
    const done = await call(env, `/v1/notes/${noteId}`, {
      method: 'PUT',
      token,
      body: { path, content: read.json.content, baseVersion: read.json.note.version },
    })

    expect(done.status).toBe(200)
  }

  function contentOf(noteId: string): Promise<string> {
    return call(env, `/v1/notes/${noteId}`, { token }).then((read) => read.json.content)
  }

  test('does not write nothing over a canvas whose file became a note', async () => {
    const boardId = await fileAt('Board.canvas', writeCanvas(DRAWN))
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: boardId, spaceId })
    await say(made, state, one.socket, one.draws(penStroke('kept', 8, '2')))
    await made.alarm()

    await renameTo(boardId, 'Board.md')

    // The runtime put the object to sleep, and a device joins the file as it now
    // is. Before the fix this was let in and the settle wrote the empty string;
    // now it is refused while the room changes over. The file must survive both.
    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    await logged(async () => {
      await join(woken, { id: boardId, spaceId, kind: 'words' }).catch(() => undefined)
      await woken.alarm().catch(() => undefined)
    })

    const after = await contentOf(boardId)
    expect(after).not.toBe('')
    expect(readCanvas(after).ink).toHaveLength(2)
    expect(readCanvas(after).nodes).toHaveLength(1)
  })

  test('does not write a canvas over the words of a note whose file became one', async () => {
    const noteId = await fileAt('plan.md', '# Plan\nwritten down\n')
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.type(7, 'and kept\n'))
    await made.alarm()

    await renameTo(noteId, 'plan.canvas')

    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    await logged(async () => {
      await join(woken, { id: noteId, spaceId, kind: 'plane' }).catch(() => undefined)
      await woken.alarm().catch(() => undefined)
    })

    expect(await contentOf(noteId)).toBe('# Plan\nand kept\nwritten down\n')
  })

  test('starts the room again as the kind the file is now', async () => {
    const boardId = await fileAt('Board.canvas', writeCanvas(DRAWN))
    const { room: made, state } = room(env)
    const drawing = await onPlane(made, state, { id: boardId, spaceId })
    await made.alarm()

    await renameTo(boardId, 'Board.md')

    // The join that finds the file changed is refused, and the room goes with it:
    // every socket closed with the code that means come back, the row saying
    // somebody had it open taken away, and the storage emptied.
    await expect(join(made, { id: boardId, spaceId, kind: 'words' })).rejects.toThrow()

    expect(drawing.socket.closed).toBe(true)
    expect(drawing.socket.closedWith?.code).toBe(1012)
    expect(state.kept.size).toBe(0)
    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 0 })

    // And the next join builds the room out of the file, under the kind it is now:
    // the canvas as it was written, read as the words the file's name says.
    const again = new NoteRoom(state as unknown as DurableObjectState, env)
    const back = await arrive(again, state, { id: boardId, spaceId })
    expect(readCanvas(back.words).nodes).toHaveLength(1)
  })

  test('refuses a settle the file itself disagrees with, and says so', async () => {
    const noteId = await fileAt('plan.md', '# Plan\n')
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.type(7, 'typed on\n'))

    // Renamed with nobody joining afterwards, so nothing has told the room: the
    // settle already on the clock is the next thing to happen.
    await renameTo(noteId, 'plan.canvas')
    const lines = await logged(() => made.alarm())

    // The words stay in the room and the file keeps its own; what does not happen
    // is prose written into a file that says it holds a plane.
    expect(await contentOf(noteId)).toBe('# Plan\n')
    expect(lines).toHaveLength(1)
    const written = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(written.failed).toBe(`room ${noteId}`)
    expect(String(written.said)).toContain('plane')
  })

  /** The second line of defence, and the one that matters for a room an older
   *  build already left in this state: its storage says words and its document is
   *  a plane, which is exactly what the overwritten kind looked like. */
  test('never writes nothing over a file that has something in it', async () => {
    const boardId = await fileAt('Board.canvas', writeCanvas(DRAWN))
    const { room: made, state } = room(env)
    await onPlane(made, state, { id: boardId, spaceId })
    await made.alarm()

    // What the old build wrote down: the file is a note and the room agrees it is
    // one, while the document it holds is the plane it always was.
    await renameTo(boardId, 'Board.md')
    state.kept.set('note', { noteId: boardId, spaceId, kind: 'words' })

    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    const lines = await logged(() => woken.alarm())

    expect(await contentOf(boardId)).toBe(writeCanvas(DRAWN))
    expect(lines).toHaveLength(1)
    const said = String((JSON.parse(lines[0] ?? '{}') as { said?: unknown }).said)
    expect(said).toContain('holds a plane')
  })

  /** The same guard from the other side, and the one the client can reach on its
   *  own: a tab that thinks it holds a canvas, joined to the room of a file whose
   *  name says it is a note. Nothing on the server renamed anything here - the two
   *  ends decided the shape from different things and disagreed. */
  test('leaves the words alone when a canvas is drawn into a note’s room', async () => {
    const noteId = await fileAt('plan.md', '# Plan\nwritten down\n')
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    // A device drawing on what the room holds as prose, which is what a canvas
    // binding on a note's room does.
    const before = Y.encodeStateVector(one.doc)
    one.doc.transact(() => {
      pushPlane(one.doc, readPlane(one.doc), stamped(readPlane(one.doc), DRAWN, 7000))
    })
    await say(made, state, one.socket, syncUpdate(Y.encodeStateAsUpdate(one.doc, before)))

    const lines = await logged(() => made.alarm())

    expect(await contentOf(noteId)).toBe('# Plan\nwritten down\n')
    expect(lines).toHaveLength(1)
  })

  test('does not empty a file because the room’s own snapshot came back quiet', async () => {
    const noteId = await fileAt('kept.md', '# Kept\nevery word\n')
    const { room: made, state } = room(env)
    await arrive(made, state, { id: noteId, spaceId })
    await made.alarm()

    // A snapshot whose bytes are not bytes: the keys are there, so the room reads
    // itself back as though it had a document, and what it has is nothing.
    for (const key of [...state.kept.keys()]) {
      if (key.startsWith('state:') || key.startsWith('log:')) state.kept.set(key, 'not bytes')
    }

    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    const lines = await logged(() => woken.alarm())

    expect(await contentOf(noteId)).toBe('# Kept\nevery word\n')
    expect(lines).toHaveLength(1)
    expect(String((JSON.parse(lines[0] ?? '{}') as { said?: unknown }).said)).toContain(
      'never held',
    )
  })

  test('still lets a note somebody emptied become empty', async () => {
    const noteId = await fileAt('gone.md', '# Gone\nevery word of it\n')
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    // Everything selected and deleted, which is a note somebody emptied rather
    // than a document read through the wrong serialiser.
    const before = Y.encodeStateVector(one.doc)
    one.text.delete(0, one.text.length)
    await say(made, state, one.socket, syncUpdate(Y.encodeStateAsUpdate(one.doc, before)))
    await made.alarm()

    expect(await contentOf(noteId)).toBe('')
  })
})

/** Who a revocation reaches, which is every file they have open rather than the
 *  first fifty rows of them: the checks a socket was let in on are made at the
 *  handshake and never again, so a room nobody told goes on writing. */
describe('telling the rooms somebody has been taken out of a space', () => {
  let told: TestEnv

  afterEach(() => told.close())

  /** Somebody holding `note-0000` upwards open, as the rooms wrote it down. */
  function holding(open: number): void {
    for (let at = 0; at < open; at++) {
      told.db
        .prepare('insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, ?)')
        .run(`note-${String(at).padStart(4, '0')}`, 's1', 'u1', Date.now())
    }
  }

  test('reaches every file they have open, however many that is', async () => {
    const door = doorway()
    told = testEnv({ ROOMS: door.ROOMS })

    const open = 137
    holding(open)

    // A room of the same space held by somebody else, and one of another space
    // held by this person: neither is this revocation's business.
    for (const [noteId, spaceId, who] of [
      ['note-9998', 's1', 'u2'],
      ['note-9999', 's2', 'u1'],
    ] as const) {
      told.db
        .prepare('insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, ?)')
        .run(noteId, spaceId, who, Date.now())
    }

    await roomsRevoked(told, 's1', 'u1', 'none')

    expect(door.asked).toHaveLength(open)
    for (const headers of door.asked) {
      expect(headers.get('x-nib-revoked')).toBe('u1')
      expect(headers.get('x-nib-role')).toBe('none')
    }
  })

  test('and only the one file, where a share was about one file', async () => {
    const door = doorway()
    told = testEnv({ ROOMS: door.ROOMS })
    holding(3)

    await roomsRevoked(told, 's1', 'u1', 'read', 'note-0001')

    expect(door.asked).toHaveLength(1)
    expect(door.asked[0]?.get('x-nib-role')).toBe('read')
  })
})

/** A session ending has to reach the sockets it opened, for the same reason a
 *  revocation does: the checks a socket was let in on were made at the handshake and
 *  never again, so a laptop that has gone missing goes on typing through its room
 *  long after the session was ended from another device. */
describe('ending a session', () => {
  let out: TestEnv

  afterEach(() => out.close())

  /** The account, and one note of one space open in a room. */
  async function signedIn(door: { ROOMS: DurableObjectNamespace; asked: Headers[] }) {
    out = testEnv({ ROOMS: door.ROOMS })
    const token = await signIn(out, 'a@b.dev')
    const who = (out.db.prepare('select id from users limit 1').get() as { id: string }).id

    out.db
      .prepare('insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, ?)')
      .run('note-a', 's1', who, Date.now())

    return { token, who }
  }

  test('closes the rooms that session had open', async () => {
    const door = doorway()
    const { token, who } = await signedIn(door)

    await call(out, '/v1/auth/signout', { method: 'POST', token })

    expect(door.asked).toHaveLength(1)
    expect(door.asked[0]?.get('x-nib-revoked')).toBe(who)
    expect(door.asked[0]?.get('x-nib-role')).toBe('none')
  })

  test('and so does ending every session but this one', async () => {
    const door = doorway()
    const { token, who } = await signedIn(door)
    // The device that went missing, which is the row this ends.
    await signIn(out, 'a@b.dev')

    await call(out, '/v1/sessions', { method: 'DELETE', token })

    expect(door.asked).toHaveLength(1)
    expect(door.asked[0]?.get('x-nib-revoked')).toBe(who)
  })
})
