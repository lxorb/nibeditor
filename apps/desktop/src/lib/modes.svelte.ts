import {
  modeEffects,
  type ModeSettings,
  setCloseBrackets,
  setCodeLineNumbers,
  setCodeTheme,
  setFocusMode,
  setHeadingNumbers,
  setLigatures,
  setLineHeight,
  setMeasure,
  setReadOnlyMode,
  setRightToLeft,
  setEquationNumbers,
  setSmartPunctuation,
  remeasure,
  setSourceMode,
  isSpellWord,
  setSpellcheck,
  setSpellWords,
  setHighlightColour,
  setStrictMode,
  setTypewriterMode,
  setVim,
  onVimMode,
  type LigatureScope,
  type VimMode,
  type EditorView,
} from '@nib/editor'
import { setHardBreaks } from '@nib/markdown'
import { highlightTone, type HighlightColour } from '@nib/markdown/highlights'
import { SvelteMap } from 'svelte/reactivity'
import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import { type AttachmentFolder, isAttachmentFolder } from './attachments'
import { isLinkFormat, type LinkFormat, setLinkWriting } from './link-format'
import { type ConflictRule, conflictRule, DEFAULT_RULE } from './sync/conflicts'
import {
  type Compaction,
  DEFAULT_COMPACTION,
  isCompaction,
  MARKS,
  type Marks,
} from '@nib/glasses/choices'
import { glassesKey } from './even/key.svelte'
import { type Effort, isEffort } from './even/models'
import { key } from './i18n.svelte'
import { isNumber, isRecord, isString, keep, stored, stringList } from './stored'
import { currentWindow } from './tauri'

const STORAGE_KEY = 'nib:modes'

/** Well past any reader's own list, and a ceiling so the pattern built from it
 *  stays something a regular expression engine will take; see spelling.ts. */
const MOST_SPELL_WORDS = 500
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2]

/** How long the account keeps what a note said before, in days. A month, which
 *  is what it always kept, or a year. The same two the service takes; see
 *  services/sync/src/versions.ts. */
export const KEEP_MONTH = 30
export const KEEP_YEAR = 365
export const KEEP_VERSIONS: readonly number[] = [KEEP_MONTH, KEEP_YEAR]

/** How far back a bulk restore could offer to go, in days, before the horizon is
 *  taken into account. */
const ROLLBACK_STEPS: readonly number[] = [1, 7, 30, 90, 180, 365]

/** The steps the Go back row offers, for a given horizon.
 *
 *  As far as the account keeps and no further: a step asking for a moment before the
 *  first version there is would answer "nothing has changed since then", which is a
 *  wrong answer rather than a refusal. So a month offers three steps and a year
 *  offers six - which is what makes choosing the year above put the year in that row.
 *
 *  Here rather than in the pane because it is the same fact the horizon is: how far
 *  back the account can answer for. See SyncPane.svelte, which draws it. */
export function rollbackSteps(keep: number): number[] {
  return ROLLBACK_STEPS.filter((one) => one <= keep)
}

/** Writing column widths, in rem. */
export const WIDTHS = [32, 38, 42, 50, 60, 80] as const

/** How much of a note the ligature glyphs are drawn over, in the order the
 *  select offers them: off, then the narrow scope, then all of it. */
export const LIGATURE_SCOPES: readonly LigatureScope[] = ['off', 'code', 'all']

/** A ligature scope out of whatever was stored or came down from the account.
 *
 *  The setting was a switch before it was a scope, and both shapes still read:
 *  an account written by an older build says `true` for everywhere and `false`
 *  for off, and one written by a newer build reaching an older one is a string
 *  that build has never heard of, which reads as nothing said. */
export function ligatureScope(value: unknown): LigatureScope | null {
  if (typeof value === 'boolean') return value ? 'all' : 'off'
  return LIGATURE_SCOPES.find((one) => one === value) ?? null
}

/** At which heading a new page starts on the glasses.
 *
 *  Written as the level and read as "this level and above", so two is "H2 and
 *  above" and zero is a note that runs on without breaks. */
export const GLASSES_BREAKS = [0, 1, 2, 3, 4, 5, 6] as const
export type GlassesBreak = (typeof GLASSES_BREAKS)[number]

export function glassesBreak(value: unknown): GlassesBreak | null {
  const wanted = typeof value === 'string' ? Number(value) : value
  return GLASSES_BREAKS.find((one) => one === wanted) ?? null
}

export const LINE_HEIGHTS = [1.5, 1.62, 1.72, 1.85, 2] as const

interface Saved {
  source: boolean
  readOnly: boolean
  focus: boolean
  typewriter: boolean
  punctuation: boolean
  numbers: boolean
  lineNumbers: boolean
  codeTheme: string
  rtl: boolean
  strict: boolean
  equationNumbers: boolean
  zoom: number
  width: number
  lineHeight: number
  spellcheck: boolean
  spellLanguage: string
  spellWords: string[]
  alwaysOnTop: boolean
  closeBrackets: boolean
  ligatures: LigatureScope
  glassesBreak: GlassesBreak
  glassesLineNumbers: boolean
  glassesVoice: boolean
  glassesCompaction: string
  glassesMarks: Marks
  glassesWords: Record<string, unknown>
  glassesSeen: boolean
  glassesModel: string
  glassesEffort: string
  vim: boolean
  attachments: string
  conflicts: string
  keepVersions: number
  highlightTone: number | null
  hardBreaks: boolean
  linkFormat: LinkFormat
}

