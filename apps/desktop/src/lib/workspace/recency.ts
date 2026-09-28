/** Ctrl+Tab in the order the tabs were last in front, VS Code's way: a first press
 *  goes to the tab used before this one, each press while Ctrl is held one further
 *  back, and letting go is what counts as using the tab arrived at - so the tabs
 *  walked past keep their places, and a quick press twice goes back and forth. The
 *  order itself is `used` in panes.svelte.ts. */

/** A strip in order of use: the tab in front, the rest by how recently each was in
 *  front, then the ones never in front in the strip's own order. */
export function ranked(
  strip: readonly string[],
  order: readonly string[],
  current: string,
): string[] {
  const used = order.filter((id) => id !== current && strip.includes(id))
  const rest = strip.filter((id) => id !== current && !used.includes(id))

  return [...(strip.includes(current) ? [current] : []), ...used, ...rest]
}

/** One held walk, from its first press to Ctrl let go of. */
export class Walk {
  private at = 0
  private readonly order: string[]

  /** `before` is the order of use when the walk began. */
  constructor(
    strip: readonly string[],
    current: string,
    private readonly before: readonly string[],
  ) {
    this.order = ranked(strip, before, current)
  }

  /** The next tab along, back in time going forward; null in a strip of one. */
  step(direction: number): string | null {
    const count = this.order.length
    if (count < 2) return null

    this.at = (((this.at + direction) % count) + count) % count
    return this.order[this.at] ?? null
  }

  /** The order of use once the walk ends on `current`, with nothing it passed moved. */
  ended(current: string | null): string[] {
    const rest = this.before.filter((id) => id !== current)
    return current === null ? rest : [current, ...rest]
  }
}
