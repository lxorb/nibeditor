import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { englishLabel, LABEL_KEYS } from '@nib/editor'
import { de } from '../locales/de'
import { fr } from '../locales/fr'
import { gsw } from '../locales/gsw'
import { ja } from '../locales/ja'
import { yue } from '../locales/yue'
import { zhHantHK } from '../locales/zh-Hant-HK'
import {
  CATALOGUE_IDS,
  catalogueFor,
  type Dictionary,
  type Forms,
  i18n,
  LANGUAGES,
} from './i18n.svelte'

/** The substitution `t()` performs, on the real thing: a dictionary is not
 *  needed to fill a template in, and a second copy of the rule here would be a
 *  second rule to keep in step. */
const fill = (template: string, values: Record<string, string | number>): string =>
  i18n.t(template, values)

/** What `<bdi>` is in a string: the isolate a value the other way round is
 *  wrapped in, and the pop that ends it. See `isolated` in direction.ts. */
const FSI = '\u2068'
const PDI = '\u2069'

/** Every catalogue on disk, read the way the app reads them. Loaded as a set
 *  rather than named one by one: forty imports would go stale the first time
 *  somebody added a language, which is the thing this file is here to catch. */
const LOADED = import.meta.glob<Record<string, unknown>>('../locales/*.ts', { eager: true })

function catalogueIn(module: Record<string, unknown>): Dictionary {
  const found = Object.values(module).find((one) => typeof one === 'object' && one !== null)
  if (!found) throw new Error('a locale file exports no catalogue')

  return found as Dictionary
}

const CATALOGUES: [string, Dictionary][] = Object.entries(LOADED)
  .map(([path, module]): [string, Dictionary] => [
    /([^/]+)\.ts$/.exec(path)?.[1] ?? path,
    catalogueIn(module),
  ])
  .sort(([one], [two]) => one.localeCompare(two))

/** The German catalogue is the reference. Every row was written against it, so a
 *  row it does not have is a row nothing asks for, and a row it has and another
 *  catalogue has not is a string that would come out in English. */
const REFERENCE = Object.keys(de)

/** The rows a count decides, which the reference holds as forms rather than as
 *  one string. Read off the reference so the list cannot fall behind it. */
const COUNTED = Object.entries(de)
  .filter(([, value]) => typeof value !== 'string')
  .map(([english]) => english)

/** Every English string the app asks for, read off the source rather than
 *  written down: a list of them would go stale the first time somebody added a
 *  row, and a row nobody translated reads as English in an app somebody set to
 *  their own language.
 *
 *  Four shapes carry one: `t()` translates on the spot, `key()` marks a string
 *  something further along translates, `message()`'s second argument is the
 *  sentence a failure falls back to, and `plural()`'s `other` form is the row a
 *  count is filed under. */
const SOURCE = fileURLToPath(new URL('..', import.meta.url))

const LITERAL = String.raw`'((?:[^'\\]|\\.)*)'`
const CALLS = [
  new RegExp(String.raw`(?<![.\w$])t\(\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])key\(\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])message\(\s*[^,()]*,\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])other:\s*${LITERAL}`, 'g'),
  // What the glasses say. `panelWord` is `t` with one extra rule - English wherever
  // the firmware's font cannot draw the reader's script - and `say` is whichever of
  // the two the caller handed the settings schema. Both were invisible here, so a
  // string the panel asks for could be renamed in the source and go on reaching the
  // glass in English with nothing to say so. See even/panel-words.ts.
  new RegExp(String.raw`(?<![.\w$])panelWord\(\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])say\(\s*${LITERAL}`, 'g'),
]

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    // The dictionaries are the answer, not the question, and the module that
    // does the translating writes an example of a plural call in its comments.
    if (statSync(path).isDirectory()) {
      if (name !== 'locales') sourceFiles(path, found)
    } else if (
      /\.(ts|svelte)$/.test(name) &&
      !name.endsWith('.test.ts') &&
      name !== 'i18n.svelte.ts'
    ) {
      found.push(path)
    }
  }

  return found
}

/** Each string, and the first place it is asked for, so a failure says where
 *  to look. */
