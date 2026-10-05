import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

/** A session an older nib wrote, with the scratchpad open as a tab and another closed:
 *  both go on the way in, the words the open one had not written yet are written to the
 *  file first, and the other tabs come back as they were. See `tabsAlong` in
 *  workspace.svelte.ts. */

vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
vi.stubGlobal('requestIdleCallback', (run: () => void) => setTimeout(run, 0))

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') return Promise.resolve([{ name: 'Work', path: '/spaces/Work' }])
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const PLAN = '/spaces/Work/Plan.md'
const PAD = '/app/Scratchpad.md'

const draft = (path: string, doc: string, dirty: boolean) => ({
  kind: 'note',
  path,
  name: path.split('/').pop(),
  doc,
  dirty,
  cursor: 0,
  scroll: 0,
})

test('an older session’s scratchpad tab is dropped, its words kept', async () => {
  const { Disk } = await import('../disk')
  disk.current = new Disk()
  disk.current.files.set(PLAN, '# Plan\n')
  disk.current.files.set(PAD, 'Old words\n')
  localStorage.clear()
  localStorage.setItem(
    'nib:workspace',
    JSON.stringify({
      version: 2,
      spaces: [{ id: 'work', name: 'Work', root: '/spaces/Work' }],
      activeSpace: 'work',
      panel: null,
      layout: {
        frame: {
          kind: 'pane',
          pane: {
            id: 'p1',
            tabs: [
              draft(PLAN, '# Plan\n', false),
              draft(PAD, 'Old words\nNot yet written\n', true),
            ],
            active: 1,
            linked: false,
          },
        },
        focused: 'p1',
        panel: null,
      },
      closed: [{ draft: draft(PAD, 'Old words\n', false), paneId: 'p1', at: 1 }],
    }),
  )

  const { workspace } = await import('../../src/lib/workspace.svelte')
  await workspace.restore()
  flushSync()

  expect(workspace.tabs.map((one) => one.path)).toEqual([PLAN])
  expect(workspace.active?.path).toBe(PLAN)
  expect(disk.current.files.get(PAD)).toBe('Old words\nNot yet written\n')

  // And the closed one is never reopened as a tab.
  await workspace.reopenClosed()
  expect(workspace.tabs.some((one) => one.path === PAD)).toBe(false)
})
