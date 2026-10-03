/** The words the extension can say, and which language it says them in.
 *
 *  A plain module on purpose. The service worker draws the three menu titles and
 *  one sentence in the toolbar's tooltip, and Chrome stops it between clips, so
 *  every clip from a shortcut or the page's own menu is a cold start: reaching
 *  the dictionaries through a rune would put Svelte's whole client runtime in
 *  front of it. The pages, which do need a language to change under them, wrap
 *  this in `i18n.svelte.ts`.
 *
 *  The list of languages, the tags a system is answered under and the shape of a
 *  count row are the app's, row for row: see
 *  `apps/desktop/src/lib/i18n.svelte.ts`. Deliberately a copy rather than a
 *  shared package - an extension bundle and an app bundle have nothing else in
 *  common, and the two catalogues hold different rows - so a change to one of the
 *  three belongs in both files. */

/** The English string is its own key. A language that has not translated
 *  something falls back to it, so nothing can ever come out blank.
 *
 *  A count-bearing row holds the forms its language needs instead of one string:
 *  `plural()` asks `Intl.PluralRules` which of them a number wants, so a language
 *  with four forms is not made to write English's two. */
export type Forms = Partial<Record<Intl.LDMLPluralRule, string>>
export type Dictionary = Record<string, string | Forms>

/** What a call site hands over. Every language has an `other`, so that is the
 *  form the row is filed under and the one form nothing may be missing. */
export interface Plural extends Forms {
  other: string
}

/** One row in the language list. `machine` marks a catalogue nobody has read
 *  through yet: written in one pass, short and consistent, and still worth
 *  correcting - which is what `CATALOGUES_URL` is there for. */
export interface Language {
  id: string
  /** As its own speakers write it, so it reads the same whatever the pages are
   *  in. */
  name: string
  machine?: true
}

/** Where a correction goes. Shown under the language row on the options page,
 *  because a reader who can see that a word is wrong is the only person who can
 *  put it right. */
export const CATALOGUES_URL =
  'https://github.com/lxorb/nibeditor/tree/main/apps/clipper/src/locales'

/** The same list the app offers, in the same order, so the two settings pages
 *  read alike.
 *
 *  Chrome's own `_locales` is not what carries these: it has no Swiss German, it
 *  covers only the languages Chrome's own interface is translated into, and it
 *  picks by the browser's UI language rather than by what somebody chose here.
 *  Only the handful of words Chrome itself draws - the tile on chrome://extensions,
 *  the listing in the store and the shortcut list - come from `public/_locales`. */
export const LANGUAGES: readonly Language[] = [
  { id: 'system', name: 'Match the system' },
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
  { id: 'gsw', name: 'Schwiizerdütsch' },
  { id: 'fr', name: 'Français' },
  { id: 'ja', name: '日本語' },
  { id: 'am', name: 'አማርኛ', machine: true },
  { id: 'ar', name: 'العربية', machine: true },
  { id: 'bn', name: 'বাংলা', machine: true },
  { id: 'es', name: 'Español', machine: true },
  { id: 'fa', name: 'فارسی', machine: true },
  { id: 'fil', name: 'Filipino', machine: true },
  { id: 'gu', name: 'ગુજરાતી', machine: true },
  { id: 'ha', name: 'Hausa', machine: true },
  { id: 'hi', name: 'हिन्दी', machine: true },
  { id: 'id', name: 'Bahasa Indonesia', machine: true },
  { id: 'it', name: 'Italiano', machine: true },
  { id: 'jv', name: 'Basa Jawa', machine: true },
  { id: 'kn', name: 'ಕನ್ನಡ', machine: true },
  { id: 'ko', name: '한국어', machine: true },
  { id: 'ml', name: 'മലയാളം', machine: true },
  { id: 'mr', name: 'मराठी', machine: true },
  { id: 'ms', name: 'Bahasa Melayu', machine: true },
  { id: 'my', name: 'မြန်မာ', machine: true },
  { id: 'pa', name: 'ਪੰਜਾਬੀ', machine: true },
  { id: 'pl', name: 'Polski', machine: true },
  { id: 'ps', name: 'پښتو', machine: true },
  { id: 'pt-BR', name: 'Português (Brasil)', machine: true },
  { id: 'pt-PT', name: 'Português (Portugal)', machine: true },
  { id: 'ru', name: 'Русский', machine: true },
  { id: 'sw', name: 'Kiswahili', machine: true },
  { id: 'ta', name: 'தமிழ்', machine: true },
  { id: 'te', name: 'తెలుగు', machine: true },
  { id: 'th', name: 'ไทย', machine: true },
  { id: 'tr', name: 'Türkçe', machine: true },
  { id: 'uk', name: 'Українська', machine: true },
  { id: 'ur', name: 'اردو', machine: true },
  { id: 'vi', name: 'Tiếng Việt', machine: true },
  { id: 'yue', name: '粵語', machine: true },
  { id: 'zh-Hans', name: '简体中文', machine: true },
  { id: 'zh-Hant', name: '繁體中文', machine: true },
  { id: 'zh-Hant-HK', name: '繁體中文（香港）', machine: true },
]

