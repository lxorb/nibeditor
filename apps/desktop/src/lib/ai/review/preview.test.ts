import { describe, expect, test } from 'vitest'
import { previewOf } from './preview'

const spaces = [{ id: 's1', name: 'Work', root: '/work' }]
const words = (notes: Record<string, string>) => (path: string) =>
  Promise.resolve(notes[path] ?? null)

describe('the change a write that asked would make', () => {
  test('is the edit worked out the way the write works it out', async () => {
    const shown = await previewOf(
      'edit_note',
      { path: 'Plan', edits: [{ at: { quote: 'two' }, replace: 'TWO' }] },
      spaces,
      's1',
      words({ '/work/Plan.md': 'one\ntwo\nthree' }),
    )
    expect(shown?.path).toBe('Plan.md')
    expect(shown?.rows.filter((row) => row.change !== 'same')).toEqual([
      expect.objectContaining({ change: 'removed', text: 'two' }),
      expect.objectContaining({ change: 'added', text: 'TWO' }),
    ])
  })

  test('is a new note’s every line, in the space it names', async () => {
    const shown = await previewOf(
      'mcp__nib__create_note',
      { path: 'New', space: 'Work', content: 'a\nb' },
      spaces,
      undefined,
      words({}),
    )
    expect(shown?.rows.map((row) => row.change)).toEqual(['added', 'added'])
  })

  test('is nothing for a call it cannot work out', async () => {
    const said = words({ '/work/Plan.md': 'one' })
    expect(await previewOf('set_task', { path: 'Plan' }, spaces, 's1', said)).toBeNull()
    expect(
      await previewOf(
        'edit_note',
        { path: 'Plan', edits: [{ at: { quote: 'zzz' }, replace: 'x' }] },
        spaces,
        's1',
        said,
      ),
    ).toBeNull()
    expect(await previewOf('edit_note', { tab: 't1', path: 'x' }, spaces, 's1', said)).toBeNull()
  })
})
