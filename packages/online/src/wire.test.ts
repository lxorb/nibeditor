import { describe, expect, it } from 'vitest'
import { frame } from '@nib/sync-core/wire'
import {
  type ClientFrame,
  clientFrameOf,
  linkFrame,
  type MachineFrame,
  machineFrameOf,
  MOST_INPUT,
  type NibdFrame,
  nibdFrameOf,
  outFrame,
  outOf,
  type ServerFrame,
  serverFrameOf,
  socketPath,
  text,
} from './wire'

const bytes = (...values: number[]) => new Uint8Array(values)

describe('the app socket', () => {
  const clients: ClientFrame[] = [
    { t: 'hello', cols: 120, rows: 40 },
    { t: 'hello', since: 0, cols: 1, rows: 1 },
    { t: 'hello', since: 2 ** 40, cols: 1000, rows: 1000 },
    { t: 'in', data: 'ls -la\r' },
    { t: 'in', data: '' },
    { t: 'in', data: '\u001b[A\u0003ü😀' },
    { t: 'size', cols: 80, rows: 24 },
    { t: 'start' },
    { t: 'resume' },
  ]

  it.each(clients)('reads back what the app sent: %j', (one) => {
    expect(clientFrameOf(text(one))).toEqual(one)
  })

  const servers: ServerFrame[] = [
    { t: 'screen', seq: 0, cols: 80, rows: 24, data: '' },
    { t: 'screen', seq: 512, cols: 120, rows: 40, data: '\u001b[31mred\u001b[0m\r\n$ ' },
    {
      t: 'screen',
      seq: 9,
      cols: 80,
      rows: 24,
      data: 'x',
      restored: { at: 1_759_000_000_000, program: 'claude' },
    },
    { t: 'screen', seq: 9, cols: 80, rows: 24, data: 'x', restored: { at: 1, program: null } },
    { t: 'size', cols: 80, rows: 24, by: 'u_emil' },
    { t: 'size', cols: 80, rows: 24, by: null },
    { t: 'people', people: [] },
    {
      t: 'people',
      people: [
        { who: 'u_a', device: 'd_1', typing: true },
        { who: 'u_a', device: 'd_2', typing: false },
      ],
    },
    { t: 'typed', who: 'u_a', seq: 77 },
    { t: 'program', name: 'claude', title: '✳ Build', mark: 'claude' },
    { t: 'program', name: null, title: null, mark: null },
    { t: 'machine', state: 'awake' },
    { t: 'machine', state: 'asleep', reason: 'idle' },
    { t: 'machine', state: 'stopping', reason: 'budget' },
    { t: 'machine', state: 'asleep', reason: 'restart' },
    { t: 'role', type: true },
    { t: 'role', type: false },
    { t: 'ended', code: 0 },
    { t: 'ended', code: 130 },
    { t: 'ended', code: null },
    { t: 'refused', error: 'role' },
    { t: 'refused', error: 'sessions' },
  ]

  it.each(servers)('reads back what the Machine sent: %j', (one) => {
    expect(serverFrameOf(text(one))).toEqual(one)
  })

  it.each([
    '',
    'not json',
    'null',
    '[]',
    '{}',
    '{"t":"nope"}',
    '{"t":"hello","cols":0,"rows":24}',
    '{"t":"hello","cols":80,"rows":1001}',
    '{"t":"hello","cols":80.5,"rows":24}',
    '{"t":"hello","cols":"80","rows":24}',
    '{"t":"hello","since":-1,"cols":80,"rows":24}',
    '{"t":"hello","since":null,"cols":80,"rows":24}',
    '{"t":"in","data":3}',
    '{"t":"in"}',
    '{"t":"size","cols":80}',
  ])('drops a client frame that does not check: %s', (raw) => {
    expect(clientFrameOf(raw)).toBeNull()
  })

  it('drops input larger than a frame may be', () => {
    expect(clientFrameOf(text({ t: 'in', data: 'x'.repeat(MOST_INPUT) }))).not.toBeNull()
    expect(clientFrameOf(text({ t: 'in', data: 'x'.repeat(MOST_INPUT + 1) }))).toBeNull()
  })

  it.each([
    '{"t":"screen","seq":0,"cols":80,"rows":24}',
    '{"t":"screen","seq":0,"cols":80,"rows":24,"data":"","restored":{"at":"x","program":null}}',
    '{"t":"size","cols":80,"rows":24}',
    '{"t":"people","people":[{"who":"a","device":"b"}]}',
    '{"t":"people","people":{}}',
    '{"t":"typed","who":"","seq":1}',
    '{"t":"program","name":"x","title":null}',
    '{"t":"machine","state":"dreaming"}',
    '{"t":"machine","state":"asleep","reason":"bored"}',
    '{"t":"role","type":"read"}',
    '{"t":"ended","code":1.5}',
    '{"t":"refused","error":"because"}',
  ])('drops a server frame that does not check: %s', (raw) => {
    expect(serverFrameOf(raw)).toBeNull()
  })

  it('drops a people list longer than a session has sockets', () => {
    const people = Array.from({ length: 26 }, (_, at) => ({
      who: `u_${String(at)}`,
      device: 'd',
      typing: false,
    }))
    expect(serverFrameOf(text({ t: 'people', people }))).toBeNull()
    expect(serverFrameOf(text({ t: 'people', people: people.slice(1) }))).not.toBeNull()
  })

  it('carries output as an offset and raw bytes', () => {
    const data = bytes(0, 27, 91, 255, 10)
    const read = outOf(outFrame(4096, data))
    expect(read?.seq).toBe(4096)
    expect([...(read?.data ?? [])]).toEqual([...data])
    expect(outOf(outFrame(2 ** 50, bytes()))).toEqual({ seq: 2 ** 50, data: bytes() })
  })

  it('reads output inside a larger buffer, as a socket may hand it', () => {
    const framed = outFrame(7, bytes(1, 2, 3))
    const padded = new Uint8Array(framed.length + 6)
    padded.set(framed, 3)
    const read = outOf(padded.subarray(3, 3 + framed.length))
    expect(read?.seq).toBe(7)
    expect([...(read?.data ?? [])]).toEqual([1, 2, 3])
  })

  it('drops output too short to hold an offset, or with no offset in it', () => {
    expect(outOf(bytes(1, 2, 3))).toBeNull()
    const bad = new Uint8Array(8)
    new DataView(bad.buffer).setFloat64(0, -1)
    expect(outOf(bad)).toBeNull()
    new DataView(bad.buffer).setFloat64(0, 1.5)
    expect(outOf(bad)).toBeNull()
    new DataView(bad.buffer).setFloat64(0, Number.NaN)
    expect(outOf(bad)).toBeNull()
  })

  it('names the socket by the file id, escaped', () => {
    expect(socketPath('f_1')).toBe('/v2/online/f_1/socket')
    expect(socketPath('a/b')).toBe('/v2/online/a%2Fb/socket')
  })
})

