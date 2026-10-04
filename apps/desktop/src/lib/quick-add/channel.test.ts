import { describe, expect, test } from 'vitest'
import { heard } from './channel'

/** A message over the channel is a value crossing a boundary: checked once, here. */

describe('what the global window and the app say', () => {
  const task = { text: 'Call mum', fields: { tags: ['family'], remind: [{ before: 15 }] } }

  test('is heard when it is one of ours', () => {
    expect(heard({ kind: 'hello' })).toEqual({ kind: 'hello' })
    expect(heard({ kind: 'task', entry: task, open: false })).toEqual({
      kind: 'task',
      entry: task,
      open: false,
    })
    expect(heard({ kind: 'world', notes: ['Inbox'], lang: 'de', smart: true })?.kind).toBe('world')
  })

  test('and nothing else is', () => {
    expect(heard(null)).toBeNull()
    expect(heard('task')).toBeNull()
    expect(heard({ kind: 'task', entry: { text: 1, fields: {} }, open: false })).toBeNull()
    expect(
      heard({
        kind: 'task',
        entry: { ...task, fields: { ...task.fields, priority: 9 } },
        open: true,
      }),
    ).toBeNull()
    expect(heard({ kind: 'world', notes: 'Inbox', lang: 'de', smart: true })).toBeNull()
  })
})
