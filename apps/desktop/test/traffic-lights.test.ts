import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Where a Mac's traffic lights are, and where the room for them is left.
 *
 *  The lights are the system's and sit at the window's left edge whichever way the
 *  app's words run: the bundle carries no right-to-left localisation, so AppKit lays
 *  its titlebar out left to right however the reader set nib's language. They are
 *  about the screen rather than about reading, which docs/design.md says stays
 *  physical. The room left for them used to be `padding-inline-start`, so in Arabic,
 *  Persian, Pashto or Urdu it went to the right: the sidebar's head, docked on the
 *  right, kept an empty gap at its far edge, and the tab strip ran under the lights
 *  at its left. */

const src = join(dirname(fileURLToPath(import.meta.url)), '../src')
const read = (path: string) => readFileSync(join(src, path), 'utf8')

const titlebar = read('lib/Titlebar.svelte')
const sidebar = read('lib/Sidebar.svelte')

describe('the room left for the traffic lights', () => {
  test('is on the bar’s left edge, whichever way the words run', () => {
    expect(titlebar).toMatch(/header\.lights\s*\{\s*padding-left:\s*var\(--traffic-lights\)/)
    expect(titlebar).not.toMatch(/header\.lights\s*\{\s*padding-inline-start/)
  })

  /** Right to left, the sidebar docks at the window's right, so the window's top left
   *  corner is the bar's whether the sidebar is open or not. */
  test('is in the bar while the words run right to left, sidebar open or not', () => {
    expect(titlebar).toContain("i18n.direction === 'rtl'")
  })

  test('is in the sidebar’s head only while that head is at the window’s left', () => {
    expect(sidebar).toMatch(/:global\(\[data-lights\]:not\(\[dir='rtl'\]\)\) \.head/)
  })
})
