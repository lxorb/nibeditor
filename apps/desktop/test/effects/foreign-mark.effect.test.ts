/** The mark a row and a tab give another sync tool's copy: a struck-through cloud whose
 *  label says which tool made it and that nib does not carry it, on that copy and
 *  nowhere else. Through the one door both marks of sync share, so a held note's mark
 *  is still drawn beside it. See foreign/ForeignMark.svelte and @nib/sync-core/foreign.
 *
 *  In the jsdom project because the label is worked out by an effect. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'

const SyncMark = (await import('../../src/lib/SyncMark.svelte')).default

const marks = document.createElement('div')
document.body.append(marks)
const mounted: ReturnType<typeof mount>[] = []

function draw(path: string | null) {
  mounted.push(mount(SyncMark, { target: marks, props: { path } }))
  flushSync()
}

function labels(): (string | null)[] {
  return [...marks.querySelectorAll('[role="img"]')].map((one) => one.getAttribute('aria-label'))
}

afterEach(() => {
  for (const one of mounted.splice(0)) void unmount(one)
})

test('another sync tool’s copy says which tool, and that it is not synced', () => {
  draw('C:\\Nib\\Work\\Hackathon List (# Name clash 2026-10-05 k3x9qaC #).md')
  draw('/home/emil/Nib/Plan.sync-conflict-20231012-143052-CEIVOCO.md')

  expect(labels()).toEqual([
    'Proton conflict copy · not synced',
    'Syncthing conflict copy · not synced',
  ])
  expect(marks.querySelectorAll('.foreign')).toHaveLength(2)
})

test('a note of somebody’s own, and a row with no file, wear nothing', () => {
  draw('/space/Plan.md')
  draw('/space/Plan (1).md')
  draw('/space/Plan (from another device 2026-09-12).md')
  draw(null)

  expect(labels()).toEqual([])
})
