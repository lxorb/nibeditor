import { describe, expect, test } from 'vitest'
import { onlyRows, serverWords, stringsIn } from '../../../even-catalogues'

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

describe('a catalogue with only some of its rows', () => {
  const WRITTEN = `const de = {
  // A comment, which goes.
  Save: 'Speichern',
  'Open file': 'Datei öffnen',
  '{count} notes': { one: '{count} Notiz', other: '{count} Notizen' },
};
export { de };`

  test('keeps each row it keeps exactly as it was written', () => {
    const kept = onlyRows(WRITTEN, (english) => english !== 'Open file')

    expect(kept).toBe(
      "const de = {Save: 'Speichern','{count} notes': { one: '{count} Notiz', other: '{count} Notizen' }};\nexport { de };",
    )
  })

  test('is still a catalogue with none of them', () => {
    expect(onlyRows(WRITTEN, () => false)).toBe('const de = {};\nexport { de };')
  })

  test('refuses a catalogue it cannot read row by row', () => {
    expect(() => onlyRows('const de = { ...other }', () => true)).toThrow()
    expect(() => onlyRows("const de = { ['Save']: 'x' }", () => true)).toThrow()
    expect(() => onlyRows('const a = {}, b = {}', () => true)).toThrow()
  })
})
