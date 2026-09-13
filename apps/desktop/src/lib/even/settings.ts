/** Every setting the glasses have, said once.
 *
 *  Two surfaces show these: the Glasses section of the phone's own Settings, and
 *  a settings screen on the panel itself, reachable from the hold modal so that
 *  nothing about the glasses needs the phone. Neither has a list of its own. A
 *  setting is one entry here - what it is called, what kind of control it is, how
 *  to read it and how to write it - and both surfaces render that.
 *
 *  Which is the whole point: adding a setting is adding one entry. The phone's
 *  pane, the glasses' rows, the reset on both of them and the search that reads
 *  the settings all follow, and none of them can be forgotten because none of
 *  them holds a second copy.
 *
 *  The kinds are the app's own three, from preferences.ts: a switch is a toggle, a
 *  select is a choice, a slider is a number. A phone draws them as it draws every
 *  other setting; the glasses draw a row with the value on the right, and a tap
 *  either flips it or opens the choices as a list like any other. */

import { COMPACTIONS, DEFAULT_COMPACTION, type Marks } from '@nib/glasses/choices'
import { key, t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import type { Field, Group } from '../preferences'
import { commandWords, DEFAULT_WORDS } from './commands'

/** There is no scrolling setting either.
 *
 *  There was, and it offered two answers to "who moves the note": the app cutting it
 *  into panels and turning them, or the whole note handed to the firmware to scroll
 *  itself. The second one never worked on a device - nothing in the SDK scrolls a
 *  container, `TextContainerUpgrade`'s `contentOffset` is undocumented and inert, and
 *  what the firmware did instead was show a scroll bar and ignore every flick. The
 *  app scrolled it in the end, a line at a time, which is the app turning pages of
 *  one row: the same mechanism with a worse page.
 *
 *  Emil: *"please remove the scrolling 'nib turns the pages / glasses scroll'
 *  setting from the glasses section of the settings. Effectively it should be always
 *  nib who turns the pages."* So there is one behaviour and no row for it, and the
 *  page number means something again on every page.
 *
 *  There is no page-number setting either.
 *
 *  There was, and Emil turned it off and on again and found it broken; the mechanism
 *  was fixed and the setting was still the wrong idea. A page number means something
 *  exactly where the app is cutting the note into panels and turning them - which is
 *  now the only thing it ever does - so it is always there and nothing decides it. A
 *  value an older build saved is ignored. See `place` in shell.ts. */

/** One setting, and where it appears. */
export interface Setting {
  /** What the glasses name it in a tap. Also what the reset walks. */
  id: string
  /** The heading it sits under, on both surfaces. */
  group: string
  field: Field
  /** False for the handful that only make sense with a keyboard: a phrase is
   *  typed, and a pair of glasses has nothing to type with. */
  onGlasses: boolean
}

/** The words for the levels of compaction, which are ours rather than the type's:
 *  "aggressive" is a name for a behaviour, not something to put in front of
 *  somebody. */
const COMPACTION_WORDS: Record<string, string> = {
  none: key('Every line break'),
  collapse: key('One break between blocks'),
  aggressive: key('As little as possible'),
}

/** The markers a reader may turn on, in the order the pane lists them: what a
 *  construct *is* first, then what merely styles it. */
const MARK_WORDS: { id: keyof Marks; label: string }[] = [
  { id: 'fence', label: key('Code fences') },
  { id: 'code', label: key('Inline code') },
  { id: 'heading', label: key('Heading hashes') },
  { id: 'link', label: key('Links') },
  { id: 'bold', label: key('Bold') },
  { id: 'italic', label: key('Italic') },
  { id: 'strike', label: key('Strikethrough') },
  { id: 'highlight', label: key('Highlight') },
]

/** How a string is turned into words. `t` for the phone, `panelWord` for the glass:
 *  the firmware's font has no Devanagari, Thai or Arabic, so a panel written in one
 *  of those is a panel of boxes. See panel-words.ts, and `undrawable` in the glasses
 *  package, which is what decides it. */
type Say = (text: string) => string

function chooser(
  say: Say,
  label: string,
  values: readonly string[],
  words: Record<string, string>,
  initial: string,
  get: () => string,
  set: (value: string) => void,
): Field {
  return {
    kind: 'select',
    label,
    options: values.map((value) => ({ value, label: say(words[value] ?? value) })),
    initial,
    get,
    set,
  }
}

/** Everything the glasses have, in the order both surfaces show it.
 *
 *  `say` is how the labels are put into words: the phone's pane leaves it alone and
 *  gets the reader's language, and the glasses hand in `panelWord`, which is English
 *  wherever the firmware cannot draw that language. One schema either way. */
export function glassesSettings(say: Say = t): Setting[] {
  const reading = say('Reading')
  const marked = say('Markdown on the panel')
  const voice = say('Voice')

  return [
    {
      id: 'break',
      group: reading,
      onGlasses: true,
      field: {
        // Where a page begins. The one setting that changes how the panel reads
        // rather than what is on it: a section that starts at the top of a panel,
        // with its heading staying put above every page of it, is a document; a
        // note cut every seven lines wherever they fall is a scroll.
        kind: 'select',
        label: say('New page at'),
        options: [
          { value: '1', label: say('H1') },
          { value: '2', label: say('H2 and above') },
          { value: '3', label: say('H3 and above') },
          { value: '4', label: say('H4 and above') },
          { value: '5', label: say('H5 and above') },
          { value: '6', label: say('Every heading') },
          { value: '0', label: say('Never') },
        ],
        initial: '2',
        get: () => String(modes.glassesBreak),
        set: (value) => modes.setGlassesBreak(value),
      },
    },
    {
      id: 'lineNumbers',
      group: reading,
      onGlasses: true,
      field: {
        kind: 'switch',
        label: say('Line numbers'),
        initial: true,
        get: () => modes.glassesLineNumbers,
        set: (on) => modes.setGlassesLineNumbers(on),
      },
    },
    {
      id: 'compaction',
      group: reading,
      onGlasses: true,
      field: chooser(
        say,
        say('Blank lines'),
        COMPACTIONS,
        COMPACTION_WORDS,
        DEFAULT_COMPACTION,
        () => modes.glassesCompaction,
        (value) => modes.setGlassesCompaction(value),
      ),
    },
    ...MARK_WORDS.map((one): Setting => ({
      id: `mark.${one.id}`,
      group: marked,
      onGlasses: true,
      field: {
        kind: 'switch',
        label: say(one.label),
        initial: MARKS_INITIAL[one.id],
        get: () => modes.glassesMarks[one.id],
        set: (on) => modes.setGlassesMark(one.id, on),
      },
    })),

    {
      id: 'voice',
      group: voice,
      onGlasses: true,
      field: {
        kind: 'switch',
        label: say('Voice commands'),
        initial: false,
        get: () => modes.glassesVoice,
        set: (on) => modes.setGlassesVoice(on),
      },
    },
  ]
}

/** What each marker starts as: rule one, from the mapping's own defaults. */
const MARKS_INITIAL: Marks = {
  heading: false,
  bold: false,
  italic: false,
  strike: false,
  highlight: false,
  code: true,
  fence: true,
  link: false,
}

/** The same settings as the phone's pane draws them, grouped in order. */
export function glassesGroups(): Group[] {
  const out: Group[] = []
  for (const setting of glassesSettings()) {
    const last = out.at(-1)
    if (last?.title === setting.group) last.fields.push(setting.field)
    else out.push({ title: setting.group, fields: [setting.field] })
  }

  return out
}

/** The phrases each spoken command answers to, as fields for the phone.
 *
 *  Phone only: a phrase is typed, and a pair of glasses has nothing to type with.
 *  Each shows the default as its placeholder and an empty field puts it back, so
 *  the reset is a field that is already there rather than a button beside it. */
export function wordFields(): Field[] {
  return commandWords().map((one): Field => ({
    kind: 'text',
    label: t(one.label),
    placeholder: one.said,
    initial: '',
    get: () => modes.glassesWords[one.id] ?? '',
    set: (value) => modes.setGlassesWord(one.id, value),
  }))
}

/** Every glasses setting, as one string that changes whenever any of them does.
 *
 *  What the bridge watches so that a setting reaches the panel at once. Emil turned
 *  the page number off and on again and it never came back: the page had not
 *  changed a character, so nothing was sent, so the panel kept the words it had -
 *  and the reader is left holding a switch that does nothing. Built from the schema
 *  rather than written out, so a setting added tomorrow is watched by having been
 *  added. See the bridge's `watch`. */
export function glassesStamp(): string {
  return glassesSettings()
    .map((one) => `${one.id}=${String(one.field.get())}`)
    .join('|')
}

/** Every glasses setting back to what it started as, from either surface.
 *
 *  Only the ones that differ are touched, the same rule the phone's own pane
 *  reset follows: a switch's setter may be a toggle. The spoken phrases go with
 *  them: they are a glasses setting like any other. */
export function resetGlasses(): void {
  for (const { field } of glassesSettings()) {
    if (field.initial === undefined || field.get() === field.initial) continue

    if (field.kind === 'switch') field.set(field.initial)
    else if (field.kind === 'slider') field.set(field.initial)
    else field.set(field.initial)
  }

  for (const id of Object.keys(DEFAULT_WORDS)) modes.setGlassesWord(id, '')
}
