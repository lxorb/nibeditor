import type { EditorView } from '@nib/editor'
import { CODE_PALETTES } from '@nib/editor'
import { panelDrawable } from './even/panel-words'
import { glassesGroups, wordFields } from './even/settings'
import { CATALOGUES_URL, i18n, plural, t } from './i18n.svelte'
import { languageOptions, machineSaid } from './language-options'
import { method } from './mobile/bridge'
import { modes, REMIND_BEFORE } from './modes.svelte'
import { PROPERTIES_MODES } from '@nib/markdown/properties'
import { PROPERTIES_WORDS } from './properties-words'
import { isPlugin } from './plugin'
import { DEFAULT_ID_FORMAT, ID_FORMATS, noteId } from './note-id'
import { DEFAULT_PAGE_SETUP, ORIENTATIONS, PAPER_SIZES } from './paper'
import { DEFAULT_DAYS, DEFAULT_MINUTES, KEEP_DAYS, SNAPSHOT_MINUTES } from './recovery'
import { recovery } from './recovery.svelte'
import { hasTray, residency } from './reminders/residency.svelte'
import { chatsGroups } from './chats-settings'
import { resetFields } from './reset-fields'
import { settings } from './settings.svelte'
import { tabCycle } from './tab-cycle.svelte'
import { isDesktop, isMobile, platform } from './tauri'
import { SCHEME_CHOICES, SCHEME_NAMES } from './schemes'
import { swipeChoice } from './back-swipe/choice.svelte'
import { parseCombination } from './keys'
import { shortcuts } from './shortcuts.svelte'
import { BY_ID } from './shortcuts/registry'
import { shellReads, TWO_WAYS } from './terminal/keys'
import { asWarning, shellName, shells, SIZES } from './terminal/shells.svelte'
import { bothName } from './terminal/two-ways'
import { type SchemeChoice, theme } from './theme.svelte'
import type { ThemeSetting } from './themes/settings'
import { asChannel } from './updater'
import { WALLPAPER_THEME } from './wallpaper/held'
import { wallpaper } from './wallpaper/wallpaper.svelte'
import { updates } from './updates.svelte'
import { pages } from './web-tab/pages.svelte'
import { isSaver } from './web-tab/resting'
import { saver } from './web-tab/saver.svelte'
import { hiddenTabs } from './workspace/hidden-tabs.svelte'
import { quickAdd } from './quick-add/asked.svelte'
import { isHiddenTabs } from './workspace/sets'

/** One side's picture in the wallpaper's row; see the `picture` kind. */
export interface PictureSide {
  /** What a pointer resting on it says: the side's name. */
  label: string
  /** The side the app is in now, which wears the ring. */
  current: boolean
  /** A `data:` address, or nothing for the theme's own field. */
  picture(): string
  /** Whether this side has a picture of its own rather than the other side's. */
  own(): boolean
  /** Where the picture's focal point is, as two fractions. */
  focus(): [number, number]
  choose(): void
  remove(): void
  /** The focal point moved; `kept` once the drag lets go. */
  place(x: number, y: number, kept: boolean): void
}

/** What every control has, whatever kind it is. */
interface Common {
  label: string
  /** Other words somebody might look for it by: `font` for the text size, `dark`
   *  and `theme` for the mode. Searched, never shown, so they are the English ones a
   *  hand types into any search box; the label and the choices are searched in the
   *  reader's own language. The settings' own box and the palette both read them;
   *  see settings-search.ts and palette/settings.ts. */
  words?: string[]
  /** One plain sentence about what the setting does, shown behind a small `i`
   *  beside the label. For the settings whose name only means something to
   *  somebody who already knows the word; one that explains itself has none, and
   *  shows no glyph at all. */
  hint?: string
}

/** One colour among a row of them, drawn as the colour itself. The only control
 *  in the app whose options are not words: naming nine shades would be nine
 *  words saying what nine squares already say. */
