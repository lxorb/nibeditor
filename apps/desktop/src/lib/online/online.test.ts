import { describe, expect, test } from 'vitest'
import { terminalMark } from '../terminal/naming'
import { cityOf, onlineOf } from './calls'
import { ownSession } from './own'
import { isMadeName, isOnlineTab, isTermTarget, termName } from './path'
import { resumeCommand } from './resume'

describe('an online terminal, told apart', () => {
  test('is a terminal tab whose file is a .term', () => {
    expect(isTermTarget('C:\\Notes\\Build.term')).toBe(true)
    expect(isTermTarget('/notes/Build.TERM')).toBe(true)
    expect(isTermTarget('/notes/Build.md')).toBe(false)
    expect(isTermTarget(null)).toBe(false)
    expect(isOnlineTab({ kind: 'terminal', path: '/n/Terminal.term' })).toBe(true)
    expect(isOnlineTab({ kind: 'terminal', path: null })).toBe(false)
    expect(isOnlineTab({ kind: 'note', path: '/n/Terminal.term' })).toBe(false)
  })

  /** The file's name is the tab's, unless it is still the one it was made with. */
  test('is called by its file, unless that is still the name it was made with', () => {
    expect(termName('Build.term')).toBe('Build')
    expect(isMadeName('Terminal.term')).toBe(true)
    expect(isMadeName('Terminal 2')).toBe(true)
    expect(isMadeName('Terminals')).toBe(false)
    expect(isMadeName('Build.term')).toBe(false)
  })
})

describe('Resume', () => {
  /** Exactly the commands docs/online-terminal.md 4.7 names. */
  test('types each agent its own continue command', () => {
    expect(resumeCommand('claude')).toBe('claude --continue')
    expect(resumeCommand('codex')).toBe('codex resume --last')
  })

  test('offers nothing for a program with no conversation to pick up', () => {
    expect(resumeCommand('vim')).toBeNull()
    expect(resumeCommand(null)).toBeNull()
  })
})

describe("the account's answer about the machine", () => {
  const month = {
    allowed: true,
    machine: { id: 'm1', state: 'asleep', held: false },
    used: { awakeS: 3600, cpuS: 60, homeBytes: 1e6, egressBytes: 2e6 },
    limit: { awakeS: 72000, cpuS: 36000, homeBytes: 5e9, egressBytes: 2e10 },
    resetAt: 1_793_000_000_000,
  }

  test('reads as the machine and the month', () => {
    const { resetAt, ...rest } = month
    expect(onlineOf(month)).toEqual({
      ...rest,
      machine: { ...rest.machine, host: 'cloudflare', server: null, disk: null },
      resets: resetAt,
    })
  })

  /** A server of its own (4.15): what it is, what it costs, and how full its disk is. */
  test('with the server under it and its disk', () => {
    const server = {
      type: 'cx43',
      location: 'fsn1',
      cores: 8,
      memoryGb: 16,
      diskGb: 160,
      price: 14.27,
      currency: 'EUR',
    }
    const read = onlineOf({
      ...month,
      machine: { ...month.machine, host: 'hetzner', server, disk: { used: 17e9, total: 160e9 } },
    })?.machine
    expect(read).toEqual({
      id: 'm1',
      state: 'asleep',
      held: false,
      host: 'hetzner',
      server,
      disk: { used: 17e9, total: 160e9 },
    })
    const unpriced = onlineOf({
      ...month,
      machine: { ...month.machine, host: 'hetzner', server: { ...server, price: null } },
    })?.machine
    expect(unpriced?.server?.price).toBeNull()
    // A service from before it said where.
    const unplaced = onlineOf({
      ...month,
      machine: { ...month.machine, host: 'hetzner', server: { ...server, location: undefined } },
    })?.machine
    expect(unplaced?.server?.location).toBeNull()
  })

  test('says where a server is by its city', () => {
    expect(cityOf('nbg1')).toBe('Nuremberg')
    expect(cityOf('fsn1')).toBe('Falkenstein')
    expect(cityOf('xyz9')).toBe('xyz9')
  })

  test('with no machine yet', () => {
    expect(onlineOf({ ...month, machine: null })?.machine).toBeNull()
  })

  test('and is nothing when it does not read', () => {
    expect(onlineOf({ ...month, used: { awakeS: '1' } })).toBeNull()
    expect(onlineOf(null)).toBeNull()
    expect(onlineOf({ ...month, machine: { id: 'm1', state: 'flying' } })?.machine).toBeNull()
  })
})

describe('a session on sync v1, which has no file id', () => {
  const made = { v: 1 as const, machine: 'm1', session: 's_new' }

  /** A file with the words given, and what was made and written. */
  function file(words: string | null) {
    const did = { made: 0, written: [] as string[] }
    return {
      did,
      file: {
        read: () => Promise.resolve(words),
        write: (text: string) => {
          did.written.push(text)
          return Promise.resolve()
        },
        make: () => {
          did.made += 1
          return Promise.resolve(made)
        },
      },
    }
  }

  test('is made for an empty file, and written into it', async () => {
    const { did, file: empty } = file('')
    expect(await ownSession(empty)).toBe('s_new')
    expect(did).toEqual({ made: 1, written: ['{"v":1,"machine":"m1","session":"s_new"}\n'] })
  })

  test('is the one the file names, made once and never again', async () => {
    const { did, file: named } = file('{"v":1,"machine":"m1","session":"s_old"}\n')
    expect(await ownSession(named)).toBe('s_old')
    expect(did).toEqual({ made: 0, written: [] })
  })

  test('is made again for a file that cannot be read or does not name one', async () => {
    expect(await ownSession(file(null).file)).toBe('s_new')
    expect(await ownSession(file('not a terminal').file)).toBe('s_new')
  })

  test('refused by the account, writes nothing', async () => {
    const { did, file: one } = file('')
    one.make = () => Promise.reject(new Error('list'))
    await expect(ownSession(one)).rejects.toThrow('list')
    expect(did.written).toEqual([])
  })
})

describe('the program in front of an online terminal', () => {
  /** nibd names the program and leaves the mark to the app, as a local terminal's. */
  test('wears the mark its name gives, the shell’s otherwise', () => {
    expect(terminalMark('', 'claude')).toBe('claude')
    expect(terminalMark('', 'codex')).toBe('codex')
    expect(terminalMark('', 'python3')).toBe('python')
    expect(terminalMark('', 'htop')).toBe('shell')
    expect(terminalMark('', null)).toBe('shell')
  })
})
