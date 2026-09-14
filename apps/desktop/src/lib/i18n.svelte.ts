import { englishLabel, LABEL_KEYS, setLabels } from '@nib/editor'
import { setChartLocale } from '@nib/markdown/chart'
import { type Direction, directionOf, factorOf, isolated } from './direction'
import { keep, storedText } from './stored'

/** The English string is its own key. A language that has not translated
 *  something falls back to it, so nothing can ever come out blank.
 *
 *  A count-bearing row holds the forms its language needs instead of one string:
 *  `plural()` asks `Intl.PluralRules` which of them a number wants, so a
 *  language with four forms is not made to write English's two. */
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
  /** As its own speakers write it, so it reads the same whatever the app is in. */
  name: string
  machine?: true
}

/** Where a correction goes. Shown under the list, because a reader who can see
 *  that a word is wrong is the only person who can put it right. */
export const CATALOGUES_URL =
  'https://github.com/lxorb/nibeditor/tree/main/apps/desktop/src/locales'

/** Every language with fifty million speakers, and the four that came first.
 *  Read through in order: the hand-written ones, then the rest by their id, so
 *  the list does not reshuffle when a catalogue stops being machine-written. */
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

/** A catalogue is fetched when it is chosen, not at start: forty of them in the
 *  first chunk is two megabytes downloaded to read one. Written out one by one
 *  rather than built from the id, so the bundler can see every file and `knip`
 *  can see that each one is used. */
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
  // Portuguese with no region is Brazilian on the web; a region the app has no
  // catalogue for spells the way Portugal does, which is the rule below.
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
 *  capitalised, a region in capitals. A system is consistent about this; a tag
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
 *  a time from what the system asked for lands on Traditional and then on
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

/** The first of the system's languages the app has a catalogue for. A system set
 *  to Norwegian and then to German is answered in German rather than in
 *  English, which is what a list of languages is a list for. */
function systemCatalogue(): string {
  // The DOM types promise `languages` is always an array. A test's navigator is
  // not the DOM, and one that answers `language` and nothing else reached this
  // line and threw; hence the chain the types say is unnecessary.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const asked = navigator.languages?.length ? navigator.languages : [navigator.language || 'en']

  for (const tag of asked) {
    const found = catalogueFor(tag)
    if (found !== 'en') return found
  }

  return 'en'
}

const STORAGE_KEY = 'nib:language'

/** Built once per language and shape, then kept: the status bar formats a number
 *  every time the caret moves, and building the formatter is most of what that
 *  would cost.
 *
 *  A plain Map on purpose, not a `SvelteMap`. Nothing reads these but the two
 *  functions under them, and a reactive map would make every formatted number a
 *  dependency of the cache it was built from: the first date of a render would
 *  invalidate everything that had already read one. */
/* eslint-disable svelte/prefer-svelte-reactivity */
const dates = new Map<string, Intl.DateTimeFormat>()
const numbers = new Map<string, Intl.NumberFormat>()
/* eslint-enable svelte/prefer-svelte-reactivity */

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const at = `${locale} ${JSON.stringify(options)}`
  const kept = dates.get(at)
  if (kept) return kept

  const made = new Intl.DateTimeFormat(locale, options)
  dates.set(at, made)
  return made
}

function numberFormat(locale: string): Intl.NumberFormat {
  const kept = numbers.get(locale)
  if (kept) return kept

  const made = new Intl.NumberFormat(locale)
  numbers.set(locale, made)
  return made
}

/** The form a count takes in one language, falling back the way a catalogue short
 *  of a form should: the category asked for, then `other`, then nothing, which
 *  the caller reads as English. */
function pick(count: number, locale: string, forms: Forms): string {
  return forms[new Intl.PluralRules(locale).select(count)] ?? forms.other ?? ''
}

/** `{name}` placeholders, filled in from what was handed over.
 *
 *  Only what was handed over: every object inherits `toString` and
 *  `constructor`, and reading a placeholder off the prototype would put the
 *  source of a function on screen.
 *
 *  Each value is isolated where it reads the other way from the sentence around
 *  it - a note's name, a folder, an address - so its own punctuation stays with
 *  it; see `isolated` in direction.ts. A value in the sentence's own direction is
 *  put in exactly as it came. */
function fill(
  text: string,
  values: Record<string, string | number> | undefined,
  direction: Direction,
): string {
  if (!values) return text

  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? isolated(String(values[name]), direction) : whole,
  )
}

class I18n {
  /** `system`, or a language chosen explicitly. */
  choice = $state('system')

  /** What is on screen right now. Empty until the catalogue lands, and empty is
   *  English: every string is its own key, so nothing is blank on the way. */
  private catalogue = $state<Dictionary>({})

