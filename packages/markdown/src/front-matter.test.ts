import { describe, expect, test } from 'vitest'
import {
  frontMatter,
  frontMatterEdit,
  frontMatterEdits,
  frontMatterList,
  frontMatterValue,
  stripFrontMatter,
  writeFrontMatter,
} from './front-matter'

/** What the block is read as. The three readers of it - an export, a search and
 *  the icon a row wears - all come through these. */
describe('reading the front matter', () => {
  test('the block, and nothing where a note has none', () => {
    expect(frontMatter('---\ntitle: Hi\n---\n\nBody')).toBe('title: Hi')
    expect(frontMatter('No front matter')).toBeNull()
    // A rule in the middle of a note did not open a block.
    expect(frontMatter('# Title\n\n---\n\nmore')).toBeNull()
  })

  test('a closing fence is a line that says nothing else', () => {
    expect(frontMatter('---\ntitle: Hi\n----\n\nBody')).toBeNull()
    expect(frontMatter('---\ntitle: Hi\n--- and more\n\nBody')).toBeNull()
  })

  /** Obsidian's rule, and the twin of "an indented opening fence opens nothing"
   *  in front_matter.rs, which used to take an indented one and so read a note
   *  the browser build read as prose. */
  test('an opening fence stands at the left margin', () => {
    expect(frontMatter('  ---\ntitle: Hi\n---\n\nBody')).toBeNull()
    expect(frontMatter('\t---\ntitle: Hi\n---\n\nBody')).toBeNull()
    // Space after the fence is nothing at all, though.
    expect(frontMatter('---  \ntitle: Hi\n---\n\nBody')).toBe('title: Hi')
  })

  test('the note without it, which is what a renderer reads', () => {
    expect(stripFrontMatter('---\ntitle: Hi\n---\n# Title')).toBe('# Title')
    expect(stripFrontMatter('# Title')).toBe('# Title')
  })

  test('one key, quotes off, and never a key indented under another', () => {
    const source = '---\ntitle: "Field Notes"\nauthor: Ada\nexport:\n  paper: A5\n---\n\nBody'

    expect(frontMatterValue(source, 'title')).toBe('Field Notes')
    expect(frontMatterValue(source, 'author')).toBe('Ada')
    expect(frontMatterValue(source, 'paper')).toBeNull()
    expect(frontMatterValue(source, 'missing')).toBeNull()
  })

  test('a key with nothing after it says nothing', () => {
    expect(frontMatterValue('---\nicon:\n---\n', 'icon')).toBeNull()
  })
})

/** The shapes a note may write a list in. Obsidian writes `aliases` all three
 *  ways depending on how it was typed, so all three are read. */
describe('reading a key as a list', () => {
  const front = (body: string) => `---\n${body}\n---\n\nWords.\n`

  test('reads a flow sequence', () => {
    expect(frontMatterList(front('aliases: [One, Two]'), 'aliases')).toEqual(['One', 'Two'])
  })

  test('reads the lines written under the key', () => {
    expect(frontMatterList(front('aliases:\n  - One\n  - Two'), 'aliases')).toEqual(['One', 'Two'])
    expect(frontMatterList(front('aliases:\n- One\n- Two'), 'aliases')).toEqual(['One', 'Two'])
  })

  test('reads a single value as a list of one', () => {
    expect(frontMatterList(front('aliases: One'), 'aliases')).toEqual(['One'])
  })

  test('takes the quotes off, whichever they are', () => {
    expect(frontMatterList(front('aliases: ["One", \'Two\']'), 'aliases')).toEqual(['One', 'Two'])
    expect(frontMatterList(front('aliases:\n  - "One two"'), 'aliases')).toEqual(['One two'])
  })

  test('stops at the next key of the note’s own', () => {
    const body = 'aliases:\n  - One\ntitle: Not an alias\n'
    expect(frontMatterList(front(body), 'aliases')).toEqual(['One'])
  })

  test('is nothing where there is nothing to read', () => {
    expect(frontMatterList('Words.\n', 'aliases')).toEqual([])
    expect(frontMatterList(front('title: A note'), 'aliases')).toEqual([])
    expect(frontMatterList(front('aliases:'), 'aliases')).toEqual([])
    expect(frontMatterList(front('aliases: []'), 'aliases')).toEqual([])
  })

  test('is not read from a key indented under another', () => {
    expect(frontMatterList(front('export:\n  aliases: [One]'), 'aliases')).toEqual([])
  })
})

