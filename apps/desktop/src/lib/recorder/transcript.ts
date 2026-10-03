/** What a recording and its transcript look like as markdown.
 *
 *  All of it pure, and all of it in one file, because the shapes have to agree: the
 *  embed a recording writes at the caret, and the transcript a Transcribe row puts
 *  under that embed.
 *
 *  Two decisions worth defending:
 *
 *  1. **A transcript under an embed is a callout.** It is an annotation in the middle
 *     of somebody's own prose, and a callout is one block with a line to say whose
 *     words are in it - Obsidian folds it, nib folds it, and nothing of the reader's
 *     own writing is now sitting in a paragraph beside a machine's.
 *  2. **Whatever a model wrote says so, in one quiet line.** Naming the model rather
 *     than "AI": `*Written by whisper*`. It is italic and it is one line, because the
 *     reader came for the words and not for a disclaimer. */

import { formatWikilink } from '@nib/markdown/links'
import { t } from '../i18n.svelte'

/** The embed for a recording: `![[recording-2026-09-12-1432.weba]]`.
 *
 *  Through the package's own writer rather than by joining brackets onto a name, so
 *  a name with a bracket in it cannot write markup that means something else. */
export function embedFor(name: string): string {
  return formatWikilink({ target: name, heading: null, block: null, alias: null, embed: true })
}

/** A language as something to read: `de` as German, in the reader's own language,
 *  where the platform knows the name and as the code itself where it does not.
 *
 *  `Intl.DisplayNames` is in all three engines and is the only list of language
 *  names that is already translated into the four the app speaks; a table here
 *  would be four more rows to write for every language Whisper can hear. */
export function languageName(code: string, locale: string): string {
  const tidy = code.trim().toLowerCase()
  if (!tidy) return ''

  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(tidy) ?? tidy
  } catch {
    // A code that is not a language tag at all, which is what a model answering
    // with a whole word rather than a code looks like: its own word will do.
    return tidy
  }
}

/** The one line that says a machine wrote what is under it. */
export function writtenBy(model: string): string {
  return `*${t('Written by {model}', { model })}*`
}

/** What a transcript is headed with: the word, and the language where one was
 *  heard. `Transcript (German)`, or just `Transcript` when the model did not say. */
function heading(language: string): string {
  return language ? t('Transcript ({language})', { language }) : t('Transcript')
}

/** Every line of a passage inside a callout, which is a quote and so carries `>`
 *  down its left. A blank line stays blank apart from the mark, or the callout ends
 *  where the reader's own writing begins. */
function quoted(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
}

/** The transcript of one recording, as the callout that goes under its embed.
 *
 *  `[!quote]` rather than a type of nib's own: it is the type Obsidian ships, it
 *  says what the block is without a word of explanation, and a space that travels
 *  to another app keeps its shape. */
export function transcriptCallout(text: string, language: string, model: string): string {
  return [`> [!quote] ${heading(language)}`, `> ${writtenBy(model)}`, '>', quoted(text)].join('\n')
}

/** A length as `1:04:09` or `4:09`, which is how every player writes one. */
export function spanOf(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(whole / 60) % 60
  const hours = Math.floor(whole / 3600)
  const rest = String(whole % 60).padStart(2, '0')

  if (!hours) return `${minutes}:${rest}`
  return `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
}

/** A date as the front matter writes it: the day, in the reader's own clock.
 *  `2026-09-12`, which is what every other tool that reads a note's front matter
 *  expects and what sorts correctly as a string. */
export function dayOf(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

/** The clock as a name is written: `1432`. */
function clockOf(at: Date): string {
  const hour = String(at.getHours()).padStart(2, '0')
  const minute = String(at.getMinutes()).padStart(2, '0')
  return `${hour}${minute}`
}

/** What a note made only to hold a recording is called: the word and the minute it
 *  started, the same shape as the file beside it, so the two read as one thing in the
 *  list. */
export function recordingNoteName(at: Date): string {
  return `${t('Recording')} ${dayOf(at)} ${clockOf(at)}`
}