/** A catalogue is fetched when it is asked for, not at start: a popup opens on
 *  every click, and forty of them in its first chunk is a hundred kilobytes
 *  parsed to read sixty rows.
 *
 *  Written out one by one rather than built from the id, so the bundler can see
 *  every file and `knip` can see that each one is used. */
const CATALOGUES: Record<string, () => Promise<Dictionary>> = {
  am: () => import('../locales/am').then((module) => module.am),
  ar: () => import('../locales/ar').then((module) => module.ar),
  bn: () => import('../locales/bn').then((module) => module.bn),
  de: () => import('../locales/de').then((module) => module.de),
  es: () => import('../locales/es').then((module) => module.es),
  fa: () => import('../locales/fa').then((module) => module.fa),
  fil: () => import('../locales/fil').then((module) => module.fil),
  fr: () => import('../locales/fr').then((module) => module.fr),
  gsw: () => import('../locales/gsw').then((module) => module.gsw),
  gu: () => import('../locales/gu').then((module) => module.gu),
  ha: () => import('../locales/ha').then((module) => module.ha),
  hi: () => import('../locales/hi').then((module) => module.hi),
  id: () => import('../locales/id').then((module) => module.id),
  it: () => import('../locales/it').then((module) => module.it),
  ja: () => import('../locales/ja').then((module) => module.ja),
  jv: () => import('../locales/jv').then((module) => module.jv),
  kn: () => import('../locales/kn').then((module) => module.kn),
  ko: () => import('../locales/ko').then((module) => module.ko),
  ml: () => import('../locales/ml').then((module) => module.ml),
  mr: () => import('../locales/mr').then((module) => module.mr),
  ms: () => import('../locales/ms').then((module) => module.ms),
  my: () => import('../locales/my').then((module) => module.my),
  pa: () => import('../locales/pa').then((module) => module.pa),
  pl: () => import('../locales/pl').then((module) => module.pl),
  ps: () => import('../locales/ps').then((module) => module.ps),
  'pt-BR': () => import('../locales/pt-BR').then((module) => module.ptBR),
  'pt-PT': () => import('../locales/pt-PT').then((module) => module.ptPT),
  ru: () => import('../locales/ru').then((module) => module.ru),
  sw: () => import('../locales/sw').then((module) => module.sw),
  ta: () => import('../locales/ta').then((module) => module.ta),
  te: () => import('../locales/te').then((module) => module.te),
  th: () => import('../locales/th').then((module) => module.th),
  tr: () => import('../locales/tr').then((module) => module.tr),
  uk: () => import('../locales/uk').then((module) => module.uk),
  ur: () => import('../locales/ur').then((module) => module.ur),
  vi: () => import('../locales/vi').then((module) => module.vi),
  yue: () => import('../locales/yue').then((module) => module.yue),
  'zh-Hans': () => import('../locales/zh-Hans').then((module) => module.zhHans),
  'zh-Hant': () => import('../locales/zh-Hant').then((module) => module.zhHant),
  'zh-Hant-HK': () => import('../locales/zh-Hant-HK').then((module) => module.zhHantHK),
}

/** The ids a catalogue can be asked for by. The test holds this, the list above
 *  and the folder on disk to one set. */
export const CATALOGUE_IDS = Object.keys(CATALOGUES)

/** Tags a system sends for a catalogue filed under another name. Chinese is
 *  asked for by region far more often than by script, and `tl` is what an older
 *  system calls Filipino.
 *
 *  `zh-HK` is written Chinese as Hong Kong writes it, which is what that tag
 *  means and what `zh-Hant-HK` holds. Cantonese is a language rather than a
 *  region of it and has a catalogue of its own under `yue`; the tag here is the
 *  legacy spelling of that, which an older system sends for the same thing. */
const ALSO: Record<string, string> = {
  in: 'id',
  pes: 'fa',
  prs: 'fa',
  // Portuguese with no region is Brazilian on the web; a region the extension
  // has no catalogue for spells the way Portugal does, which is the rule below.
  pt: 'pt-BR',
  tl: 'fil',
  zh: 'zh-Hans',
  'zh-CN': 'zh-Hans',
  'zh-HK': 'zh-Hant-HK',
  'zh-MO': 'zh-Hant',
  'zh-MY': 'zh-Hans',
  'zh-SG': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'zh-YUE': 'yue',
}

