/** Which writing systems the firmware's one font can draw.
 *
 *  The glasses have a single font baked into the firmware and no way to add one. It
 *  carries Latin, Cyrillic, Greek, CJK and emoji; it has no Devanagari, no Bengali,
 *  no Tamil, no Telugu, no Kannada, no Malayalam, no Gurmukhi, no Gujarati, no
 *  Arabic, no Thai, no Burmese and no Ethiopic - not one glyph. The app's interface
 *  is in forty languages, so a reader in one of those scripts had a menu of
 *  perfectly correct words drawn as a row of boxes.
 *
 *  This is that fact as data: one row per script, with a sample of it, and what the
 *  metrics answer about that sample. It is a list of *scripts* rather than of
 *  languages because that is what a font has or has not got: Hindi and Marathi are
 *  one question, and `hi`, `mr` and any Devanagari language added later are answered
 *  by the same row.
 *
 *  **Data, and a test that holds it to the font.** `scripts.test.ts` measures every
 *  sample below with `undrawable` and fails if the `draws` column disagrees, so the
 *  day a firmware update adds a script the test says which line to change rather
 *  than the reader finding out. The samples are also what `scripts/even-panel.mjs`
 *  draws for the pictures in docs/even.md: the proof is a panel, not a claim.
 *
 *  Codes are ISO 15924, which is what `Intl.Locale.prototype.maximize` answers with,
 *  so a language tag can be turned into a row here without a table of its own; see
 *  `panelDrawable` in apps/desktop/src/lib/even/panel-words.ts. */

/** One writing system, and what the firmware makes of it. */
export interface Script {
  /** ISO 15924, as `Intl.Locale` says it: `Latn`, `Deva`, `Arab`. */
  code: string
  /** In English, for the pictures and for a report. */
  name: string
  /** A few words in it. Short on purpose: it is measured character by character, and
   *  one word is as much evidence as a paragraph. */
  sample: string
  /** Whether the firmware has glyphs for it. Measured, not assumed; see the test. */
  draws: boolean
  /** The catalogues in src/locales written in it, for the report and for nothing
   *  else. Empty where the app has no catalogue in that script. */
  languages: readonly string[]
}

/** Every script the app's own catalogues are written in, and the two the font has
 *  that no catalogue uses yet. Ordered: what draws first, then what does not. */
export const SCRIPTS: readonly Script[] = [
  {
    code: 'Latn',
    name: 'Latin',
    sample: 'Settings',
    draws: true,
    languages: [
      'en',
      'de',
      'es',
      'fil',
      'fr',
      'gsw',
      'ha',
      'id',
      'it',
      'jv',
      'ms',
      'pl',
      'pt-BR',
      'pt-PT',
      'sw',
      'tr',
      'vi',
    ],
  },
  {
    code: 'Cyrl',
    name: 'Cyrillic',
    sample: 'Настройки',
    draws: true,
    languages: ['ru', 'uk'],
  },
  {
    code: 'Grek',
    name: 'Greek',
    sample: 'Ρυθμίσεις',
    draws: true,
    languages: [],
  },
  {
    code: 'Hans',
    name: 'Chinese, simplified',
    sample: '设置',
    draws: true,
    languages: ['zh-Hans'],
  },
  {
    code: 'Hant',
    name: 'Chinese, traditional',
    sample: '設定',
    draws: true,
    // Cantonese is written in Traditional characters, which is what `Intl` answers
    // for `yue` as well: one script, one question, whatever the language.
    languages: ['yue', 'zh-Hant', 'zh-Hant-HK'],
  },
  {
    code: 'Jpan',
    name: 'Japanese',
    sample: '設定する',
    draws: true,
    languages: ['ja'],
  },
  {
    code: 'Kore',
    name: 'Korean',
    sample: '설정',
    draws: true,
    languages: ['ko'],
  },

  {
    code: 'Deva',
    name: 'Devanagari',
    sample: 'सेटिंग',
    draws: false,
    languages: ['hi', 'mr'],
  },
  {
    code: 'Beng',
    name: 'Bengali',
    sample: 'সেটিংস',
    draws: false,
    languages: ['bn'],
  },
  {
    code: 'Guru',
    name: 'Gurmukhi',
    sample: 'ਸੈਟਿੰਗਾਂ',
    draws: false,
    languages: ['pa'],
  },
  {
    code: 'Gujr',
    name: 'Gujarati',
    sample: 'સેટિંગ્સ',
    draws: false,
    languages: ['gu'],
  },
  {
    code: 'Taml',
    name: 'Tamil',
    sample: 'அமைப்புகள்',
    draws: false,
    languages: ['ta'],
  },
  {
    code: 'Telu',
    name: 'Telugu',
    sample: 'సెట్టింగ్‌లు',
    draws: false,
    languages: ['te'],
  },
  {
    code: 'Knda',
    name: 'Kannada',
    sample: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
    draws: false,
    languages: ['kn'],
  },
  {
    code: 'Mlym',
    name: 'Malayalam',
    sample: 'ക്രമീകരണങ്ങൾ',
    draws: false,
    languages: ['ml'],
  },
  {
    code: 'Arab',
    name: 'Arabic',
    sample: 'الإعدادات',
    draws: false,
    languages: ['ar', 'fa', 'ps', 'ur'],
  },
  {
    code: 'Thai',
    name: 'Thai',
    sample: 'การตั้งค่า',
    draws: false,
    languages: ['th'],
  },
  {
    code: 'Mymr',
    name: 'Burmese',
    sample: 'ဆက်တင်များ',
    draws: false,
    languages: ['my'],
  },
  {
    code: 'Ethi',
    name: 'Ethiopic',
    sample: 'ቅንብሮች',
    draws: false,
    languages: ['am'],
  },
]

/** Whether the firmware can draw a script, by its ISO 15924 code.
 *
 *  A script nobody has listed answers true. Two reasons, and both are about what a
 *  reader gets: the list holds every script the app has a catalogue in, so an unknown
 *  code is a language the app does not have; and `fold` puts a box where the font has
 *  nothing either way, so a wrong yes costs one panel while a wrong no would put a
 *  reader who can read their own language into English for nothing. */
export function drawsScript(code: string | undefined): boolean {
  if (!code) return true

  return SCRIPTS.find((one) => one.code === code)?.draws ?? true
}

/** The scripts the firmware cannot draw, for a report and for the pictures. */
export function scriptsNotDrawn(): readonly Script[] {
  return SCRIPTS.filter((one) => !one.draws)
}
