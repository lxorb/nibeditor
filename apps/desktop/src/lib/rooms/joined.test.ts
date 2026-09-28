import { describe, expect, test, vi } from 'vitest'

/** What a note's room and a canvas's room share about being joined: the scheme the
 *  others are drawn in and whether the room is still about its file. The meeting
 *  itself is each kind's own and has tests of its own, in room.test.ts and
 *  plane.test.ts; the socket is stood in for, since nothing here goes over it. */

vi.mock('./socket', () => ({
  RoomSocket: class {
    start() {
      // Never connects: nothing in these tests is said to a room.
    }
    stop() {
      // Nor goes anywhere to stop.
    }
    send() {
      return false
    }
  },
}))

const { JoinedRoom } = await import('./joined')

/** A room of no particular kind, that writes down each time it draws the others. */
class Probe extends JoinedRoom {
  readonly drawn: string[] = []

  asks(): boolean {
    return this.holds()
  }

  leave() {
    this.left = true
  }

  protected together() {
    // Holds nothing to bring together.
  }

  protected showPresent() {
    this.drawn.push(this.scheme)
  }
}

function probe(onFile = () => true): Probe {
  return new Probe({
    noteId: 'n1',
    token: 'session',
    who: { name: 'Mac', accent: 'blue' },
    scheme: 'dark',
    onPeers: () => undefined,
    gone: () => undefined,
    refused: () => undefined,
    holds: onFile,
  })
}

describe('a joined room', () => {
  test('draws the others again in a scheme that changed, and only then', () => {
    const room = probe()

    room.repaint('dark')
    room.repaint('light')
    room.repaint('light')

    expect(room.drawn).toEqual(['light'])
  })

  test('holds its file until it is left', () => {
    const room = probe()
    expect(room.asks()).toBe(true)

    room.leave()
    expect(room.asks()).toBe(false)
  })

  test('and not once what is open above has moved on to another', () => {
    let arrivals = 0
    const room = probe(() => arrivals === 0)

    arrivals += 1

    expect(room.asks()).toBe(false)
  })
})
