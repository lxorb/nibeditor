import { beforeEach, describe, expect, test, vi } from 'vitest'
import { heldWallpaper, pictureRule, WALLPAPER_KEY } from './held'

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
  test('is read back whole', () => {
    write(GOOD)
    expect(heldWallpaper()).toEqual(GOOD)
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

describe('the rule it is said in', () => {
  test('names the picture and both sides', () => {
    const rule = pictureRule(GOOD)

    expect(rule).toContain(`--wallpaper-picture: url("${GOOD.picture}");`)
    expect(rule).toContain('--wallpaper-floor-dark: 70%;')
    expect(rule).toContain('--wallpaper-floor-light: 69%;')
    expect(rule).toContain('--wallpaper-ground-dark: #171c25;')
    expect(rule).toContain('--wallpaper-ground-light: #f1f3f6;')
    expect(rule.startsWith(':root {')).toBe(true)
  })
})