/** The surgery. Every case is one edit of the characters that moved, so a note
 *  open in a pane takes it without a caret in it going anywhere. */
describe('setting a key', () => {
  const applied = (source: string, key: string, value: string | null) => {
    const edit = frontMatterEdit(source, key, value)
    if (!edit) return source
    return source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
  }

  test('opens a block on a note that has none', () => {
    expect(applied('# Plan\n\nwords\n', 'icon', 'rocket')).toBe(
      '---\nicon: rocket\n---\n# Plan\n\nwords\n',
    )
  })

  test('and on an empty note', () => {
    expect(applied('', 'icon', 'rocket')).toBe('---\nicon: rocket\n---\n')
  })

  test('goes in as the last line of a block that has other keys', () => {
    expect(applied('---\ntitle: Plan\ntags: [work]\n---\n\nwords', 'icon', 'rocket')).toBe(
      '---\ntitle: Plan\ntags: [work]\nicon: rocket\n---\n\nwords',
    )
  })

  test('replaces the value and leaves every other line alone', () => {
    expect(applied('---\nicon: rocket\ntitle: Plan\n---\nwords', 'icon', 'anchor')).toBe(
      '---\nicon: anchor\ntitle: Plan\n---\nwords',
    )
  })

  test('a key already saying it is not written again', () => {
    expect(frontMatterEdit('---\nicon: rocket\n---\n', 'icon', 'rocket')).toBeNull()
    expect(frontMatterEdit('---\nicon: "rocket"\n---\n', 'icon', 'rocket')).toBeNull()
  })

  test('keeps the line endings the file was written with', () => {
    expect(applied('---\r\ntitle: Plan\r\n---\r\nwords', 'icon', 'rocket')).toBe(
      '---\r\ntitle: Plan\r\nicon: rocket\r\n---\r\nwords',
    )
    expect(applied('# Plan\r\n', 'icon', 'rocket')).toBe('---\r\nicon: rocket\r\n---\r\n# Plan\r\n')
  })
})

describe('taking a key away', () => {
  const applied = (source: string, key: string) => {
    const edit = frontMatterEdit(source, key, null)
    if (!edit) return source
    return source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
  }

  test('takes its line, and nothing else in the block', () => {
    expect(applied('---\ntitle: Plan\nicon: rocket\ntags: [work]\n---\nwords', 'icon')).toBe(
      '---\ntitle: Plan\ntags: [work]\n---\nwords',
    )
  })

  test('a block that held nothing else goes with it, blank lines and all', () => {
    expect(applied('---\nicon: rocket\n---\n\n# Plan\n', 'icon')).toBe('# Plan\n')
    expect(applied('---\nicon: rocket\n---\n', 'icon')).toBe('')
  })

  test('a note that never said it is left exactly as it was', () => {
    expect(frontMatterEdit('---\ntitle: Plan\n---\nwords', 'icon', null)).toBeNull()
    expect(frontMatterEdit('# Plan\n', 'icon', null)).toBeNull()
  })

  test('the same on a file written with the other line ending', () => {
    expect(applied('---\r\nicon: rocket\r\ntitle: Plan\r\n---\r\nwords', 'icon')).toBe(
      '---\r\ntitle: Plan\r\n---\r\nwords',
    )
    expect(applied('---\r\nicon: rocket\r\n---\r\n\r\n# Plan\r\n', 'icon')).toBe('# Plan\r\n')
  })
})

/** Several keys in one write. What it is for: an icon and the colour it is drawn in
 *  are two keys so that another app reading the note still finds the icon, and one
 *  write so that choosing an icon is one thing to undo. */
