import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { overlays } from './overlays'

/** One overlay: whether it is open, and how it is closed. */
function sheet() {
  const it = { open: true, closed: 0 }
  const off = overlays.show(() => {
    it.open = false
    it.closed++
  })

  return { ...it, off, state: it }
}

/** An Escape, as much of one as `escape` reads: whether it was answered, and
 *  whether it goes on to the listeners after this one. */
function keystroke() {
  const press = {
    defaultPrevented: false,
    stopped: false,
    preventDefault: () => (press.defaultPrevented = true),
    stopImmediatePropagation: () => (press.stopped = true),
  }

  return press
}

describe('escape', () => {
  test('closes nothing when nothing is open', () => {
    expect(overlays.escape()).toBe(false)
  })

  test('closes the one that is open', () => {
    const one = sheet()

    expect(overlays.escape()).toBe(true)
    expect(one.state.open).toBe(false)

    one.off()
  })

  test('closes the newest first, and leaves the one underneath standing', () => {
    const settings = sheet()
    const dropdown = sheet()

    expect(overlays.escape()).toBe(true)
    expect(dropdown.state.open).toBe(false)
    expect(settings.state.open).toBe(true)

    expect(overlays.escape()).toBe(true)
    expect(settings.state.open).toBe(false)
    expect(overlays.escape()).toBe(false)

    settings.off()
    dropdown.off()
  })

  test('closes each overlay once, however fast the key is pressed twice', () => {
    const settings = sheet()
    const dropdown = sheet()

    // Two presses in the same moment: closing is a change to a component's own
    // state, which reaches this list a moment later.
    overlays.escape()
    overlays.escape()

    expect(dropdown.state.closed).toBe(1)
    expect(settings.state.closed).toBe(1)

    settings.off()
    dropdown.off()
  })

  /** A press that closed an overlay is spent. Other things on the page read
   *  Escape off the same window - the find bar over a note being read, the one
   *  over a PDF - and a key that closed the palette must not also shut the bar
   *  underneath it. */
  test('takes the keystroke with it, so nothing else acts on the same press', () => {
    const one = sheet()
    const press = keystroke()

    expect(overlays.escape(press)).toBe(true)
    expect(press.defaultPrevented).toBe(true)
    expect(press.stopped).toBe(true)

    one.off()
  })

  test('leaves a press nothing was open for alone', () => {
    const press = keystroke()

    expect(overlays.escape(press)).toBe(false)
    expect(press.defaultPrevented).toBe(false)
    expect(press.stopped).toBe(false)
  })

  /** Four deep: a full-screen deck, a sheet, the settings and a dropdown inside
   *  them. One press closes one, newest first, and the fourth press has nothing
   *  left to close - the deck goes last, which is what puts the caret back on
   *  the slide somebody stopped at. */
  test('unwinds a deep stack one press at a time, newest first', () => {
    const closed: string[] = []
    const offs = ['deck', 'sheet', 'settings', 'dropdown'].map((name) =>
      overlays.show(() => closed.push(name)),
    )

    while (overlays.escape()) {
      // Each press closes exactly one, so the order is the whole answer.
    }

    expect(closed).toEqual(['dropdown', 'settings', 'sheet', 'deck'])
    for (const off of offs) off()
  })

  test('an overlay that closes itself is no longer on the stack', () => {
    const one = sheet()
    one.off()

    expect(overlays.depth).toBe(0)
    expect(overlays.escape()).toBe(false)
    expect(one.state.closed).toBe(0)
  })

  test('one taken off from under another leaves the order it was in', () => {
    const settings = sheet()
    const dropdown = sheet()

    // The pane behind the dropdown was closed by something other than Escape.
    settings.off()

    expect(overlays.escape()).toBe(true)
    expect(dropdown.state.open).toBe(false)
    expect(overlays.depth).toBe(0)

    dropdown.off()
  })
})

/** The second question the stack answers: whether a web page has to be out of sight.
 *
 *  A web tab's page is a native webview, which draws above every pixel of HTML in the
 *  window, so the pane hides it - and holds its still picture instead - while anything
 *  is on this stack. That is right for a layer somebody opened over the note and will
 *  close again, and wrong for anything that stays up without being asked for: the
 *  update notice was one, and the page went blank for as long as it stood. So every
 *  caller is named here with what it is, and a new one fails this until somebody has
 *  said which kind it is. See `covered` in lib/web-tab/WebTab.svelte. */
