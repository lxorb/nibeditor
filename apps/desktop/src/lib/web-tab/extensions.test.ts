/** What the bar, its bubble and Settings make of the crate's list of extensions: a row
 *  read whatever the crate sent, the buttons the bar shows, when the stores are asked for
 *  newer versions, and a press shown at once and put right when the crate refuses it.
 *  See extensions.svelte.ts. */

import { expect, test, vi } from 'vitest'

const asked: { command: string; args: Record<string, unknown> | undefined }[] = []
let refuse = false
/** What each popup build is answered with in turn: a refusal's words, or null for built. */
const builds: (string | null)[] = []

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args?: Record<string, unknown>) => {
    asked.push({ command, args })
    if (command === 'extensions_list') return Promise.resolve([row({ id: 'a', enabled: true })])
    if (command === 'extension_popup_open') {
      const said = builds.shift() ?? null
      return said === null ? Promise.resolve(undefined) : Promise.reject(said)
    }
    return refuse ? Promise.reject(new Error('no')) : Promise.resolve(undefined)
  },
}))

const { UPDATE_EVERY, extensions, pinnedOf, readExtension, updateDue } =
  await import('./extensions.svelte')
const { ASK_AGAIN, NOT_ANSWERING } = await import('./answering')

function row(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'ddkjiahejlhfcafbddmgiahcphecmpfh',
    store: 'chrome',
    version: '1.0',
    enabled: true,
    pinned: true,
    name: 'uBlock Origin Lite',
    picture: 'data:image/png;base64,AA==',
    popup: 'popup.html',
    options: null,
    action: true,
    permissions: ['storage', '<all_urls>'],
    problem: null,
    ...fields,
  }
}

test('a row is read whole, and anything that is not one is nothing', () => {
  const one = readExtension(row({}))
  expect(one?.name).toBe('uBlock Origin Lite')
  expect(one?.popup).toBe('popup.html')
  expect(one?.options).toBeNull()
  expect(one?.permissions).toEqual(['storage', '<all_urls>'])

  expect(readExtension(null)).toBeNull()
  expect(readExtension({ id: 3 })).toBeNull()
  // A nameless extension is called by its id rather than by nothing.
  expect(readExtension(row({ name: '' }))?.name).toBe('ddkjiahejlhfcafbddmgiahcphecmpfh')
  expect(readExtension(row({ store: 'edge', permissions: ['tabs', 4] }))).toMatchObject({
    store: 'edge',
    permissions: ['tabs'],
  })
})

test('the bar shows what is on, has a button and is pinned', () => {
  const list = [
    row({ id: 'on' }),
    row({ id: 'off', enabled: false }),
    row({ id: 'buttonless', action: false }),
    row({ id: 'unpinned', pinned: false }),
  ].map((one) => readExtension(one))
  expect(pinnedOf(list.filter((one) => one !== null)).map((one) => one.id)).toEqual(['on'])
})

test('the stores are asked once in a while, and again after a clock went back', () => {
  const now = 1_800_000_000_000
  expect(updateDue(null, now)).toBe(true)
  expect(updateDue(now - 1000, now)).toBe(false)
  expect(updateDue(now - UPDATE_EVERY, now)).toBe(true)
  expect(updateDue(now + 1000, now)).toBe(true)
})

test('a switch moves at once, and comes back when the crate refuses it', async () => {
  await extensions.load()
  expect(extensions.list[0]?.enabled).toBe(true)

  refuse = true
  const turning = extensions.enable('a', false)
  expect(extensions.list[0]?.enabled).toBe(false)
  await turning
  await Promise.resolve()
  expect(extensions.list[0]?.enabled).toBe(true)
  refuse = false
  expect(asked.some((one) => one.command === 'extensions_set')).toBe(true)
})

test('one popup at a time, and pressing its button again closes it', () => {
  extensions.open('a', 't1', null)
  expect(extensions.popped).toEqual({ id: 'a', tab: 't1', store: null })
  extensions.open('b', 't1', 'space_1')
  expect(extensions.popped?.id).toBe('b')
  extensions.open('b', 't1', 'space_1')
  expect(extensions.popped).toBeNull()
})

const RECT = { x: 10, y: 20, width: 25, height: 25 }

function built(): number {
  return asked.filter((one) => one.command === 'extension_popup_open').length
}

test('a popup waits on a busy browser, asking again each second until it is built', async () => {
  vi.useFakeTimers()
  try {
    await extensions.load()
    asked.length = 0
    builds.push(NOT_ANSWERING, NOT_ANSWERING, null)
    extensions.open('a', 't1', null)
    const popped = extensions.popped
    if (!popped) throw new Error('no popup')
    const building = extensions.build(popped, () => RECT)
    await vi.advanceTimersByTimeAsync(ASK_AGAIN * 2)
    await building
    expect(built()).toBe(3)
    expect(extensions.popped).toBe(popped)
    expect(extensions.list[0]?.problem).toBeNull()
  } finally {
    vi.useRealTimers()
    extensions.close()
  }
})

test('a popup that cannot be opened closes and says why on its button, and the app goes on', async () => {
  await extensions.load()
  builds.push('that popup could not be opened: no')
  extensions.open('a', 't1', null)
  const popped = extensions.popped
  if (!popped) throw new Error('no popup')
  await extensions.build(popped, () => RECT)
  expect(extensions.popped).toBeNull()
  expect(extensions.list[0]?.problem).toBe('that popup could not be opened: no')

  // And opened the next time, the button is itself again.
  extensions.open('a', 't1', null)
  const again = extensions.popped
  if (!again) throw new Error('no popup')
  await extensions.build(again, () => RECT)
  expect(extensions.list[0]?.problem).toBeNull()
  extensions.close()
})

test('a popup closed while its browser was busy is never built, and one closed while it was being built goes', async () => {
  vi.useFakeTimers()
  try {
    await extensions.load()
    asked.length = 0
    builds.push(NOT_ANSWERING)
    extensions.open('a', 't1', null)
    const popped = extensions.popped
    if (!popped) throw new Error('no popup')
    const building = extensions.build(popped, () => RECT)
    await Promise.resolve()
    extensions.close()
    await vi.advanceTimersByTimeAsync(ASK_AGAIN * 3)
    await building
    expect(built()).toBe(1)
  } finally {
    vi.useRealTimers()
  }

  asked.length = 0
  extensions.open('a', 't1', null)
  const late = extensions.popped
  if (!late) throw new Error('no popup')
  const building = extensions.build(late, () => RECT)
  extensions.close()
  await building
  expect(asked.map((one) => one.command)).toEqual(['extension_popup_open', 'extension_popup_close'])
})
