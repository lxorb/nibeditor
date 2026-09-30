import { frame, unframe } from '@nib/sync-core/wire'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { get, put, scan } from './sync2/store'

/** The native store's half of the bridge: every call reaches the command it is meant
 *  for, a batch goes up as one envelope of bytes, and an answer is read however the
 *  platform delivered it. The crate's half of the same envelope is sync_store/wire.rs,
 *  and `the_envelope_is_the_one_sync_core_speaks` there pins the two to each other. */

interface Calls {
  made: { command: string; args: unknown }[]
  answer: unknown
}

const calls = vi.hoisted((): Calls => ({ made: [], answer: null }))

vi.mock('./native', () => ({
  invoke: (command: string, args: unknown) => {
    calls.made.push({ command, args })
    return Promise.resolve(calls.answer)
  },
}))

const { bytesOf, openNative } = await import('./native-sync-store')

beforeEach(() => {
  calls.made = []
})

const opened = { device: 'd', wasClean: true, schema: 1, recovered: false }

describe('an answer from the crate', () => {
  test('is bytes however the platform delivered it', () => {
    const bytes = frame([new Uint8Array([5, 6])])
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    for (const delivered of [bytes, buffer, [...bytes]]) {
      expect(unframe(bytesOf(delivered))).toEqual([new Uint8Array([5, 6])])
    }
    expect(() => bytesOf('text')).toThrow('not bytes')
    expect(() => bytesOf([256])).toThrow('not bytes')
  })
})

describe('the native store', () => {
  test('opens through the crate and says what it found', async () => {
    calls.answer = opened
    const store = await openNative('account')
    expect(store.opened).toEqual(opened)
    expect(calls.made).toEqual([{ command: 'sync_store_open', args: { account: 'account' } }])
  })

  test('sends a batch as one envelope of bytes', async () => {
    calls.answer = opened
    const store = await openNative('account')
    calls.answer = [1]
    const row = {
      id: 'n',
      remote: new Uint8Array([4]),
      remote_sv: new Uint8Array(),
      device: null,
      at: 1,
    }
    const counts = await store.write([put('held', row)])

    expect(counts).toEqual([1])
    const sent = calls.made.at(-1)
    expect(sent?.command).toBe('sync_store_write')
    expect(sent?.args).toBeInstanceOf(Uint8Array)
    expect(unframe(bytesOf(sent?.args))).toEqual([{ t: 'put', table: 'held', row }])
  })

  test('checks every answer against its question', async () => {
    calls.answer = opened
    const store = await openNative('account')
    calls.answer = frame([{ hash: 'h', state: 'here' }, [{ key: 'device', value: 'd' }]])
    const [file, meta] = await store.read([get('files', 'h'), scan('meta')])
    expect(file).toEqual({ hash: 'h', state: 'here' })
    expect(meta).toEqual([{ key: 'device', value: 'd' }])

    calls.answer = frame([{ hash: 'h', state: 3 }])
    await expect(store.read([get('files', 'h')])).rejects.toThrow('files.state')
    calls.answer = frame([])
    await expect(store.read([get('files', 'h')])).rejects.toThrow('odd read')
    calls.answer = new Uint8Array([9, 9, 9])
    await expect(store.read([get('files', 'h')])).rejects.toThrow('odd read')
  })

  test('refuses a batch before it reaches the crate', async () => {
    calls.answer = opened
    const store = await openNative('account')
    const bad = put('files', { hash: 'h', state: 3 as unknown as string })
    await expect(store.write([bad])).rejects.toThrow('files.state')
    expect(calls.made.map((one) => one.command)).toEqual(['sync_store_open'])
  })
})