/** The word the status bar shows for each mode modal editing has, in Vim's own
 *  case because that is what the mode is called wherever anybody learned it.
 *  Keys for `t()`, translated in every dictionary. */
export const VIM_WORDS: Record<VimMode, string> = {
  normal: key('NORMAL'),
  insert: key('INSERT'),
  visual: key('VISUAL'),
  replace: key('REPLACE'),
}

/** Nearest of the steps the keyboard uses, so both routes agree. */
function clamp(value: number, steps: readonly number[]): number {
  return steps.reduce((best, one) => (Math.abs(one - value) < Math.abs(best - value) ? one : best))
}

/** One step along a fixed list, clamped at both ends. A value that is not one
 *  of the steps - written by an older build, or set from a slider - starts from
 *  `fallback`, which is. */
function step<T extends number>(
  steps: readonly T[],
  current: number,
  direction: number,
  fallback: T,
): T {
  const at = steps.findIndex((one) => one === current)
  const from = at >= 0 ? at : steps.findIndex((one) => one === fallback)
  return steps[Math.min(steps.length - 1, Math.max(0, from + direction))] ?? fallback
}

/** A stored string, when there is one worth having. */
function text(value: unknown, fallback: string): string {
  return isString(value) && value ? value : fallback
}

/** A stored number, when it is a real one. Zero is not a size or a zoom, so it
 *  reads as nothing written. */
function measure(value: unknown, fallback: number): number {
  return isNumber(value) && value !== 0 ? value : fallback
}

/** Which markers to draw, out of whatever was stored or came down from the
 *  account. Read switch by switch, so a build that has never heard of one of them
 *  keeps its own default rather than the whole object being thrown away. */
function marksOf(value: unknown): Marks {
  if (!isRecord(value)) return { ...MARKS }

  const out = { ...MARKS }
  for (const name of Object.keys(MARKS) as (keyof Marks)[]) {
    const found = value[name]
    if (typeof found === 'boolean') out[name] = found
  }

  return out
}

/** The phrases a reader has changed, out of whatever was stored. Only strings,
 *  and only short ones: this is a spoken phrase, not a paragraph. */
function wordsOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const out: Record<string, string> = {}
  for (const [id, phrase] of Object.entries(value)) {
    if (isString(phrase) && phrase.trim() && phrase.length <= 60) out[id] = phrase.trim()
  }

  return out
}

class Modes {
  source = $state(false)
  /** The note laid out as it reads, with nothing that writes to it. The reading
   *  view is a different thing - the note through the renderer, per tab; this is
   *  the editor with its doors locked. Never on at the same time as source mode,
   *  and never shared with the account: whether a note is open for writing this
   *  minute is not a preference. */
  readOnly = $state(false)
  focus = $state(false)
  typewriter = $state(false)
  punctuation = $state(false)
  numbers = $state(false)
  lineNumbers = $state(false)
  codeTheme = $state('follow')
  rtl = $state(false)
  strict = $state(false)
  equationNumbers = $state(false)
  zoom = $state(1)
  width = $state(42)
  lineHeight = $state(1.72)
  /** The webview's own spell checker, over the writing surface. On, because a
   *  typo is worth knowing about and nobody goes looking through settings for
   *  the checker every other editor has running already. */
  spellcheck = $state(true)
  /** The dictionary to check against; `system` leaves it to the browser, which
   *  reads the language the machine is set to. */
  spellLanguage = $state('system')
  /** The words the reader has said are words: names, terms, a project. The
   *  checker is turned off over each of them wherever it appears, which is what
   *  takes the wavy line away; see spelling.ts in the editor package for why
   *  that, and not the platform's own dictionary.
   *
   *  The account's rather than this machine's: a name you write about is a name
   *  you write about on every device. */
  spellWords = $state<string[]>([])
  /** This window over every other application's. A desktop's, and this machine's
   *  rather than the account's: which window is in front is about the desk it is
   *  on. */
  alwaysOnTop = $state(false)
  closeBrackets = $state(true)
  /** `->` shown as an arrow, `<=` as a sign, and so on: nowhere, in the code of
   *  a note, or everywhere in it. Off until chosen; the choice follows the
   *  account. */
  ligatures = $state<LigatureScope>('off')
  /** At which heading a new page starts on the Even Realities glasses.
   *
   *  Two, which is H2 and above: it is what makes the panel read as a document
   *  rather than as a scroll, because a section then begins at the top of a panel
   *  and its heading stays in the head band for every page of it. Zero for a note
   *  that runs on without breaks.
   *
   *  Every setting in this section follows the account rather than the machine.
   *  The plugin runs on a phone and is set up on a desktop, and nobody wants to
   *  type an API key into a WebView with a thumb. */
  glassesBreak = $state<GlassesBreak>(2)
  /** A gutter of the note's own line numbers down the left of the panel.
   *
   *  On, because they are what "go to line forty" is answered with and what tells
   *  a reader glancing up how far into a note they are. They cost the body about
   *  a tenth of its width, and turning them off is the one setting that rebuilds
   *  the page; see even/screen.ts. */
  glassesLineNumbers = $state(true)
  /** Whether the microphone is listening for commands.
   *
   *  Off until asked for, which is the only defensible default for a microphone:
   *  it is turned on from the hold modal on the glasses, or here. */
  glassesVoice = $state(false)
  /** How much of a note's own white space reaches the panel; see `Compaction` in
   *  @nib/glasses. One break between blocks, which is Emil's answer having read on a
   *  pair; the default is said once, in that package. */
  glassesCompaction = $state<Compaction>(DEFAULT_COMPACTION)
  /** Which of a note's markers are drawn. Rule one as it stands, until a reader
   *  overrules it per construct; see `Marks` in @nib/glasses. */
  glassesMarks = $state<Marks>({ ...MARKS })
  /** The phrases each spoken command answers to, where the reader has changed
   *  them. Only the differences travel, the way the shortcuts do: a full dump
   *  would freeze today's wording into every account that ever saved one. */
  glassesWords = $state<Record<string, string>>({})
  /** Whether this account has ever had the plugin in front of a pair of glasses.
   *
   *  What the Glasses section on every other device waits for: somebody who has
   *  never worn a pair should not be offered a pane of settings about them. Set
   *  once, by the plugin, the first time a bridge answers. */
  glassesSeen = $state(false)
  /** Which model answers. Empty until the reader has chosen one from the list the
   *  API itself gave; see even/models.ts. */
  glassesModel = $state('')
  /** How hard it is asked to think, from the API's own list. */
  glassesEffort = $state<Effort>('low')
  /** Modal editing. Off until chosen, follows the account, and independent of
   *  which keyboard the shortcuts are on: the Vim preset turns it on, and the
   *  switch in the Editor pane puts it on top of any of the others. */
  vim = $state(false)
  /** Which mode each editor on the page is in, while modal editing is on. The
   *  status bar shows the one the reader is writing in. */
  readonly vimModes = new SvelteMap<EditorView, VimMode>()
  /** Where a pasted picture is written; see attachments.ts. Follows the account
   *  too, because it is about how someone keeps their notes rather than about
   *  the machine they are at. */
  attachments = $state<AttachmentFolder>('space')

