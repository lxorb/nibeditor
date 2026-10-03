/** Quick add's line, read: `Call mum tomorrow 4pm #family p1 every sunday` as the words
 *  `Call mum` and the fields a task line carries (docs/tasks.md 5.6).
 *
 *  Every recognised phrase is a chip over the characters it was read from, so the
 *  field can draw it where it was typed and a press can turn it back into words: the
 *  spans the reader turned back come in as `keep`, and nothing overlapping one is read
 *  again. The app's language is tried first and English always after it, so a German
 *  reader typing `tomorrow` is understood too; short words that are also ordinary
 *  words (`sun`, German `Do`) need a word in front that says a day is meant.
 *
 *  Where two phrases say the same field, the last one is the field and the earlier
 *  stays words: people put the date at the end, and the words before it are free to
 *  mention a Friday. */

import { tagsIn } from '@nib/markdown/task-line'
import type { Priority, Remind } from '@nib/markdown/task-line'
import { addDays } from '../dates'
import { nextDate, ruleText } from '../recurrence'
import { DE } from './de'
import { EN, EN_US } from './en'
import type { Grammar } from './grammar'
import { repeatAt } from './repeat'
import { type Clock, clockOf, dayAt, timeAt, whenAt } from './when'
import { bare, type Word, wordsOf } from './words'

/** What a chip stands for. */
export type ChipKind =
  | 'when'
  | 'repeat'
  | 'priority'
  | 'where'
  | 'tag'
  | 'assignee'
  | 'remind'
  | 'deadline'
  | 'duration'

/** A recognised phrase, as a span of the line. */
export interface Chip {
  kind: ChipKind
  from: number
  to: number
}

/** The fields quick add writes. */
export interface QuickFields {
  due?: string
  time?: string
  recurrence?: string
  priority?: Priority
  tags: string[]
  assignee?: string
  remind: Remind[]
  deadline?: string
  duration?: number
}

export interface QuickAdd {
  /** The words, every chip taken out. */
  text: string
  fields: QuickFields
  /** `>Note`, as written: the note's name or path, without `.md`. */
  note?: string
  /** `/Heading` after it. */
  heading?: string
  chips: Chip[]
}

export interface QuickAddOptions {
  /** Spans turned back into words: nothing overlapping one is read. */
  keep?: readonly { from: number; to: number }[]
  /** The space's notes, by name or path without `.md`: a `>` name with spaces in it is
   *  the longest of these it matches. */
  notes?: readonly string[]
}

const GRAMMARS: Record<string, Grammar> = { en: EN, 'en-us': EN_US, de: DE }

/** The tables to read with: the app's language, then English. */
function grammarsFor(langs: readonly string[]): Grammar[] {
  const out: Grammar[] = []
  for (const lang of [...langs, 'en']) {
    const lower = lang.toLowerCase()
    const found = GRAMMARS[lower] ?? GRAMMARS[lower.split('-')[0] ?? '']
    if (found && !out.some((one) => one.lang.startsWith(found.lang.slice(0, 2)))) out.push(found)
  }
  return out
}

/** A phrase found, before it is known whether it is kept. */
interface Found {
  kind: ChipKind
  /** Words, end exclusive. */
  at: number
  end: number
  /** The fields it fills, where that is not its kind's alone: a `when` fills the day,
   *  the time or both. */
  slots?: readonly string[]
  apply(into: QuickAdd): void
}

const TAG = /^[#@%]([\p{L}][\p{L}\p{N}\-_/]*)$/u
const PERSON = /^\+([\p{L}][\p{L}\p{N}\-_.]*)$/u
const PRIORITY = /^p([1-4])$/i

/** `>Note`, `>Folder/Note`, `>"Moving flat"`, `>Moving flat` where the space has that
 *  note, and `/Heading` after any of them. */
function whereAt(words: readonly Word[], at: number, notes: readonly string[]): Found | null {
  const first = words[at]?.raw ?? ''
  if (!first.startsWith('>') || first.length < 2) return null

  let end = at + 1
  let name = first.slice(1)
  if (name.startsWith('"')) {
    while (!name.endsWith('"') || name.length < 2) {
      const next = words[end]
      if (!next) return null
      name = `${name} ${next.raw}`
      end++
    }
    name = name.slice(1, -1)
  } else {
    // The longest name of the space's that the words from here spell.
    for (let count = Math.min(words.length - at, 8); count > 1; count--) {
      const said = [name, ...words.slice(at + 1, at + count).map((one) => one.raw)].join(' ')
      if (notes.some((note) => note.toLowerCase() === said.toLowerCase())) {
        name = said
        end = at + count
        break
      }
    }
  }
  if (name.trim() === '') return null

  let heading: string | undefined
  const slash = words[end]?.raw ?? ''
  if (slash.startsWith('/') && slash.length > 1) {
    heading = slash.slice(1)
    end++
  }
  const note = name.trim()
  return {
    kind: 'where',
    at,
    end,
    apply(into) {
      into.note = note
      if (heading === undefined) delete into.heading
      else into.heading = heading
    },
  }
}

/** `!30m`, `!1h`, `!9am`, `!9:00`, `!tomorrow 9am`, `!9 Uhr`, as reminders. */
function remindAt(words: readonly Word[], at: number, g: Grammar, clock: Clock): Found | null {
  const first = words[at]
  if (!first?.key.startsWith('!') || first.key.length < 2) return null

  const before = /^!(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)(?:m|min))?$/.exec(first.key)
  if (before && (before[1] ?? before[2] ?? before[3]) !== undefined) {
    const minutes =
      Number(before[1] ?? 0) * 1440 + Number(before[2] ?? 0) * 60 + Number(before[3] ?? 0)
    return {
      kind: 'remind',
      at,
      end: at + 1,
      apply: (into) => into.fields.remind.push({ before: minutes }),
    }
  }

  // The rest read as a phrase of its own, with the `!` taken off its first word.
  const shown = [{ ...first, raw: first.raw.slice(1), key: first.key.slice(1) }, ...words.slice(at + 1)]
  const when = whenAt(shown, 0, g, clock, true) ?? timeAt(shown, 0, g, true)
  if (!when) return null
  const end = at + when.end
  return {
    kind: 'remind',
    at,
    end,
    apply(into) {
      if (when.day && when.time) into.fields.remind.push({ at: when.day, time: when.time })
      else if (when.time) into.fields.remind.push({ time: when.time })
      else if (when.day) into.fields.remind.push({ at: when.day, time: '09:00' })
    },
  }
}

