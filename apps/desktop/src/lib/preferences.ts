import type { EditorView } from '@nib/editor'
import { CODE_PALETTES } from '@nib/editor'
import { panelDrawable } from './even/panel-words'
import { glassesGroups, wordFields } from './even/settings'
import { CATALOGUES_URL, i18n, LANGUAGES, plural, t } from './i18n.svelte'
import { modes } from './modes.svelte'
import { PROPERTIES_MODES } from '@nib/markdown/properties'
import { PROPERTIES_WORDS } from './properties-words'
import { isPlugin } from './plugin'
import { DEFAULT_ID_FORMAT, ID_FORMATS, noteId } from './note-id'
import { DEFAULT_PAGE_SETUP, ORIENTATIONS, PAPER_SIZES } from './page-setup'
import { DEFAULT_DAYS, DEFAULT_MINUTES, KEEP_DAYS, SNAPSHOT_MINUTES } from './recovery'
import { recovery } from './recovery.svelte'
import { settings } from './settings.svelte'
import { isDesktop } from './tauri'
import { SCHEME_CHOICES, SCHEME_NAMES, type SchemeChoice, theme } from './theme.svelte'
import { asChannel } from './updater'
import { updates } from './updates.svelte'

/** What every control has, whatever kind it is. */
interface Common {
  label: string
  /** One plain sentence about what the setting does, shown behind a small `i`
   *  beside the label. For the settings whose name only means something to
   *  somebody who already knows the word; one that explains itself has none, and
   *  shows no glyph at all. */
  hint?: string
}

/** One choice among a few, drawn as a row rather than opened as a list. Only
 *  where the choices are two or three short words worth seeing at once. */
export interface Segment {
  value: string
  label: string
  /** Set where the choice cannot be honoured right now - a scheme the theme in
   *  force does not have. Shown as the app shows anything disabled. */
  disabled?: boolean
}

/** One control, and how to read and write whatever sits behind it. A field
 *  that says what it starts as can be put back to that; a pane whose fields
 *  all can offers a reset. */
export type Field = Common &
  (
    | { kind: 'switch'; initial?: boolean; get(): boolean; set(on: boolean): void }
    | {
        kind: 'slider'
        min: number
        max: number
        step: number
        unit?: string
        initial?: number
        get(): number
        set(value: number): void
      }
    | {
        kind: 'select'
        /** `note` is one thing worth knowing about that choice before it is made,
         *  drawn as a footnote mark against the name; see Select.svelte. */
        options: { value: string; label: string; note?: string }[]
        initial?: string
        get(): string
        set(value: string): void
      }
    | {
        kind: 'segmented'
        options: Segment[]
        initial?: string
        get(): string
        set(value: string): void
      }
    /** A line somebody types. Only where nothing else will do - a spoken command's
     *  own phrase, a page's margin - and never on the glasses, which have nothing to
     *  type with. */
    | {
        kind: 'text'
        /** What it says with nobody having typed anything, which for a phrase is the
         *  phrase the app already answers to. An empty field is that put back. */
        placeholder: string
        /** Written as it is typed rather than when the field is left.
         *
         *  The page setup is the one that wants this: the margin and the running text
         *  are read by an export the reader may start from the row of buttons under
         *  the very same card, without the field ever losing focus. A phrase the app
         *  answers to is the other way round - half a word is a phrase that matches
         *  nothing, so it waits. */
        live?: boolean
        initial?: string
        get(): string
        set(value: string): void
      }
  )

/** A line under a card, for what no control on it can say about itself. Its own
 *  words where there is nothing to open, and a link where there is: the language
 *  row says a catalogue was machine-written and where a correction goes. */
export interface Caption {
  text: string
  url?: string
}

export interface Group {
  title: string
  caption?: Caption
  fields: Field[]
}

/** Dictionaries the browser's checker can be pointed at, named the way their
 *  speakers name them, so they read the same whatever the app's language.
 *  `system` leaves the choice to the browser. */