  /** What a device does when the same note was written in two places. On the
   *  account, because it is a decision about the notes rather than about the
   *  machine; see sync/conflicts.ts. */
  conflicts = $state<ConflictRule>(DEFAULT_RULE)

  /** How long the account keeps what a note said before, in days: a month, or a
   *  year. On the account because that is whose storage it is, and because the
   *  sweep that enforces it reads the same number; see services/sync/versions.ts
   *  and docs/sync.md. */
  keepVersions = $state<number>(KEEP_MONTH)

  /** Which colour the highlight button writes, as the palette tone it names, or
   *  null for a highlight with no colour of its own - which is what nib has always
   *  written and so is where this starts.
   *
   *  The last colour chosen sticks, because marking up a paper is one colour a
   *  dozen times rather than a fresh decision each time. On the account: it is
   *  about how somebody marks up, not about the machine they are at. See
   *  highlights.ts in @nib/markdown for which tone each emoji is. */
  highlightTone = $state<number | null>(null)

  /** Whether a single newline breaks the line instead of being the space
   *  CommonMark makes of it.
   *
   *  Off, which is CommonMark and what every other reader of the same file does
   *  with it - a paragraph hard wrapped in the file is one paragraph. On, a note
   *  reads the way it is typed. Either way it is the one renderer that answers, so
   *  the reading view, an export, a card on a canvas and a published page all say
   *  the same thing; a deck keeps its single breaks whatever this says, because a
   *  slide is a poster. See `RenderOptions.breaks` in @nib/markdown. */
  hardBreaks = $state(false)

  /** How a link to another note is written: `[[wikilinks]]`, or markdown links
   *  with the shortest name, a relative path or a path from the top of the space.
   *  Wikilinks, which is what nib has always written and what survives a rename.
   *  Reading both spellings already works either way; see link-format.ts. */
  linkFormat = $state<LinkFormat>('wikilink')

  constructor() {
    // The editor package reports a view's mode as it changes and null when
    // that view leaves modal editing; see packages/editor/src/vim.ts.
    onVimMode((view, mode) => {
      if (mode) this.vimModes.set(view, mode)
      else this.vimModes.delete(view)
    })
  }

