import { describe, expect, test, vi } from 'vitest'
import { ChatSocket, type Dial, type Heard } from './socket'

const CHAT = `c_${'c'.repeat(32)}`

/** A dial whose sockets the test opens, speaks into and closes. */
function dialed() {
  const sockets: {
    protocols: string[]
    sent: string[]
    on: Parameters<Dial>[2]
    closed: boolean
  }[] = []
  const dial: Dial = (_url, protocols, on) => {
    const one = { protocols, sent: [] as string[], on, closed: false }
    sockets.push(one)
    return { send: (said) => one.sent.push(said), close: () => (one.closed = true) }
  }
  return { sockets, dial }
}

function heard(): Heard & { calls: string[] } {
  const calls: string[] = []
  const note =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push(`${name} ${JSON.stringify(args)}`)
  return {
    calls,
    events: note('events'),
    behind: note('behind'),
    typing: note('typing'),
    read: note('read'),
    here: note('here'),
    profile: note('profile'),
    state: note('state'),
    ended: note('ended'),
  }
}

describe('a chat’s socket', () => {
  test('says hello with the place held, and hands on what it hears', () => {
    const { sockets, dial } = dialed()
    const ears = heard()
    const socket = new ChatSocket(CHAT, 'token', 'device-0001', () => 41, ears, dial)
    const [one] = sockets
    expect(one?.protocols).toEqual(['nib.token.token', 'nib.device.device-0001'])
    one?.on.opened()
    expect(one?.sent[0]).toBe(JSON.stringify({ t: 'hello', since: 41 }))
    expect(socket.read(42)).toBe(true)

    one?.on.heard(JSON.stringify({ t: 'here', who: ['user:ana'] }))
    one?.on.heard(JSON.stringify({ t: 'behind', seq: 90_000 }))
    one?.on.heard('not a frame')
    expect(ears.calls).toEqual(['state [true]', 'here [["user:ana"]]', 'behind [90000]'])
    socket.close()
  })

  test('comes back after a drop, and not after the log ends it', () => {
    vi.useFakeTimers()
    try {
      const { sockets, dial } = dialed()
      const ears = heard()
      const socket = new ChatSocket(CHAT, 'token', null, () => 0, ears, dial)
      sockets[0]?.on.opened()
      sockets[0]?.on.closed(1006)
      vi.advanceTimersByTime(60_000)
      expect(sockets).toHaveLength(2)

      sockets[1]?.on.opened()
      sockets[1]?.on.closed(1008)
      vi.advanceTimersByTime(60_000)
      expect(sockets).toHaveLength(2)
      expect(ears.calls.at(-1)).toBe('ended []')
      expect(socket.open).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
