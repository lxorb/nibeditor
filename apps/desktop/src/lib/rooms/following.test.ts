/** Which room each open file is in, as the file underneath it changes.
 *
 *  The store follows what is open: a file joins its room, leaves when the last tab
 *  holding it closes, and the pairing is worked out again on every change to the
 *  list. What these tests are about is the three things that can change under an
 *  open tab without the list of what is open changing at all.
 *
 *  A space renamed, which rewrites every open note's path and keeps its id: the
 *  same note, moved. A file renamed across the two kinds of room, which makes the
 *  document in the tab the wrong shape for the file. And the room itself going,
 *  which is what the service does when it has to rebuild one.
 *
 *  Everything here is real but the socket: the store, the documents, the rooms, the
 *  meeting when a room answers, and the binding between a note and a room's text.
 *  The other end of the socket is the same protocol module both ends use. */

import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyCanvas } from '@nib/markdown/canvas'
import { receive, syncUpdate, TEXT } from '@nib/rooms'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { PlaneSurface } from '../canvas/shared'

const sockets = vi.hoisted(() => {
  interface Wire {
    opened: () => void
    heard: (message: Uint8Array) => void
    closed: (code: number, said: string) => void
  }

  class FakeSocket {
    private sent: Uint8Array[] = []
    private up = false
    stopped = false

    constructor(
      readonly noteId: string,
      readonly token: string,
      readonly wire: Wire,
    ) {
      opened.push(this)
    }

    get open(): boolean {
      return this.up
    }

    arrive() {
      this.up = true
      this.wire.opened()
    }

    /** The room's end going, with the code it went with and whatever it said. 1012
     *  is what the service closes with when it has thrown a room away and will build
     *  another; 1009 is what it closes with when the document has reached the size a
     *  document may be, and then the words are the reason. */
    went(code: number, said = '') {
      this.up = false
      this.wire.closed(code, said)
    }

    take(): Uint8Array[] {
      const said = this.sent
      this.sent = []
      return said
    }

    start() {
      // The real one connects here; this one waits to be told it is up.
    }

    send(message: Uint8Array): boolean {
      if (!this.up) return false

      this.sent.push(message)
      return true
    }

    stop() {
      this.up = false
      this.stopped = true
    }
  }

  const opened: FakeSocket[] = []
  return { FakeSocket, opened }
})

vi.mock('./socket', () => ({ RoomSocket: sockets.FakeSocket }))
vi.mock('./who', () => ({
  deviceName: () => 'Windows',
  deviceAccent: () => 'blue',
  personName: () => undefined,
}))
vi.mock('../account.svelte', () => ({ account: { token: 'session', name: null } }))
vi.mock('../theme.svelte', () => ({ theme: { current: 'dark' } }))
vi.mock('../i18n.svelte', () => ({ t: (text: string) => text, key: (text: string) => text }))

/** What the line across the top was told, which is the one thing a reader sees when
 *  a room refuses them. Filled by the mock below. */
const said: string[] = []

vi.mock('../busy.svelte', () => ({
  busy: {
    failed: (reason: string) => said.push(reason),
    start: () => undefined,
  },
}))

const { rooms } = await import('../rooms.svelte')
const { record } = await import('../sync/record.svelte')
const { NoteDoc } = await import('../workspace/documents.svelte')

type Doc = InstanceType<typeof NoteDoc>
type Socket = InstanceType<typeof sockets.FakeSocket>

/** The room in the Worker, as far as the protocol is concerned. `file` is what a
 *  settle would write, which is the whole point of reading it. */
class Server {
  readonly doc = new Y.Doc()
  private readonly awareness = new Awareness(this.doc)

  constructor(words: string) {
    if (words) this.doc.getText(TEXT).insert(0, words)
  }

  answer(message: Uint8Array): Uint8Array | null {
    return receive(message, this.doc, this.awareness, 'socket')
  }

  /** Somebody else writing in this note on their own device, and the room passing
   *  it on to this one. */
  elsewhere(at: number, words: string, socket: Socket) {
    const before = Y.encodeStateVector(this.doc)
    this.doc.getText(TEXT).insert(at, words)
    socket.wire.heard(syncUpdate(Y.encodeStateAsUpdate(this.doc, before)))
  }

  get file(): string {
    return this.doc.getText(TEXT).toJSON()
  }
}

function documentOn(path: string, words: string, kind: 'note' | 'canvas' = 'note'): Doc {
  return new NoteDoc(
    { kind, path, name: path.split('/').at(-1) ?? path, text: words, dirty: false },
    () => undefined,
    () => true,
  )
}

/** A plane on screen, as much of one as a room needs. */
function surface(): PlaneSurface {
  return {
    canvas: emptyCanvas(),
    shared: null,
    arrived: () => undefined,
    handsAre: () => undefined,
    historyIs: () => undefined,
  }
}

function latest(): Socket {
  const socket = sockets.opened.at(-1)
  if (!socket) throw new Error('no socket was opened')

  return socket
}

