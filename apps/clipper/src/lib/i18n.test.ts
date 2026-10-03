import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { de } from '../locales/de'
import { fr } from '../locales/fr'
import { gsw } from '../locales/gsw'
import { ja } from '../locales/ja'
import { yue } from '../locales/yue'
import { zhHantHK } from '../locales/zh-Hant-HK'
import { i18n } from './i18n.svelte'
import { LABELS } from './kinds'
import { PROBLEMS } from './problems'
import { TEMPLATE_PROBLEMS } from './interpret/templates'
import { CATALOGUE_IDS, catalogueFor, type Dictionary, type Forms, LANGUAGES } from './translate'

/** Every catalogue on disk, read the way the pages read them. Loaded as a set
 *  rather than named one by one: forty imports would go stale the first
 *  time somebody added a language, which is the thing this file is here to
 *  catch. */
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

/** Every English string the extension asks for, read off the source rather than
 *  written down: a list of them would go stale the first time somebody added a
 *  row, and a row nobody translated reads as English to somebody who chose their
 *  own language.
 *
 *  Three shapes carry one: `t()` translates on the spot, `message()`'s second
 *  argument is the sentence a failure falls back to, and `plural()`'s `other`
 *  form is the row a count is filed under. */
const SOURCE = join(process.cwd(), 'src')
if (!existsSync(join(SOURCE, 'manifest.ts'))) {
  // Vitest runs in the package's own root; `import.meta.url` is not a file URL
  // under jsdom, which is the environment the rest of these tests need.
  throw new Error(`the extension's source is not at ${SOURCE}`)
}

const LITERAL = String.raw`'((?:[^'\\]|\\.)*)'`
const CALLS = [
  new RegExp(String.raw`(?<![.\w$])t\(\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])message\(\s*[^,()]*,\s*${LITERAL}`, 'g'),
  new RegExp(String.raw`(?<![.\w$])other:\s*${LITERAL}`, 'g'),
]

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    // The dictionaries are the answer, not the question, and the two modules that
    // do the translating write examples of a call in their comments.
    if (statSync(path).isDirectory()) {
      if (name !== 'locales') sourceFiles(path, found)
    } else if (
      /\.(ts|svelte)$/.test(name) &&
      !name.endsWith('.test.ts') &&
      name !== 'i18n.svelte.ts' &&
      name !== 'translate.ts'
    ) {
      found.push(path)
    }
  }

  return found
}

/** Each string, and the first place it is asked for, so a failure says where to
 *  look. */
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
        if (!asked.has(literal)) asked.set(literal, `${relative(SOURCE, path)}:${line}`)
      }
    }
  }

  return asked
}

// Read once: the whole source tree is work no single test should be charged for.
const ASKED = stringsAsked()

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
   *  other one says it was machine-written, which is what the link under the row
   *  is there to answer. */
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

    const names = LANGUAGES.map((one) => one.name)
    expect(new Set(names).size).toBe(names.length)
  })

  /** The same list the app offers, which is every language with fifty million
   *  speakers and the four that came first; see
   *  `apps/desktop/src/lib/i18n.svelte.ts`. */
  test('cover every language the app covers', () => {
    for (const id of ['zh-Hans', 'zh-Hant', 'zh-Hant-HK', 'pt-BR', 'pt-PT', 'fil', 'ps', 'jv']) {
      expect(CATALOGUE_IDS, id).toContain(id)
    }

    // Forty, since Cantonese, as in the app: written differently enough from
    // standard written Chinese to be its own catalogue rather than a region of one.
    expect(CATALOGUE_IDS).toContain('yue')
    expect(CATALOGUE_IDS.length).toBeGreaterThanOrEqual(40)
  })
})

