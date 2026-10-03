/** The shapes every lane of tasks and databases meets at (docs/tasks.md, 7.1).
 *
 *  A row is a note or a task line; a base is Obsidian's `.base` file read into
 *  these shapes; an answer is what a view of a base says about a set of rows. The
 *  rows store builds rows, the engine answers views over them, and the views draw
 *  the answer, so a change here is a change to all three: keep it small and say
 *  why. Nothing in this file runs. */

import type { TaskFields } from '@nib/markdown/task-line'

export type { FieldName, Priority, Remind, TaskFields } from '@nib/markdown/task-line'
export type { TaskChange } from '@nib/markdown/task-edits'

/** A date, or a date and a time. Floating: the wall clock wherever the reader is,
 *  unless a zone is written. `time` is `HH:mm` or `HH:mm:ss`. */
export interface DateValue {
  kind: 'date'
  iso: string
  time?: string
  zone?: string
}

/** A span of time. Months stand apart from milliseconds because a month is not a
 *  fixed number of them: `"1M"` added to the 31st of January is the last of
 *  February. */
export interface DurationValue {
  kind: 'duration'
  ms: number
  months: number
}

/** A wikilink or an address, as a property holds it: `[[Thesis]]`, `[[Thesis|the
 *  thesis]]`, `https://...`. */
export interface LinkValue {
  kind: 'link'
  target: string
  display?: string
}

/** What a view draws rather than reads: `image()`, `icon()`, `html()`. */
export type RenderedValue =
  { kind: 'image'; src: string } | { kind: 'icon'; name: string } | { kind: 'html'; html: string }

/** What a property, a formula or a summary is worth. */
export type Value =
  | null
  | boolean
  | number
  | string
  | DateValue
  | DurationValue
  | LinkValue
  | RenderedValue
  | Value[]
  | ValueRecord

export interface ValueRecord {
  [key: string]: Value
}

/** Bases' `file.*`, for one file. */
export interface FileInfo {
  /** `Dune.md` */
  name: string
  /** `Dune` */
  basename: string
  /** Relative to the space, `/` between folders: `Books/Dune.md`. */
  path: string
  /** `Books`, and `` at the space's root. */
  folder: string
  /** `md`, without the dot. */
  ext: string
  /** Bytes. */
  size: number
  /** Milliseconds since the epoch. */
  ctime: number
  mtime: number
  /** Every tag in the body and the front matter, without `#`. */
  tags: string[]
  /** Every link target as written, `[[` and `|display` taken off; the context
   *  resolves them to paths. */
  links: string[]
  embeds: string[]
  /** Whether the file is in a shared space or is a shared note. */
  shared?: boolean
}

/** A task line as a row holds it: its fields, and where it stands in its note. */
export interface TaskRow extends TaskFields {
  /** The headings above it, outermost first. The nearest is its section. */
  section: string[]
  /** The line of the task it is indented under, if any. */
  parent?: number
  /** Columns of indentation, a tab counted as one. */
  indent: number
}

/** A note, or a task in a note. */
export interface Row {
  kind: 'note' | 'task'
  /** The space's name. */
  space: string
  /** The note's path within the space; a task row carries its note's. */
  path: string
  /** Where a task line is: its 0-based line, and `taskHash` of its words to find it
   *  again after lines above it moved. Absent on a note row. */
  anchor?: { line: number; hash: string }
  file: FileInfo
  /** The note's front matter; a task row carries its note's. */
  note: Record<string, Value>
  task?: TaskRow
}

/** Bases' filter: an expression, or `and`, `or` and `not` of filters to any depth.
 *  `not` is "none of these", Bases' own reading. */
export type Filter = string | { and: Filter[] } | { or: Filter[] } | { not: Filter[] }

/** A property and a direction: a sort, a grouping. */
export interface Sort {
  property: string
  direction: 'ASC' | 'DESC'
}

/** What `properties:` says about one property. */
export interface PropertyConfig {
  displayName?: string
  /** Every other key, as written. */
  kept: Record<string, unknown>
}

/** One choice of a select or status property (`nib.properties.<key>.options`). */
export interface SelectOption {
  value: string
  /** For a status: which of the three a choice belongs to. */
  group?: 'todo' | 'doing' | 'done'
  /** One of the six tones. */
  tone?: string
}