/** `{fri}`, `{oct 10}`, `{Fr}`: a deadline. */
function deadlineAt(words: readonly Word[], at: number, g: Grammar, clock: Clock): Found | null {
  const first = words[at]
  if (!first?.raw.startsWith('{')) return null
  let close = at
  while (close < words.length && !(words[close]?.raw.endsWith('}') ?? false)) close++
  if (close >= words.length || close - at > 5) return null

  const inner = words.slice(at, close + 1).map((word, index, all) => {
    let raw = word.raw
    if (index === 0) raw = raw.slice(1)
    if (index === all.length - 1) raw = raw.slice(0, -1)
    return { ...word, raw, key: raw.toLowerCase().replace(/[,;]+$/u, '') }
  })
  const day = dayAt(inner, 0, g, clock, true)
  if (!day?.day || day.end !== inner.length) return null
  const date = day.day
  return { kind: 'deadline', at, end: close + 1, apply: (into) => (into.fields.deadline = date) }
}

/** `for 45m`, `for 1h30`, `for 2 hours`, `für 45 Min`, `1,5 Std`: minutes. */
function durationAt(words: readonly Word[], at: number, g: Grammar): Found | null {
  const lead = g.lasting.has(bare(words[at])) ? 1 : 0
  if (!lead && !g.bareDuration) return null

  let index = at + lead
  let minutes = 0
  let read = false
  for (let part = 0; part < 2; part++) {
    const key = words[index]?.key ?? ''
    // `45m`, `1h30`, `1h30m`, `1.5h`, written as one word.
    const glued = /^(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+)(?:m|min)?)?$/.exec(key)
    if (glued && key !== '' && (glued[1] !== undefined || /m(?:in)?$/.test(key))) {
      minutes += Math.round(Number((glued[1] ?? '0').replace(',', '.')) * 60) + Number(glued[2] ?? 0)
      read = true
      index++
      continue
    }
    // `45 min`, `1,5 Std`, `2 hours`, `an hour`.
    const count = /^\d+(?:[.,]\d+)?$/.test(key)
      ? Number(key.replace(',', '.'))
      : (g.numbers[bare(words[index])] ?? null)
    const unit = g.units[bare(words[index + 1])]
    if (count === null || (unit !== 'minute' && unit !== 'hour')) break
    minutes += Math.round(count * (unit === 'hour' ? 60 : 1))
    read = true
    index += 2
  }
  // A bare German span is only one with its unit written out: `1,5 Std`, not `3`.
  if (!read || minutes <= 0 || minutes > 1440 || (!lead && index - at < 2)) return null
  return { kind: 'duration', at, end: index, apply: (into) => (into.fields.duration = minutes) }
}

/** One word's own fields: a tag, a person, a priority. */
function wordAt(words: readonly Word[], at: number): Found | null {
  const raw = words[at]?.raw ?? ''
  const key = words[at]?.key ?? ''
  const tag = TAG.exec(raw.replace(/[,;.]+$/u, ''))
  if (tag?.[1]) {
    const name = tag[1]
    return {
      kind: 'tag',
      at,
      end: at + 1,
      apply: (into) => {
        if (!into.fields.tags.includes(name)) into.fields.tags.push(name)
      },
    }
  }
  const person = PERSON.exec(raw.replace(/[,;]+$/u, ''))
  if (person?.[1]) {
    const name = person[1]
    return { kind: 'assignee', at, end: at + 1, apply: (into) => (into.fields.assignee = name) }
  }
  const priority = PRIORITY.exec(key) ?? (key === '!!!' ? ['', '1'] : null)
  if (priority?.[1]) {
    const level = Number(priority[1]) as Priority
    return { kind: 'priority', at, end: at + 1, apply: (into) => (into.fields.priority = level) }
  }
  return null
}

