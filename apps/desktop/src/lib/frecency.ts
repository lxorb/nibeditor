/** How often and how lately each thing was reached for: what the palette weighs a
 *  row by once the words have been matched.
 *
 *  Firefox's frecency, as a curve rather than a list of visits. Every thing carries
 *  one number, which each use adds one to and which halves every week that passes
 *  without one. A thing reached for every day climbs towards ten and stays there; one
 *  used five times last month is worth less than one used twice this week; one used
 *  once in the spring is worth nothing anybody could see. It is the same shape as
 *  Firefox's recency buckets and VS Code's most recently used list, kept as two
 *  numbers a thing and updated in constant time.
 *
 *  What a thing is, is a key the caller makes and nothing here reads:
 *  `note:<path>`, `command:<id>`, `setting:<section>/<label>`, `page:<address>`. So a
 *  note opened from the file list counts the same as one chosen in the palette (see
 *  `remember` in workspace/device.svelte.ts), and a setting Emil opens every morning
 *  climbs over the notes the way he would expect it to.
 *
 *  Nothing is read at launch. A use noted before anything has asked - a note opened
 *  while the window comes up - waits in memory and is folded in at the first read,
 *  and the list is written down once the uses have stopped for a few seconds. And it
 *  is bounded: past `MOST` things, the ones worth least go. This machine's, like the
 *  notes opened lately, because it is a habit of whoever is at the keyboard rather
 *  than a fact about a space. */

import { forget, isNumber, isRecord, keep, stored, stringList } from './stored'
import { afterQuiet } from './timing'

const KEY = 'nib:palette-picks'

/** What the commands run from the palette were kept under before there was this:
 *  a list of ids, newest first. Read once into the curve and dropped. */
const USED_KEY = 'nib:palette-used'

const DAY = 24 * 60 * 60 * 1000

/** How long a use takes to count for half as much. A week: long enough that the
 *  weekly meeting note keeps its place between meetings, short enough that last
 *  month's project gives way to this one's within a fortnight. */
export const HALF_LIFE = 7 * DAY

/** How many things are kept. Far more than anybody reaches for in a month. */
const MOST = 400

/** How long the uses have to have stopped before the list is written down. */
const SETTLING = 3000

/** One thing's weight as of `at`, which is when it was last used. */
export interface Use {
  weight: number
  at: number
}

/** What a use is worth `now`. */
export function worth(use: Use, now: number): number {
  return use.weight * 0.5 ** (Math.max(0, now - use.at) / HALF_LIFE)
}

/** The same thing after one more use at `now`. */
export function used(before: Use | undefined, now: number): Use {
  return { weight: (before ? worth(before, now) : 0) + 1, at: now }
}

/** The list cut down to the `most` things worth most `now`. */
export function trimmed(uses: Map<string, Use>, now: number, most = MOST): Map<string, Use> {
  if (uses.size <= most) return uses

  const kept = [...uses].sort(([, a], [, b]) => worth(b, now) - worth(a, now)).slice(0, most)
  return new Map(kept)
}

/** What storage held, read rather than trusted: `{ key: [weight, at] }`. */
export function usesFrom(value: unknown): Map<string, Use> {
  const out = new Map<string, Use>()
  if (!isRecord(value)) return out

  for (const [key, pair] of Object.entries(value)) {
    if (!Array.isArray(pair)) continue
    const [weight, at] = pair as unknown[]
    if (isNumber(weight) && isNumber(at) && weight > 0) out.set(key, { weight, at })
  }

  return out
}

/** The commands the palette kept before, newest first, as uses a minute apart. */
function formerly(now: number): Map<string, Use> {
  const ids = stringList(stored(USED_KEY)) ?? []
  return new Map(ids.map((id, index) => [`command:${id}`, { weight: 1, at: now - index * 60_000 }]))
}

class Frecency {
  /** Read the first time anything asks. */
  private uses: Map<string, Use> | null = null

  /** Uses noted before that, in the order they happened. */
  private waiting: [string, number][] = []

  private readonly settle = afterQuiet(() => this.write(), SETTLING)

  private read(): Map<string, Use> {
    if (this.uses) return this.uses

    const now = Date.now()
    let uses = usesFrom(stored(KEY))
    if (!uses.size) {
      uses = formerly(now)
      if (uses.size) this.settle()
    }
    forget(USED_KEY)

    for (const [key, at] of this.waiting) uses.set(key, used(uses.get(key), at))
    this.waiting = []
    this.uses = uses
    return uses
  }

  private write() {
    const now = Date.now()
    const uses = trimmed(this.read(), now)
    this.uses = uses

    const out: Record<string, [number, number]> = {}
    for (const [key, use] of uses) out[key] = [Math.round(use.weight * 1000) / 1000, use.at]
    keep(KEY, JSON.stringify(out))
  }

  /** Somebody reached for `key`. */
  use(key: string, now = Date.now()) {
    if (this.uses) this.uses.set(key, used(this.uses.get(key), now))
    else this.waiting.push([key, now])

    this.settle()
  }

  /** What `key` is worth now: nought for a thing never used. */
  worth(key: string, now = Date.now()): number {
    const use = this.read().get(key)
    return use ? worth(use, now) : 0
  }

  /** When `key` was last used, or null. */
  last(key: string): number | null {
    return this.read().get(key)?.at ?? null
  }

  /** The keys under a prefix used lately, newest first, at most `count`. */
  latest(prefix: string, count: number): string[] {
    return [...this.read()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, count)
      .map(([key]) => key)
  }

  /** Takes a thing out, which is Shift+Delete on its row. */
  forget(key: string) {
    if (this.read().delete(key)) this.settle()
  }

  /** Writes a waiting list down now, for a window on its way out. */
  flush() {
    this.settle.flush()
  }
}

export const frecency = new Frecency()