  restore() {
    // Whether the entry holds a setting this version has not got. Written back once
    // at the end, so that the file stops carrying it.
    let stale = false

    // Field by field off an unknown, not a cast: the entry may have been
    // written by another version of the app or edited by hand, and a mode that
    // reads as neither on nor off should simply be the default.
    const saved = stored(STORAGE_KEY)
    if (isRecord(saved)) {
      this.source = saved.source === true
      // Both at once is a state the app cannot get into; a hand-edited entry
      // can say it anyway, and source mode is the one that was written last.
      // `reading` is what a build before the reading view called this.
      this.readOnly = (saved.readOnly === true || saved.reading === true) && !this.source
      this.focus = saved.focus === true
      this.typewriter = saved.typewriter === true
      // `=== true` rather than `!== false`: a reader who never chose keeps the
      // new default, and only one who turned it on keeps it on.
      this.punctuation = saved.punctuation === true
      this.numbers = saved.numbers === true
      this.lineNumbers = saved.lineNumbers === true
      this.codeTheme = text(saved.codeTheme, 'follow')
      this.rtl = saved.rtl === true
      this.strict = saved.strict === true
      this.equationNumbers = saved.equationNumbers === true
      this.zoom = measure(saved.zoom, 1)
      this.width = measure(saved.width, 42)
      this.lineHeight = measure(saved.lineHeight, 1.72)
      this.spellcheck = saved.spellcheck !== false
      this.spellLanguage = text(saved.spellLanguage, 'system')
      this.spellWords = (stringList(saved.spellWords) ?? [])
        .filter(isSpellWord)
        .slice(0, MOST_SPELL_WORDS)
      this.alwaysOnTop = saved.alwaysOnTop === true
      this.closeBrackets = saved.closeBrackets !== false
      this.ligatures = ligatureScope(saved.ligatures) ?? 'off'
      this.conflicts = conflictRule(saved.conflicts) ?? DEFAULT_RULE
      this.keepVersions = KEEP_VERSIONS.includes(saved.keepVersions as number)
        ? (saved.keepVersions as number)
        : KEEP_MONTH
      this.glassesBreak = glassesBreak(saved.glassesBreak) ?? 2
      this.glassesLineNumbers = saved.glassesLineNumbers !== false
      this.glassesVoice = saved.glassesVoice === true
      if (isCompaction(saved.glassesCompaction)) this.glassesCompaction = saved.glassesCompaction
      this.glassesMarks = marksOf(saved.glassesMarks)
      this.glassesWords = wordsOf(saved.glassesWords)
      this.glassesSeen = saved.glassesSeen === true
      // A setting that is gone: who scrolls the note. It offered the glasses' own
      // scrolling, which no firmware ever did - see even/settings.ts - and Emil asked
      // for the row to go: "effectively it should be always nib who turns the pages."
      // Machines that chose one have it written down, so it is dropped rather than
      // left in the entry for a later version to wonder about. Written back at the
      // end of this method, once everything else has been read.
      stale = 'glassesScroll' in saved
      this.glassesModel = text(saved.glassesModel, '')
      this.glassesEffort = isEffort(saved.glassesEffort) ? saved.glassesEffort : 'low'
      this.vim = saved.vim === true
      if (isAttachmentFolder(saved.attachments)) this.attachments = saved.attachments
      if (isNumber(saved.highlightTone) || saved.highlightTone === null) {
        this.highlightTone = highlightTone(saved.highlightTone).tone
      }
      this.hardBreaks = saved.hardBreaks === true
      if (isLinkFormat(saved.linkFormat)) this.linkFormat = saved.linkFormat
    }
    // The renderer and the one link writer are told once, here and in the setters
    // below, rather than asked by every caller; see `setHardBreaks` in
    // @nib/markdown and `setLinkWriting` in link-format.ts.
    setHardBreaks(this.hardBreaks)
    setLinkWriting(this.linkFormat)
    setHighlightColour(this.highlight)
    this.applyZoom()
    if (this.alwaysOnTop) this.applyAlwaysOnTop()

    // Written back without whatever this version has not got; see `stale` above.
    if (stale) this.persist()
  }

  toggleAlwaysOnTop() {
    this.alwaysOnTop = !this.alwaysOnTop
    this.applyAlwaysOnTop()
    this.persist()
  }

  /** Tells the window. A refusal is the window manager's answer and there is
   *  nothing to say about it: the row goes back to what the window is doing at
   *  the next start, since nothing was written. */
  private applyAlwaysOnTop() {
    void currentWindow()
      .then((window) => window.setAlwaysOnTop(this.alwaysOnTop))
      .catch(() => undefined)
  }

  /** Every editor on the page: one for each pane. A mode is the window's rather
   *  than one pane's - a note locked in one pane and open in the other would be
   *  two different notes to look at - so a change reaches all of them. */
  private readonly views = new Set<EditorView>()

  /** The one the caller had in mind, and every other one there is. A view is
   *  built fresh for every tab, so the set is what keeps the panes in step; the
   *  argument is what makes a brand new view take the modes on the way up. */
  private each(view: EditorView | undefined, apply: (one: EditorView) => void) {
    if (view) apply(view)
    for (const one of this.views) if (one !== view) apply(one)
  }

  /** Every mode as the editor package wants them, so a pane can put a whole set
   *  of them on in one transaction; see `modeEffects`. */
  get settings(): ModeSettings {
    return {
      source: this.source,
      readOnly: this.readOnly,
      focus: this.focus,
      typewriter: this.typewriter,
      punctuation: this.punctuation,
      numbers: this.numbers,
      lineNumbers: this.lineNumbers,
      codeTheme: this.codeTheme,
      rtl: this.rtl,
      strict: this.strict,
      equationNumbers: this.equationNumbers,
      spellcheck: this.spellcheck,
      dictionary: this.dictionary,
      words: this.spellWords,
      closeBrackets: this.closeBrackets,
      ligatures: this.ligatures,
      vim: this.vim,
    }
  }

  /** Re-applies every mode to a freshly created view, and keeps it.
   *
   *  One transaction for the seventeen of them: a view that took them one at a
   *  time spent seventeen updates being dressed, and every one of those redrew
   *  whatever was on screen. The two that are CSS custom properties are not
   *  transactions at all and follow on their own. */
  apply(view: EditorView) {
    this.views.add(view)

    view.dispatch({ effects: modeEffects(this.settings) })
    setMeasure(view, this.width)
    setLineHeight(view, this.lineHeight)
  }

  /** A view that has left the page. */
  forget(view: EditorView) {
    this.views.delete(view)
    this.vimModes.delete(view)
  }

  toggleSource(view?: EditorView) {
    this.source = !this.source
    if (this.source) this.readOnly = false
    this.each(view, (one) => setSourceMode(one, this.source))
    this.persist()
  }