function stringsAsked(): Map<string, string> {
  const asked = new Map<string, string>()

  for (const path of sourceFiles(SOURCE)) {
    const text = readFileSync(path, 'utf8')

    for (const pattern of CALLS) {
      for (const match of text.matchAll(pattern)) {
        const literal = (match[1] ?? '').replace(/\\(.)/g, (_whole, escaped: string) =>
          escaped === 'n' ? '\n' : escaped,
        )
        const line = text.slice(0, match.index).split('\n').length
        if (!asked.has(literal)) asked.set(literal, `${path.slice(SOURCE.length)}:${line}`)
      }
    }
  }

  return asked
}

// Read once: the whole source tree is work no single test should be charged for.
const ASKED = stringsAsked()

/** Every string the glasses folder asks for. They are drawn on a 576-pixel panel
 *  that cannot scroll sideways, so how long they are is not a matter of taste. */
function glassesWords(): Set<string> {
  const found = new Set<string>()

  for (const path of sourceFiles(join(SOURCE, 'lib', 'even'))) {
    const text = readFileSync(path, 'utf8')
    for (const pattern of CALLS.slice(0, 2)) {
      for (const match of text.matchAll(pattern)) found.add(match[1] ?? '')
    }
  }

  return found
}

const GLASSES = glassesWords()

/** How much of a line a string takes. A CJK glyph is drawn twice as wide as a
 *  Latin one, so counting characters would let Japanese through at half its
 *  size. */
const WIDE = new RegExp(
  '[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff' +
    '\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]',
)

const columns = (text: string): number =>
  // Code points rather than graphemes: what the firmware draws is a glyph per
  // code point, so a Devanagari conjunct costs what its pieces cost and an
  // emoji built out of a joiner is as wide as the glyphs it is built from.
  Array.from(text).reduce((sum, one) => sum + (WIDE.test(one) ? 2 : 1), 0)

/** The panel is 576 pixels wide with an eight-pixel margin either side, which is
 *  about sixty Latin columns. Forty-eight leaves room for the longest of them to
 *  be a little wider than the font's average and still land on one line. */
const PANEL_COLUMNS = 48

/** How wide a translation of a glasses string may be.
 *
 *  A line, for almost all of them. Two of them are sentences the app says while it
 *  waits on OpenAI, and English itself does not fit a line: the shell wraps those
 *  onto a second of the body's eight rows rather than cutting them, so the rule
 *  there is proportion rather than a line - half again the English, which is the
 *  room a language that spells things out needs and a sentence answering a label
 *  does not have. */
const roomFor = (english: string): number =>
  Math.max(PANEL_COLUMNS, Math.ceil(columns(english) * 1.5))

/** What `Intl` says this language's count forms are. */
const categoriesOf = (id: string): string[] =>
  new Intl.PluralRules(id).resolvedOptions().pluralCategories.slice().sort()

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort()

/** Every form a row holds, whether it holds one or six. */
const forms = (value: string | Forms): string[] =>
  typeof value === 'string' ? [value] : Object.values<string>(value)

