import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The marks on a PDF, through the two commands that keep them beside it.
 *
 *  The crate answers an empty sidecar for a PDF nobody has marked, and fails the
 *  read only where there is a file it will not read: one past the size it allows,
 *  one another program holds. That file is somebody's marks, and a sheet that
 *  reads as none and may be written would put the next highlight over all of them. */

const disk = { refuse: false, written: [] as string[] }

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'read_highlights') {
      return disk.refuse
        ? Promise.reject(new Error('could not read the sidecar'))
        : Promise.resolve('')
    }
    if (command === 'write_highlights') disk.written.push(String(args?.content))
    return Promise.resolve(undefined)
  },
}))

const { loadHighlights, saveHighlights } = await import('./sidecar')

beforeEach(() => {
  disk.refuse = false
  disk.written = []
})

describe('the marks on a PDF', () => {
  test('start empty and are written where there are none yet', async () => {
    const sheet = await loadHighlights('/space/paper.pdf')

    expect(sheet.highlights).toEqual([])
    expect(await saveHighlights('/space/paper.pdf', sheet)).toBe(true)
    expect(disk.written).toHaveLength(1)
  })

  test('are left alone where the sidecar is there and will not read', async () => {
    disk.refuse = true
    const sheet = await loadHighlights('/space/paper.pdf')

    expect(await saveHighlights('/space/paper.pdf', sheet)).toBe(false)
    expect(disk.written).toEqual([])
  })
})