/** Everything that can stand at word `at`, in one language: the longest, the kinds
 *  with a mark of their own first. */
function foundAt(
  words: readonly Word[],
  at: number,
  g: Grammar,
  clock: Clock,
  notes: readonly string[],
): Found | null {
  const marked =
    whereAt(words, at, notes) ??
    wordAt(words, at) ??
    remindAt(words, at, g, clock) ??
    deadlineAt(words, at, g, clock)
  if (marked) return marked

  const repeat = repeatAt(words, at, g, clock)
  if (repeat) {
    const text = ruleText(repeat.rule)
    const { rule, first } = repeat
    return {
      kind: 'repeat',
      at,
      end: repeat.end,
      slots: ['repeat'],
      apply(into) {
        into.fields.recurrence = text
        // The rule's first day where no phrase names one, or the one `starting` names.
        if (into.fields.due === undefined || first) {
          const from = first ?? clock.today
          into.fields.due = nextDate(rule, from, addDays(from, -1)) ?? from
        }
      },
    }
  }

  const duration = durationAt(words, at, g)
  if (duration) return duration

  const when = whenAt(words, at, g, clock)
  if (!when) return null
  const { day, time } = when
  return {
    kind: 'when',
    at,
    end: when.end,
    slots: [...(day ? ['day'] : []), ...(time ? ['time'] : [])],
    apply(into) {
      if (day) into.fields.due = day
      if (time) into.fields.time = time
    },
  }
}

/** Whether a span of the line was turned back into words. */
const kept = (
  keep: readonly { from: number; to: number }[],
  from: number,
  to: number,
): boolean => keep.some((span) => span.from < to && span.to > from)

/** The fields each phrase fills: its kind's, or the day and the time a `when` named. */
const slotsOf = (one: Found): readonly string[] => one.slots ?? [one.kind]

/** Kinds every phrase of counts, rather than the last. */
const MANY = new Set<string>(['tag', 'remind'])

/** The phrases that stand: of the ones saying the same field, the last. */
function standing(found: readonly Found[]): Found[] {
  const last = new Map<string, Found>()
  for (const one of found) for (const slot of slotsOf(one)) last.set(slot, one)
  return found.filter(
    (one) => MANY.has(one.kind) || slotsOf(one).some((slot) => last.get(slot) === one),
  )
}

/** The line, read. `now` is the reader's wall clock; `langs` the app's language first. */
export function parseQuickAdd(
  text: string,
  langs: readonly string[],
  now: Date,
  options: QuickAddOptions = {},
): QuickAdd {
  const words = wordsOf(text)
  const grammars = grammarsFor(langs)
  const clock = clockOf(now)
  const keep = options.keep ?? []
  const notes = options.notes ?? []

  const found: Found[] = []
  for (let at = 0; at < words.length;) {
    let best: Found | null = null
    for (const g of grammars) {
      const one = foundAt(words, at, g, clock, notes)
      if (one && (!best || one.end > best.end)) best = one
    }
    const from = words[at]?.from ?? 0
    const to = words[(best?.end ?? at + 1) - 1]?.to ?? from
    if (best && !kept(keep, from, to)) {
      found.push(best)
      at = best.end
    } else {
      at++
    }
  }

  const chosen = standing(found)
  const result: QuickAdd = { text: '', fields: { tags: [], remind: [] }, chips: [] }
  // In the order they were typed, a repeat after every day said, so a day said beside
  // a rule is its first.
  for (const one of chosen) if (one.kind !== 'repeat') one.apply(result)
  for (const one of chosen) if (one.kind === 'repeat') one.apply(result)

  // A time and no day: today's, or tomorrow's once today's has gone by.
  const { time } = result.fields
  if (time && result.fields.due === undefined) {
    const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    result.fields.due = minutes > clock.minutes ? clock.today : addDays(clock.today, 1)
  }

  result.chips = chosen.map((one) => ({
    kind: one.kind,
    from: words[one.at]?.from ?? 0,
    to: words[one.end - 1]?.to ?? 0,
  }))
  result.text = wordsLeft(text, result.chips)

  // A tag turned back into words is still a tag: the note will read it as one.
  for (const tag of tagsIn(result.text)) {
    if (!result.fields.tags.includes(tag)) result.fields.tags.push(tag)
  }
  return result
}

/** The line with every chip taken out, the blanks they leave closed up. */
function wordsLeft(text: string, chips: readonly Chip[]): string {
  let left = ''
  let at = 0
  for (const chip of chips) {
    left += `${text.slice(at, chip.from)} `
    at = chip.to
  }
  return `${left}${text.slice(at)}`.replace(/\s+/gu, ' ').trim()
}
