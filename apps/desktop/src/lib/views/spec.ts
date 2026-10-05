/** What a view tab is a view of, written as its words.
 *
 *  A view tab holds no file's words: Today is a question about every space, and a
 *  `.base` file is read by the tab rather than typed into it. What the tab does keep
 *  is which question it asks - a built-in view and what it is about (a project's note,
 *  a label's tag), or the view of a base file it shows - so a restart, a split and Move
 *  to space put the same view back. The same trick a terminal tab plays with its shell
 *  (terminal/spec.ts): the words are a small JSON object, read back checked.
 *
 *  A built-in view changed in its tab (another layout, a sort, a filter) keeps the
 *  change here as the base it makes, `yaml`, until "Copy to a base" writes it to a
 *  file. A base file's own changes go into the file. */

import { isRecord, isString, parsed } from '../stored'

/** The views nib ships; see `builtinView` in @nib/bases. */
const BUILTINS = ['inbox', 'today', 'upcoming', 'logbook', 'project', 'label'] as const
export type Builtin = (typeof BUILTINS)[number]

export interface ViewSpec {
  /** A built-in view, or absent for the view of a base file (the tab's path). */
  builtin?: Builtin
  /** A project: the note, by its space's name and its path within it. */
  space?: string
  path?: string
  /** A label: the tag, without `#`. */
  tag?: string
  /** Which view of the base, by name; the first where absent. */
  view?: string
  /** A built-in view as the tab changed it, as a base. */
  yaml?: string
}

const isBuiltin = (value: unknown): value is Builtin => BUILTINS.some((one) => one === value)

/** The spec a tab's words say, or null for words that are not one. */
export function readSpec(words: string): ViewSpec | null {
  const value = parsed(words)
  if (!isRecord(value)) return null

  const spec: ViewSpec = {}
  if (isBuiltin(value.builtin)) spec.builtin = value.builtin
  for (const key of ['space', 'path', 'tag', 'view', 'yaml'] as const) {
    const one = value[key]
    if (isString(one)) spec[key] = one
  }
  return spec
}

/** The words a tab keeps for a spec, keys in one order so two tabs of one view
 *  have the same words. */
export function writeSpec(spec: ViewSpec): string {
  const ordered: ViewSpec = {}
  if (spec.builtin) ordered.builtin = spec.builtin
  if (spec.space !== undefined) ordered.space = spec.space
  if (spec.path !== undefined) ordered.path = spec.path
  if (spec.tag !== undefined) ordered.tag = spec.tag
  if (spec.view !== undefined) ordered.view = spec.view
  if (spec.yaml !== undefined) ordered.yaml = spec.yaml
  return JSON.stringify(ordered)
}

/** Whether two specs ask the same question, whatever either has changed about how
 *  it answers it: one tab per view per pane. */
export function sameView(a: ViewSpec, b: ViewSpec): boolean {
  return (
    a.builtin === b.builtin &&
    a.space === b.space &&
    a.path === b.path &&
    a.tag === b.tag &&
    (a.builtin !== undefined || a.view === b.view)
  )
}
