import { describe, expect, test } from 'vitest'
import { withOwn } from './own-file'
import { readShortcut, readWebloc, writeShortcut } from './shortcut'

const WHEN = new Date('2026-09-12T08:30:00.000Z')

describe('the file a website is written as', () => {
  test('is an internet shortcut, and nothing more than one', () => {
    expect(writeShortcut('https://svelte.dev/docs', 'Svelte docs', WHEN)).toBe(
      '[InternetShortcut]\r\n' +
        'URL=https://svelte.dev/docs\r\n' +
        'Title=Svelte docs\r\n' +
        'Nib-Added=2026-09-12T08:30:00.000Z\r\n',
    )
  })

  test('is written with the line ending the format is read with', () => {
    expect(writeShortcut('https://a.example/', 'A', WHEN)).not.toContain('\n\n')
    expect(writeShortcut('https://a.example/', 'A', WHEN).split('\r\n')).toHaveLength(5)
  })

  test('says the address where a page has no title of its own', () => {
    expect(writeShortcut('https://a.example/', '   ', WHEN)).toContain('Title=https://a.example/')
  })

  test('keeps a title that arrived with a newline in it on one line', () => {
    const written = writeShortcut('https://a.example/', 'Two\nlines', WHEN)
    expect(written).toContain('Title=Two lines')
    expect(written.split('\r\n')).toHaveLength(5)
  })

  test('reads back exactly what it wrote', () => {
    const said = readShortcut(writeShortcut('https://svelte.dev/docs', 'Svelte docs', WHEN))
    expect(said).toEqual({
      url: 'https://svelte.dev/docs',
      title: 'Svelte docs',
      added: '2026-09-12T08:30:00.000Z',
      home: null,
      icon: null,
      own: null,
    })
  })

  // #239: a web note that keeps its own web data says so in its file, so the choice moves,
  // is renamed and syncs with the note.
  test('says a note keeps its own web data, and reads it back', () => {
    const written = writeShortcut('https://a.example', 'A', WHEN, null, null, '3f9a0c17e2b4d685')
    expect(written).toContain('Nib-Data=3f9a0c17e2b4d685\r\n')
    expect(readShortcut(written)?.own).toBe('3f9a0c17e2b4d685')
    expect(writeShortcut('https://a.example', 'A', WHEN)).not.toContain('Nib-Data')
  })

  test('and reads anything else in that key as a note that shares the one store', () => {
    for (const value of ['', 'yes', '3F9A0C17E2B4D68', '../web', '3f9a0c17e2b4d685x']) {
      const text = `[InternetShortcut]\r\nURL=https://a.example\r\nNib-Data=${value}\r\n`
      expect(readShortcut(text)?.own, value).toBeNull()
    }
    const loose = '[InternetShortcut]\nURL=https://a.example\nnib-data= 3F9A0C17E2B4D685 '
    expect(readShortcut(loose)?.own).toBe('3f9a0c17e2b4d685')
    expect(writeShortcut('https://a.example', 'A', WHEN, null, null, 'not an id')).not.toContain(
      'Nib-Data',
    )
  })

  // A web note is a browser tab: `URL` is the page the reading has got to, so that
  // opening the note again opens that page, and the address the note points at is kept
  // beside it. See keep.ts and docs/web-tabs.md.
  test('keeps where the note points when the reading has moved on', () => {
    const written = writeShortcut(
      'https://svelte.dev/docs/svelte/what-are-runes',
      'Svelte docs',
      WHEN,
      'https://svelte.dev/docs',
      'https://svelte.dev/favicon.png',
    )

    expect(written).toContain('URL=https://svelte.dev/docs/svelte/what-are-runes')
    expect(written).toContain('Nib-Home=https://svelte.dev/docs')
    expect(written).toContain('Nib-Icon=https://svelte.dev/favicon.png')

    const said = readShortcut(written)
    expect(said?.url).toBe('https://svelte.dev/docs/svelte/what-are-runes')
    expect(said?.home).toBe('https://svelte.dev/docs')
    expect(said?.icon).toBe('https://svelte.dev/favicon.png')
  })

  // The ordinary file is the three lines it always was: a note nobody has followed a
  // link out of says nothing it has nothing to say.
  test('says nothing about home when the reading is where the note points', () => {
    const written = writeShortcut('https://a.example/', 'A', WHEN, 'https://a.example/', null)
    expect(written).not.toContain('Nib-Home')
    expect(written).not.toContain('Nib-Icon')
    expect(written.split('\r\n')).toHaveLength(5)
  })
})

