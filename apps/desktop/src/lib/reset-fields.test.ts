import { describe, expect, test } from 'vitest'

import type { Field } from './preferences'
import { resetFields } from './reset-fields'

/** Every value written, in order, so a test can see what a reset touched. */
function recorder() {
  const written: unknown[] = []
  return { written, write: (value: unknown) => void written.push(value) }
}

describe('putting settings back', () => {
  test('writes each field of every kind that differs back to where it started', () => {
    const { written, write } = recorder()
    const fields: Field[] = [
      { kind: 'switch', label: 'On', initial: true, get: () => false, set: write },
      {
        kind: 'slider',
        label: 'Size',
        min: 8,
        max: 32,
        step: 1,
        initial: 16,
        get: () => 24,
        set: write,
      },
      {
        kind: 'select',
        label: 'Scheme',
        options: [],
        initial: 'system',
        get: () => 'dark',
        set: write,
      },
      {
        kind: 'segmented',
        label: 'Side',
        options: [],
        initial: 'left',
        get: () => 'right',
        set: write,
      },
      {
        kind: 'text',
        label: 'Phrase',
        placeholder: 'next',
        initial: '',
        get: () => 'on',
        set: write,
      },
    ]

    resetFields(fields)

    expect(written).toEqual([true, 16, 'system', 'left', ''])
  })

  test('leaves one already where it started untouched, since a switch may be a toggle', () => {
    let on = true
    const toggle: Field = {
      kind: 'switch',
      label: 'On',
      initial: true,
      get: () => on,
      set: () => {
        on = !on
      },
    }

    resetFields([toggle])

    expect(on).toBe(true)
  })

  test('and one that does not say what it started as', () => {
    const { written, write } = recorder()

    resetFields([
      { kind: 'slider', label: 'Width', min: 0, max: 80, step: 1, get: () => 40, set: write },
    ])

    expect(written).toEqual([])
  })
})
