import { afterEach, describe, expect, test, vi } from 'vitest'

/** Closing the window from the keyboard and the File menu.
 *
 *  Cmd+W closes the note, which is what it does in every tabbed editor. On a Mac it
 *  did nothing at all once the last note was closed, where Safari and VS Code close
 *  the window with it; and the window had no row of its own to close it by, which
 *  every Mac app's File menu has under Shift+Cmd+W. Both go the way the window's
 *  close button does, so an unsaved note is asked about first; see start.ts. */

const closed = vi.fn(() => Promise.resolve())
let os = 'macos'

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => os,
  closeWindow: closed,
}))

const { SHORTCUTS } = await import('./shortcuts/registry')
const { workspace } = await import('./workspace.svelte')
const { appMenu } = await import('./app-menu')
const { appCommands } = await import('./commands')

const context = { onpalette: () => undefined, onhistory: () => undefined }

/** The command a key runs, pressed the way the shortcut handler presses it. */
function press(id: string) {
  const entry = SHORTCUTS.find((one) => one.id === id)
  if (!entry?.run) throw new Error(`${id} runs nothing`)
  entry.run(context as never)
}

/** A window with one note open, or with none. */
function showing(tab: string | null) {
  vi.spyOn(workspace, 'activeTabId', 'get').mockReturnValue(tab)
  return vi.spyOn(workspace, 'closeActive').mockResolvedValue(undefined)
}

afterEach(() => {
  vi.restoreAllMocks()
  closed.mockClear()
  os = 'macos'
})

describe('Cmd+W', () => {
  test('closes the note that is open', () => {
    const closing = showing('one')
    press('app.close')

    expect(closing).toHaveBeenCalledOnce()
    expect(closed).not.toHaveBeenCalled()
  })

  test('closes the window on a Mac once nothing is left in it', () => {
    const closing = showing(null)
    press('app.close')

    expect(closed).toHaveBeenCalledOnce()
    expect(closing).not.toHaveBeenCalled()
  })

  test('and nowhere else, where one more press than notes would end the app', () => {
    os = 'windows'
    showing(null)
    press('app.close')

    expect(closed).not.toHaveBeenCalled()
  })
})

describe('Close window', () => {
  test('is Shift and the same key, and closes the window with a note in it', () => {
    showing('one')
    press('app.close-window')

    expect(SHORTCUTS.find((one) => one.id === 'app.close-window')?.key).toBe('Mod-Shift-w')
    expect(closed).toHaveBeenCalledOnce()
  })

  test('is a row of the File menu, after the ones that close a note', () => {
    const file = appMenu(context).find((group) => group.id === 'file')
    const labels = (file?.rows ?? []).flatMap((row) => (row && 'label' in row ? [row.label] : []))

    expect(labels.slice(-3)).toEqual(['Close note', 'Reopen closed tab', 'Close window'])
  })

  test('and a command of the palette, beside New window', () => {
    const ids = appCommands().map((one) => one.id)
    const row = appCommands().find((one) => one.id === 'close-window')

    expect(ids.indexOf('close-window')).toBe(ids.indexOf('new-window') + 1)
    row?.run()
    expect(closed).toHaveBeenCalledOnce()
  })
})
