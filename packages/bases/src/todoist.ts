/** Todoist's filter language, compiled to Bases' filters over task rows.
 *
 *  `today & #work | overdue`, `(p1 | p2) & 7 days`, `##Thesis & !/Admin`,
 *  `search: dentist`, `assigned to: me`, `no date, overdue`: the words Todoist's
 *  help documents, in English and in German, each turned into a Bases expression
 *  over `task.*` and `file.*`, and `&`, `|`, `!` and parentheses into `and`, `or`
 *  and `not`. A comma makes several lists, one under the other, as in Todoist, so
 *  the answer is one filter per list.
 *
 *  Relative dates stay relative: `tomorrow` is `today() + "1d"` and `friday` is
 *  worked out from `today()` too, so a saved filter is still right next week. A
 *  date written as a day of a month without its year is this year's.
 *
 *  `#Name` is a note when a note has that name and a tag otherwise, which the
 *  caller answers through `isNote`; quick add does not guess (docs/tasks.md 5.8). */

import { type DateWordOptions, dateWords, weekdayFrom } from './date-words'
import { BasesError } from './errors'
import type { Filter } from './types'

export interface TodoistOptions extends DateWordOptions {
  /** Whether a note of this name exists, so `#Name` means it rather than a tag. */
  isNote?: (name: string) => boolean
}

const quote = (text: string) => JSON.stringify(text)

/** A name with `*` in it as a pattern; null for a name without one. */
function wildcard(name: string): string | null {
  if (!name.includes('*')) return null
  const pattern = name
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&'))
    .join('.*')
  return `/^${pattern}$/i`
}

/** `name` compared with a value, as Todoist compares names: case aside, `*` a
 *  wildcard. */
function named(value: string, name: string): string {
  const pattern = wildcard(name)
  return pattern
    ? `${pattern}.matches(${value})`
    : `${value}.lower() == ${quote(name.toLowerCase())}`
}

/** A comparison of a date field with a date in words. */
function onDate(
  field: string,
  op: '==' | '<' | '>',
  words: string,
  options: TodoistOptions,
  at: number,
): string {
  const date = dateWords(words, options)
  if (!date) throw new BasesError(`"${words.trim()}" is not a date`, at)
  if (date.clock) {
    const moment = field === 'task.date' ? 'task.at' : field
    return `${moment} ${op} ${date.expression}`
  }
  return `${field} ${op} ${date.expression}`
}

/** One term of the language, as a Bases expression. */
function term(raw: string, options: TodoistOptions, at: number): string {
  const text = raw.trim()
  const lower = text.toLowerCase()

  switch (lower) {
    case 'today':
    case 'heute':
      return 'task.date == today()'
    case 'tomorrow':
    case 'morgen':
      return 'task.date == today() + "1d"'
    case 'yesterday':
    case 'gestern':
      return 'task.date == today() - "1d"'
    case 'overdue':
    case 'od':
    case 'überfällig':
    case 'ueberfaellig':
      return 'task.date < today() || (task.date == today() && task.time && task.time < now().format("HH:mm"))'
    case 'no date':
    case 'kein datum':
    case 'ohne datum':
      return '!task.date'
    case 'no time':
    case 'keine uhrzeit':
      return 'task.date && !task.time'
    case 'no deadline':
    case 'keine deadline':
      return '!task.deadline'
    case 'no priority':
    case 'keine priorität':
    case 'p4':
      return 'task.priority >= 4'
    case 'p1':
    case 'p2':
    case 'p3':
      return `task.priority == ${lower.slice(1)}`
    case 'no labels':
    case 'no label':
    case 'keine labels':
      return 'task.tags.isEmpty()'
    case 'recurring':
    case 'wiederkehrend':
      return 'task.recurring'
    case 'subtask':
    case 'subtasks':
    case 'unteraufgabe':
      return 'task.subtask'
    case 'assigned':
    case 'zugewiesen':
      return 'task.assignee'
    case 'shared':
    case 'geteilt':
      return 'file.shared'
    case 'view all':
    case 'all':
    case 'alle':
      return 'true'
    case 'uncompletable':
      return 'false'
    case 'next week':
    case 'nächste woche': {
      const monday = weekdayFrom(1, false)
      return `task.date >= ${monday} && task.date < ${monday} + "7d"`
    }
  }

  const within = /^(?:next |nächsten? )?(\d+) (days?|tagen?|tage)$/.exec(lower)
  if (within) return `task.date >= today() && task.date < today() + "${within[1]}d"`

  const keyed = /^([a-zäö ]+?)\s*:\s*(.*)$/.exec(text)
  if (keyed) {
    const key = (keyed[1] ?? '').toLowerCase().replace(/\s+/g, ' ')
    const value = (keyed[2] ?? '').trim()
    const field = /^(date|datum|due|fällig)( before| after| vor| nach)?$/.exec(key)
    if (field) {
      const which = field[1] === 'due' || field[1] === 'fällig' ? 'task.due' : 'task.date'
      const op = !field[2] ? '==' : /before|vor/.test(field[2]) ? '<' : '>'
      return onDate(which, op, value, options, at)
    }
    const deadline = /^deadline( before| after| vor| nach)?$/.exec(key)
    if (deadline) {
      const op = !deadline[1] ? '==' : /before|vor/.test(deadline[1]) ? '<' : '>'
      return onDate('task.deadline', op, value, options, at)
    }
    const created = /^(created|erstellt)( before| after| vor| nach)?$/.exec(key)
    if (created) {
      const op = !created[2] ? '==' : /before|vor/.test(created[2]) ? '<' : '>'
      return onDate('if(task.created, task.created, file.ctime.date())', op, value, options, at)
    }
    if (key === 'assigned to' || key === 'zugewiesen an') {
      const who = value.toLowerCase()
      if (who === 'me' || who === 'mich' || who === 'mir') return 'task.mine'
      if (who === 'others' || who === 'andere') return 'task.assignee && !task.mine'
      return `task.assignee && ${named('task.assignee', value)}`
    }
    if (key === 'search' || key === 'suche')
      return `task.text.lower().contains(${quote(value.toLowerCase())})`
  }

  if (text.startsWith('##')) {
    const name = text.slice(2).trim()
    const pattern = wildcard(name)
    const inFolder = pattern ? `${pattern}.matches(file.folder)` : `file.inFolder(${quote(name)})`
    return `${inFolder} || ${named('file.basename', name)}`
  }
  if (text.startsWith('#')) {
    const name = text.slice(1).trim()
    // A wildcard names projects in Todoist's help, so it matches notes.
    if (name.includes('*') || options.isNote?.(name)) return named('file.basename', name)
    return `task.hasTag(${quote(name)})`
  }
  if (text.startsWith('@') || text.startsWith('%')) {
    const name = text.slice(1).trim()
    const pattern = wildcard(name)
    return pattern
      ? `task.tags.filter(${pattern}.matches(value)).length > 0`
      : `task.hasTag(${quote(name)})`
  }
  if (text.startsWith('/')) {
    const name = text.slice(1).trim()
    if (name === '*') return 'task.section'
    return `task.section && ${named('task.section', name)}`
  }

  const date = dateWords(text, options)
  if (date) return `task.date == ${date.expression}`
  throw new BasesError(`"${text}" is not a filter`, at)
}