describe('setting several keys at once', () => {
  const applied = (source: string, keys: readonly (readonly [string, string | null])[]) => {
    const edit = frontMatterEdits(source, keys)
    return edit === null ? source : source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
  }

  test('opens a block and writes both lines', () => {
    expect(
      applied('# Plan\n', [
        ['icon', 'rocket'],
        ['icon-color', 'violet'],
      ]),
    ).toBe('---\nicon: rocket\nicon-color: violet\n---\n# Plan\n')
  })

  test('joins a block that was there, leaving its own keys alone', () => {
    expect(
      applied('---\ntitle: Plan\n---\n\nwords\n', [
        ['icon', 'rocket'],
        ['icon-color', 'violet'],
      ]),
    ).toBe('---\ntitle: Plan\nicon: rocket\nicon-color: violet\n---\n\nwords\n')
  })

  test('replaces one and adds the other', () => {
    expect(
      applied('---\nicon: rocket\n---\nwords\n', [
        ['icon', 'anchor'],
        ['icon-color', 'teal'],
      ]),
    ).toBe('---\nicon: anchor\nicon-color: teal\n---\nwords\n')
  })

  test('takes both away, and the block with them where it held nothing else', () => {
    expect(
      applied('---\nicon: rocket\nicon-color: violet\n---\n\n# Plan\n', [
        ['icon', null],
        ['icon-color', null],
      ]),
    ).toBe('# Plan\n')
  })

  test('is one edit however many keys moved', () => {
    const edit = frontMatterEdits('---\ntitle: Plan\n---\nwords\n', [
      ['icon', 'rocket'],
      ['icon-color', 'violet'],
    ])

    // The words below the block are outside it, which is what keeps a caret in them.
    expect(edit).not.toBeNull()
    expect(edit?.to).toBeLessThan('---\ntitle: Plan\n---\n'.length)
  })

  test('and no edit at all where the note already says all of it', () => {
    expect(
      frontMatterEdits('---\nicon: rocket\nicon-color: violet\n---\n', [
        ['icon', 'rocket'],
        ['icon-color', 'violet'],
      ]),
    ).toBeNull()
    expect(frontMatterEdits('# Plan\n', [['icon', null]])).toBeNull()
  })
})

describe('writing a block', () => {
  test('is the rows asked for, fenced, and nothing after the fence', () => {
    expect(
      writeFrontMatter([
        ['date', '2026-01-02'],
        ['tags', ['work', 'a/b']],
      ]),
    ).toBe('---\ndate: 2026-01-02\ntags: [work, a/b]\n---')
  })

  test('a number and a yes-or-no are written as YAML has them, a string as words', () => {
    expect(
      writeFrontMatter([
        ['pages', 412],
        ['read', true],
        ['code', '412'],
      ]),
    ).toBe("---\npages: 412\nread: true\ncode: '412'\n---")
  })

  test('a block with no rows is no block at all', () => {
    expect(writeFrontMatter([])).toBe('')
  })

  test('an empty list is still stated, because the caller asked for the row', () => {
    expect(writeFrontMatter([['tags', []]])).toBe('---\ntags: []\n---')
  })

  test('and what is written is read back as what was given', () => {
    const rows = [
      ['source', 'https://site.example/a?b=1#c'],
      ['title', "It's: here"],
      ['tags', ['work', 'two words']],
    ] as const
    const note = `${writeFrontMatter(rows)}\n\n# One\n`

    expect(frontMatterValue(note, 'source')).toBe('https://site.example/a?b=1#c')
    expect(frontMatterValue(note, 'title')).toBe("It's: here")
    expect(frontMatterList(note, 'tags')).toEqual(['work', 'two words'])
    expect(stripFrontMatter(note)).toBe('\n# One\n')
  })

  test('cannot be ended early by a value with lines in it', () => {
    const block = writeFrontMatter([['title', 'Fine\n---\n\n<img src=x>']])

    expect(block).toBe('---\ntitle: Fine --- <img src=x>\n---')
  })
})