  /** The editor keeps the same rule on its side, in setReadOnlyMode: the two
   *  are opposite answers to the same question, so one going on takes the
   *  other off. Here it is the ticks in the menu that have to agree. */
  toggleReadOnly(view?: EditorView) {
    this.readOnly = !this.readOnly
    if (this.readOnly) this.source = false
    this.each(view, (one) => setReadOnlyMode(one, this.readOnly))
    this.persist()
  }

  toggleFocus(view?: EditorView) {
    this.focus = !this.focus
    this.each(view, (one) => setFocusMode(one, this.focus))
    this.persist()
  }

  toggleTypewriter(view?: EditorView) {
    this.typewriter = !this.typewriter
    this.each(view, (one) => setTypewriterMode(one, this.typewriter))
    this.persist()
  }

  togglePunctuation(view?: EditorView) {
    this.punctuation = !this.punctuation
    this.each(view, (one) => setSmartPunctuation(one, this.punctuation))
    this.persist()
  }

  toggleNumbers(view?: EditorView) {
    this.numbers = !this.numbers
    this.each(view, (one) => setHeadingNumbers(one, this.numbers))
    this.persist()
  }

  toggleLineNumbers(view?: EditorView) {
    this.lineNumbers = !this.lineNumbers
    this.each(view, (one) => setCodeLineNumbers(one, this.lineNumbers))
    this.persist()
  }

  /** Code fences are coloured on their own, so a light theme can hold a dark
   *  fence and the other way round. */
  setCodeTheme(id: string, view?: EditorView) {
    this.codeTheme = id
    this.each(view, (one) => setCodeTheme(one, id))
    this.persist()
  }

  toggleSpellcheck(view?: EditorView) {
    this.spellcheck = !this.spellcheck
    this.each(view, (one) => setSpellcheck(one, this.spellcheck, this.dictionary))
    this.persist()
  }

  /** What the checker reads against: a tag when one was chosen, nothing when
   *  the browser is to pick. */
  private get dictionary(): string | undefined {
    return this.spellLanguage === 'system' ? undefined : this.spellLanguage
  }

  /** Adds a word to the reader's own list, or takes it away when it is already
   *  there. One call for both, because the menu row and the settings row are the
   *  same act said twice.
   *
   *  Kept lowercased and sorted, so the list reads as a list rather than as the
   *  order somebody happened to meet the words in, and a word added twice in two
   *  cases is one word. */
  toggleSpellWord(word: string, view?: EditorView) {
    const wanted = word.trim().toLowerCase()
    if (!isSpellWord(wanted)) return

    const rest = this.spellWords.filter((one) => one !== wanted)
    const words = rest.length === this.spellWords.length ? [...rest, wanted].sort() : rest
    if (words.length > MOST_SPELL_WORDS) return

    this.spellWords = words
    this.each(view, (one) => setSpellWords(one, words))
    this.persist()
    this.share({ spellWords: words })
  }

  /** Whether a word is already one of the reader's own. */
  knowsWord(word: string): boolean {
    return this.spellWords.includes(word.trim().toLowerCase())
  }

  setSpellLanguage(value: string, view?: EditorView) {
    this.spellLanguage = value
    this.each(view, (one) => setSpellcheck(one, this.spellcheck, this.dictionary))
    this.persist()
  }

  /** How much of a note the glyphs are drawn over. Said outright rather than
   *  flipped: there are three answers, not two. */
  setLigatures(scope: string, view?: EditorView) {
    const wanted = ligatureScope(scope)
    if (!wanted || wanted === this.ligatures) return

    this.ligatures = wanted
    this.each(view, (one) => setLigatures(one, wanted))
    this.persist()
    this.share({ ligatures: wanted })
  }

  /** The colour the highlight button writes from now on. A tone the palette does
   *  not name, or none at all, is the plain highlight. */
  setHighlightTone(tone: number | null) {
    const wanted = highlightTone(tone).tone
    if (wanted === this.highlightTone) return

    this.highlightTone = wanted
    setHighlightColour(this.highlight)
    this.persist()
    this.share({ highlightTone: wanted })
  }

  /** The colour that button writes, as the renderer and the editor know it. */
  get highlight(): HighlightColour {
    return highlightTone(this.highlightTone)
  }

  /** Whether a single newline breaks the line, everywhere a note is read. */
  toggleHardBreaks() {
    this.hardBreaks = !this.hardBreaks
    setHardBreaks(this.hardBreaks)
    this.persist()
    this.share({ hardBreaks: this.hardBreaks })
  }

  /** How a link to another note is written from now on. Nothing already written
   *  changes: both spellings are read, so a space may hold both. */
  setLinkFormat(format: string) {
    if (!isLinkFormat(format) || format === this.linkFormat) return

    this.linkFormat = format
    setLinkWriting(format)
    this.persist()
    this.share({ linkFormat: format })
  }

  /** Which of the two ways a note reaches the glasses. */
  /** At which heading level a new page starts on the glasses. */
  setGlassesBreak(level: string) {
    const wanted = glassesBreak(level)
    if (wanted === null || wanted === this.glassesBreak) return

    this.glassesBreak = wanted
    this.persist()
    this.share({ glassesBreak: wanted })
  }

  setGlassesLineNumbers(on: boolean) {
    if (on === this.glassesLineNumbers) return

    this.glassesLineNumbers = on
    this.persist()
    this.share({ glassesLineNumbers: on })
  }

  setGlassesVoice(on: boolean) {
    if (on === this.glassesVoice) return

    this.glassesVoice = on
    this.persist()
    this.share({ glassesVoice: on })
  }