describe('the folder, the list and the loader', () => {
  test('hold the same languages', () => {
    expect(CATALOGUES.map(([id]) => id)).toEqual([...CATALOGUE_IDS].sort())
  })

  test('are what the language list offers', () => {
    const offered = LANGUAGES.map((one) => one.id)
      .filter((id) => id !== 'system' && id !== 'en')
      .sort()

    expect(offered).toEqual([...CATALOGUE_IDS].sort())
  })

  test('offer the system default first and English second', () => {
    expect(LANGUAGES[0]?.id).toBe('system')
    expect(LANGUAGES[1]?.id).toBe('en')
  })

  /** The four that were written by hand say nothing about themselves; every
   *  other one says it was machine-written, which is what the link under the
   *  row is there to answer. */
  test('mark every catalogue nobody has read through', () => {
    const written = ['de', 'gsw', 'fr', 'ja']
    for (const language of LANGUAGES) {
      if (language.id === 'system' || language.id === 'en') continue

      expect(language.machine, language.id).toBe(written.includes(language.id) ? undefined : true)
    }
  })

  test('name every language the way its own speakers write it', () => {
    for (const language of LANGUAGES) {
      expect(language.name.trim(), language.id).not.toBe('')
    }

    // No two rows with the same name: two Portuguese rows that both read
    // "Português" would be a list nobody could choose from.
    const names = LANGUAGES.map((one) => one.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test('cover every language with fifty million speakers', () => {
    // Spot checks rather than the whole list: the ones that are easy to leave
    // out because a two-letter tag does not name them.
    for (const id of ['zh-Hans', 'zh-Hant', 'zh-Hant-HK', 'pt-BR', 'pt-PT', 'fil', 'ps', 'jv']) {
      expect(CATALOGUE_IDS, id).toContain(id)
    }

    // Forty, since Cantonese: eighty-five million speakers, written differently
    // enough from standard written Chinese to be its own catalogue rather than a
    // region of one. The floor moved with it deliberately - it was thirty-nine.
    expect(CATALOGUE_IDS.length).toBeGreaterThanOrEqual(40)
  })
})

describe('following the system', () => {
  test('takes the catalogue a tag names', () => {
    expect(catalogueFor('de')).toBe('de')
    expect(catalogueFor('ja-JP')).toBe('ja')
    expect(catalogueFor('pt-BR')).toBe('pt-BR')
  })

  test('drops a subtag at a time', () => {
    expect(catalogueFor('de-AT')).toBe('de')
    // Swiss Standard German is German, not the dialect.
    expect(catalogueFor('de-CH')).toBe('de')
    expect(catalogueFor('ar-EG')).toBe('ar')
    expect(catalogueFor('zh-Hans-CN')).toBe('zh-Hans')
  })

  test('reads Chinese by region as well as by script', () => {
    expect(catalogueFor('zh')).toBe('zh-Hans')
    expect(catalogueFor('zh-CN')).toBe('zh-Hans')
    expect(catalogueFor('zh-SG')).toBe('zh-Hans')
    expect(catalogueFor('zh-TW')).toBe('zh-Hant')
    expect(catalogueFor('zh-MO')).toBe('zh-Hant')
    expect(catalogueFor('zh-HK')).toBe('zh-Hant-HK')
  })

  /** Cantonese is a language rather than a region of Chinese, and it has a
   *  catalogue of its own. A system asking for `yue` used to be answered in Hong
   *  Kong's written Chinese, which is not what it asked for; `zh-HK` above still
   *  is, because that is the tag for written Chinese in Hong Kong. */
  test('and Cantonese as a language of its own', () => {
    expect(catalogueFor('yue')).toBe('yue')
    expect(catalogueFor('yue-HK')).toBe('yue')
    expect(catalogueFor('yue-Hant-HK')).toBe('yue')
    // The legacy tag, which is what an older system sends for the same language.
    expect(catalogueFor('zh-yue')).toBe('yue')
  })

  test('spells Portuguese the way the region does', () => {
    expect(catalogueFor('pt')).toBe('pt-BR')
    expect(catalogueFor('pt-PT')).toBe('pt-PT')
    expect(catalogueFor('pt-AO')).toBe('pt-PT')
    expect(catalogueFor('pt-MZ')).toBe('pt-PT')
  })

  test('answers an older tag under its current name', () => {
    expect(catalogueFor('tl')).toBe('fil')
    expect(catalogueFor('in')).toBe('id')
    expect(catalogueFor('prs')).toBe('fa')
  })

  test('tidies a tag that has been through storage', () => {
    expect(catalogueFor('ZH-HANT-hk')).toBe('zh-Hant-HK')
    expect(catalogueFor('pt_br')).toBe('pt-BR')
  })

  test('falls back to English rather than to nothing', () => {
    expect(catalogueFor('nb')).toBe('en')
    expect(catalogueFor('en-GB')).toBe('en')
    expect(catalogueFor('')).toBe('en')
    expect(catalogueFor('not a tag at all')).toBe('en')
  })
})

describe.each(CATALOGUES)('the %s catalogue', (language, catalogue) => {
  const categories = categoriesOf(language)

  test('covers every row the reference has', () => {
    const missing = REFERENCE.filter((english) => !(english in catalogue))
    expect(missing, language).toEqual([])
  })

  /** The other way round, so no catalogue carries a row of its own that the
   *  rest have never heard of. */
  test('holds nothing the reference does not', () => {
    const extra = Object.keys(catalogue).filter((english) => !REFERENCE.includes(english))
    expect(extra, language).toEqual([])
  })

  test('has something to say for every row', () => {
    for (const [english, value] of Object.entries(catalogue)) {
      for (const written of forms(value)) {
        expect(written.trim(), `${language}: ${english}`).not.toBe('')
      }
    }
  })

  test('translates most of what it holds', () => {
    const changed = Object.entries(catalogue).filter(([english, value]) => value !== english)
    expect(changed.length).toBeGreaterThan(Object.keys(catalogue).length * 0.9)
  })

  test('keeps every placeholder the English string uses', () => {
    for (const [english, value] of Object.entries(catalogue)) {
      const wanted = placeholders(english)
      for (const written of forms(value)) {
        expect(placeholders(written), `${language}: ${english}`).toEqual(wanted)
      }
    }
  })

  /** A count row holds the forms `Intl.PluralRules` has for the language and no
   *  others: a form it has no rule for is never picked, and a missing one leaves
   *  a number reading as though it were a different number. */
  test('holds the count forms its language has', () => {
    for (const english of COUNTED) {
      const value = catalogue[english]

      if (categories.length === 1) {
        expect(typeof value, `${language}: ${english}`).toBe('string')
        continue
      }

      expect(typeof value, `${language}: ${english}`).toBe('object')
      expect(Object.keys(value as Forms).sort(), `${language}: ${english}`).toEqual(categories)
    }
  })

  test('holds one string for every row a count does not decide', () => {
    for (const [english, value] of Object.entries(catalogue)) {
      if (COUNTED.includes(english)) continue

      expect(typeof value, `${language}: ${english}`).toBe('string')
    }
  })

  test('survived the file encoding', () => {
    // A mangled UTF-8 round trip reads the second byte of a two-byte letter as a
    // letter of its own, so what shows up is one of these followed by something
    // in the range those second bytes fall in. The range matters: Portuguese
    // writes ÇÃO and Ã before a capital is a word, not a fault.
    const mangled = /[ÃÂ][-¿]|â€/

    for (const value of Object.values(catalogue)) {
      for (const written of forms(value)) expect(written).not.toMatch(mangled)
    }
  })

  test('writes no em dashes', () => {
    for (const value of Object.values(catalogue)) {
      for (const written of forms(value)) {
        expect(written).not.toContain(String.fromCharCode(0x2014))
      }
    }
  })

  /** No bidi control character in a string. Right-to-left layout is the app's
   *  business, and a mark buried in a catalogue would fight whatever the layout
   *  decides. */
  test('carries no direction marks', () => {
    for (const [english, value] of Object.entries(catalogue)) {
      for (const written of forms(value)) {
        expect(written, `${language}: ${english}`).not.toMatch(/[‎‏؜‪-‮]/)
      }
    }
  })

  test('translates every string the app asks for', () => {
    const missing = [...ASKED]
      .filter(([text]) => !(text in catalogue))
      .map(([text, where]) => `${where}: ${JSON.stringify(text)}`)

    expect(missing, language).toEqual([])
  })

  /** A word on the glasses has one line and no way to scroll. A catalogue that
   *  answers a two-word label with a sentence is a panel with the end of it
   *  missing. */
  test('keeps the glasses’ own words to a line', () => {
    const long = [...GLASSES]
      .flatMap((english) => {
        const value = catalogue[english]
        if (value === undefined) return []

        const most = roomFor(english)

        return forms(value)
          .filter((written) => columns(written) > most)
          .map((written) => `${columns(written)} columns: ${JSON.stringify(written)}`)
      })
      .sort()

    expect(long, language).toEqual([])
  })

  test('translates every label the editor shows', () => {
    for (const key of LABEL_KEYS) {
      expect(catalogue[englishLabel(key)], `${language}: ${key}`).toBeDefined()
    }
  })
})

describe('the catalogues between them', () => {
  test('keep their own spelling', () => {
    expect(de.Delete).toBe('Löschen')
    expect(fr.Delete).toBe('Supprimer')
    expect(ja.Delete).toBe('削除')
  })

  /** The other side of the Swiss rule: German does write an eszett, and half a
   *  dictionary spelling it the Swiss way is one dictionary with two spellings
   *  in it. `schließen` and `Größe` are already there. */
  test('German writes an eszett where German has one', () => {
    for (const [english, value] of Object.entries(de)) {
      for (const written of forms(value)) {
        expect(written, english).not.toMatch(/gross|grösse|strasse|heiss/i)
      }
    }
  })

  test('Swiss German never uses an eszett', () => {
    for (const [english, value] of Object.entries(gsw)) {
      for (const written of forms(value)) expect(written, english).not.toContain('ß')
    }
  })

  test('Swiss German is the Zurich dialect, not the Bernese one', () => {
    // `nid`, `lah` and `verlah` are Bernese; Zurich says `nöd`, `laa` and
    // `verlaa`. Whole words only, so an innocent word containing them is left
    // alone.
    for (const [english, value] of Object.entries(gsw)) {
      for (const written of forms(value)) {
        expect(written, english).not.toMatch(/\bnid\b/)
        expect(written, english).not.toMatch(/\blah\b/i)
        expect(written, english).not.toMatch(/\bverlah\b/)
      }
    }
  })

  /** Swiss German written as German with the odd vowel changed is what the
   *  dictionary is there not to be. These three words are the giveaway, and no
   *  dialect writes any of them. */
  test('Swiss German is not German', () => {
    for (const [english, value] of Object.entries(gsw)) {
      for (const written of forms(value)) {
        expect(written, english).not.toMatch(/\bnicht\b/i)
        expect(written, english).not.toMatch(/\bkeine?\b/i)
        expect(written, english).not.toMatch(/\bist\b/i)
      }
    }
  })

  /** French elides with a typographic apostrophe, the one the English strings
   *  already use in `Don’t save`. Two shapes of it in one panel is two fonts of
   *  it on one screen. */
  test('French elides with one apostrophe throughout', () => {
    for (const [english, value] of Object.entries(fr)) {
      for (const written of forms(value)) expect(written, english).not.toContain("'")
    }
  })

  /** Cantonese written as Cantonese, rather than as standard written Chinese in
   *  Traditional characters with a word changed here and there. It is a separate
   *  catalogue only because it is a separate language in writing: the words below
   *  are the ones a Cantonese reader looks for first, and a catalogue without them
   *  would be the Hong Kong one under another name.
   *
   *  Traditional characters, which is what Cantonese is written in, come from that
   *  catalogue being where this one started; the Simplified test above holds every
   *  catalogue to its own script. */
  test('Cantonese is written Cantonese, not standard written Chinese', () => {
    const said = Object.values(yue)
      .flatMap((value) => forms(value))
      .join('\n')

    // The attributive, the copula, the negator and "there is none": between them
    // they are in a third of the rows.
    for (const word of ['嘅', '係', '唔', '冇']) {
      expect(said.includes(word), word).toBe(true)
    }
    // And the words that are Cantonese and nothing else: this and that, the
    // pronoun, the perfective, "look", "pick", "thing", "what".
    for (const word of ['呢個', '嗰', '佢', '咗', '睇', '揀', '嘢', '咩']) {
      expect(said.includes(word), word).toBe(true)
    }

    // The other way round: the words standard written Chinese uses where
    // Cantonese has its own. 不 survives in 不透明度, which is opacity in both.
    for (const [english, value] of Object.entries(yue)) {
      for (const written of forms(value)) {
        expect(written, english).not.toContain('沒有')
        expect(written, english).not.toContain('這')
        expect(written, english).not.toContain('那')
        expect(written, english).not.toContain('它')
        expect(written, english).not.toContain('的')
        expect(written, english).not.toContain('什麼')
        expect(written, english).not.toContain('無法')
      }
    }
  })

  /** It is its own catalogue, so it has to say something of its own: a row-for-row
   *  copy of the Hong Kong one would be a language in the picker that changes
   *  nothing on the screen. */
  test('and says something different from Hong Kong’s written Chinese', () => {
    const rows = Object.keys(yue).filter((english) => english in zhHantHK)
    const differ = rows.filter((english) => {
      const one = yue[english]
      const two = zhHantHK[english]
      return JSON.stringify(one) !== JSON.stringify(two)
    })

    // A quarter of the rows, and every sentence among them: most of what a
    // catalogue holds is one or two words - 儲存, 畫布 - which Cantonese and
    // standard written Chinese spell the same way, and changing those would be
    // writing a different language rather than the same one.
    expect(differ.length / rows.length).toBeGreaterThan(0.2)
  })

  /** Japanese punctuation is full width. A question asked with an ASCII mark
   *  sits half a character narrow beside the sentence it ends. */
  test('Japanese asks its questions with a full-width mark', () => {
    for (const [english, value] of Object.entries(ja)) {
      for (const written of forms(value)) {
        expect(written, english).not.toMatch(/[?!]/)
        if (english.endsWith('?')) expect(written, english).toMatch(/？$/)
      }
    }
  })
})

describe('filling in placeholders', () => {
  test('substitutes what it is given', () => {
    expect(fill('Undo deleting {name}', { name: 'Note.md' })).toBe('Undo deleting Note.md')
  })

  test('leaves an unknown placeholder alone', () => {
    expect(fill('{a} and {b}', { a: '1' })).toBe('1 and {b}')
  })

  test('takes numbers', () => {
    expect(fill('Digit {number}', { number: 3 })).toBe('Digit 3')
  })

  /** Only what was handed over. Every object inherits `toString` and
   *  `constructor`, and reading a placeholder off the prototype would put the
   *  source of a function on screen. */
  test('reads nothing an object merely inherits', () => {
    expect(fill('{toString} {constructor}', { name: 'x' })).toBe('{toString} {constructor}')
  })

  /** A name written the other way round keeps its own punctuation instead of
   *  handing it to the sentence; see `isolated` in direction.ts. Both ways round,
   *  because both happen: an Arabic note in an English app, and an English note in
   *  an Arabic one. */
  test('a name that reads the other way is kept to itself', () => {
    const arabic = 'خطة.md'
    expect(fill('Undo deleting {name}', { name: arabic })).toBe(
      `Undo deleting ${FSI}${arabic}${PDI}`,
    )

    const was = i18n.choice
    i18n.choice = 'ar'
    try {
      expect(fill('Undo deleting {name}', { name: 'Note.md' })).toBe(
        `Undo deleting ${FSI}Note.md${PDI}`,
      )
      // Nothing to isolate: a name in the language the sentence is in already
      // reads the way the sentence does. The name above would still be isolated
      // here, because its `.md` is Latin inside it.
      expect(fill('Undo deleting {name}', { name: 'خطة' })).toBe('Undo deleting خطة')
    } finally {
      i18n.choice = was
    }
  })
})

describe('a count', () => {
  test('picks English’s two forms by the rule rather than by a comparison', () => {
    expect(i18n.plural(1, { one: '{count} note', other: '{count} notes' })).toBe('1 note')
    expect(i18n.plural(0, { one: '{count} note', other: '{count} notes' })).toBe('0 notes')
    expect(i18n.plural(7, { one: '{count} note', other: '{count} notes' })).toBe('7 notes')
  })

  test('fills in what else it is given', () => {
    expect(
      i18n.plural(
        2,
        { one: '{name}: {count} note', other: '{name}: {count} notes' },
        { name: 'A' },
      ),
    ).toBe('A: 2 notes')
  })

  /** The one form every language has, so a catalogue short of a category still
   *  says something rather than nothing. */
  test('falls back to the other form', () => {
    expect(i18n.plural(1, { other: '{count} notes' })).toBe('1 notes')
  })

  test('agrees with Intl about what each language needs', () => {
    // Arabic has six categories and Thai one; both are real answers, and the
    // catalogues are shaped by this and nothing else.
    expect(categoriesOf('ar')).toEqual(['few', 'many', 'one', 'other', 'two', 'zero'])
    expect(categoriesOf('th')).toEqual(['other'])
    expect(categoriesOf('pl')).toEqual(['few', 'many', 'one', 'other'])
  })
})

describe('dates and numbers', () => {
  test('are written in the app’s language, not the machine’s', () => {
    const at = Date.UTC(2026, 8, 12, 13, 45)
    expect(i18n.when(at, { dateStyle: 'short', timeZone: 'UTC' })).toBe(
      new Intl.DateTimeFormat('en', { dateStyle: 'short', timeZone: 'UTC' }).format(at),
    )
    expect(i18n.amount(12345)).toBe(new Intl.NumberFormat('en').format(12345))
  })

  test('build one formatter per shape', () => {
    // The status bar formats a number on every caret move; the same call twice
    // must not build a second formatter.
    expect(i18n.amount(1000)).toBe(i18n.amount(1000))
  })
})
