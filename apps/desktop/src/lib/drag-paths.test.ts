import { describe, expect, test } from 'vitest'
import { carry, isFileDrop, isLinkDrop, landing } from './drag-paths'

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

  /** A link out of a page becomes a web note; a picture out of a page is a file. */
  test('keeps a link dragged out of a page, and a picture as the file it carries', () => {
    const link = transfer(['text/uri-list', 'text/html', 'text/plain'])
    expect(isLinkDrop(link)).toBe(true)
    expect(landing(drop(link), 'win')).toBe('copy')

    const picture = transfer(['text/uri-list', 'text/html', 'Files'])
    expect(isLinkDrop(picture)).toBe(false)
    expect(isFileDrop(picture)).toBe(true)

    // A sentence carries no link list, and leaves the page as nothing.
    expect(isLinkDrop(transfer(['text/plain', 'text/html']))).toBe(false)
  })

  test('and takes nothing else', () => {
    expect(landing(drop(transfer(['text/plain'])), 'win')).toBeNull()
    expect(landing({ dataTransfer: null, ctrlKey: false, altKey: false }, 'win')).toBeNull()
  })
})
