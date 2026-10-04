import { describe, expect, test } from 'vitest'
import type { Row } from '@nib/bases'
import { rowsIn } from './fixtures'
import { type Host, pressOf, respond } from './presses'

function rig(content: string) {
  const rows = rowsIn('Work', 'Plan.md', content)
  const ticked: Row[] = []
  const opened: [string, string, number][] = []
  const host: Host = {
    rootOf: (space) => (space === 'Work' ? '/spaces/Work' : null),
    rowsAt: (path) => (path === '/spaces/Work/Plan.md' ? rows : []),
    ready: () => Promise.resolve(),
    tick(row) {
      ticked.push(row)
      return Promise.resolve(true)
    },
    open(root, path, line) {
      opened.push([root, path, line])
      return Promise.resolve()
    },
    inside: (root, path) => `${root}/${path}`,
  }
  const hash = rows.find((one) => one.kind === 'task')?.anchor?.hash ?? ''
  return { host, ticked, opened, hash }
}

describe('respond', () => {
  test('Done ticks the task its reminder was about, wherever its line went', async () => {
    const one = rig('New line\n\n- [ ] Call the bank 📅 2026-10-06\n')
    const done = await respond(
      { act: 'done', space: 'Work', path: 'Plan.md', hash: one.hash, line: 0 },
      one.host,
    )
    expect(done).toBe(true)
    expect(one.ticked.map((row) => row.task?.text)).toEqual(['Call the bank'])
  })

  test('a task ticked, edited or deleted since is left alone', async () => {
    const ticked = rig('- [x] Call the bank ✅ 2026-10-04\n')
    expect(
      await respond(
        { act: 'done', space: 'Work', path: 'Plan.md', hash: ticked.hash, line: 0 },
        ticked.host,
      ),
    ).toBe(false)

    const edited = rig('- [ ] Call the bank\n')
    expect(
      await respond(
        { act: 'done', space: 'Work', path: 'Plan.md', hash: 'other', line: 0 },
        edited.host,
      ),
    ).toBe(false)
    expect(edited.ticked).toEqual([])
  })

  test('a press opens the note at the line the task is on now', async () => {
    const one = rig('# Errands\n\n- [ ] Call the bank\n')
    await respond(
      { act: 'open', space: 'Work', path: 'Plan.md', hash: one.hash, line: 9 },
      one.host,
    )
    expect(one.opened).toEqual([['/spaces/Work', '/spaces/Work/Plan.md', 2]])
  })

  test('a space that is gone answers nothing', async () => {
    const one = rig('- [ ] Call\n')
    expect(
      await respond(
        { act: 'done', space: 'Gone', path: 'Plan.md', hash: one.hash, line: 0 },
        one.host,
      ),
    ).toBe(false)
  })
})

test('pressOf takes only a press', () => {
  expect(pressOf({ act: 'done', space: 'W', path: 'P.md', hash: 'h', line: 3 })).toEqual({
    act: 'done',
    space: 'W',
    path: 'P.md',
    hash: 'h',
    line: 3,
  })
  expect(pressOf({ act: 'delete', space: 'W', path: 'P.md', hash: 'h' })).toBeNull()
  expect(pressOf('done')).toBeNull()
})
