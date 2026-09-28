import { describe, expect, test } from 'vitest'
import { carry, isFileDrop, landing } from './drag-paths'

/** A transfer as a browser hands one over: the types while the drag is under way,
 *  the data once it lands. */
function transfer(types: string[] = []): DataTransfer {
  const data = new Map<string, string>()
  const held = {
    types,
    effectAllowed: 'none',
    setData: (type: string, value: string) => {
      data.set(type, value)
      if (!types.includes(type)) types.push(type)
    },
    getData: (type: string) => data.get(type) ?? '',
  }
  return held as unknown as DataTransfer
}

const drop = (dataTransfer: DataTransfer, keys: { ctrlKey?: boolean; altKey?: boolean } = {}) => ({
  dataTransfer,
  ctrlKey: keys.ctrlKey ?? false,
  altKey: keys.altKey ?? false,
})

describe('a drop on the file list', () => {
  test('moves its own rows, and lets the one dragging choose a copy instead', () => {
    const rows = transfer()
    carry(rows, ['/s/a.md'])

    expect(rows.effectAllowed).toBe('copyMove')
    expect(landing(drop(rows), 'win')).toBe('move')
  })

  test('copies them with Ctrl held, and with Alt on a Mac', () => {
    const rows = transfer()
    carry(rows, ['/s/a.md'])

    expect(landing(drop(rows, { ctrlKey: true }), 'win')).toBe('copy')
    expect(landing(drop(rows, { ctrlKey: true }), 'linux')).toBe('copy')
    expect(landing(drop(rows, { altKey: true }), 'mac')).toBe('copy')
    // Ctrl on a Mac is the right click, not a copy.
    expect(landing(drop(rows, { ctrlKey: true }), 'mac')).toBe('move')
  })

  test('copies in files from outside the app, whatever is held', () => {
    const files = transfer(['Files'])

    expect(isFileDrop(files)).toBe(true)
    expect(landing(drop(files), 'win')).toBe('copy')
  })

  test('and takes nothing else', () => {
    expect(landing(drop(transfer(['text/plain'])), 'win')).toBeNull()
    expect(landing({ dataTransfer: null, ctrlKey: false, altKey: false }, 'win')).toBeNull()
  })
})
