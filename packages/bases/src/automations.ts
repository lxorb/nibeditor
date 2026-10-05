/** A base's automations: when a row is added, or a property of one changes (to a
 *  value), set properties, move the note to a folder, or tell the reader
 *  (docs/tasks.md 5.13). Notion's database automations, kept in the base under
 *  `nib.automations`, which Obsidian leaves alone:
 *
 *  ```yaml
 *  nib:
 *    automations:
 *      - when: { property: status, is: Done }
 *        set: { finished: "{{date}}" }
 *        move: Archive
 *      - when: added
 *        notify: "{{title}}"
 *        off: true
 *  ```
 *
 *  An automation fires on a change, never on a state: a row that was Done before
 *  and is still Done after an edit to its title fires nothing, so one edit fires it
 *  once however often the row is looked at. What fired is answered as one effect,
 *  every automation's sets together, so the app writes it as one edit beside the one
 *  that fired it, and one undo takes both back. An automation's own write fires
 *  nothing: they never trigger each other, as Notion's do not. Pure. */

import { scopeFor } from './expr/compile'
import { compileFilters } from './filter'
import { scalarValue } from './note-values'
import { fillTemplate, type Filling } from './templates'
import type { Base, Context, Row, Value } from './types'
import { text } from './expr/runtime'

export type Trigger = { added: true } | { property: string; is?: string }

export interface Automation {
  when: Trigger
  /** Property to the words it is set to, placeholders filled; an empty value takes
   *  the property away. */
  set: Record<string, string>
  /** A folder of the space to move the note into. */
  move?: string
  /** Words to tell the reader. */
  notify?: string
  off?: boolean
  /** Every other key, as written. */
  kept: Record<string, unknown>
}

type Plain = Record<string, unknown>

const isPlain = (value: unknown): value is Plain =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const word = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined

const KNOWN = ['when', 'set', 'move', 'notify', 'off']

function readTrigger(raw: unknown): Trigger | null {
  if (raw === 'added') return { added: true }
  if (!isPlain(raw)) return null
  if (raw.added === true) return { added: true }
  const property = word(raw.property)
  if (!property) return null
  const is = word(raw.is)
  return is === undefined ? { property } : { property, is }
}

/** The automations a base keeps, in order; a row that is not one is left out. */
export function readAutomations(base: Base): Automation[] {
  const raw = base.nib.kept.automations
  if (!Array.isArray(raw)) return []
  return raw.flatMap((one): Automation[] => {
    if (!isPlain(one)) return []
    const when = readTrigger(one.when)
    if (!when) return []
    const automation: Automation = {
      when,
      set: isPlain(one.set)
        ? Object.fromEntries(
            Object.entries(one.set).map(([key, value]) => [key, word(value) ?? '']),
          )
        : {},
      kept: Object.fromEntries(Object.entries(one).filter(([key]) => !KNOWN.includes(key))),
    }
    const move = word(one.move)
    if (move !== undefined) automation.move = move
    const notify = word(one.notify)
    if (notify !== undefined) automation.notify = notify
    if (one.off === true) automation.off = true
    return [automation]
  })
}

function plainOf(automation: Automation): Plain {
  const when = 'added' in automation.when ? 'added' : { ...automation.when }
  return {
    when,
    ...(Object.keys(automation.set).length ? { set: automation.set } : {}),
    ...(automation.move === undefined ? {} : { move: automation.move }),
    ...(automation.notify === undefined ? {} : { notify: automation.notify }),
    ...(automation.off ? { off: true } : {}),
    ...automation.kept,
  }
}

/** The base with these automations, a new base. None takes the key away. */
export function withAutomations(base: Base, automations: readonly Automation[]): Base {
  const kept = { ...base.nib.kept }
  if (automations.length) kept.automations = automations.map(plainOf)
  else Reflect.deleteProperty(kept, 'automations')
  return { ...base, nib: { ...base.nib, kept } }
}

/** What fired, together. */
export interface Effect {
  set: Record<string, Value | null>
  move?: string
  notify: string[]
}

/** A value as the words a trigger compares: a list by each of its members. */
function wordsOf(value: Value | undefined): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.flatMap(wordsOf)
  return [text(value).toLowerCase()]
}

/** Whether a property's value is what a trigger waits for. */
function matches(value: Value | undefined, is: string): boolean {
  return wordsOf(value).includes(is.trim().toLowerCase())
}

/** Whether the change from `before` to `after` is the one the trigger waits for. */
function triggered(when: Trigger, before: Row | undefined, after: Row): boolean {
  if ('added' in when) return before === undefined
  if (before === undefined) return false
  const key = when.property.replace(/^note\./, '')
  const was = before.note[key]
  const now = after.note[key]
  if (when.is === undefined) return wordsOf(was).join('\n') !== wordsOf(now).join('\n')
  return matches(now, when.is) && !matches(was, when.is)
}

/** Words set into a property as the value they read as: a day as a date, a number
 *  as one, `true` and `false` as a box, nothing as the property taken away. */
function settled(words: string): Value | null {
  if (words.trim() === '') return null
  return scalarValue(words.trim())
}

/** Everything the base's automations do because a note row went from `before` (absent
 *  for a row just added) to `after`; null when nothing fired. */
export function fired(
  automations: readonly Automation[],
  before: Row | undefined,
  after: Row,
  filling: Omit<Filling, 'title'>,
): Effect | null {
  if (after.kind !== 'note') return null
  const fill = (words: string) => fillTemplate(words, { ...filling, title: after.file.basename })
  let effect: Effect | null = null
  for (const automation of automations) {
    if (automation.off || !triggered(automation.when, before, after)) continue
    effect ??= { set: {}, notify: [] }
    for (const [key, words] of Object.entries(automation.set))
      effect.set[key] = settled(fill(words))
    if (automation.move !== undefined) effect.move = fill(automation.move)
    if (automation.notify !== undefined) effect.notify.push(fill(automation.notify))
  }
  return effect
}

/** Whether a row is one of the base's own: its filters, not any view's. A base with
 *  no filters is about every note of its space. */
export function inBase(base: Base, row: Row, context: Context): boolean {
  if (row.kind !== 'note') return false
  return compileFilters(base.filters).test(scopeFor(row, context, base.formulas))
}