describe('a shortcut somebody else wrote', () => {
  test('is read whatever case and spacing it uses', () => {
    const said = readShortcut('[internetshortcut]\r\n url = https://a.example/page \r\n')
    expect(said?.url).toBe('https://a.example/page')
    // No title in the file: the name on disk is the only name there is.
    expect(said?.title).toBe(null)
  })

  test('keeps every equals sign after the first, because an address is full of them', () => {
    const said = readShortcut('[InternetShortcut]\nURL=https://a.example/?a=1&b=2\n')
    expect(said?.url).toBe('https://a.example/?a=1&b=2')
  })

  test('steps over the keys a browser leaves behind', () => {
    const said = readShortcut(
      '[InternetShortcut]\r\nIDList=\r\nURL=https://a.example/\r\n' +
        'IconFile=C:\\icons\\a.ico\r\nIconIndex=0\r\nHotKey=0\r\nModified=90\r\n',
    )
    expect(said?.url).toBe('https://a.example/')
  })

  test('reads only the keys in the shortcut block', () => {
    const said = readShortcut(
      '[DEFAULT]\r\nBASEURL=https://wrong.example/\r\n' +
        '[InternetShortcut]\r\nURL=https://right.example/\r\n' +
        '[{000214A0-0000-0000-C000-000000000046}]\r\nProp3=19,2\r\n',
    )
    expect(said?.url).toBe('https://right.example/')
  })

  test('takes the first of two keys that say the same thing twice', () => {
    const said = readShortcut('[InternetShortcut]\nURL=https://first.example/\nURL=https://b/\n')
    expect(said?.url).toBe('https://first.example/')
  })

  test('is not a website when it points anywhere but the web', () => {
    expect(readShortcut('[InternetShortcut]\r\nURL=file:///C:/notes/Idea.md\r\n')).toBe(null)
    expect(readShortcut('[InternetShortcut]\r\nURL=javascript:alert(1)\r\n')).toBe(null)
    expect(readShortcut('[InternetShortcut]\r\nIconIndex=0\r\n')).toBe(null)
    expect(readShortcut('URL=https://a.example/')).toBe(null)
    expect(readShortcut('')).toBe(null)
    expect(readShortcut(null)).toBe(null)
  })
})

describe('a shortcut a Mac wrote', () => {
  test('is the string after the key called URL', () => {
    expect(
      readWebloc(
        '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n' +
          '\t<key>URL</key>\n\t<string>https://svelte.dev/docs</string>\n</dict>\n</plist>\n',
      ),
    ).toBe('https://svelte.dev/docs')
  })

  test('comes back with its escapes undone', () => {
    expect(
      readWebloc('<dict><key>URL</key><string>https://a.example/?a=1&amp;b=2</string></dict>'),
    ).toBe('https://a.example/?a=1&b=2')
  })

  test('and is nothing when the plist says nothing this app can open', () => {
    expect(readWebloc('<dict><key>URL</key><string>ftp://a.example/</string></dict>')).toBe(null)
    expect(readWebloc('<dict><key>Name</key><string>A</string></dict>')).toBe(null)
    expect(readWebloc('bplist00')).toBe(null)
    expect(readWebloc('')).toBe(null)
    expect(readWebloc(null)).toBe(null)
  })
})

describe('a web note turned apart or shared again', () => {
  test('keeps everything the file said, its own web data aside', () => {
    const was = writeShortcut('https://a.example/page', 'A', WHEN, 'https://a.example', 'data:x')
    const apart = withOwn('/S/A.url', was, '3f9a0c17e2b4d685')
    expect(readShortcut(apart)).toEqual({ ...readShortcut(was), own: '3f9a0c17e2b4d685' })
    expect(withOwn('/S/A.url', apart, null)).toBe(was)
  })

  test('and writes nothing over a file it does not write', () => {
    expect(withOwn('/S/A.webloc', '<plist/>', '3f9a0c17e2b4d685')).toBeNull()
    expect(withOwn('/S/A.url', 'not a shortcut', '3f9a0c17e2b4d685')).toBeNull()
    expect(withOwn('/S/A.url', null, null)).toBeNull()
  })
})