  setGlassesCompaction(level: string) {
    if (!isCompaction(level) || level === this.glassesCompaction) return

    this.glassesCompaction = level
    this.persist()
    this.share({ glassesCompaction: level })
  }

  /** One marker on or off. Written whole rather than as a difference, because
   *  there are eight of them and the account holds one small object either way. */
  setGlassesMark(name: keyof Marks, on: boolean) {
    if (this.glassesMarks[name] === on) return

    this.glassesMarks = { ...this.glassesMarks, [name]: on }
    this.persist()
    this.share({ glassesMarks: { ...this.glassesMarks } })
  }

  /** What a spoken command answers to. An empty phrase is the default put back,
   *  which is why the map holds only the differences. */
  setGlassesWord(id: string, phrase: string) {
    const wanted = phrase.trim().toLowerCase()
    // Built rather than deleted from: an empty phrase is the default put back, and
    // "the entries that are not this one" says that without reaching for `delete`.
    const words = Object.fromEntries(
      Object.entries(this.glassesWords).filter(([one]) => one !== id),
    )
    if (wanted) words[id] = wanted

    this.glassesWords = words
    this.persist()
    this.share({ glassesWords: words })
  }

  /** Whether the account has been told, this sitting, that a pair of glasses
   *  answered. Not written down: what is written down is `glassesSeen`, and the
   *  point of this is that the two are different questions. */
  private toldOfGlasses = false

  /** Said by the plugin every time a pair of glasses answers, and passed on to the
   *  account once a sitting.
   *
   *  Once a sitting rather than once a machine, which is what it was: the machine is
   *  a plugin page whose own store a packed build loses - see account.svelte.ts,
   *  which keeps the session somewhere else for exactly that reason - so "this
   *  machine already knows" does not mean "the account has been told", and the
   *  account is the only place the answer is any use to the desktop. Where the pull
   *  has already shown that the account knows, nothing is sent at all. */
  sawGlasses() {
    if (this.toldOfGlasses) return

    this.toldOfGlasses = true
    if (!this.glassesSeen) {
      this.glassesSeen = true
      this.persist()
    }

    this.share({ glassesSeen: true })
  }

  setGlassesModel(model: string) {
    if (model === this.glassesModel) return

    this.glassesModel = model
    this.persist()
    this.share({ glassesModel: model })
  }

  setGlassesEffort(effort: string) {
    if (!isEffort(effort) || effort === this.glassesEffort) return

    this.glassesEffort = effort
    this.persist()
    this.share({ glassesEffort: effort })
  }

  toggleVim(view?: EditorView) {
    this.setVimKeys(!this.vim, view)
  }

  /** Modal editing on or off. Said outright rather than flipped, because a
   *  preset says which it wants rather than that it wants the other one. */
  setVimKeys(on: boolean, view?: EditorView) {
    if (on === this.vim) return

    this.vim = on
    this.each(view, (one) => setVim(one, on))
    this.persist()
    this.share({ vim: on })
  }

  /** Which mode a view is in, for the status bar. Null while modal editing is
   *  off, and while a view that has just been built has yet to report. */
  vimModeOf(view: EditorView | undefined): VimMode | null {
    return (view && this.vimModes.get(view)) ?? null
  }

  setAttachments(value: string) {
    if (!isAttachmentFolder(value)) return

    this.attachments = value
    this.persist()
    this.share({ attachments: value })
  }

  setConflicts(value: string) {
    const rule = conflictRule(value)
    if (!rule) return

    this.conflicts = rule
    this.persist()
    this.share({ conflicts: rule })
  }

  /** A month or a year, and nothing in between: the two the service takes, so a
   *  number nobody offered is a horizon nobody asked for. */
  setKeepVersions(days: number) {
    const wanted = KEEP_VERSIONS.find((one) => one === days)
    if (wanted === undefined || wanted === this.keepVersions) return

    this.keepVersions = wanted
    this.persist()
    this.share({ keepVersions: wanted })
  }