type Token = { kind: 'op'; text: string; at: number } | { kind: 'term'; text: string; at: number }

/** The filter cut at its operators; a backslash keeps the next character as a
 *  character, so `#a\&b` is one name. */
function tokens(source: string): Token[] {
  const out: Token[] = []
  let term = ''
  let termAt = 0
  const flush = () => {
    if (term.trim() !== '') out.push({ kind: 'term', text: term.trim(), at: termAt })
    term = ''
  }
  for (let at = 0; at < source.length; at++) {
    const char = source.charAt(at)
    if (char === '\\' && at + 1 < source.length) {
      if (term.trim() === '') termAt = at
      term += source.charAt(at + 1)
      at++
      continue
    }
    // A `!` opens a term only where a term would start; inside one it is a letter.
    const startsTerm = term.trim() === ''
    if ('&|(),'.includes(char) || (char === '!' && startsTerm)) {
      flush()
      out.push({ kind: 'op', text: char, at })
      continue
    }
    if (startsTerm) termAt = at
    term += char
  }
  flush()
  return out
}

/** One comma-separated list's tokens as a filter. */
function parseList(list: Token[], options: TodoistOptions): Filter {
  let at = 0
  const peek = () => list[at]
  const isOp = (text: string) => {
    const token = peek()
    return token?.kind === 'op' && token.text === text
  }

  const or = (): Filter => {
    const members = [and()]
    while (isOp('|')) {
      at++
      members.push(and())
    }
    return members.length === 1 && members[0] !== undefined ? members[0] : { or: members }
  }
  const and = (): Filter => {
    const members = [not()]
    while (isOp('&')) {
      at++
      members.push(not())
    }
    return members.length === 1 && members[0] !== undefined ? members[0] : { and: members }
  }
  const not = (): Filter => {
    if (isOp('!')) {
      at++
      return { not: [not()] }
    }
    return primary()
  }
  const primary = (): Filter => {
    const token = peek()
    if (!token) throw new BasesError('The filter ends too soon', list.at(-1)?.at ?? 0)
    at++
    if (token.kind === 'term') return term(token.text, options, token.at)
    if (token.text === '(') {
      const inner = or()
      if (!isOp(')')) throw new BasesError('A "(" is not closed', token.at)
      at++
      return inner
    }
    throw new BasesError(`Unexpected "${token.text}"`, token.at)
  }

  const filter = or()
  const rest = peek()
  if (rest) throw new BasesError(`Unexpected "${rest.text}"`, rest.at)
  return filter
}

/** A Todoist filter as one Bases filter per comma-separated list. Throws a
 *  BasesError naming the part it could not read and where. */
export function fromTodoist(source: string, options: TodoistOptions = {}): Filter[] {
  const lists: Token[][] = [[]]
  let depth = 0
  for (const token of tokens(source)) {
    if (token.kind === 'op' && token.text === '(') depth++
    if (token.kind === 'op' && token.text === ')') depth--
    if (token.kind === 'op' && token.text === ',' && depth === 0) lists.push([])
    else lists.at(-1)?.push(token)
  }
  return lists.filter((list) => list.length).map((list) => parseList(list, options))
}