describe('the link', () => {
  const machines: MachineFrame[] = [
    { t: 'open', session: 's_1', cols: 80, rows: 24 },
    { t: 'in', session: 's_1', data: bytes(3) },
    { t: 'in', session: 's_1', data: bytes() },
    { t: 'size', session: 's_1', cols: 200, rows: 60 },
    { t: 'want', session: 's_1', since: 0 },
    { t: 'want', session: 's_1', since: 123_456 },
    { t: 'close', session: 's_1' },
    { t: 'sleep' },
  ]

  it.each(machines)('nibd reads back what the Machine sent: %j', (one) => {
    expect(machineFrameOf(linkFrame(one))).toEqual(one)
  })

  const nibds: NibdFrame[] = [
    { t: 'out', session: 's_1', seq: 0, data: bytes(104, 105) },
    { t: 'out', session: 's_1', seq: 2 ** 33, data: bytes(0, 255) },
    { t: 'screen', session: 's_1', seq: 10, cols: 80, rows: 24, data: '\u001b[?1049h' },
    {
      t: 'screen',
      session: 's_1',
      seq: 10,
      cols: 80,
      rows: 24,
      data: 'x',
      restored: { at: 5, program: 'codex' },
    },
    { t: 'program', session: 's_1', name: 'vim', title: 'notes.md', mark: 'vim' },
    { t: 'program', session: 's_1', name: 'bash', title: null, mark: null },
    { t: 'ended', session: 's_1', code: 0 },
    { t: 'ended', session: 's_1', code: null },
    { t: 'activity', activity: { at: 1, output: 0, cpu: 0.25, net: 51_200, homeBytes: 2 ** 32 } },
    { t: 'saved' },
  ]

  it.each(nibds)('the Machine reads back what nibd sent: %j', (one) => {
    expect(nibdFrameOf(linkFrame(one))).toEqual(one)
  })

  it('carries bytes on the link as bytes, not escaped', () => {
    const data = new Uint8Array(4096).fill(0x1b)
    expect(linkFrame({ t: 'in', session: 's', data }).length).toBeLessThan(4096 + 100)
  })

  it.each<[string, unknown]>([
    ['no session', { t: 'open', cols: 80, rows: 24 }],
    ['an empty session', { t: 'close', session: '' }],
    ['a size of nothing', { t: 'size', session: 's', cols: 0, rows: 24 }],
    ['text for input', { t: 'in', session: 's', data: 'ls' }],
    ['a negative offset', { t: 'want', session: 's', since: -5 }],
    ['an unknown kind', { t: 'reboot', session: 's' }],
  ])('nibd drops a frame with %s', (_, value) => {
    expect(machineFrameOf(frame(value as object))).toBeNull()
  })

  it('nibd drops input larger than a frame may be', () => {
    const data = new Uint8Array(MOST_INPUT + 1)
    expect(machineFrameOf(linkFrame({ t: 'in', session: 's', data }))).toBeNull()
  })

  it.each<[string, unknown]>([
    ['text for output', { t: 'out', session: 's', seq: 0, data: 'hi' }],
    ['a screen with no size', { t: 'screen', session: 's', seq: 0, data: '' }],
    ['an activity with no home', { t: 'activity', activity: { at: 1, output: 0, cpu: 0, net: 0 } }],
    [
      'a negative CPU',
      { t: 'activity', activity: { at: 1, output: 0, cpu: -1, net: 0, homeBytes: 0 } },
    ],
    ['an ended with no session', { t: 'ended', code: 0 }],
    ['an unknown kind', { t: 'hello' }],
  ])('the Machine drops a frame with %s', (_, value) => {
    expect(nibdFrameOf(frame(value as object))).toBeNull()
  })

  it('drops bytes that are not an envelope at all', () => {
    expect(machineFrameOf(bytes(9, 9, 9))).toBeNull()
    expect(nibdFrameOf(bytes())).toBeNull()
  })
})