  /** Takes over the account's settings: signing in on a new machine brings
   *  them along, and a change made on another shows up at the next start.
   *  What the account has not decided stays as this machine had it.
   *
   *  Hands back everything the account holds, settings this store knows
   *  nothing about included, so the one request answers for all of them. The
   *  shortcuts are taken from it in App.svelte; see shortcuts.svelte.ts. */
  async adopt(token: string): Promise<AccountSettings | null> {
    // What this machine had said before the question went out. Anything it
    // says while the answer is in the air is newer than the answer, so the
    // answer stops being worth adopting: the account already has the newer
    // value, and taking the older one back would undo the reader's own switch.
    //
    // Read before anything is awaited, or a choice made in the same tick as this
    // call would be counted as older than an answer that had not left yet.
    const asked = this.sent

    // Whatever this machine decided before it knew there was an account goes up
    // first; see `share`. It is one request and only when something is owed, so an
    // ordinary start still asks once. It is not a choice, so it is not counted as
    // one: what `asked` is about is the reader changing their mind.
    await this.settle(token)

    let remote: AccountSettings
    try {
      const answer = await api.settings(token)
      remote = answer.settings
      // Whether the account has an OpenAI key, and its last four characters. Not a
      // setting - nothing can send it back up - but it comes back with them, so the
      // pane and the bridge learn about it in the one request the app already
      // makes. See even/key.svelte.ts.
      glassesKey.took(answer.key)
    } catch {
      return null
    }

    // Nothing this machine has chosen since the question went out; see above.
    const unheard = this.sent === asked

    // Both shapes of the setting read; see `ligatureScope`.
    const theirs = ligatureScope(remote.ligatures)
    if (theirs && unheard && theirs !== this.ligatures) {
      this.ligatures = theirs
      this.each(undefined, (one) => setLigatures(one, theirs))
      this.persist()
    }

    const modal = remote.vim
    if (typeof modal === 'boolean' && unheard && modal !== this.vim) {
      this.vim = modal
      this.each(undefined, (one) => setVim(one, modal))
      this.persist()
    }

    const folder = remote.attachments
    if (isAttachmentFolder(folder) && unheard && folder !== this.attachments) {
      this.attachments = folder
      this.persist()
    }

    const clash = conflictRule(remote.conflicts)
    if (clash && unheard && clash !== this.conflicts) {
      this.conflicts = clash
      this.persist()
    }

    const keeping = remote.keepVersions
    if (isNumber(keeping) && KEEP_VERSIONS.includes(keeping) && unheard) {
      if (keeping !== this.keepVersions) {
        this.keepVersions = keeping
        this.persist()
      }
    }

    const tone = remote.highlightTone
    if ((isNumber(tone) || tone === null) && unheard) {
      const wanted = highlightTone(tone).tone
      if (wanted !== this.highlightTone) {
        this.highlightTone = wanted
        setHighlightColour(this.highlight)
        this.persist()
      }
    }

    const breaking = remote.hardBreaks
    if (typeof breaking === 'boolean' && unheard && breaking !== this.hardBreaks) {
      this.hardBreaks = breaking
      setHardBreaks(breaking)
      this.persist()
    }

    const spelling = remote.linkFormat
    if (isLinkFormat(spelling) && unheard && spelling !== this.linkFormat) {
      this.linkFormat = spelling
      setLinkWriting(spelling)
      this.persist()
    }

    // The reader's own words. Taken whole rather than merged: the list is what
    // the account says it is, and a word taken away on another device should
    // stay taken away rather than being put back by this one.
    const words = remote.spellWords
    if (Array.isArray(words) && unheard) {
      const kept = words.filter(isSpellWord).slice(0, MOST_SPELL_WORDS)
      if (kept.join('\0') !== this.spellWords.join('\0')) {
        this.spellWords = kept
        this.each(undefined, (one) => setSpellWords(one, kept))
        this.persist()
      }
    }

    // The Glasses section. All of it comes back down, which is the whole reason it
    // is on the account rather than on the machine: the plugin runs on a phone and
    // is set up on a desktop, and typing a key into a phone through a WebView is
    // nobody's idea of an evening.
    if (unheard) this.adoptGlasses(remote)

    return remote
  }

  /** The Glasses settings, as the account has them.
   *
   *  Kept apart from `adopt` because it is seven fields of the same shape and one
   *  more `if` in that method would have made it unreadable. Each is taken only
   *  when the account actually said something about it: an account written by a
   *  build that had no such setting says nothing, and nothing is not `false`. */
  private adoptGlasses(remote: AccountSettings): void {
    let moved = false
    const took = <T>(value: T | undefined, take: (one: T) => void) => {
      if (value === undefined) return

      take(value)
      moved = true
    }

    const level = glassesBreak(remote.glassesBreak)
    if (level !== null && level !== this.glassesBreak) {
      this.glassesBreak = level
      moved = true
    }

    if (typeof remote.glassesLineNumbers === 'boolean') {
      took(remote.glassesLineNumbers, (on) => (this.glassesLineNumbers = on))
    }
    if (typeof remote.glassesVoice === 'boolean') {
      took(remote.glassesVoice, (on) => (this.glassesVoice = on))
    }
    if (isCompaction(remote.glassesCompaction)) {
      took(remote.glassesCompaction, (level) => (this.glassesCompaction = level))
    }
    if (remote.glassesMarks !== undefined) {
      took(marksOf(remote.glassesMarks), (marks) => (this.glassesMarks = marks))
    }
    if (remote.glassesWords !== undefined) {
      took(wordsOf(remote.glassesWords), (words) => (this.glassesWords = words))
    }
    if (remote.glassesSeen === true) {
      took(true, (seen) => (this.glassesSeen = seen))
      // The account knows, so nothing here has to tell it again.
      this.toldOfGlasses = true
    }
    if (typeof remote.glassesModel === 'string') {
      took(remote.glassesModel, (model) => (this.glassesModel = model))
    }
    if (isEffort(remote.glassesEffort)) {
      took(remote.glassesEffort, (effort) => (this.glassesEffort = effort))
    }

    if (moved) this.persist()
  }

  /** How many choices this machine has made since it started. Counted whether
   *  or not there was an account to tell, because what it is for is telling an
   *  answer that set off earlier from one that set off later. */
  private sent = 0

  /** What was decided with no session to tell, waiting for one.
   *
   *  Emil, on his desktop: *"I don't see the glasses setting on desktop, even though
   *  I already had the Even plugin open."* The account said nothing about
   *  `glassesSeen` and everything about the settings he had changed later in the same
   *  sitting, which is the whole story: the plugin sees a pair of glasses within a
   *  moment of starting, and on a phone the session takes seconds to come back
   *  because it comes from the host app rather than from the page. So `sawGlasses`
   *  ran with `accountToken` still null, the patch went nowhere, and - being already
   *  true on that machine - it was never said again.
   *
   *  Anything said once and only once has that shape, so it is kept here rather than
   *  fixed in one caller: a patch with nowhere to go waits, and goes up with the next
   *  one that has somewhere, or on the next settings pull. */
  private owed: AccountSettings = {}