/** A tag the way BCP 47 writes one: the language in lower case, a script
 *  capitalised, a region in capitals. A browser is consistent about this; a tag
 *  that has been through storage or a hand-edited setting is not. */
function tidy(tag: string): string {
  return tag
    .replace(/_/g, '-')
    .split('-')
    .map((part, at) => {
      if (at === 0) return part.toLowerCase()
      if (part.length === 4) return part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase()
      return part.toUpperCase()
    })
    .join('-')
}

/** The catalogue that fits a tag best, or `en` when none does.
 *
 *  Longest first: Hong Kong has a catalogue of its own, and dropping a subtag at
 *  a time from what the browser asked for lands on Traditional and then on
 *  Simplified rather than on English. Portuguese goes the other way - every
 *  region but Brazil spells the way Portugal does, so a region nobody has a
 *  catalogue for is answered in `pt-PT` rather than in Brazilian. */
export function catalogueFor(tag: string): string {
  let parts = tidy(tag).split('-')

  while (parts.length) {
    const candidate = parts.join('-')
    if (candidate in CATALOGUES) return candidate

    const named = ALSO[candidate]
    if (named) return named

    if (parts[0] === 'pt') return 'pt-PT'

    parts = parts.slice(0, -1)
  }

  return 'en'
}

/** The first of the browser's languages the extension has a catalogue for. A
 *  browser set to Norwegian and then to German is answered in German rather than
 *  in English, which is what a list of languages is a list for.
 *
 *  A service worker's navigator answers both of these as well as a page's does,
 *  which is why the choice can be read here rather than handed in. */
function systemCatalogue(): string {
  // The types promise `languages` is always an array. A test's navigator is not
  // the browser's, and one that answers `language` and nothing else reached this
  // line and threw; hence the chain the types say is unnecessary.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const asked = navigator.languages?.length ? navigator.languages : [navigator.language || 'en']

  for (const tag of asked) {
    const found = catalogueFor(tag)
    if (found !== 'en') return found
  }

  return 'en'
}

/** The language a choice means. `system` is whatever the browser is set to. */
export function languageOf(choice: string): string {
  return choice === 'system' ? systemCatalogue() : choice
}

/** The catalogue for a language, or nothing at all for English and for anything
 *  that has no catalogue: every string is its own key, so nothing is blank. */
export async function catalogueOf(language: string): Promise<Dictionary> {
  const fetching = CATALOGUES[language]
  return fetching ? fetching().catch(() => ({})) : {}
}

/** The form a count takes in one language, falling back the way a catalogue short
 *  of a form should: the category asked for, then `other`, then nothing, which
 *  the caller reads as English. */
export function pick(count: number, language: string, forms: Forms): string {
  return forms[new Intl.PluralRules(language).select(count)] ?? forms.other ?? ''
}

/** `{name}` placeholders, filled in from what was handed over.
 *
 *  Only what was handed over: every object inherits `toString` and `constructor`,
 *  and reading a placeholder off the prototype would put the source of a function
 *  on screen. */
export function fill(text: string, values?: Record<string, string | number>): string {
  if (!values) return text

  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : whole,
  )
}

/** One string out of a catalogue in hand, with `{name}` placeholders filled in.
 *  A row a count decides is read through `pick` instead; only the pages show a
 *  count, so only they have a shorthand for it. */
export function say(
  catalogue: Dictionary,
  source: string,
  values?: Record<string, string | number>,
): string {
  const found = catalogue[source]
  return fill(typeof found === 'string' ? found : source, values)
}

/** Which way a language reads. The four are the ones with a catalogue here, and
 *  the same four the app names: a copy on purpose, the way the language list is,
 *  because an extension bundle and an app bundle share nothing else. See
 *  `apps/desktop/src/lib/direction.ts` for the whole of the rule.
 *
 *  The pages put the answer on their own `html` element, and everything that
 *  mirrors keys off that one attribute. */
const RIGHT_TO_LEFT = ['ar', 'fa', 'ps', 'ur']

export function directionOf(language: string): 'ltr' | 'rtl' {
  const base = language.split('-')[0]?.toLowerCase() ?? ''
  return RIGHT_TO_LEFT.includes(base) ? 'rtl' : 'ltr'
}

/** What the service worker translates through: the catalogue for a choice,
 *  fetched once, as a function of a string.
 *
 *  A worker has no markup to redraw and is stopped between clips, so it asks for
 *  this at the top of whatever it is doing rather than holding a language. */
export async function words(
  choice: string,
): Promise<(source: string, values?: Record<string, string | number>) => string> {
  const catalogue = await catalogueOf(languageOf(choice))
  return (source, values) => say(catalogue, source, values)
}
