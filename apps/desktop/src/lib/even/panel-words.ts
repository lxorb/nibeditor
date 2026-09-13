/** Which language the *panel* is written in.
 *
 *  The app has thirty-nine interface catalogues. The firmware has one font, and that
 *  font draws Latin, Cyrillic, Greek, CJK and emoji: Devanagari, Bengali, Tamil,
 *  Telugu, Kannada, Malayalam, Gurmukhi, Gujarati, Arabic, Persian, Pashto, Urdu,
 *  Thai, Burmese and Amharic have no glyphs at all, so a reader in one of those
 *  languages got a row of boxes where the menu should be. Correct words, drawn as
 *  nothing, which is the one way of being wrong that text mode cannot afford.
 *
 *  So the panel falls back to English where the font cannot draw the reader's own
 *  language. The phone's own panes are not touched by this: a reader reads their
 *  language on the glass where the glass can draw it and on the phone always - see
 *  `t` in i18n.svelte.ts, which is what every pane still calls.
 *
 *  **Decided by what the font can draw, not by a list of scripts.** `undrawable` in
 *  packages/glasses/src/firmware.ts answers what share of a text the font has no
 *  glyph for, and that is asked of the reader's own catalogue. Measured over the
 *  thirty-nine, the answer is two groups and nothing in between: every Latin,
 *  Cyrillic, Greek and CJK catalogue is at 0.0%, and the fifteen scripts above are
 *  at 31% and more. A catalogue in a script the firmware gains is drawable the day
 *  the metrics say so, and a hand list would still say no. */

import { drawsScript, undrawable } from '@nib/glasses'
import { i18n, t } from '../i18n.svelte'

/** How much of a catalogue may be undrawable before the panel gives up on it.
 *
 *  A tenth, and only where the script could not be named: the two groups are 0% and
 *  31%, so it is nowhere near either. What it is for is a catalogue that borrows a
 *  word - a brand, a key name - rather than one written in a script the font lacks. */
const MOST_MISSING = 0.1

/** The words the question is asked of when it has to be measured: the panel's own,
 *  in the reader's language. Its own menu rather than a sample of the whole
 *  catalogue, because these are the strings that would be drawn as boxes. */
const SAMPLE = ['Settings', 'Switch space', 'Change note', 'Voice off', 'Spaces', 'Notes']

/** What was decided, and for which language. A reader who changes language mid
 *  sitting is asked again; nobody else is. */
let decided: { language: string; drawable: boolean } | null = null

/** The writing system a language tag is in, as ISO 15924. `Intl` knows which script
 *  every language is written in, so `hi` and `mr` are one answer and a Devanagari
 *  language added tomorrow is the same answer again. */
function scriptOf(tag: string): string | undefined {
  try {
    return new Intl.Locale(tag).maximize().script
  } catch {
    // A tag storage or a hand-edited setting made up. Measured below instead.
    return undefined
  }
}

/** Whether the panel can be written in the reader's own language.
 *
 *  **Per script, not per language.** What a font has or has not got is a writing
 *  system: Hindi and Marathi are one question, and the answer for Devanagari is the
 *  answer for every language written in it. `SCRIPTS` in the glasses package is that
 *  list, measured against the firmware's own metrics by its own test.
 *
 *  Where a tag names no script - one that is not a tag at all - the reader's own
 *  words are measured instead, which is the same question asked the slow way. */
export function panelDrawable(): boolean {
  const language = i18n.language
  if (decided?.language === language) return decided.drawable

  const script = scriptOf(language)
  const drawable = script
    ? drawsScript(script)
    : undrawable(SAMPLE.map((one) => t(one)).join(' ')) <= MOST_MISSING

  decided = { language, drawable }
  return drawable
}

/** `{name}` filled in, the way `t` fills it. Here because the panel's English is the
 *  key itself, which has not been through the catalogue and so has not been filled. */
function fill(text: string, values?: Record<string, string | number>): string {
  if (!values) return text

  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const found = values[name]
    return found === undefined ? whole : String(found)
  })
}

/** One string for the panel: the reader's language where the firmware can draw it,
 *  and English where it cannot.
 *
 *  English is the key itself. Every string in this app is filed under what it says in
 *  English, which is what makes the fallback a lookup nobody has to ship a second
 *  catalogue for; see i18n.svelte.ts. */
export function panelWord(text: string, values?: Record<string, string | number>): string {
  return panelDrawable() ? t(text, values) : fill(text, values)
}

/** Asked again the next time somebody wants a word. For the tests, which change
 *  language between one assertion and the next. */
export function forgetPanelLanguage(): void {
  decided = null
}