  /** Tells the account, when there is one. A machine that is offline keeps
   *  its own choice, and carries it up the moment there is somewhere to carry it. */
  private share(patch: AccountSettings) {
    this.sent++

    const token = account.accountToken
    if (!token) {
      this.owed = { ...this.owed, ...patch }
      return
    }

    const owed = this.owed
    this.owed = {}
    void api.saveSettings(token, { ...owed, ...patch }).catch(() => {
      // It never arrived, so it is owed again - behind anything said since, which
      // is newer than both.
      this.owed = { ...owed, ...patch, ...this.owed }
    })
  }

  /** Sends what was decided before there was an account to tell it to.
   *
   *  Before the pull rather than after, so that what comes back down is an account
   *  with those decisions in it: this machine and the account then agree, instead of
   *  the pull handing back an account that had not heard yet and `adoptGlasses`
   *  taking that older answer. */
  private async settle(token: string): Promise<void> {
    const owed = this.owed
    if (!Object.keys(owed).length) return

    this.owed = {}
    try {
      await api.saveSettings(token, owed)
    } catch {
      this.owed = { ...owed, ...this.owed }
    }
  }

  toggleCloseBrackets(view?: EditorView) {
    this.closeBrackets = !this.closeBrackets
    this.each(view, (one) => setCloseBrackets(one, this.closeBrackets))
    this.persist()
  }

  toggleStrict(view?: EditorView) {
    this.strict = !this.strict
    this.each(view, (one) => setStrictMode(one, this.strict))
    this.persist()
  }

  toggleEquationNumbers(view?: EditorView) {
    this.equationNumbers = !this.equationNumbers
    this.each(view, (one) => setEquationNumbers(one, this.equationNumbers))
    this.persist()
  }

  toggleRightToLeft(view?: EditorView) {
    this.rtl = !this.rtl
    this.each(view, (one) => setRightToLeft(one, this.rtl))
    this.persist()
  }

  /** The sliders in preferences set a value outright; the keyboard steps
   *  through the same range. Both land in the same place. */
  setZoom(value: number) {
    this.zoom = clamp(value, ZOOM_STEPS)
    this.applyZoom()
    this.persist()
  }

  setWidth(value: number, view?: EditorView) {
    this.width = Math.round(value)
    this.each(view, (one) => setMeasure(one, this.width))
    this.persist()
  }

  setLineSpacing(value: number, view?: EditorView) {
    this.lineHeight = Math.round(value * 100) / 100
    this.each(view, (one) => setLineHeight(one, this.lineHeight))
    this.persist()
  }

  /** Steps through the widths rather than offering a slider of nothing. */
  stepWidth(direction: number, view?: EditorView) {
    this.width = step(WIDTHS, this.width, direction, 42)
    this.each(view, (one) => setMeasure(one, this.width))
    this.persist()
  }

  stepLineHeight(direction: number, view?: EditorView) {
    this.lineHeight = step(LINE_HEIGHTS, this.lineHeight, direction, 1.72)
    this.each(view, (one) => setLineHeight(one, this.lineHeight))
    this.persist()
  }

  stepZoom(direction: number) {
    this.zoom = step(ZOOM_STEPS, this.zoom, direction, 1)
    this.applyZoom()
    this.persist()
  }

  resetZoom() {
    this.zoom = 1
    this.applyZoom()
    this.persist()
  }

  /** Zoom is the one metric that cannot live on the view: `--text-content` is
   *  worked out at the root, so `--zoom` has to be set there too. Which means
   *  nothing tells the editor its text just changed size - hence the view kept
   *  above, and this. */
  private applyZoom() {
    document.documentElement.style.setProperty('--zoom', String(this.zoom))
    for (const one of this.views) remeasure(one)
  }

  private persist() {
    const state: Saved = {
      source: this.source,
      readOnly: this.readOnly,
      focus: this.focus,
      typewriter: this.typewriter,
      punctuation: this.punctuation,
      numbers: this.numbers,
      lineNumbers: this.lineNumbers,
      codeTheme: this.codeTheme,
      rtl: this.rtl,
      strict: this.strict,
      equationNumbers: this.equationNumbers,
      zoom: this.zoom,
      width: this.width,
      lineHeight: this.lineHeight,
      spellcheck: this.spellcheck,
      spellLanguage: this.spellLanguage,
      spellWords: this.spellWords,
      alwaysOnTop: this.alwaysOnTop,
      closeBrackets: this.closeBrackets,
      ligatures: this.ligatures,
      glassesBreak: this.glassesBreak,
      glassesLineNumbers: this.glassesLineNumbers,
      glassesVoice: this.glassesVoice,
      glassesCompaction: this.glassesCompaction,
      glassesMarks: this.glassesMarks,
      glassesWords: this.glassesWords,
      glassesSeen: this.glassesSeen,
      glassesModel: this.glassesModel,
      glassesEffort: this.glassesEffort,
      vim: this.vim,
      attachments: this.attachments,
      conflicts: this.conflicts,
      keepVersions: this.keepVersions,
      highlightTone: this.highlightTone,
      hardBreaks: this.hardBreaks,
      linkFormat: this.linkFormat,
    }
    keep(STORAGE_KEY, JSON.stringify(state))
  }
}

export const modes = new Modes()
