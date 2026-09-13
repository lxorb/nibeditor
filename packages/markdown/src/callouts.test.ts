import { describe, expect, test } from 'vitest'
import { calloutIcon, calloutOf } from './callouts'

describe('a callout’s opening line', () => {
  test('is nothing at all for a quote that names no type', () => {
    expect(calloutOf('Just a quote.')).toBeNull()
    expect(calloutOf('[not a callout] really')).toBeNull()
    expect(calloutOf('[!] empty')).toBeNull()
  })

  test('names its type however it was capitalised', () => {
    expect(calloutOf('[!NOTE]')?.type).toBe('note')
    expect(calloutOf('[!Warning]')?.type).toBe('warning')
  })

  test('resolves an alias to the look it wears, keeping the word that was written', () => {
    const found = calloutOf('[!hint] Try this')
    expect(found?.type).toBe('hint')
    expect(found?.look).toBe('tip')
  })

  test('leaves a type nothing knows without a look', () => {
    const found = calloutOf('[!recipe]')
    expect(found?.type).toBe('recipe')
    expect(found?.look).toBeNull()
    expect(found?.label).toBe('Recipe')
  })

  /** These two were nib's own looks before nib had any of the others, and an
   *  `[!important]` came out violet here where Obsidian draws it green. Obsidian's
   *  thirteen types with Obsidian's aliases is one list, so these are in it: the word
   *  survives in `data-callout`, and what it wears is what it wears over there. */
  test('folds the two GitHub alert kinds in, the way Obsidian does', () => {
    expect(calloutOf('[!important]')?.look).toBe('tip')
    expect(calloutOf('[!important]')?.type).toBe('important')
    expect(calloutOf('[!caution]')?.look).toBe('warning')
    expect(calloutOf('[!caution]')?.type).toBe('caution')
  })

  /** Thirteen looks and twelve more words for them, which is Obsidian's list
   *  exactly: a callout written in either app is the same callout in both. */
  test('knows the thirteen types Obsidian has, and every alias of them', () => {
    const types = [
      'note',
      'abstract',
      'info',
      'todo',
      'tip',
      'success',
      'question',
      'warning',
      'failure',
      'danger',
      'bug',
      'example',
      'quote',
    ]
    for (const type of types) expect(calloutOf(`[!${type}]`)?.look, type).toBe(type)

    const aliases: Record<string, string> = {
      summary: 'abstract',
      tldr: 'abstract',
      hint: 'tip',
      important: 'tip',
      check: 'success',
      done: 'success',
      help: 'question',
      faq: 'question',
      caution: 'warning',
      attention: 'warning',
      fail: 'failure',
      missing: 'failure',
      error: 'danger',
      cite: 'quote',
    }
    for (const [word, look] of Object.entries(aliases)) {
      expect(calloutOf(`[!${word}]`)?.look, word).toBe(look)
    }
  })

  test('says the words that are not words in capitals', () => {
    expect(calloutOf('[!tldr]')?.label).toBe('TLDR')
    expect(calloutOf('[!faq]')?.label).toBe('FAQ')
    expect(calloutOf('[!abstract]')?.label).toBe('Abstract')
  })

  test('reads the fold sign, and reads none as none', () => {
    expect(calloutOf('[!note]')).toMatchObject({ foldable: false, folded: false })
    expect(calloutOf('[!note]+')).toMatchObject({ foldable: true, folded: false })
    expect(calloutOf('[!note]-')).toMatchObject({ foldable: true, folded: true })
  })

  test('takes the rest of the line as the title', () => {
    expect(calloutOf('[!tip] Mind the gap')?.title).toBe('Mind the gap')
    expect(calloutOf('[!tip]-   Mind the gap  ')?.title).toBe('Mind the gap')
    expect(calloutOf('[!tip]')?.title).toBe('')
  })

  test('measures the marker line so the words after it can be cut off exactly', () => {
    const found = calloutOf('[!tip]- Mind the gap\nBelow it.')
    expect(found?.taken).toBe('[!tip]- Mind the gap\n'.length)
    expect(found?.rest).toBe('Below it.')
  })

  test('leaves nothing behind for a marker on a line of its own', () => {
    expect(calloutOf('[!note]')?.rest).toBe('')
    expect(calloutOf('[!note]\nUnder it.')?.rest).toBe('Under it.')
  })

  test('reads a marker the writer indented', () => {
    expect(calloutOf('  [!note] Titled')?.taken).toBe('  [!note] Titled'.length)
  })
})

describe('a callout’s icon', () => {
  test('is one svg with every child closed, so an EPUB can be parsed', () => {
    const icon = calloutIcon('warning')

    expect(icon.startsWith('<svg')).toBe(true)
    expect(icon.endsWith('</svg>')).toBe(true)
    expect(icon).toContain(' />')
    // Nothing but the svg itself is left open.
    expect(/<(?!svg|\/svg)[a-z]+[^>]*[^/]>/.exec(icon)).toBeNull()
  })

  test('is nothing for a type nothing knows', () => {
    expect(calloutIcon(null)).toBe('')
    expect(calloutIcon('recipe')).toBe('')
  })

  test('draws in the colour of the words around it', () => {
    expect(calloutIcon('note')).toContain('stroke="currentColor"')
  })
})
