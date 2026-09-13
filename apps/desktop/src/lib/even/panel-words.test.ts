import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SCRIPTS, undrawable } from '@nib/glasses'
import { i18n, t } from '../i18n.svelte'
import { forgetPanelLanguage, panelDrawable, panelWord } from './panel-words'

/** Which language the panel is written in.
 *
 *  The app has thirty-nine interface catalogues and the firmware has one font. That
 *  font draws Latin, Cyrillic, Greek, CJK and emoji: a catalogue in Devanagari,
 *  Bengali, Tamil, Telugu, Kannada, Malayalam, Gurmukhi, Gujarati, Arabic, Persian,
 *  Pashto, Urdu, Thai, Burmese or Amharic reaches the glass as a row of boxes.
 *
 *  Two languages are enough to say the rule, and they are the two ends of it: German,
 *  which the font draws, and Thai, which it has not one glyph of. */

/** The catalogue in force, awaited: `load` is what fetches it. */
async function reading(language: string): Promise<void> {
  i18n.choice = language
  await i18n.load()
  forgetPanelLanguage()
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  })
})

afterEach(async () => {
  await reading('en')
  vi.unstubAllGlobals()
})

describe('a language the firmware can draw', () => {
  test('is what the panel is written in', async () => {
    await reading('de')

    expect(panelDrawable()).toBe(true)
    expect(t('Settings')).not.toBe('Settings')
    expect(panelWord('Settings')).toBe(t('Settings'))
  })

  test('and every word of it reaches the glass as words', async () => {
    await reading('de')

    const said = ['Settings', 'Switch space', 'Voice off', 'Done'].map((one) => panelWord(one))
    expect(undrawable(said.join(' '))).toBe(0)
  })
})

describe('a language the firmware has no glyphs for', () => {
  test('is drawn as boxes, which is what this is about', async () => {
    await reading('th')

    // The words are right and the glass cannot draw them: a third of the letters
    // have no glyph at all.
    expect(t('Settings')).not.toBe('Settings')
    expect(undrawable(t('Settings'))).toBeGreaterThan(0.3)
  })

  test('so the panel says it in English instead', async () => {
    await reading('th')

    expect(panelDrawable()).toBe(false)
    expect(panelWord('Settings')).toBe('Settings')
    expect(panelWord('Switch space')).toBe('Switch space')
    expect(undrawable(panelWord('Voice off'))).toBe(0)
  })

  test('and fills in what a string was given, the way the catalogue would have', async () => {
    await reading('th')

    expect(panelWord('Page {page} of {count}', { page: 2, count: 8 })).toBe('Page 2 of 8')
  })

  /** The phone is not the glass: a reader holding it reads their own language, on a
   *  screen with every font on it. Only what is sent to the firmware falls back. */
  test('while the phone keeps the reader’s own language', async () => {
    await reading('th')

    expect(t('Settings')).not.toBe('Settings')
  })
})

describe('the decision itself', () => {
  test('is asked once per language, and again when the reader changes it', async () => {
    await reading('de')
    expect(panelDrawable()).toBe(true)

    i18n.choice = 'th'
    await i18n.load()
    // Nothing forgotten by hand this time: the language it was decided for is part
    // of what was decided.
    expect(panelDrawable()).toBe(false)
  })

  test('and English is drawable, which is the one catalogue there is no file for', async () => {
    await reading('en')

    expect(panelDrawable()).toBe(true)
    expect(panelWord('Settings')).toBe('Settings')
  })
})

describe('the rule is about scripts rather than languages', () => {
  /** Hindi and Marathi are one question, and Arabic answers for Persian, Pashto and
   *  Urdu as well. A list of languages would have been four lines that can disagree;
   *  the script is one line that cannot. */
  test('every language in a script the font lacks is answered the same way', async () => {
    for (const one of ['hi', 'mr', 'bn', 'ta', 'te', 'kn', 'ml', 'pa', 'gu']) {
      await reading(one)
      expect(panelDrawable(), one).toBe(false)
      expect(panelWord('Settings'), one).toBe('Settings')
    }
  })

  test('and Arabic answers for every language written in it', async () => {
    for (const one of ['ar', 'fa', 'ps', 'ur']) {
      await reading(one)
      expect(panelDrawable(), one).toBe(false)
    }
  })

  test('while every script the font has keeps its own words', async () => {
    for (const one of ['de', 'fr', 'gsw', 'ru', 'uk', 'ja', 'ko', 'zh-Hans', 'zh-Hant']) {
      await reading(one)
      expect(panelDrawable(), one).toBe(true)
      expect(panelWord('Settings'), one).toBe(t('Settings'))
    }
  })
})

/** The catalogues this app has, against the scripts the glasses package lists.
 *
 *  That list decides the panel's language and what the plugin build packs, so a
 *  catalogue in a script nobody has listed is a language neither has an answer for.
 *  Here rather than in the glasses package, which has no business knowing where this
 *  app keeps its words. */
describe('every catalogue is in a script the list names', () => {
  test('and no language is named twice', () => {
    const where = resolve(import.meta.dirname, '../../locales')
    const catalogues = readdirSync(where)
      .filter((one) => one.endsWith('.ts'))
      .map((one) => one.replace('.ts', ''))
    const listed = SCRIPTS.flatMap((one) => one.languages)

    expect(catalogues.length).toBeGreaterThan(30)
    // English is in the list and has no file of its own: every string is its key.
    expect(listed).toContain('en')
    expect(catalogues.filter((one) => !listed.includes(one))).toEqual([])
    expect(new Set(listed).size).toBe(listed.length)
  })
})