/** Until something is true, or long enough that it is not going to be.
 *
 *  Joining reaches for a real digest of the file, which is answered in its own time -
 *  so what is waited for is the room saying it has caught up, rather than a number of
 *  ticks that happens to be enough on an idle machine. */
async function until(what: () => boolean, said: string): Promise<void> {
  for (let tries = 0; tries < 2000; tries++) {
    if (what()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }

  throw new Error(`gave up waiting for ${said}`)
}

/** Everything the device has said into the room, and everything back. */
function carry(socket: Socket, server: Server) {
  for (const message of socket.take()) {
    const back = server.answer(message)
    if (back) socket.wire.heard(back)
  }
}

/** What the words of a document read as, brought up to what the panes hold. */
function words(note: Doc): string {
  note.flush()
  return note.text
}

/** The account's hash of a text, worked out the way the store works it out, so the
 *  copy the account last handed this device can really be recognised. A string that
 *  is not a digest is never either side's copy, which reads as both of them having
 *  moved on; see `Base` in join.ts. */
async function digestOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** One open file, followed, and its room caught up with it. The hash handed over is
 *  the file's own, so the note reads as untouched: nothing of its own to offer. */
async function following(note: Doc, server: Server, held = words(note)) {
  const hash = await digestOf(held)
  rooms.follow([{ key: note.key, noteId: 'note-1', note, hash, version: 1 }])

  const socket = latest()
  socket.arrive()
  carry(socket, server)
  await until(() => rooms.joined.has('note-1'), 'the room to catch up')
  carry(socket, server)

  return socket
}

/** The engine, in hand before anything is timed.
 *
 *  The two kinds of room are fetched when the account first has something to join a
 *  room for, and nothing in the app waits for them: `follow` starts the fetch and is
 *  answered again when it lands. Every test below is about the pairing rather than
 *  about that one fetch, so it is done once here - which is also the state the app is
 *  in for all but the first moment of a session. See `reach` in rooms.svelte.ts. */
beforeAll(async () => {
  await rooms.reach()
})

beforeEach(() => {
  rooms.clear()
  sockets.opened.length = 0
})

describe('a space renamed while one of its notes is open in a room', () => {
  /** A space rename rewrites the path of every open note and keeps every id: the
   *  same file, somewhere else. The pairing used to read that as the document having
   *  moved on to another note, because the predicate it was handed compared the
   *  path - and `arrivals` beside it already says the one thing the path was there
   *  to say. So the binding refused everything in both directions while the room
   *  went on claiming the file, which left the note mute on the room and on the file
   *  sync at once, until the tab was closed. */
  test('keeps carrying what is typed into it', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    // Every open note's path rewritten under the space's new name, and the store
    // told what is open again - the same document, the same id, another path.
    note.path = '/Renamed/a.md'
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '# A\n', version: 1 }])

    note.live.replace('# A\nafter the rename\n')
    note.flush()
    carry(socket, server)

    expect(server.file).toBe('# A\nafter the rename\n')
  })

  test('and keeps bringing the other device’s words in', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    note.path = '/Renamed/a.md'
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '# A\n', version: 1 }])

    server.elsewhere(3, ' from the phone', socket)

    expect(words(note)).toBe('# A from the phone\n')
  })

  test('and does not leave the room, so the file sync is right to stand back', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    const before = sockets.opened.length
    note.path = '/Renamed/a.md'
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '# A\n', version: 1 }])

    // The same socket, because it is the same file: nothing was rejoined.
    expect(sockets.opened.length).toBe(before)
    expect(socket.open).toBe(true)
    // And the room still says it holds this file, which is what tells the file
    // sync to leave it alone; see sync/mirror.ts.
    expect(rooms.joined.has('note-1')).toBe(true)
  })
})

describe('which shape of room a file joins', () => {
  test('is the file’s name, not what the tab was opened as', async () => {
    // A tab that thinks it holds words over a file whose name says otherwise: what
    // a session written before there were canvases restores. It must not be given a
    // note's room, because the service serves that file as a plane.
    const note = documentOn('/Notes/Board.canvas', '{}', 'note')
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '{}', version: 1 }])

    expect(sockets.opened).toHaveLength(0)
  })

  test('waits for the plane a canvas is about, and then joins it', async () => {
    const note = documentOn('/Notes/Board.canvas', '{}', 'canvas')
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '{}', version: 1 }])
    expect(sockets.opened).toHaveLength(0)

    rooms.drawing(note.key, surface())
    expect(sockets.opened).toHaveLength(1)
  })

  test('is worked out again when the file’s name crosses the two kinds', async () => {
    const note = documentOn('/Notes/plan.md', '# Plan\n')
    const server = new Server('# Plan\n')
    await following(note, server)
    expect(sockets.opened).toHaveLength(1)

    // Renamed into a canvas, and the tab now has a plane to draw.
    note.path = '/Notes/plan.canvas'
    rooms.drawing(note.key, surface())
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '# Plan\n', version: 1 }])

    // The words room was left and a plane's room joined in its place: a second
    // socket, and the first one stopped.
    expect(sockets.opened).toHaveLength(2)
    expect(sockets.opened[0]?.open).toBe(false)
  })
})

