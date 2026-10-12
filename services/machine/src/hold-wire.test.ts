import { expect, test } from 'vitest'
import {
  frameOf,
  Frames,
  fromHolderOf,
  type FromHolder,
  type Hello,
  HOLD_VERSION,
  specOf,
  toHolderOf,
  type ToHolder,
} from './hold-wire'

const bytes = (text: string) => new TextEncoder().encode(text)

const hello: Hello = {
  t: 'hello',
  v: HOLD_VERSION,
  holder: 4100,
  shell: 4101,
  base: 120,
  from: 300,
  end: 5000,
  cols: 100,
  rows: 30,
  exited: null,
}

function through(frame: FromHolder | ToHolder) {
  const raws = new Frames().push(frameOf(frame))
  expect(raws).toHaveLength(1)
  const [raw] = raws
  if (!raw) throw new Error('no frame')
  return { from: fromHolderOf(raw), to: toHolderOf(raw) }
}

test('every frame a holder says reads back as it was said, and as nothing it is told', () => {
  for (const frame of [
    hello,
    { ...hello, exited: { code: 3 } },
    { t: 'out', seq: 2 ** 40, data: bytes('\x1b[31mred\x1b[0m') },
    { t: 'exit', code: null },
    { t: 'exit', code: 0 },
  ] satisfies FromHolder[]) {
    const { from, to } = through(frame)
    expect(from).toEqual(frame)
    if (frame.t !== 'out') expect(to).toBeNull()
  }
})

test('every frame a holder is told reads back as it was told', () => {
  for (const frame of [
    { t: 'attach', since: 0 },
    { t: 'attach', since: 1_234_567 },
    { t: 'in', data: bytes('ls -la\r') },
    { t: 'size', cols: 200, rows: 50 },
  ] satisfies ToHolder[]) {
    expect(through(frame).to).toEqual(frame)
  }
})

test('frames come out whole however the socket cut them, and in order', () => {
  const stream = new Uint8Array([
    ...frameOf(hello),
    ...frameOf({ t: 'out', seq: 300, data: bytes('one') }),
    ...frameOf({ t: 'out', seq: 303, data: bytes('two') }),
  ])
  for (const cut of [1, 3, 5, 7, 64]) {
    const frames = new Frames()
    const read: (FromHolder | null)[] = []
    for (let at = 0; at < stream.length; at += cut) {
      for (const raw of frames.push(stream.subarray(at, at + cut))) read.push(fromHolderOf(raw))
    }
    expect(read.map((one) => one?.t)).toEqual(['hello', 'out', 'out'])
    expect(read[2]).toEqual({ t: 'out', seq: 303, data: bytes('two') })
  }
})

test('a length no frame has breaks the stream, which is then dropped', () => {
  const frames = new Frames()
  expect(frames.push(new Uint8Array([0xff, 0xff, 0xff, 0xff, 1]))).toEqual([])
  expect(frames.broken).toBe(true)
})

test('a hello that says what no hello is, or a newer kind, is passed over', () => {
  const said = (value: unknown) => {
    const [raw] = new Frames().push(frameOf(hello))
    if (!raw) throw new Error('no frame')
    return fromHolderOf({ kind: raw.kind, body: bytes(JSON.stringify(value)) })
  }
  expect(said({ ...hello, from: 10 })).toBeNull()
  expect(said({ ...hello, end: 299 })).toBeNull()
  expect(said({ ...hello, shell: -1 })).toBeNull()
  expect(said({ ...hello, exited: { code: 'no' } })).toBeNull()
  // A holder from a later nib speaks every word this one knows.
  expect(said({ ...hello, v: HOLD_VERSION + 1, more: true })).toMatchObject({ v: 2 })
  expect(fromHolderOf({ kind: 99, body: bytes('{}') })).toBeNull()
  expect(toHolderOf({ kind: 99, body: bytes('{}') })).toBeNull()
})

test('what a holder runs is read back whole, and anything else is no spec', () => {
  const spec = {
    socket: '/var/lib/nibd/holds/s_1.sock',
    cgroup: null,
    file: '/bin/bash',
    args: ['-l'],
    cwd: '/home/nib',
    cols: 80,
    rows: 24,
    base: 0,
  }
  expect(specOf(JSON.stringify(spec))).toEqual(spec)
  expect(specOf(JSON.stringify({ ...spec, cgroup: '/sys/fs/cgroup/nibd/s_1' }))?.cgroup).toBe(
    '/sys/fs/cgroup/nibd/s_1',
  )
  expect(specOf(undefined)).toBeNull()
  expect(specOf('{')).toBeNull()
  expect(specOf(JSON.stringify({ ...spec, args: [1] }))).toBeNull()
  expect(specOf(JSON.stringify({ ...spec, base: -1 }))).toBeNull()
})