describe('what hides a web page', () => {
  const src = fileURLToPath(new URL('..', import.meta.url))
  const read = (path: string) => readFileSync(join(src, path), 'utf8')

  /** Every file that puts something on the stack, and what it puts there. Each is drawn
   *  over the note, opened by a press or by a site's question, and closed again. */
  const LAYERS: Record<string, string> = {
    'App.svelte': 'a panel slid over the note as a drawer',
    'lib/AppMenuPanel.svelte': 'menu',
    'lib/CanvasBar.svelte': 'dropdown',
    'lib/ContextMenu.svelte': 'menu',
    'lib/GraphControls.svelte': 'dropdown',
    'lib/History.svelte': 'sheet',
    'lib/IconPicker.svelte': 'sheet',
    'lib/NewKindSheet.svelte': 'dialog',
    'lib/Palette.svelte': 'dialog',
    'lib/PromptSheet.svelte': 'dialog',
    'lib/Select.svelte': 'dropdown',
    'lib/SettingsPanel.svelte': 'sheet',
    'lib/Sheet.svelte': 'sheet',
    'lib/SignIn.svelte': 'sheet',
    'lib/Slides.svelte': 'a deck over the whole window',
    'lib/SpaceSwitcher.svelte': 'menu',
    'lib/ThemeStore.svelte': 'sheet',
    'lib/theme-picker/ThemePicker.svelte': 'the theme picker, over the switch or the note',
    'lib/web-tab/AddressField.svelte': 'the suggestions under the address',
    'lib/web-tab/WebAsk.svelte': "a site's question, under the bar",
    'lib/web-tab/WebDownloads.svelte': 'bubble',
    'lib/web-tab/WebSite.svelte': 'bubble',
  }

  /** What stays up without being asked for, and so may never be over a page. */
  const FURNITURE = [
    'lib/UpdateNotice.svelte',
    'lib/StorageWarning.svelte',
    'lib/RecordingPill.svelte',
  ]

  function sources(): string[] {
    return readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((path) => /\.(svelte|ts)$/.test(path) && !path.endsWith('.test.ts'))
      .map((path) => path.replaceAll('\\', '/'))
  }

  test('every layer on the stack is one somebody opened over the note', () => {
    const callers = sources().filter((path) => read(path).includes('overlays.show('))
    expect(callers.sort()).toEqual(Object.keys(LAYERS).sort())
  })

  test('full screen is a mode and not a layer, so a page fills it', () => {
    expect(read('App.svelte')).not.toMatch(/fullscreen\.on \? overlays\.show/)
  })

  test("the app's own furniture is on no stack and floats over nothing", () => {
    for (const path of FURNITURE) {
      const text = read(path)
      expect(text, path).not.toContain('overlays')
      expect(text, path).not.toMatch(/position:\s*(fixed|absolute)/)
    }
  })

  test('it takes a row of its own under the panes instead', () => {
    const app = read('App.svelte')
    // Written once, as a snippet: the row is drawn in the note's column, or under the
    // drawer as well where the panels are one.
    const row = app.slice(app.indexOf('<div class="notices"'))
    const end = row.indexOf('{/snippet}')

    expect(end).toBeGreaterThan(0)
    for (const name of ['StorageWarning', 'RecordingPill', 'UpdateNotice']) {
      expect(row.slice(0, end), name).toContain(`<${name}`)
      expect(app.split(`<${name}`).length - 1, name).toBe(1)
    }
  })

  /** Where the panels are a drawer, the note slides off the screen to show the list,
   *  and a row inside the note went with it: the Undo for a file deleted from the
   *  list was off the side of a phone, where nobody could see it or press it. */
  test('where the panels are a drawer it is under the list and the note, not in the note', () => {
    const app = read('App.svelte')
    const main = app.slice(app.indexOf('<div class="middle"'), app.indexOf('</main>'))
    const after = main.slice(main.lastIndexOf('\n  </div>'))

    expect(after).toContain('{#if viewport.drawer}')
    expect(after).toContain('{@render notices()}')
    expect(app).toContain('{#if !viewport.drawer}\n        {@render notices()}')
  })
})
