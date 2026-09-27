import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/** A Mac's window, which Tauri merges over the one in tauri.conf.json.
 *
 *  A merge replaces a list rather than walking into it, so the Mac's file repeats the
 *  whole of the window. What this holds is that it repeats it and nothing more: the
 *  keys that make the frame a Mac's own are the only ones allowed to differ. See
 *  launch.rs, which builds every later window the same way. */

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../src-tauri/${name}`, import.meta.url), 'utf8')) as {
    app: { windows: Record<string, unknown>[] }
  }

const OWN = ['decorations', 'titleBarStyle', 'hiddenTitle', 'trafficLightPosition']

describe("a Mac's window", () => {
  const base = read('tauri.conf.json').app.windows
  const mac = read('tauri.macos.conf.json').app.windows

  test('is the same window as everywhere else', () => {
    const strip = (window: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(window).filter(([key]) => !OWN.includes(key)))

    expect(mac).toHaveLength(base.length)
    expect(mac.map(strip)).toEqual(base.map(strip))
  })

  test("with the system's traffic lights over the app's own bar", () => {
    expect(mac[0]).toMatchObject({ decorations: true, titleBarStyle: 'Overlay', hiddenTitle: true })
  })
})
