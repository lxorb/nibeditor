import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The typed doors to the crate's web state commands: what each asks, under which
 *  names, and that an answer of the wrong shape is refused at the boundary rather than
 *  believed. The crate itself is stood in for; its own tests are in web_state/. */

interface World {
  desktop: boolean
  asked: { command: string; args: Record<string, unknown> | undefined }[]
  answer: unknown
}

const world = vi.hoisted((): World => ({ desktop: true, asked: [], answer: null }))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  get isDesktop() {
    return world.desktop
  },
  invoke: (command: string, args?: Record<string, unknown>) => {
    world.asked.push({ command, args })
    return Promise.resolve(world.answer)
  },
}))

const { NotHere, webKey, webState } = await import('./web-state')

const CAPTURED = {
  folder: 'C:/nib/web-state/out-1',
  manifest: { name: 'manifest', size: 812 },
  chunks: [{ name: 'a'.repeat(64), size: 4096 }],
  skipped: [{ name: 'mail-cache', version: 3, size: 90_000_000, why: 'large' }],
  cookies: 7,
}

const RESTORED = {
  cookies: 7,
  origins: 1,
  databases: 1,
  skipped: [],
  session: { origin: 'https://moodle.ethz.ch', items: [['step', '3']] },
  app: { zoom: 1.25 },
  engine: 'webview2',
  at: 1_700_000_000_000,
}

beforeEach(() => {
  world.desktop = true
  world.asked = []
  world.answer = null
})

describe('webState', () => {
  test('a capture asks for the store, the site, its origins and the tab', async () => {
    world.answer = CAPTURED
    const captured = await webState.capture(null, 'ethz.ch', ['https://moodle.ethz.ch'], 't1', {
      zoom: 1.25,
    })

    expect(captured.chunks[0]?.size).toBe(4096)
    expect(world.asked).toEqual([
      {
        command: 'web_state_capture',
        args: {
          store: null,
          site: 'ethz.ch',
          origins: ['https://moodle.ethz.ch'],
          tab: 't1',
          app: { zoom: 1.25 },
        },
      },
    ])
  })

  test('a restore names the manifest and hands the session back', async () => {
    world.answer = RESTORED
    const restored = await webState.restore('space_0-a', 'ethz.ch', 'C:/in-1/manifest')

    expect(restored.session?.items).toEqual([['step', '3']])
    expect(world.asked[0]).toEqual({
      command: 'web_state_restore',
      args: { store: 'space_0-a', site: 'ethz.ch', manifestPath: 'C:/in-1/manifest' },
    })
  })

  test('the session goes to its tab as the origin and the pairs', async () => {
    await webState.session('t1', { origin: 'https://moodle.ethz.ch', items: [['a', 'b']] })

    expect(world.asked[0]).toEqual({
      command: 'web_state_session',
      args: { tab: 't1', origin: 'https://moodle.ethz.ch', items: [['a', 'b']] },
    })
  })

  test('an answer of another shape is refused rather than believed', async () => {
    world.answer = { ...CAPTURED, skipped: [{ name: 'x', version: 1, size: 1, why: 'bored' }] }
    await expect(webState.capture(null, 'ethz.ch', [])).rejects.toThrow('answered something else')

    world.answer = { ...RESTORED, session: { origin: 'x', items: [['only one']] } }
    await expect(webState.restore(null, 'ethz.ch', 'm')).rejects.toThrow()

    world.answer = 42
    await expect(webState.inbox()).rejects.toThrow()
  })
})

describe('webKey', () => {
  test('the digits are six, and anything else is refused', async () => {
    world.answer = '048213'
    await expect(webKey.digits('cHVibGlj')).resolves.toBe('048213')
    expect(world.asked[0]).toEqual({ command: 'web_key_digits', args: { publicKey: 'cHVibGlj' } })

    world.answer = '48213'
    await expect(webKey.digits('cHVibGlj')).rejects.toThrow()
  })

  test('a wrap goes back in as it came out', async () => {
    world.answer = { wrapped: 'd3JhcHBlZA==', generation: 2 }
    const wrapped = await webKey.wrap('cHVibGlj')
    world.answer = null
    await webKey.accept(wrapped)

    expect(world.asked.map((one) => one.command)).toEqual(['web_key_wrap', 'web_key_accept'])
    expect(world.asked[1]?.args).toEqual({ wrapped: 'd3JhcHBlZA==', generation: 2 })
  })

  test('a lease key is sixty-four hex digits, and a computer not yet approved has none', async () => {
    world.answer = 'f'.repeat(64)
    await expect(webKey.lease(null, 'ethz.ch')).resolves.toHaveLength(64)
    world.answer = 'ETHZ'
    await expect(webKey.lease(null, 'ethz.ch')).rejects.toThrow()

    world.answer = null
    await expect(webKey.current()).resolves.toBeNull()
    world.answer = 3
    await expect(webKey.current()).resolves.toBe(3)
  })

  test('rotate, device and forget reach their commands', async () => {
    world.answer = 1
    await webKey.rotate()
    world.answer = 'cHVibGlj'
    await webKey.device()
    world.answer = null
    await webKey.forget()

    expect(world.asked.map((one) => one.command)).toEqual([
      'web_key_rotate',
      'web_key_device',
      'web_key_forget',
    ])
  })
})

describe('the browser build and the phone', () => {
  test('refuse every call without asking anybody', async () => {
    world.desktop = false
    for (const call of [
      () => webState.capture(null, 'ethz.ch', []),
      () => webState.restore(null, 'ethz.ch', 'm'),
      () => webState.inbox(),
      () => webKey.device(),
      () => webKey.rotate(),
      () => webKey.forget(),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(NotHere)
    }
    expect(world.asked).toEqual([])
  })
})