const DICTIONARIES = [
  { id: 'system', name: 'Match the system' },
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
  { id: 'fr', name: 'Français' },
  { id: 'es', name: 'Español' },
  { id: 'it', name: 'Italiano' },
  { id: 'nl', name: 'Nederlands' },
  { id: 'pt', name: 'Português' },
  { id: 'ja', name: '日本語' },
] as const

/** A control hands its value back as a string, because that is what a control
 *  holds. Following the system is what anything else reads as. */
function asChoice(value: string): SchemeChoice {
  return value === 'dark' || value === 'light' ? value : 'system'
}

/** The panes that are only about settings. The account and the LLM connector are
 *  their own thing and stay written out by hand. */
type PaneId = 'general' | 'editor' | 'spelling' | 'markdown' | 'appearance' | 'glasses' | 'export'

export interface Pane {
  id: PaneId
  label: string
  groups: Group[]
}

/** Built against a live view so a change lands in the editor on screen. */
export function preferences(view?: EditorView): Pane[] {
  // One moment for every example on the pane, so the options read as one set of
  // spellings of the same time rather than as four different times.
  const moment = new Date()

  return [
    {
      id: 'general',
      label: t('General'),
      groups: [
        {
          // A note being written in is kept every so often on top of what a
          // save keeps, so a crash between two saves is not the end of the
          // story; History is where the versions are.
          title: t('Recovery'),
          fields: [
            {
              kind: 'select',
              label: t('Keep a version every'),
              options: SNAPSHOT_MINUTES.map((minutes) => ({
                value: String(minutes),
                label: minutes ? t('{count} min', { count: minutes }) : t('Off'),
              })),
              initial: String(DEFAULT_MINUTES),
              get: () => String(recovery.every),
              set: (value) => recovery.setEvery(Number(value)),
            },
            {
              kind: 'select',
              label: t('Keep versions for'),
              options: KEEP_DAYS.map((days) => ({
                value: String(days),
                label: plural(days, { one: '{count} day', other: '{count} days' }),
              })),
              initial: String(DEFAULT_DAYS),
              get: () => String(recovery.days),
              set: (value) => recovery.setDays(Number(value)),
            },
          ],
        },
        {
          title: t('Language'),
          // Two things can be worth saying about a language, and both are one line.
          //
          // Most of the catalogues were written in one pass and never read through.
          // Saying so is the honest part; the folder they live in is the useful part,
          // because the reader who can see the wrong word is the only person who can
          // put it right.
          //
          // And the glasses have one font baked into the firmware, with no Devanagari,
          // Arabic, Thai, Burmese or Ethiopic in it at all - so for a reader in one of
          // those scripts the panel is in English however the app is set. Said here,
          // where the choice is made, and only to somebody who has a pair: it is the
          // one place a reader could act on it, and noise to everybody else. The rule
          // itself is `panelDrawable`; see even/panel-words.ts.
          ...caption(),
          fields: [
            {
              kind: 'select',
              label: t('Language'),
              // Each row says for itself whether its catalogue was written in one
              // pass and never read through, in the same sentence the caption says
              // it in - said once, in machineSaid. The caption is about the
              // language already chosen, which is the one row nobody in the list is
              // choosing; a reader deciding between forty of them can only read it
              // here.
              options: LANGUAGES.map((one) => ({
                value: one.id,
                label: t(one.name),
                ...(one.machine ? { note: machineSaid() } : {}),
              })),
              get: () => i18n.choice,
              set: (value) => i18n.select(value),
            },
          ],
        },

        // Only the desktop app installs anything: a page is the new version the
        // moment it is reloaded, and a phone app is the store's business. So the
        // row is not there at all rather than there and answering nothing.
        //
        // The choice stays on this machine, since it is about this machine: one
        // laptop can run the build of main while the desktop stays on the
        // releases. See updates.svelte.ts.
        ...(isDesktop
          ? ([
              {
                title: t('Updates'),
                fields: [
                  {
                    kind: 'segmented',
                    label: t('Release channel'),
                    hint: t(
                      'Stable follows the official releases, Unstable every push to main and can break.',
                    ),
                    options: [
                      { value: 'stable', label: t('Stable') },
                      { value: 'unstable', label: t('Unstable') },
                    ],
                    initial: 'stable',
                    get: () => updates.channel,
                    set: (value) => updates.setChannel(asChannel(value)),
                  },
                ],
              },
            ] satisfies Group[])
          : []),
      ],
    },

    {
      id: 'editor',
      label: t('Editor'),
      groups: [
        {
          title: t('Text'),
          fields: [
            {
              kind: 'slider',
              label: t('Text size'),
              min: 0.8,
              max: 1.6,
              step: 0.05,
              unit: '×',
              initial: 1,
              get: () => modes.zoom,
              set: (value) => modes.setZoom(value),
            },
            {
              kind: 'slider',
              label: t('Line spacing'),
              min: 1.3,
              max: 2.2,
              step: 0.02,
              initial: 1.72,
              get: () => modes.lineHeight,
              set: (value) => modes.setLineSpacing(value, view),
            },
            {
              kind: 'slider',
              label: t('Line width'),
              min: 30,
              max: 70,
              step: 1,
              unit: 'rem',
              initial: 42,
              get: () => modes.width,
              set: (value) => modes.setWidth(value, view),
            },
          ],
        },
        {
          title: t('Writing'),
          fields: [
            {
              kind: 'switch',
              label: t('Close brackets and quotes'),
              initial: true,
              get: () => modes.closeBrackets,
              set: () => modes.toggleCloseBrackets(view),
            },
            {
              kind: 'switch',
              label: t('Typewriter mode'),
              initial: false,
              get: () => modes.typewriter,
              set: () => modes.toggleTypewriter(view),
            },
            {
              kind: 'switch',
              label: t('Focus mode'),
              initial: false,
              get: () => modes.focus,
              set: () => modes.toggleFocus(view),
            },
            {
              // `->` drawn as an arrow, and its kind. A scope rather than a
              // switch: an arrow is welcome where it is an operator and a
              // surprise in the middle of a sentence, so code can have it on
              // its own.
              kind: 'select',
              label: t('Ligatures'),
              options: [
                { value: 'off', label: t('Off') },
                { value: 'code', label: t('Code only') },
                { value: 'all', label: t('Everywhere') },
              ],
              initial: 'off',
              get: () => modes.ligatures,
              set: (value) => modes.setLigatures(value, view),
            },
            {
              // Where a pasted or dropped picture lands. What the note says
              // stays relative to the note either way, so the choice changes
              // nothing about notes already written.
              kind: 'select',
              label: t('Attachments'),
              options: [
                { value: 'space', label: t('Assets folder of the space') },
                { value: 'note', label: t('Next to the note') },
                { value: 'named', label: t('A folder named after the note') },
              ],
              initial: 'space',
              get: () => modes.attachments,
              set: (value) => modes.setAttachments(value),
            },
          ],
        },
        {
          // The paper a page note starts on. A page already written on is changed from
          // its own menu in the panel, which is where somebody looking at a page is;
          // this is only what a new one is given. See PagesNavigator.svelte.
          title: t('Page notes'),
          fields: [
            {
              kind: 'select',
              label: t('New pages'),
              options: [
                { value: 'a4', label: t('A4') },
                { value: 'letter', label: t('Letter') },
                { value: 'long', label: t('Long page') },
              ],
              initial: 'a4',
              get: () => modes.pagesPaper,
              set: (value) => modes.setPagesPaper(value),
            },
          ],
        },
        {
          // What "New unique note" names a note. Each option is labelled with
          // what it would produce right now, which says more than the tokens do.
          title: t('Unique note names'),
          fields: [
            {
              kind: 'select',
              label: t('Name'),
              options: ID_FORMATS.map((format) => ({
                value: format,
                label: noteId(format, moment),
              })),
              initial: DEFAULT_ID_FORMAT,
              get: () => settings.noteIdFormat,
              set: (value) => settings.setNoteIdFormat(value),
            },
          ],
        },
        {
          // How a link to another note is written. Not what is read: both
          // spellings are read whatever this says, so a space may hold both and
          // nothing already written changes.
          title: t('Links'),
          fields: [
            {
              kind: 'select',
              label: t('New links'),
              hint: t(
                'Wikilinks name the note, so a link survives it being renamed; both spellings are read either way.',
              ),
              options: [
                { value: 'wikilink', label: t('[[Wikilinks]]') },
                { value: 'shortest', label: t('Markdown, shortest name') },
                { value: 'relative', label: t('Markdown, relative path') },
                { value: 'absolute', label: t('Markdown, path in the space') },
              ],
              initial: 'wikilink',
              get: () => modes.linkFormat,
              set: (value) => modes.setLinkFormat(value),
            },
          ],
        },
        {
          title: t('Code'),
          fields: [
            {
              kind: 'select',
              label: t('Highlighting'),
              options: CODE_PALETTES.map((one) => ({ value: one.id, label: one.name })),
              initial: 'follow',
              get: () => modes.codeTheme,
              set: (value) => modes.setCodeTheme(value, view),
            },
            {
              kind: 'switch',
              label: t('Line numbers'),
              initial: false,
              get: () => modes.lineNumbers,
              set: () => modes.toggleLineNumbers(view),
            },
          ],
        },
      ],
    },

    {
      id: 'spelling',
      label: t('Spelling'),
      groups: [
        {
          title: t('Checking'),
          fields: [
            {
              kind: 'switch',
              label: t('Check spelling'),
              initial: true,
              get: () => modes.spellcheck,
              set: () => modes.toggleSpellcheck(view),
            },
          ],
        },
        {
          // The browser checks against the dictionary the surface's language
          // names, so this is the one setting that decides whose words are
          // wrong.
          title: t('Dictionary'),
          fields: [
            {
              kind: 'select',
              label: t('Language'),
              options: DICTIONARIES.map((one) => ({ value: one.id, label: t(one.name) })),
              initial: 'system',
              get: () => modes.spellLanguage,
              set: (value) => modes.setSpellLanguage(value, view),
            },
          ],
        },
      ],
    },

    {
      id: 'markdown',
      label: t('Markdown'),
      groups: [
        {
          title: t('Syntax'),
          fields: [
            {
              kind: 'switch',
              label: t('Strict CommonMark'),
              hint: t('Only the standard markdown rules, no tables, task lists or footnotes.'),
              initial: false,
              get: () => modes.strict,
              set: () => modes.toggleStrict(view),
            },
            {
              kind: 'switch',
              label: t('Smart punctuation'),
              hint: t('Turns straight quotes and dashes into typographic ones as you type.'),
              initial: false,
              get: () => modes.punctuation,
              set: () => modes.togglePunctuation(view),
            },
            {
              // What CommonMark says a single newline is, and what Obsidian's own
              // "Strict line breaks" asks the other way round. Off, which is the
              // standard and what every other reader does with the same file; the
              // hint says what Obsidian calls it so nobody has to guess which
              // switch is which.
              kind: 'switch',
              label: t('A single newline breaks the line'),
              hint: t(
                'Off is standard markdown: two lines of one paragraph read as one; Obsidian calls it strict line breaks.',
              ),
              initial: false,
              get: () => modes.hardBreaks,
              set: () => modes.toggleHardBreaks(),
            },
            {
              // What a note's front matter is drawn as. Three answers, not two, so a
              // segmented row rather than a switch - and the same three Obsidian
              // asks with. Read by the editor and by the reading view, so a note
              // cannot say one thing written and another read.
              kind: 'segmented',
              label: t('Front matter'),
              hint: t(
                'Properties draws the rows and edits them in place; Source is the YAML as typed.',
              ),
              options: PROPERTIES_MODES.map((one) => ({
                value: one,
                label: t(PROPERTIES_WORDS[one]),
              })),
              initial: 'properties',
              get: () => modes.properties,
              set: (value) => modes.setProperties(value, view),
            },
          ],
        },
        {
          title: t('Numbering'),
          fields: [
            {
              kind: 'switch',
              label: t('Number headings'),
              hint: t('Puts 1., 1.1, 1.2 in front of headings.'),
              initial: false,
              get: () => modes.numbers,
              set: () => modes.toggleNumbers(view),
            },
            {
              kind: 'switch',
              label: t('Number equations'),
              hint: t('Numbers display equations so you can refer to them.'),
              initial: false,
              get: () => modes.equationNumbers,
              set: () => modes.toggleEquationNumbers(view),
            },
          ],
        },
        {
          title: t('Direction'),
          fields: [
            {
              kind: 'switch',
              label: t('Right to left'),
              initial: false,
              get: () => modes.rtl,
              set: () => modes.toggleRightToLeft(view),
            },
          ],
        },
      ],
    },

    {
      id: 'appearance',
      label: t('Appearance'),
      groups: [
        {
          title: t('Theme'),
          fields: [
            {
              // The theme, and nothing else. A theme has a dark side or a light
              // one or both; which of them the app is showing is the row below.
              //
              // Named for what it picks rather than for the group it is in: the
              // group is the theme and both rows are about it, so a row called
              // Theme under a heading called Theme read as "Theme / Theme / Mode"
              // and said nothing about which of the two was which. This one picks
              // the look - the palette and the type a theme sets - and the one
              // below picks which side of it the app is showing.
              kind: 'select',
              label: t('Style'),
              options: theme.all.map((one) => ({ value: one.id, label: t(one.name) })),
              get: () => theme.id,
              set: (value) => theme.select(value),
            },
            {
              // Following the system is where everybody starts and the only one
              // of the three that changes with the hour, so it stays a segment
              // of its own rather than being something to arrive back at.
              //
              // Neither row says what it started as, so the pane offers no reset:
              // a look chosen from a gallery is not a default anybody drifted
              // away from, and the accent below is drawn by hand where a reset
              // could not reach it.
              kind: 'segmented',
              label: t('Mode'),
              options: SCHEME_CHOICES.map((one) => ({
                value: one,
                label: t(SCHEME_NAMES[one]),
                disabled: !theme.offers(one),
              })),
              get: () => theme.shown,
              set: (value) => theme.setScheme(asChoice(value)),
            },
          ],
        },

        // The window itself: who draws its frame, and whether the desk shows through
        // it. Desktop only, because a browser tab has neither - and on a phone the
        // system draws everything. Nib's own frame stays the default: the bar it draws
        // holds the menu, the sidebar toggle, the tabs and the window's three buttons,
        // and it is the shape the whole shell is measured from. See appearance.rs.
        ...(isDesktop
          ? ([
              {
                title: t('Window'),
                fields: [
                  {
                    kind: 'segmented',
                    label: t('Frame'),
                    options: [
                      { value: 'nib', label: t('Nib’s own') },
                      { value: 'system', label: t('The system’s') },
                    ],
                    initial: 'nib',
                    get: () => modes.frame,
                    set: (value) => modes.setFrame(value),
                  },
                  {
                    // A switch would read as "Translucency: on", which is the same two
                    // words in a shape that says less; the row beside it is a choice of
                    // two and these read as a pair. Where the platform has nothing to
                    // turn on, turning it on says so and comes back off; see
                    // `applyTranslucency` in modes.svelte.ts.
                    kind: 'segmented',
                    label: t('Translucency'),
                    options: [
                      { value: 'off', label: t('Off') },
                      { value: 'on', label: t('On') },
                    ],
                    initial: 'off',
                    get: () => (modes.translucent ? 'on' : 'off'),
                    set: (value) => modes.setTranslucent(value === 'on'),
                  },
                ],
              },
            ] satisfies Group[])
          : []),
      ],
    },

    // Only for somebody who has a pair. In the plugin always; on every other
    // device once the plugin has answered a pair of glasses at least once, which
    // the account remembers. Spread rather than left empty, so the pane does not
    // exist at all otherwise: an empty section is a question nobody asked, and
    // the settings search reads this same list.
    //
    // Every field in it comes from even/settings.ts, which is the one list both
    // this pane and the settings screen on the glasses are drawn from. Adding a
    // setting is adding an entry there.
    ...(isPlugin() || modes.glassesSeen
      ? ([
          {
            id: 'glasses',
            label: t('Glasses'),
            groups: [...glassesGroups(), { title: t('Spoken commands'), fields: wordFields() }],
          },
        ] satisfies Pane[])
      : []),
    {
      // The page an export is laid out on. The ways of exporting are beside it on
      // the pane and are commands rather than settings; see `exportExtras` in
      // SettingsPanel.svelte.
      //
      // None of these says what it started as, so the pane offers no reset: a
      // margin somebody typed is a decision about their printer, and one button
      // that quietly replaced six of those is not worth having.
      id: 'export',
      label: t('Export'),
      groups: [
        {
          title: t('Page'),
          fields: [
            {
              kind: 'select',
              label: t('Paper'),
              options: PAPER_SIZES.map((size) => ({ value: size, label: size })),
              get: () => settings.page.paper,
              set: (value) => settings.setPage({ paper: value as never }),
            },
            {
              kind: 'select',
              label: t('Orientation'),
              options: ORIENTATIONS.map((one) => ({ value: one, label: t(one) })),
              get: () => settings.page.orientation,
              set: (value) => settings.setPage({ orientation: value as never }),
            },
            {
              kind: 'text',
              label: t('Margin'),
              placeholder: DEFAULT_PAGE_SETUP.margin,
              live: true,
              get: () => settings.page.margin,
              set: (value) => settings.setPage({ margin: value }),
            },
            // Running text on every sheet. `${title}`, `${date}` and `${year}` are
            // filled in; the placeholder shows the shape.
            {
              kind: 'text',
              label: t('Header'),
              placeholder: '${title}',
              live: true,
              get: () => settings.page.header,
              set: (value) => settings.setPage({ header: value }),
            },
            {
              kind: 'text',
              label: t('Footer'),
              placeholder: '${date}',
              live: true,
              get: () => settings.page.footer,
              set: (value) => settings.setPage({ footer: value }),
            },
            {
              kind: 'select',
              label: t('Appearance'),
              options: [
                { value: 'light', label: t('Light') },
                { value: 'dark', label: t('Dark') },
                { value: 'app', label: t('Match the app') },
              ],
              get: () => settings.exportAppearance,
              set: (value) => settings.setExportAppearance(value as never),
            },
          ],
        },
      ],
    },
  ]
}

