/** The toast on the page, following the real undo stack.
 *
 *  What undo-toast.test.ts cannot ask: the component reads the stack inside an effect
 *  and writes its own batch in the same breath, and an effect that depended on what it
 *  wrote would run itself for ever and stop the page. So the stack is changed here the
 *  way the workspace changes it, and the toast has to come and go with it.
 *
 *  In the jsdom project because it mounts a component. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import UndoToast from '../../src/lib/UndoToast.svelte'
import { undoToast } from '../../src/lib/undo-toast.svelte'
import { workspace } from '../../src/lib/workspace.svelte'

/** jsdom has no animations, and the toast flies in. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

let host: HTMLElement
let shown: ReturnType<typeof mount>

beforeEach(() => {
  workspace.undone.stack = [{ kind: 'rename', from: 'Old.md', to: 'Older.md' }]
  host = document.createElement('div')
  document.body.append(host)
  shown = mount(UndoToast, { target: host })
  flushSync()
})

afterEach(() => {
  void unmount(shown)
  host.remove()
  workspace.undone.stack = []
  vi.restoreAllMocks()
})

test('what was done before it was there is not offered', () => {
  expect(host.textContent).toBe('')
})

test('a delete puts it up, and Undo takes it back and puts it away', async () => {
  const undo = vi.spyOn(workspace, 'undoFileAction').mockImplementation(() => {
    workspace.undone.drop()
    return Promise.resolve()
  })

  workspace.undone.record({ kind: 'delete', path: 'A.md', content: 'a' })
  workspace.undone.record({ kind: 'delete', path: 'B.md', content: 'b' })
  flushSync()
  expect(host.textContent).toContain('Deleted')

  host.querySelector('button')?.click()
  await vi.waitFor(() => expect(undo).toHaveBeenCalledTimes(2))
  flushSync()
  expect(workspace.undone.stack).toHaveLength(1)
  // Gone, on its way out: jsdom never finishes the fly, so the store is what is asked.
  expect(undoToast.kind).toBeNull()
})

test('the Undo row in a menu takes it away too', () => {
  workspace.undone.record({ kind: 'move', from: 'A.md', to: 'Archive/A.md' })
  flushSync()
  expect(host.textContent).toContain('Moved')

  workspace.undone.drop()
  flushSync()
  // Gone, on its way out: jsdom never finishes the fly, so the store is what is asked.
  expect(undoToast.kind).toBeNull()
})