  /** The catalogue in force, which is also the tag `Intl` is asked in: the app's
   *  language rather than the system's, so somebody reading a German app on an
   *  English machine reads German dates. */
  readonly language = $derived(this.choice === 'system' ? systemCatalogue() : this.choice)

  /** Which way the interface reads, which is a fact about its language. The same
   *  answer as the `dir` on the root element, for a component that would rather
   *  ask a store than the document; see direction.ts. */
  readonly direction = $derived(directionOf(this.language))

  /** 1 where a line runs to the right and -1 where it runs to the left: what a
   *  component doing its own arithmetic multiplies a sideways movement by. */
  readonly factor = $derived(factorOf(this.direction))

  /** Whether what is on screen was written in one pass and never read through.
   *  The setting says so under the row, with somewhere to send a correction. */
  readonly machine = $derived(
    LANGUAGES.some((one) => one.id === this.language && one.machine === true),
  )

  restore() {
    this.choice = storedText(STORAGE_KEY) ?? 'system'
    void this.load()
  }

  select(id: string) {
    this.choice = id
    keep(STORAGE_KEY, id)
    void this.load()
  }

  /** Fetches the catalogue for whatever is chosen now. A second choice made
   *  while the first is still on its way wins: an answer that arrives for a
   *  language nobody is waiting for any more is dropped.
   *
   *  Public, and awaitable, because a test that wants the app in German sets
   *  `choice` and waits for this rather than going through `select()`, which
   *  writes to storage a test has none of. */
  async load(): Promise<void> {
    const wanted = this.language
    // Not in a test, which has no page to mark. `dir` beside `lang`, because
    // which way the interface reads is a fact about the language and every rule
    // that mirrors keys off this one attribute; see direction.ts.
    if (typeof document !== 'undefined') {
      document.documentElement.lang = wanted
      document.documentElement.dir = directionOf(wanted)
    }
    // A chart's numbers are grouped the way this language groups them, on every
    // surface that draws one; see `setChartLocale` in @nib/markdown/chart.
    setChartLocale(wanted)

    const fetching = CATALOGUES[wanted]
    const next = fetching ? await fetching().catch(() => ({})) : {}
    if (this.language !== wanted) return

    this.catalogue = next
    this.translateEditor()
  }

  /** The editor package has its own handful of labels; hand it ours. */
  private translateEditor() {
    setLabels(Object.fromEntries(LABEL_KEYS.map((key) => [key, this.t(englishLabel(key))])))
  }

  /** Translates one string, filling in `{name}` placeholders. */
  t(text: string, values?: Record<string, string | number>): string {
    const found = this.catalogue[text]
    return fill(typeof found === 'string' ? found : text, values, this.direction)
  }

  /** One of the forms a count wants, in the language's own shape: English has
   *  two, Polish four and Arabic six, and which one a number takes is
   *  `Intl.PluralRules`'s answer rather than a comparison with 1.
   *
   *  A catalogue holding one string for the row is a language with one form,
   *  which is most of East and Southeast Asia. */
  plural(count: number, forms: Plural, values?: Record<string, string | number>): string {
    const found = this.catalogue[forms.other]
    const translated =
      typeof found === 'string'
        ? found
        : found
          ? pick(count, this.language, found)
          : pick(count, 'en', forms)

    return fill(translated || forms.other, { count, ...values }, this.direction)
  }

  /** A date, a time, or both, in the app's language. */
  when(at: Date | number, options: Intl.DateTimeFormatOptions): string {
    return dateFormat(this.language, options).format(at)
  }

  /** A number with the language's own grouping and digits. */
  amount(value: number): string {
    return numberFormat(this.language).format(value)
  }
}

export const i18n = new I18n()

/** Whatever was thrown, as a translated sentence. Server messages arrive in
 *  English, so they are looked up like any other string and fall back to
 *  themselves when a dictionary has nothing for them. */
export function message(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : ''
  return t(text || fallback)
}

/** Marks a string that something further along will translate. It hands the
 *  text back unchanged; the point is that the dictionaries and the check that
 *  guards them can both see it. */
export const key = (text: string) => text

/** Shorthand, so a component reads `{t('Save')}` rather than `{i18n.t('Save')}`. */
export const t = (text: string, values?: Record<string, string | number>) => i18n.t(text, values)

/** Shorthand for a count: `plural(n, { one: '{count} note', other: '{count} notes' })`.
 *  The `other` form is the row every catalogue holds. */
export const plural = (
  count: number,
  forms: Plural,
  values?: Record<string, string | number>,
): string => i18n.plural(count, forms, values)

/** Shorthand for a number in the app's language. A date or a time goes through
 *  `i18n.when()` rather than a shorthand of its own: three of the four panes that
 *  show one already call a local helper `when`, and two names for the same idea in
 *  one file is worse than the longer call. */
export const amount = (value: number): string => i18n.amount(value)