describe('following the browser', () => {
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
   *  catalogue of its own, negotiated the way the app negotiates it. A browser
   *  asking for `yue` used to be answered in Hong Kong's written Chinese, which is
   *  not what it asked for; `zh-HK` above still is. */
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

  /** The other way round, so no catalogue carries a row of its own that the rest
   *  have never heard of. */
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

  /** Four fifths rather than the app's nine tenths. Sixty rows is a seventh of
   *  what the app says, and half a dozen of them are words a language borrows
   *  from English outright - Folder, Account, API key, Model - which the app's own
   *  catalogue for that language borrows too. A catalogue that is a copy of the
   *  English still has nothing changed at all, which is what this catches. */
  test('translates four fifths of what it holds', () => {
    const changed = Object.entries(catalogue).filter(([english, value]) => value !== english)
    expect(changed.length, language).toBeGreaterThan(Object.keys(catalogue).length * 0.8)
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
   *  others: a form it has no rule for is never picked, and a missing one leaves a
   *  number reading as though it were a different number. */
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
    const mangled = /[ÃÂ][-¿]|â€/

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

  /** No bidi control character in a string. Which way a page runs is the page's
   *  business, and a mark buried in a catalogue would fight whatever it decides. */
  test('carries no direction marks', () => {
    for (const [english, value] of Object.entries(catalogue)) {
      for (const written of forms(value)) {
        expect(written, `${language}: ${english}`).not.toMatch(/[‎‏؜‪-‮]/)
      }
    }
  })

  test('translates every string the extension asks for', () => {
    const missing = [...ASKED]
      .filter(([text]) => !(text in catalogue))
      .map(([text, where]) => `${where}: ${JSON.stringify(text)}`)

    expect(missing, language).toEqual([])
  })

  /** The sentences that travel as values rather than as literals: a problem is
   *  thrown from the worker or the content script and translated where it is
   *  drawn, so no `t('…')` in the source names it. */
  test('says every sentence the extension can show', () => {
    for (const sentence of [...Object.values(PROBLEMS), ...Object.values(TEMPLATE_PROBLEMS)]) {
      expect(catalogue[sentence], `${language}: ${sentence}`).toBeDefined()
    }
  })

  test('names all three clips', () => {
    for (const label of Object.values(LABELS)) {
      expect(catalogue[label], `${language}: ${label}`).toBeDefined()
    }
  })
})

describe('the catalogues between them', () => {
  /** The words the app already says, spelled the way it spells them: the
   *  extension and the editor are one product. Spot checks rather than the whole
   *  set, because the whole set is `apps/desktop/src/locales` and a test that
   *  reached across both apps would fail here for a change made there. */
  test('spell the words the app spells the way the app spells them', () => {
    expect(de.Save).toBe('Speichern')
    expect(fr.Save).toBe('Enregistrer')
    expect(ja.Save).toBe('保存')
    expect(gsw.Space).toBe('Ablag')
    expect(de.Reset).toBe('Zurücksetzen')
    expect(ja.Space).toBe('スペース')
  })

  test('Swiss German never uses an eszett', () => {
    for (const [english, value] of Object.entries(gsw)) {
      for (const written of forms(value)) expect(written, english).not.toContain('ß')
    }
  })

  /** `nid`, `lah` and `verlah` are Bernese; Zurich says `nöd`, `laa` and
   *  `verlaa`. Whole words only, so an innocent word containing them is left
   *  alone. */
  test('Swiss German is the Zurich dialect, not the Bernese one', () => {
    for (const [english, value] of Object.entries(gsw)) {
      for (const written of forms(value)) {
        expect(written, english).not.toMatch(/\bnid\b/)
        expect(written, english).not.toMatch(/\blah\b/i)
        expect(written, english).not.toMatch(/\bverlah\b/)
      }
    }
  })

  /** French elides with a typographic apostrophe, the one the app's own catalogue
   *  uses throughout. Two shapes of it in one popup is two fonts of it on one
   *  screen. */
  test('French elides with one apostrophe throughout', () => {
    for (const [english, value] of Object.entries(fr)) {
      for (const written of forms(value)) expect(written, english).not.toContain("'")
    }
  })

  /** Cantonese written as Cantonese, rather than as standard written Chinese in
   *  Traditional characters with a word changed here and there - the app's own rule
   *  for its `yue`, on the extension's sixty rows. A catalogue without these words
   *  would be the Hong Kong one under another name. */
  test('Cantonese is written Cantonese, not standard written Chinese', () => {
    const said = Object.values(yue)
      .flatMap((value) => forms(value))
      .join('\n')

    // The attributive, the copula, the negator and "there is none", and the words
    // that are Cantonese and nothing else: this, that, the pronoun, the perfective,
    // the progressive, "pick", "thing".
    for (const word of ['嘅', '係', '唔', '冇', '呢個', '嗰', '佢', '咗', '緊', '揀', '嘢']) {
      expect(said.includes(word), word).toBe(true)
    }

    // The other way round: the words standard written Chinese uses where Cantonese
    // has its own.
    for (const [english, value] of Object.entries(yue)) {
      for (const written of forms(value)) {
        for (const standard of ['沒有', '這', '那', '它', '的', '什麼', '無法', '不']) {
          expect(written, english).not.toContain(standard)
        }
      }
    }
  })

  /** Its own catalogue has to say something of its own: a row-for-row copy of the
   *  Hong Kong one would be a language in the picker that changes nothing. The one
   *  and two word rows - 儲存, 帳戶 - are spelled the same in both, so a third. */
  test('and says something different from Hong Kong’s written Chinese', () => {
    const rows = Object.keys(yue).filter((english) => english in zhHantHK)
    const differ = rows.filter(
      (english) => JSON.stringify(yue[english]) !== JSON.stringify(zhHantHK[english]),
    )

    expect(differ.length / rows.length).toBeGreaterThan(0.3)
  })

  /** Japanese punctuation is full width. A question asked with an ASCII mark sits
   *  half a character narrow beside the sentence it ends. */
  test('Japanese asks its questions with a full-width mark', () => {
    for (const [english, value] of Object.entries(ja)) {
      for (const written of forms(value)) {
        expect(written, english).not.toMatch(/[?!]/)
        if (english.endsWith('?')) expect(written, english).toMatch(/？$/)
      }
    }
  })
})

describe('the English the catalogues are keyed by', () => {
  test('writes no em dashes either', () => {
    for (const english of REFERENCE) {
      expect(english).not.toContain(String.fromCharCode(0x2014))
    }
  })

  test('ends every sentence about a failure with a full stop', () => {
    for (const sentence of [...Object.values(PROBLEMS), ...Object.values(TEMPLATE_PROBLEMS)]) {
      expect(sentence.endsWith('.'), sentence).toBe(true)
    }
  })
})

/** Through `i18n` itself rather than through a copy of its substitution. This
 *  file used to hold one, so nothing here exercised the real thing and a drift in
 *  it would have left every test green. */
describe('filling in placeholders', () => {
  test('substitutes what it is given', () => {
    expect(i18n.t('Resend in {seconds}s', { seconds: 12 })).toBe('Resend in 12s')
  })

  test('leaves an unknown placeholder alone', () => {
    expect(i18n.t('{a} and {b}', { a: '1' })).toBe('1 and {b}')
  })

  /** Only what was handed over. Every object inherits `toString` and
   *  `constructor`, and reading a placeholder off the prototype would put the
   *  source of a function on screen. */
  test('reads nothing an object merely inherits', () => {
    expect(i18n.t('{toString} {constructor}', { name: 'x' })).toBe('{toString} {constructor}')
  })
})

describe('a count', () => {
  test('picks English’s two forms by the rule rather than by a comparison', () => {
    const forms = { one: '{count} character sent', other: '{count} characters sent' }
    expect(i18n.plural(1, forms)).toBe('1 character sent')
    expect(i18n.plural(0, forms)).toBe('0 characters sent')
    expect(i18n.plural(7, forms)).toBe('7 characters sent')
  })

  /** The one form every language has, so a catalogue short of a category still
   *  says something rather than nothing. */
  test('falls back to the other form', () => {
    expect(i18n.plural(1, { other: '{count} characters sent' })).toBe('1 characters sent')
  })

  test('takes a number already written out', () => {
    expect(
      i18n.plural(
        2400,
        { one: '{count} character sent', other: '{count} characters sent' },
        { count: i18n.amount(2400) },
      ),
    ).toBe('2,400 characters sent')
  })

  test('agrees with Intl about what each language needs', () => {
    // Arabic has six categories and Thai one; both are real answers, and the
    // catalogues are shaped by this and nothing else.
    expect(categoriesOf('ar')).toEqual(['few', 'many', 'one', 'other', 'two', 'zero'])
    expect(categoriesOf('th')).toEqual(['other'])
    expect(categoriesOf('pl')).toEqual(['few', 'many', 'one', 'other'])
  })
})

describe('a number', () => {
  test('is grouped the way the language groups one', () => {
    expect(i18n.amount(12345)).toBe(new Intl.NumberFormat('en').format(12345))
  })

  test('builds one formatter per language', () => {
    // The line under the switch formats a number for every character of the page;
    // the same call twice must not build a second formatter.
    expect(i18n.amount(1000)).toBe(i18n.amount(1000))
  })
})

/** The words Chrome itself draws: the tile on chrome://extensions, the listing in
 *  the store and the shortcut list. They are `_locales`' business rather than the
 *  catalogues', because Chrome's own mechanism is the only one those surfaces
 *  have; what this holds is that the two halves cover the same languages and say
 *  the same things. */
describe('the words Chrome draws', () => {
  const MANIFEST = readFileSync(join(SOURCE, 'manifest.ts'), 'utf8')
  const FOLDERS = join(SOURCE, '..', 'public', '_locales')

  const messages = (tag: string): Record<string, { message: string }> =>
    JSON.parse(readFileSync(join(FOLDERS, tag, 'messages.json'), 'utf8')) as Record<
      string,
      { message: string }
    >

  const TAGS = readdirSync(FOLDERS)
  const ENGLISH = messages('en')

  /** Chrome's own interface languages, underscored the way it writes a region.
   *  A folder named after anything else would never be chosen, because Chrome
   *  picks by its own UI language. */
  const CHROME = new Set([
    'am',
    'ar',
    'bg',
    'bn',
    'ca',
    'cs',
    'da',
    'de',
    'el',
    'en',
    'en_GB',
    'en_US',
    'es',
    'es_419',
    'et',
    'fa',
    'fi',
    'fil',
    'fr',
    'gu',
    'he',
    'hi',
    'hr',
    'hu',
    'id',
    'it',
    'ja',
    'kn',
    'ko',
    'lt',
    'lv',
    'ml',
    'mr',
    'ms',
    'nl',
    'no',
    'pl',
    'pt_BR',
    'pt_PT',
    'ro',
    'ru',
    'sk',
    'sl',
    'sr',
    'sv',
    'sw',
    'ta',
    'te',
    'th',
    'tr',
    'uk',
    'vi',
    'zh_CN',
    'zh_TW',
  ])

  /** Which catalogue each folder is the Chrome name for. Chrome has no interface
   *  in Swiss German, Hausa, Javanese, Burmese, Punjabi, Pashto, Urdu, Hong Kong
   *  Chinese or Cantonese, so those readers get the whole of the extension in their own
   *  language and Chrome's tile beside it in English. */
  const AS_CATALOGUE: Record<string, string> = {
    pt_BR: 'pt-BR',
    pt_PT: 'pt-PT',
    zh_CN: 'zh-Hans',
    zh_TW: 'zh-Hant',
  }

  test('are asked for by the manifest and answered by every folder', () => {
    const asked = [...MANIFEST.matchAll(/__MSG_(\w+)__/g)].map((match) => match[1] ?? '')
    expect(asked.length).toBeGreaterThan(0)

    for (const key of asked) expect(ENGLISH[key]?.message, key).toBeTruthy()
  })

  test('have the language the manifest falls back to', () => {
    expect(MANIFEST).toContain("default_locale: 'en'")
    expect(TAGS).toContain('en')
  })

  test('are in folders Chrome can choose', () => {
    for (const tag of TAGS) expect(CHROME.has(tag), tag).toBe(true)
  })

  test('cover only languages the pages cover too', () => {
    for (const tag of TAGS) {
      if (tag === 'en') continue

      const id = AS_CATALOGUE[tag] ?? tag
      expect(CATALOGUE_IDS, tag).toContain(id)
    }
  })

  test('say the same things in every language', () => {
    const wanted = Object.keys(ENGLISH).sort()

    for (const tag of TAGS) {
      const said = messages(tag)
      expect(Object.keys(said).sort(), tag).toEqual(wanted)

      for (const [key, row] of Object.entries(said)) {
        expect(row.message.trim(), `${tag}: ${key}`).not.toBe('')
        expect(row.message, `${tag}: ${key}`).not.toContain(String.fromCharCode(0x2014))
      }
    }
  })

  /** The extension's name is never translated, and neither is the product's; see
   *  docs/conventions.md. */
  test('leave the name alone', () => {
    for (const tag of TAGS) expect(messages(tag).name?.message, tag).toBe('nibeditor')
  })

  test('are translated everywhere but English', () => {
    for (const tag of TAGS) {
      if (tag === 'en') continue

      const said = messages(tag)
      const changed = Object.keys(ENGLISH).filter(
        (key) => key !== 'name' && said[key]?.message !== ENGLISH[key]?.message,
      )
      expect(changed.length, tag).toBe(Object.keys(ENGLISH).length - 1)
    }
  })
})
