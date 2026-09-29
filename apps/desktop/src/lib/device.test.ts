import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The iOS build, whose WebKit calls an iPad a Mac. */
vi.mock('./tauri', () => ({ isNative: true, isMobile: true, platform: () => 'ios' }))

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

const IPAD_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'

/** A fresh module each time, since the name is worked out once and then held. */
async function named(width: number, height: number): Promise<string> {
  vi.stubGlobal('screen', { width, height })
  vi.stubGlobal('navigator', { userAgent: IPAD_AGENT })
  vi.resetModules()
  const { deviceName } = await import('./device')
  return deviceName()
}

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

describe('what an iOS build calls itself', () => {
  test('an iPad, whichever way round it is held, though its WebKit says Mac', async () => {
    expect(await named(1024, 1366)).toBe('iPad')
    localStorage.clear()
    expect(await named(1366, 1024)).toBe('iPad')
  })

  test('an iPhone', async () => {
    expect(await named(440, 956)).toBe('iPhone')
  })
})
