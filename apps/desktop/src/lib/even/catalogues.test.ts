import { describe, expect, test } from 'vitest'
import { englishIn, handedTo, inColumn, serverWords, stringsIn } from '../../../even-catalogues'
import { rowsOf } from './catalogue-keys'

/** The two halves of trimming a catalogue for the plugin, on code small enough to
 *  read; bundle.test.ts asks the same of the package itself. */

describe('the strings a piece of code writes out', () => {
  test('are its literals, however they are quoted', () => {
    expect(stringsIn('t(\'Save\'); t("Close"); t(`Open`)')).toEqual(
      new Set(['Save', 'Close', 'Open']),
    )
  })

  test('but not a template anything is put into, nor a name', () => {
    expect(stringsIn('t(`Page ${n}`); const Save = 1; ({ Close: 2 })')).toEqual(new Set())
  })

  test('and read in TypeScript as well', () => {
    expect(stringsIn("const said: string = 'sign in first'", 'ts')).toEqual(
      new Set(['sign in first']),
    )
  })
})

describe('what the server can say', () => {
  test('is read off its source', () => {
    expect(serverWords().has('a note already lives there')).toBe(true)
  })
})

describe('a catalogue as a column', () => {
  const WRITTEN = `const de = {
  // A comment, which goes.
  Save: 'Speichern',
  'Open file': 'Datei öffnen',
  '{count} notes': { one: '{count} Notiz', other: '{count} Notizen' },
};
export { de };`

  test('reads the English of every row, however it is spelled', () => {
    expect(englishIn(WRITTEN)).toEqual(['Save', 'Open file', '{count} notes'])
  })

  test('keeps the rows the keys name, in their order, each exactly as it was written', () => {
    const column = inColumn(WRITTEN, ['{count} notes', 'New', 'Save'])

    expect(column).toBe(
      "const de = [{ one: '{count} Notiz', other: '{count} Notizen' },,'Speichern'];\nexport { de };",
    )
  })

  test('is still a catalogue with none of them', () => {
    expect(inColumn(WRITTEN, [])).toBe('const de = [];\nexport { de };')
  })

  test('reads a table that has been handed to `rowsOf`', () => {
    const handed = handedTo(
      "import type { Dictionary } from './i18n'\nexport const de: Dictionary = { Save: 'Speichern' }\n",
      'rowsOf',
    )

    expect(handed).toBe(
      "import type { Dictionary } from './i18n'\nexport const de: Dictionary = rowsOf({ Save: 'Speichern' })\n",
    )
    expect(inColumn('const de = rowsOf({ Save: `Speichern` });', ['Save'])).toBe(
      'const de = rowsOf([`Speichern`]);',
    )
  })

  test('refuses a catalogue it cannot read row by row', () => {
    expect(() => englishIn('const de = { ...other }')).toThrow()
    expect(() => englishIn("const de = { ['Save']: 'x' }")).toThrow()
    expect(() => englishIn('const a = {}, b = {}')).toThrow()
  })

  test('and `rowsOf` passes a table it is handed as a table straight through', () => {
    const table = { Save: 'Speichern' }
    expect(rowsOf(table)).toBe(table)
  })
})
