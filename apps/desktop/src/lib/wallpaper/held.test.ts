import { beforeEach, describe, expect, test, vi } from 'vitest'
import { DARK_KEY, heldDark, heldFor, heldWallpaper, WALLPAPER_KEY } from './held'

/** What the first frame reads. The entry is somebody else's text as far as this is
 *  concerned - an older build's, a half-written one - and the picture in it goes
 *  into a stylesheet, so anything not quite a picture is nothing. */

const entries = new Map<string, string>()

beforeEach(() => {
  entries.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  })
})

const GOOD = {
  picture: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
  blur: 28,
  dark: { floor: 0.7, ground: '#171c25' },
  light: { floor: 0.69, ground: '#f1f3f6' },
}

function write(value: unknown) {
  entries.set(WALLPAPER_KEY, JSON.stringify(value))
}

describe('what was written down', () => {
  test('is read back whole, an older record with its focal point in the middle', () => {
    write(GOOD)
    expect(heldWallpaper()).toEqual({ ...GOOD, focus: [0.5, 0.5] })
  })

  test('a record made now keeps what the picture holds instead of its floors', () => {
    const made = {
      picture: GOOD.picture,
      blur: 0,
      tone: '1.00 0.00 ',
      span: { least: [0, 10, 20], most: [250, 240, 230] },
      mean: '#808080',
      size: [1920, 1080],
      focus: [0.25, 0.75],
    }
    write(made)
    expect(heldWallpaper()).toEqual(made)
  })

  test('a focal point is held inside the picture, and a span out of range is none', () => {
    write({ ...GOOD, focus: [-1, 4] })
    expect(heldWallpaper()?.focus).toEqual([0, 1])
    write({ picture: GOOD.picture, blur: 0, span: { least: [0, 0, 0], most: [300, 0, 0] } })
    expect(heldWallpaper()).toBeNull()
  })

  test('is nothing when nothing was', () => {
    expect(heldWallpaper()).toBeNull()
    entries.set(WALLPAPER_KEY, '{"picture":')
    expect(heldWallpaper()).toBeNull()
  })

  test('is nothing where the picture is anything but a picture written out', () => {
    for (const picture of [
      'https://example.com/a.png',
      'file:///C:/Users/me/a.png',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:image/png;base64,AAAA") ; background: url("https://example.com',
    ]) {
      write({ ...GOOD, picture })
      expect(heldWallpaper(), picture).toBeNull()
    }
  })

  test('is nothing where a side is missing or out of range', () => {
    write({ ...GOOD, light: undefined })
    expect(heldWallpaper()).toBeNull()
    write({ ...GOOD, dark: { floor: 1.4, ground: '#000000' } })
    expect(heldWallpaper()).toBeNull()
    write({ ...GOOD, dark: { floor: 0.5, ground: 'red; color: blue' } })
    expect(heldWallpaper()).toBeNull()
  })

  test('follows the entry when it changes', () => {
    write(GOOD)
    expect(heldWallpaper()?.blur).toBe(28)
    write({ ...GOOD, blur: 40 })
    expect(heldWallpaper()?.blur).toBe(40)
  })
})

describe('the dark side', () => {
  test('wears the picture until it has its own', () => {
    write(GOOD)
    expect(heldDark()).toBeNull()
    expect(heldFor('dark')).toEqual(heldWallpaper())

    entries.set(DARK_KEY, JSON.stringify({ ...GOOD, blur: 12 }))
    expect(heldFor('dark')?.blur).toBe(12)
    expect(heldFor('light')?.blur).toBe(28)
  })
})
