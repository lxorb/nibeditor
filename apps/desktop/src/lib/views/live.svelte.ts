/** One view on screen: its base, which of the base's views it shows, what it answers
 *  over the rows, and how a change to it is kept.
 *
 *  The answer is the engine's (`answer` in @nib/bases) over the rows store's rows, and
 *  it is asked again when the rows say something changed, when the day turns over and
 *  when the view's own search stops being typed into. Never per keystroke anywhere
 *  else, and never by reading a file: the rows are in memory, and the engine keeps
 *  what it worked out about every row whose file did not change (docs/tasks.md 5.19).
 *
 *  Where a change to the view goes is the host's to say (`Source.save`): a built-in
 *  view keeps it in its tab's words, a base file in the file, a fence in the note it
 *  stands in. The view shows the change at once and the host writes it after. */

import {
  answer as answered,
  type Answer,
  type Base,
  cellValue,
  type Context,
  type Row,
  type View,
} from '@nib/bases'
import { rows as store } from '../rows/rows.svelte'
import { afterQuiet } from '../timing'
import { toneColour } from './chips'
import { columnsOf } from './columns'
import { contextFor } from './context'
import { nowHere, todayHere, untilMidnightHere } from './days'

export interface Source {
  /** The space whose rows the view is over, by name; every space where null. */
  scope: string | null
  /** The base, as it is now. */
  load(): Promise<Base>
  /** Keeps a changed base. */
  save(next: Base): Promise<void>
  /** Bases' `this`: the note embedding the view. */
  self?: () => Row | undefined
  /** Which view of the base to show first, by name. */
  view?: string | undefined
  /** Hears the source change under the view (a base file written elsewhere); answers
   *  the way to stop. */
  watch?: (changed: () => void) => () => void
}

/** The small layer a view's head holds open over the view: a builder for something a
 *  menu row asked for, about one column where it is about one. */
export type Builder =
  | { kind: 'colour' | 'automations' }
  | { kind: 'rollup' | 'button'; column?: string }
  | { kind: 'options'; column: string }

/** How long the view's search waits for the typing to stop. */
const SEARCH_QUIET = 160

export class LiveView {
  base = $state.raw<Base | null>(null)
  /** Which of the base's views is showing. */
  at = $state(0)
  /** What the search field holds, and what the answer was last asked with. */
  typed = $state('')
  private searched = $state('')
  today = $state(todayHere())
  failed = $state(false)
  /** The rows the view is over, the store's list as it was last told of a change. */
  rows = $state.raw<readonly Row[]>([])
  /** The builder the head holds open, if any. */
  builder = $state<Builder | null>(null)
  /** How many changes a lock turned away, so the lock can answer each one. */
  refused = $state(0)

  private readonly stops: (() => void)[] = []
  /** Whether the base has been read once: the view a host names is the first shown,
   *  and a read after that keeps whichever the reader moved to. */
  private once = false
  private readonly quiet = afterQuiet(() => (this.searched = this.typed.trim()), SEARCH_QUIET)

  constructor(private readonly source: Source) {}

  /** Starts listening and reads the base. Answers the way to stop. */
  start(): () => void {
    const scope = this.source.scope ?? undefined
    this.rows = store.of(scope)
    this.stops.push(
      store.watch((change) => {
        if (scope === undefined || change.space === scope) this.rows = store.of(scope)
      }),
    )
    if (this.source.watch) this.stops.push(this.source.watch(() => void this.reload()))
    this.daily()
    void this.reload()
    return () => this.stop()
  }

  private stop() {
    for (const stop of this.stops.splice(0)) stop()
    this.quiet.cancel()
  }

  /** Today moves on at midnight, here. */
  private daily() {
    const timer = setTimeout(() => {
      this.today = todayHere()
      this.daily()
    }, untilMidnightHere() + 1000)
    this.stops.push(() => clearTimeout(timer))
  }

  /** Reads the base again from where it is kept. */
  async reload() {
    try {
      const base = await this.source.load()
      this.base = base
      const named = this.source.view
      const at = named === undefined ? -1 : base.views.findIndex((one) => one.name === named)
      if (at !== -1 && !this.once) this.at = at
      this.once = true
      if (this.at >= base.views.length) this.at = 0
      this.failed = false
    } catch {
      // A base file that is not YAML, or is gone: the view says nothing rather than
      // something wrong, and a write that fixes the file reads again.
      this.failed = true
    }
  }

  /** The view showing. */
  readonly view = $derived.by((): View | null => this.base?.views[this.at] ?? null)

  readonly context = $derived.by((): Context =>
    contextFor({
      rows: this.rows,
      today: this.today,
      now: nowHere(),
      this: this.source.self?.(),
      search: this.searched,
    }),
  )

  readonly answer = $derived.by((): Answer | null => {
    const base = this.base
    if (!base) return null
    try {
      return answered(base, this.at, this.rows, this.context)
    } catch {
      return null
    }
  })

  /** Whether the view's shape is locked, by itself or with its whole base (Notion's
   *  lock: the rows stay editable, the view and the base do not). */
  readonly locked = $derived(this.base?.nib.locked === true || this.view?.nib.locked === true)

  /** The colour the view's conditional colour gives a row, or null. */
  colourOf(row: Row): string | null {
    const base = this.base
    const expression = this.view?.nib.colour
    if (!base || !expression) return null
    const tone = cellValue(base, expression, row, this.context)
    return typeof tone === 'string' ? toneColour(tone) : null
  }

  /** The columns the view shows. */
  readonly columns = $derived.by((): string[] =>
    this.base ? columnsOf(this.base, this.at, this.rows) : [],
  )

  /** Typing into the view's own search. */
  search(words: string) {
    this.typed = words
    if (!words.trim()) {
      this.quiet.cancel()
      this.searched = ''
    } else this.quiet()
  }

  /** A changed base, shown at once and then kept where the host keeps it. */
  async change(next: Base): Promise<void> {
    this.base = next
    if (this.at >= next.views.length) this.at = Math.max(0, next.views.length - 1)
    await this.source.save(next)
  }
}