describe('a room the service threw away and will build again', () => {
  /** The service closes with 1012 when the file behind a room changed kind: it
   *  writes what the room held into the file and resets the object, so the next join
   *  builds the room out of the file under the kind it now is.
   *
   *  That is a different document, seeded afresh. Reconnecting this device's own
   *  document to it would merge two histories of the same words and show them
   *  twice, so the answer is to let the room go and join again from nothing - which
   *  is the one path that ends in `meeting`, where what each side holds is compared
   *  rather than added up. */
  test('is joined again rather than reconnected to', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    socket.went(1012)

    expect(sockets.opened).toHaveLength(2)
    // And the socket that went is not coming back on its own.
    expect(socket.stopped).toBe(true)
  })

  test('loses nothing that was typed while it was away', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    // The room goes, and somebody carries on typing into the note.
    socket.went(1012)
    note.live.replace('# A\ntyped while it was away\n')
    note.flush()

    // The room the service built out of the file, which has what the file had.
    const rebuilt = new Server('# A\n')
    const back = latest()
    back.arrive()
    carry(back, rebuilt)
    await until(() => rooms.joined.has('note-1'), 'the new room to catch up')
    carry(back, rebuilt)

    expect(rebuilt.file).toBe('# A\ntyped while it was away\n')
    expect(words(note)).toBe('# A\ntyped while it was away\n')
  })

  test('stays out of its room while a reader is being asked, and rejoins after', async () => {
    // The rule that asks. The device wrote while it was away and so did the room, so
    // neither copy may be written over: the note waits, out of its room, and the file
    // sync carries it. See rooms/apart.ts.
    const { modes } = await import('../modes.svelte')
    modes.conflicts = 'ask'

    try {
      const note = documentOn('/Notes/a.md', '# A\n')
      const server = new Server('# A\n')
      const socket = await following(note, server)

      socket.went(1012)
      note.live.replace('# A\ntyped while it was away\n')
      note.flush()

      // The room the service built out of the file has moved on too.
      const rebuilt = new Server('# A\nand something from the phone\n')
      const back = latest()
      back.arrive()
      carry(back, rebuilt)
      await until(() => !!record.clashes.length, 'the clash to reach the pane')
      carry(back, rebuilt)

      // Both copies exactly as they were, and the note out of its room - which is what
      // keeps a pass from pushing one over the other.
      expect(words(note)).toBe('# A\ntyped while it was away\n')
      expect(rebuilt.file).toBe('# A\nand something from the phone\n')
      expect(rooms.joined.has('note-1')).toBe(false)
      expect(record.clashes.map((one) => one.theirs)).toEqual([
        '# A\nand something from the phone\n',
      ])

      // Somebody answers, which settles the files and moves the account's copy on. That
      // is what says so out here, and the note joins its room again rather than waiting
      // for its tab to be closed.
      const opened = sockets.opened.length
      rooms.follow([
        {
          key: note.key,
          noteId: 'note-1',
          note,
          hash: await digestOf('# A\nsettled by hand\n'),
          version: 2,
        },
      ])

      expect(sockets.opened.length).toBe(opened + 1)
    } finally {
      modes.conflicts = 'both'
      record.forgetEverything()
    }
  })

  test('does not count as being in a room while it is gone', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)
    expect(rooms.joined.has('note-1')).toBe(true)

    socket.went(1012)

    // Which is what hands the file back to the file sync for the moment in
    // between; see `caughtUp` in rooms/door.ts.
    expect(rooms.joined.has('note-1')).toBe(false)
  })
})

/** 1009 is the service saying the document has reached the size a document may be,
 *  and the words it closes with are why. Nothing is retried and nothing is rebuilt:
 *  reconnecting would be the same refusal on the next keystroke, so the room is let
 *  go and the note carries on as a file. See `TOO_LARGE` in door.ts and `full` in
 *  services/sync/src/rooms/state.ts. */
describe('a room that will take no more keystrokes', () => {
  const TOO_LARGE = 1009
  const SAID = 'this note is as large as a note in a room may get'

  beforeEach(() => {
    said.length = 0
  })

  test('is let go rather than joined again', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)
    expect(rooms.joined.has('note-1')).toBe(true)

    socket.went(TOO_LARGE, SAID)

    // One socket, stopped: a second would be closed again on the next keystroke.
    expect(socket.stopped).toBe(true)
    expect(sockets.opened).toHaveLength(1)
    expect(rooms.joined.has('note-1')).toBe(false)
  })

  test('and says so once, in the app’s own words', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    socket.went(TOO_LARGE, SAID)

    expect(said).toEqual(['This note is as large as a note in a room may get.'])
  })

  test('while the words carry on being written into the file', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    socket.went(TOO_LARGE, SAID)
    note.live.replace('# A\nstill typing\n')
    note.flush()

    expect(words(note)).toBe('# A\nstill typing\n')
  })
})