/** What nib adds about a property, under `nib.properties`. */
export interface NibProperty {
  options?: SelectOption[]
  /** `number`, `percent`, `currency:EUR`, `progress`, `url`, `email`, `phone`... */
  format?: string
  /** A relation held to one note. */
  one?: boolean
  kept: Record<string, unknown>
}

/** nib's additions to a base, under the top-level `nib:` key Obsidian leaves alone. */
export interface NibBase {
  /** The note a new row is made from: `[[Templates/Bug]]`. */
  template?: string
  /** Unique ids: the property and its prefix, `BUG-45`. */
  id?: { property: string; prefix: string }
  properties: Record<string, NibProperty>
  locked?: boolean
  /** Every other key, automations among them, as written. */
  kept: Record<string, unknown>
}

/** Which rows a view is about. */
export type RowKinds = 'notes' | 'tasks' | 'both'

/** nib's additions to one view, under its `nib:` key. */
export interface NibView {
  /** `notes` by default, as in Bases. */
  rows?: RowKinds
  subGroupBy?: Sort
  /** A manual order of rows within each group, by group key as text: paths for
   *  notes, `path#line` anchors for tasks. */
  order?: Record<string, string[]>
  /** The date property a calendar or a timeline places rows by, and where a bar ends. */
  date?: string
  end?: string
  /** An expression answering a tone, per row. */
  colour?: string
  /** Done and cancelled tasks stay in the view. */
  showCompleted?: boolean
  /** `rows` keeps groups in the order their first row comes, as a note's headings
   *  are; `value`, the default, orders them by their key. */
  groupOrder?: 'value' | 'rows'
  /** Groups kept out of sight, by key as text. */
  hidden?: string[]
  locked?: boolean
  /** Every other key, as written. */
  kept: Record<string, unknown>
}

export interface View {
  /** `table`, `cards`, `list`, `kanban`, `map`, and nib's `calendar`, `timeline`,
   *  `chart`, `form`. */
  type: string
  name: string
  filters?: Filter
  /** The properties shown, in order. */
  order: string[]
  sort: Sort[]
  groupBy?: Sort
  limit?: number
  /** Property to summary name: a default (`Average`) or one of the base's own. */
  summaries: Record<string, string>
  nib: NibView
  /** Every other key the view was written with (`image`, `cardSize`, `columnSize`,
   *  a plugin's own), as written. */
  options: Record<string, unknown>
}

export interface Base {
  filters?: Filter
  formulas: Record<string, string>
  properties: Record<string, PropertyConfig>
  /** Custom summary formulas by name, over `values`. */
  summaries: Record<string, string>
  views: View[]
  nib: NibBase
  /** Every other top-level key, as written. */
  kept: Record<string, unknown>
}

/** What an expression is evaluated against, beyond the row. */
export interface Context {
  /** `YYYY-MM-DD`, the reader's today. */
  today: string
  /** `YYYY-MM-DDTHH:mm:ss`, the reader's wall clock. */
  now: string
  /** Bases' `this`: the note that embeds the base, the base's own file when it is
   *  opened, the note in front for a base in a side panel. */
  this?: Row
  /** A link target written in `from` to the path of the file it points at, in the
   *  same space, or null when it points at nothing. Without it a target is compared
   *  as written. */
  resolve?: (target: string, from: Row) => string | null
  /** The note row at a path, for `asFile()`, `file()` and `linksTo()`. */
  row?: (path: string, space: string) => Row | undefined
  /** The paths of the notes linking to this one, for `file.backlinks`. */
  backlinks?: (row: Row) => string[]
  /** The signed-in person, for "assigned to me". */
  me?: string
  /** Words typed into the view's own search. */
  search?: string
  /** For `random()`; Math.random by default. */
  random?: () => number
}

/** A group of rows in an answer, with its summaries, and its sub-groups when the
 *  view has a second grouping. */
export interface Group {
  key: Value
  rows: Row[]
  summaries: Record<string, Value>
  sub?: Group[]
}

/** A view's answer: its groups (one, keyed null, when it groups by nothing), the
 *  number of rows, and the summaries over all of them. */
export interface Answer {
  groups: Group[]
  total: number
  summaries: Record<string, Value>
}
