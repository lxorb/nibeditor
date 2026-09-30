import { describe, expect, test } from 'vitest'
import { resolve } from './anchors'
import { readNote } from './read'
import { deskWith } from './test-desk'

const NOTE = [
  '---',
  'tags: plan',
  '---',
  '# Plan',
  '- [ ] Buy milk',
  '- [x] Call Anna',
  '',
  '## Later',
  'An idea worth keeping ^idea',
  '',
  '# Log',
  '## Later',
  '- [ ] Buy milk',
  '',
].join('\n')

describe('a note, read', () => {
  test('is the words as the reader has them, unsaved ones and all', async () => {
    const { desk, panes } = deskWith({ 'plan.md': 'saved' }, ['plan.md'])
    panes['plan.md']?.type(5, ' and typed')

    const read = await readNote(desk, { path: 'plan.md' })

    expect(read).toMatchObject({
      path: 'plan.md',
      space: 'Space',
      open: true,
      text: 'saved and typed',
    })
    expect(read.typing).toBe(true)
  })

  test('carries a rev that is the same open or closed, and not across one keystroke', async () => {
    const closed = await readNote(deskWith({ 'plan.md': 'words' }).desk, { path: 'plan.md' })
    const open = deskWith({ 'plan.md': 'words' }, ['plan.md'])
    const first = await readNote(open.desk, { path: 'plan.md' })
    open.panes['plan.md']?.type(0, 'x')
    const second = await readNote(open.desk, { path: 'plan.md' })

    expect(first.rev).toBe(closed.rev)
    expect(second.rev).not.toBe(first.rev)
  })

  test('with the one line ending the editor holds, whatever the file has', async () => {
    const read = await readNote(deskWith({ 'crlf.md': 'a\r\nb\r\n' }).desk, { path: 'crlf.md' })
    expect(read.text).toBe('a\nb\n')
  })

  test('hands an anchor for every heading, task and block, each naming exactly it', async () => {
    const read = await readNote(deskWith({ 'plan.md': NOTE }).desk, { path: 'plan.md' })

    expect(read.outline?.map((row) => row.anchor)).toEqual([
      { heading: 'Plan' },
      { heading: 'Plan/Later' },
      { heading: 'Log' },
      { heading: 'Log/Later' },
    ])
    expect(read.tasks?.map((row) => [row.anchor, row.done])).toEqual([
      [{ task: 'Buy milk', nth: 1 }, false],
      [{ task: 'Call Anna' }, true],
      [{ task: 'Buy milk', nth: 2 }, false],
    ])
    expect(read.blocks).toEqual([
      // The run of lines the name sits in, heading and all, as a link to it reads it.
      { anchor: { block: 'idea' }, line: 7, text: 'Later' },
    ])

    const lines = NOTE.split('\n')
    const rows = [...(read.outline ?? []), ...(read.tasks ?? []), ...(read.blocks ?? [])]
    for (const row of rows) {
      const place = resolve(row.anchor, NOTE)
      expect(NOTE.slice(place.from).startsWith(lines[row.line] ?? '')).toBe(true)
    }
  })

  test('says only what it was asked', async () => {
    const read = await readNote(deskWith({ 'plan.md': NOTE }).desk, { path: 'plan.md' }, [
      'properties',
    ])

    expect(Object.keys(read).sort()).toEqual([
      'open',
      'path',
      'properties',
      'rev',
      'space',
      'typing',
    ])
    expect(read.properties?.map((one) => one.key)).toEqual(['tags'])
  })

  test('where the reader is only for the note in front of them', async () => {
    const { desk } = deskWith({ 'plan.md': NOTE }, ['plan.md'])
    const read = await readNote(desk, { path: 'plan.md' }, ['selection'])
    expect(read.selection).toBeNull()
  })

  test('refuses a list of parts it does not know', async () => {
    await expect(
      readNote(deskWith({ 'plan.md': '' }).desk, { path: 'plan.md' }, ['everything']),
    ).rejects.toThrow('include is some of')
  })
})