export interface SwatchOption {
  value: string
  /** What a pointer resting on it says, and what a screen reader is told - the
   *  one place the colour does have to be a word. */
  label: string
  /** The colour to paint it, in the scheme the app is in. */
  colour: string
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
        /** The least the dial may be turned to now; see `least` in themes/settings.ts. */
        least?: () => number
        get(): number
        /** Shown while the knob is dragged and kept nowhere; `set` is letting go. A
         *  slider without one keeps every position it passes. */
        preview?(value: number): void
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
    /** A row of colours. Only ever a theme setting: a colour is one of the four
     *  things a theme may offer, and the accent is the app's own. */
    | {
        kind: 'swatches'
        options: SwatchOption[]
        initial?: string
        get(): string
        set(value: string): void
      }
    /** The pictures somebody chose: a thumbnail per side of the theme, which opens
     *  the file chooser when pressed and moves the picture's focal point when dragged,
     *  and a cross on one that has a picture of its own. Only the wallpaper's. */
    | {
        kind: 'picture'
        /** Left out: a picture somebody chose is not a default a reset puts back. */
        initial?: string
        /** The picture the side in force wears, as a `data:` address or nothing; `set('')`
         *  takes it away. What a row that is only read - a search, the glasses - sees. */
        get(): string
        set(value: string): void
        sides: PictureSide[]
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

/** One of the theme's own settings, as a row of the pane.
 *
 *  The whole of what Appearance knows about what a theme offers. A theme declares
 *  a kind and the app already has a control for each: a colour is a row of
 *  swatches, a number in a range is the dial every other measurement in the app
 *  uses, a switch is a switch, and a choice of two or three short words is the
 *  segmented control - past three it is a dropdown, because a row of six words is
 *  a row nobody can read at a glance.
 *
 *  The label goes through `t()` on its way in: a theme the app ships with declares
 *  words the catalogues carry, and a theme file declares its author's own, which
 *  `t()` hands back unchanged. */
function themeField(setting: ThemeSetting): Field {
  const label = t(setting.label)
  const get = () => theme.values[setting.id]
  const common = { label, initial: setting.initial }

  if (setting.kind === 'range') {
    return {
      ...common,
      kind: 'slider',
      min: setting.min,
      max: setting.max,
      step: setting.step,
      unit: setting.unit,
      initial: setting.initial,
      ...(setting.least ? { least: setting.least } : {}),
      get: () => Number(get() ?? setting.initial),
      preview: (value) => theme.try(setting.id, value),
      set: (value) => theme.set(setting.id, value),
    }
  }

  if (setting.kind === 'switch') {
    return {
      ...common,
      kind: 'switch',
      initial: setting.initial,
      get: () => get() === true,
      set: (on) => theme.set(setting.id, on),
    }
  }

  if (setting.kind === 'colour') {
    return {
      ...common,
      kind: 'swatches',
      options: setting.options.map((one) => ({
        value: one.value,
        label: t(one.name),
        colour: one[theme.current],
      })),
      initial: setting.initial,
      get: () => String(get() ?? setting.initial),
      set: (value) => theme.set(setting.id, value),
    }
  }

  const options = setting.options.map((one) => ({
    value: one.value,
    label: t(one.label),
    ...(one.disabled ? { disabled: true } : {}),
  }))

  return {
    ...common,
    kind: options.length > 3 && !setting.own ? 'select' : 'segmented',
    options,
    initial: setting.initial,
    get: () => String(get() ?? setting.initial),
    set: (value) => theme.set(setting.id, value),
  }
}

/** The wallpaper's pictures, light first: the side the app is not in shows what it
 *  would wear, which is this side's picture until it is given one of its own. */
function pictureField(): Field {
  const sides = (['light', 'dark'] as const).map((scheme): PictureSide => ({
    label: t(SCHEME_NAMES[scheme]),
    current: theme.current === scheme,
    picture: () => wallpaper.of(scheme)?.picture ?? '',
    own: () => wallpaper.owns(scheme),
    focus: () => wallpaper.of(scheme)?.focus ?? [0.5, 0.5],
    choose: () => void wallpaper.choose(scheme),
    remove: () => wallpaper.clear(scheme),
    place: (x, y, kept) => wallpaper.place(scheme, x, y, kept),
  }))

  return {
    kind: 'picture',
    label: t('Picture'),
    words: ['wallpaper', 'background', 'image', 'photo', 'focal point'],
    get: () => wallpaper.of(theme.current)?.picture ?? '',
    set: (value) => {
      if (!value) wallpaper.clear(theme.current)
    },
    sides,
  }
}

/** A built-in theme's own rows that are there right now. */
function ownFields(): Field[] {
  return theme.settings.filter((one) => one.own === true && (one.when?.() ?? true)).map(themeField)
}

/** The panes that are only about settings. The account and the LLM connector are
 *  their own thing and stay written out by hand. */
type PaneId = 'general' | 'editor' | 'spelling' | 'markdown' | 'appearance' | 'glasses' | 'export'

export interface Pane {
  id: PaneId
  label: string
  groups: Group[]
}

/** Whose a key that is both the app's and the shell's is, one row each: asked every
 *  time, the app's command, or the shell's character. The row is the question's answer,
 *  and putting it back to asking is choosing that. Only for a command on a key a shell
 *  reads, which on a Mac is none of them: Cmd never reaches a shell. See
 *  terminal/two-ways.ts. */
function twoWayFields(): Field[] {
  return [...TWO_WAYS].flatMap((command): Field[] => {
    const held = shortcuts.keyFor(command)
    const chord = held ? parseCombination(held, shortcuts.platform) : null
    const reads =
      chord &&
      shellReads({
        key: chord.key,
        ctrlKey: chord.ctrl,
        metaKey: chord.meta,
        altKey: chord.alt,
        shiftKey: chord.shift,
      })
    if (!reads) return []

    return [
      {
        kind: 'select',
        label: bothName(command),
        words: ['shortcut', 'key', 'shell', 'conflict', 'ask'],
        options: [
          { value: 'ask', label: t('Always ask') },
          { value: 'app', label: BY_ID.get(command)?.label() ?? command },
          { value: 'shell', label: t('Terminal') },
        ],
        initial: 'ask',
        get: () => shells.ways[command] ?? 'ask',
        set: (value) => shells.setWay(command, value === 'app' || value === 'shell' ? value : null),
      },
    ]
  })
}

/** The terminal's settings. The shells are asked for as the pane is drawn, which is
 *  the first time this list is needed; the row fills in when they arrive. */
function terminalGroup(): Group {
  void shells.ask()

  return {
    title: t('Terminal'),
    fields: [
      {
        kind: 'select',
        label: t('Shell'),
        options: shells.list.map((one) => ({ value: one.id, label: shellName(one) })),
        get: () => shells.chosen?.id ?? '',
        set: (id) => shells.choose(id),
      },
      {
        kind: 'slider',
        label: t('Text size'),
        min: SIZES.least,
        max: SIZES.most,
        step: 1,
        unit: 'px',
        initial: SIZES.initial,
        get: () => shells.size,
        set: (size) => shells.setSize(size),
      },
      {
        kind: 'switch',
        label: t('Restore history'),
        words: ['scrollback', 'session', 'restart', 'privacy'],
        initial: true,
        get: () => shells.restoring,
        set: (on) => shells.setRestoring(on),
      },
      {
        kind: 'select',
        label: t('Warn before quitting'),
        words: ['quit', 'close', 'exit', 'confirm', 'running', 'process', 'claude'],
        options: [
          { value: 'always', label: t('Always') },
          { value: 'running', label: t('When something runs') },
          { value: 'never', label: t('Never') },
        ],
        initial: 'running',
        get: () => shells.warning,
        set: (value) => shells.setWarning(asWarning(value)),
      },
      ...twoWayFields(),
    ],
  }
}

/** When a task reminds of itself, and what keeps the reminders ringing: the tray on a
 *  desktop that has one, the exact alarms on a phone. One line on Linux, where nothing
 *  rings with nib closed. See docs/tasks.md 5.10. */
function remindersGroup(): Group {
  const exact = method('exactAlarms')
  const ask = method('askExactAlarms')

  return {
    title: t('Reminders'),
    ...(isDesktop && platform() === 'linux'
      ? { caption: { text: t('Reminders ring while nibeditor is open') } }
      : {}),
    fields: [
      {
        kind: 'select',
        label: t('Automatic'),
        words: ['reminder', 'notification', 'alarm', 'due', 'time', 'before'],
        options: REMIND_BEFORE.map((minutes) => ({
          value: String(minutes),
          label:
            minutes < 0
              ? t('Off')
              : minutes === 0
                ? t('At the time')
                : t('{count} min', { count: minutes }),
        })),
        initial: '0',
        get: () => String(modes.remindBefore),
        set: (value) => modes.setRemindBefore(Number(value)),
      },
      ...(hasTray
        ? ([
            {
              kind: 'switch',
              label: t('Stay in the tray'),
              words: ['tray', 'background', 'menu bar', 'close', 'quit', 'reminder'],
              get: () => residency.on,
              set: (on) => residency.set(on),
            },
          ] satisfies Field[])
        : []),
      ...(exact && ask
        ? ([
            {
              kind: 'switch',
              label: t('Exact alarms'),
              words: ['alarm', 'reminder', 'exact', 'battery'],
              get: () => exact(),
              set: () => ask(),
            },
          ] satisfies Field[])
        : []),
    ],
  }
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
          // A note being written in is kept every so often on top of the words
          // each sitting began with, so an edit that went wrong is not the end of
          // the story; History is where the versions are.
          title: t('Recovery'),
          fields: [
            {
              kind: 'select',
              label: t('Keep a version every'),
              words: ['backup', 'history', 'snapshot'],
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
          // Chrome's order is the default, and VS Code's is the option: the tab
          // used last, and further back for each press while Ctrl is held. See
          // tab-cycle.svelte.ts.
          title: t('Tabs'),
          fields: [
            {
              kind: 'switch',
              label: t('Ctrl+Tab in order of use'),
              words: ['tabs', 'recent', 'switcher'],
              initial: false,
              get: () => tabCycle.byUse,
              set: (on) => tabCycle.setByUse(on),
            },
            // Two fingers sideways for back and forward, as in every browser; off for a
            // hand that keeps doing it by accident. Not on a phone, whose side of the
            // screen is the system's own back. See back-swipe/swipes.ts.
            ...(isMobile
              ? []
              : ([
                  {
                    kind: 'switch',
                    label: t('Swipe between pages'),
                    words: [
                      'swipe',
                      'gesture',
                      'touchpad',
                      'trackpad',
                      'back',
                      'forward',
                      'history',
                    ],
                    initial: true,
                    get: () => swipeChoice.on,
                    set: (on) => swipeChoice.set(on),
                  },
                ] satisfies Field[])),
            // What a space's own tabs do out of sight: the pages a desktop runs, which a
            // phone and a browser tab do not. See workspace/hidden-tabs.svelte.ts.
            ...(isDesktop
              ? ([
                  {
                    kind: 'segmented',
                    label: t('Hidden tabs'),
                    words: ['spaces', 'background', 'pause', 'sleep', 'freeze', 'audio'],
                    options: [
                      { value: 'run', label: t('Keep running') },
                      { value: 'pause', label: t('Pause') },
                      { value: 'ask', label: t('Ask') },
                    ],
                    initial: 'ask',
                    get: () => hiddenTabs.choice,
                    set: (value) => hiddenTabs.set(isHiddenTabs(value) ? value : 'ask'),
                  },
                  // Off, so no page is ever closed for memory unless somebody asks; out of
                  // sight it is frozen instead. See web-tab/resting.ts.
                  {
                    kind: 'select',
                    label: t('Memory saver'),
                    words: ['memory', 'ram', 'discard', 'sleep', 'reload', 'performance'],
                    options: [
                      { value: 'off', label: t('Off') },
                      { value: 'moderate', label: t('Moderate') },
                      { value: 'balanced', label: t('Balanced') },
                      { value: 'maximum', label: t('Maximum') },
                    ],
                    initial: 'off',
                    get: () => saver.mode,
                    set: (value) => {
                      saver.set(isSaver(value) ? value : 'off')
                      pages.retime()
                    },
                  },
                ] satisfies Field[])
              : []),
          ],
        },
        {
          // Quick add: whether its words are read as dates and fields at all (Todoist's
          // smart date switch), and whether its key reaches past the window. See
          // quick-add/asked.svelte.ts and docs/tasks.md 5.6.
          title: t('Add task'),
          fields: [
            {
              kind: 'switch',
              label: t('Smart dates'),
              words: ['tasks', 'quick add', 'natural language', 'parse', 'todoist'],
              initial: true,
              get: () => quickAdd.smart,
              set: (on) => quickAdd.setSmart(on),
            },
            ...(isDesktop && !isMobile
              ? ([
                  {
                    kind: 'switch',
                    label: t('From any app'),
                    words: ['tasks', 'quick add', 'global', 'hotkey', 'shortcut', 'system'],
                    initial: true,
                    get: () => quickAdd.anywhere,
                    set: (on) => quickAdd.setAnywhere(on),
                  },
                ] satisfies Field[])
              : []),
          ],
        },
        {
          // The few hints that point at a feature somebody has not found, or none of
          // them: Silent mode is for whoever knows the app and wants it clean. See
          // hints.svelte.ts.
          title: t('Hints'),
          fields: [
            {
              kind: 'switch',
              label: t('Silent mode'),
              words: ['tips', 'hints', 'quiet', 'clean', 'onboarding'],
              initial: false,
              get: () => modes.silent,
              set: () => modes.toggleSilent(),
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
              // Each row says for itself whether its catalogue was read through;
              // see language-options.ts, which the space chooser offers too.
              options: languageOptions(),
              get: () => i18n.choice,
              set: (value) => i18n.select(value),
            },
          ],
        },

        // The automatic reminder, and the tray or the alarms that keep reminders ringing;
        // never the glasses' plugin, which rings nothing.
        ...(__EVEN_PLUGIN__ ? [] : [remindersGroup()]),

        // What pings for every chat, where a chat can ping at all: a desktop and the
        // browser, never a phone, whose push is off (docs/chats.md decision 7.4). None in
        // the glasses' plugin, whose twin of the module has no chats; see
        // chats-settings.even.ts.
        ...(isMobile ? [] : chatsGroups()),

        // Which shell a new terminal opens, how large its type is and whether its lines
        // come back after a restart: this machine's, like the release channel below,
        // because a shell is a program on one computer and its screen is nobody else's.
        // Only a desktop has a terminal; see docs/terminal.md.
        ...(!__EVEN_PLUGIN__ && isDesktop ? [terminalGroup()] : []),

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
                    words: ['beta', 'updates', 'nightly'],
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
              words: ['font', 'zoom', 'bigger', 'smaller'],
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
              words: ['line height', 'leading'],
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
              words: ['column', 'wide', 'readable width'],
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
              words: ['auto pair', 'autoclose'],
              initial: true,
              get: () => modes.closeBrackets,
              set: () => modes.toggleCloseBrackets(view),
            },
            {
              kind: 'switch',
              label: t('Typewriter mode'),
              words: ['centre', 'center', 'scroll'],
              initial: false,
              get: () => modes.typewriter,
              set: () => modes.toggleTypewriter(view),
            },
            {
              kind: 'switch',
              label: t('Focus mode'),
              words: ['zen', 'distraction free', 'dim'],
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
              words: ['font'],
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
              words: ['images', 'pictures', 'paste', 'assets'],
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
              words: ['syntax', 'code colours', 'code colors'],
              options: CODE_PALETTES.map((one) => ({ value: one.id, label: one.name })),
              initial: 'follow',
              get: () => modes.codeTheme,
              set: (value) => modes.setCodeTheme(value, view),
            },
            {
              kind: 'switch',
              label: t('Line numbers'),
              words: ['gutter'],
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
              words: ['spellcheck', 'spell check', 'typos'],
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
              // Notion's and Word's way round: the words wear their formatting and
              // the marks never come back while writing. On, which is Typora's and
              // Obsidian's live preview, where a mark shows while the caret is in it.
              kind: 'switch',
              label: t('Show markdown while writing'),
              words: ['syntax', 'marks', 'wysiwyg', 'rich text'],
              initial: true,
              get: () => !modes.quietMarks,
              set: () => modes.toggleQuietMarks(view),
            },
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
              words: ['properties', 'yaml', 'metadata'],
              hint: t(
                'Properties draws the rows and edits them in place; Source is the YAML as typed.',
              ),
              options: PROPERTIES_MODES.map((one) => ({
                value: one,
                label: t(PROPERTIES_WORDS[one]),
              })),
              initial: 'hidden',
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
              words: ['theme', 'look'],
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
              words: ['dark', 'light', 'night', 'theme'],
              options: SCHEME_CHOICES.map((one) => ({
                value: one,
                label: t(SCHEME_NAMES[one]),
                disabled: !theme.offers(one),
              })),
              get: () => theme.shown,
              set: (value) => theme.setScheme(asChoice(value)),
            },
            // And whatever the theme in force offers of its own, under the two
            // rows that chose it and with no heading between: they are the
            // theme's, and where they sit is what says so. A theme with nothing
            // to offer adds nothing, so the group is the same two rows it has
            // always been. See themes/settings.ts.
            ...theme.settings.filter((one) => one.own !== true).map(themeField),
          ],
        },

        // A built-in's own dials - glass's material, the wallpaper's picture - in a
        // card of the theme's name: there are more of them than a row under Style can
        // carry, and the name is the heading they already have. The picture first,
        // which is what the wallpaper is about; the thumbnails are the pictures, so
        // the row needs no more words.
        ...(theme.settings.some((one) => one.own === true)
          ? [
              {
                title: t(theme.active.name),
                fields: [...(theme.id === WALLPAPER_THEME ? [pictureField()] : []), ...ownFields()],
              },
            ]
          : []),

        {
          title: t('Pointer'),
          fields: [
            {
              // A desktop app's arrow over its buttons, or a web page's hand. The
              // arrow stays the default; the Claude app offers the same switch.
              kind: 'switch',
              label: t('Pointing hand on buttons'),
              words: ['cursor', 'mouse', 'hand', 'click'],
              initial: false,
              get: () => modes.hand,
              set: () => modes.toggleHand(),
            },
          ],
        },

        // The window itself: who draws its frame. Desktop only, because a browser tab
        // has none - and on a phone the system draws everything. Nib's own frame stays
        // the default: the bar it draws holds the menu, the sidebar toggle, the tabs
        // and the window's three buttons, and it is the shape the whole shell is
        // measured from. See appearance.rs.
        //
        // Whether the desk shows through the window is not here: that is the glass
        // theme, chosen under Style above. A row of its own was a switch that took the
        // window's ground away and showed next to nothing, since every surface painted
        // over the ground; see material.ts.
        ...(isDesktop
          ? ([
              {
                title: t('Window'),
                fields: [
                  {
                    kind: 'segmented',
                    label: t('Frame'),
                    words: ['title bar', 'window'],
                    options: [
                      { value: 'nib', label: t('nibeditor’s own') },
                      { value: 'system', label: t('The system’s') },
                    ],
                    initial: 'nib',
                    get: () => modes.frame,
                    set: (value) => modes.setFrame(value),
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

/** Puts every field in the pane back to what it started as; see reset-fields.ts. */
export function resetPane(pane: Pane) {
  resetFields(pane.groups.flatMap((group) => group.fields))
}