/** What the Language group says under its row, where there is anything to say.
 *
 *  One caption, because two sentences about the same choice are one caption; the link
 *  is the catalogues folder either way, since that is where a correction goes and a
 *  reader who cannot read the panel may well want to fix the words too. */
/** What a machine-written catalogue says about itself. Two readers of the one
 *  sentence: the mark on every such row in the list, and the caption under the row
 *  once one of them is the language in force. */
function machineSaid(): string {
  return t('Machine-translated. Corrections welcome.')
}

function caption(): { caption?: { text: string; url: string } } {
  const said = [
    i18n.machine ? machineSaid() : '',
    (isPlugin() || modes.glassesSeen) && !panelDrawable() ? t('The glasses show English.') : '',
  ].filter(Boolean)

  if (!said.length) return {}
  return { caption: { text: said.join(' '), url: CATALOGUES_URL } }
}

/** Whether every field in the pane knows what it started as. */
export function resettable(pane: Pane): boolean {
  return pane.groups.every((group) => group.fields.every((field) => field.initial !== undefined))
}

/** Puts every field in the pane back to what it started as. Only the ones
 *  that differ are touched: a switch's setter may be a toggle, which would
 *  flip a value that was already right. */
export function resetPane(pane: Pane) {
  for (const group of pane.groups) {
    for (const field of group.fields) {
      if (field.initial === undefined || field.get() === field.initial) continue

      if (field.kind === 'switch') field.set(field.initial)
      else if (field.kind === 'slider') field.set(field.initial)
      else field.set(field.initial)
    }
  }
}
