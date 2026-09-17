/** Where the tabs somebody pinned sit, which is at the head of the strip.
 *
 *  A pinned tab is one that was meant to stay: it is drawn as its mark alone, it
 *  offers no cross, and every browser for twenty years has kept the run of them at
 *  the start of the strip. That is one fact about an order, and the order is the
 *  array of tabs itself rather than a sort at the drawing end - the numbered keys,
 *  Ctrl+Tab, where a closed tab comes back and where a dragged one lands all count
 *  along that array, and a strip the reader saw in some other order would make
 *  every one of them count wrong.
 *
 *  So the array is kept in order, and this is the rule that keeps it: everything
 *  that puts a tab at a place in a strip asks here what place it may actually
 *  take. Nothing else has to know that pinning has anything to do with order,
 *  which is why a tab dragged in front of the run stops at the edge of it without
 *  the drag knowing why.
 *
 *  Tabs and no store, so which tab goes where can be read off a list in a test
 *  rather than out of a running window. */

/** All this knows about a tab: whether it is one of the kept ones. */
export interface Pinnable {
  readonly pinned: boolean
}

/** How long the run of pinned tabs at the head of a strip is.
 *
 *  Counted from the head and stopped at the first tab that is not pinned, rather
 *  than counting every pinned tab in the strip: the run is the head of the strip
 *  by definition, so a session written by a build that let one sit further along
 *  reads as a shorter run and `byPin` is what puts that strip right. */
export function pinnedRun(strip: readonly Pinnable[]): number {
  let run = 0
  while (strip[run]?.pinned === true) run += 1
  return run
}

/** The place a tab may take in a strip: the place asked for, held inside the run
 *  when the tab is pinned and outside it when it is not.
 *
 *  `at` counts along the strip as it is without the tab, and null is the end of
 *  it - which for a pinned tab is the end of its own run, since that is as far
 *  along as it may go.
 *
 *  A drag is what this is mostly answering. Dropping a note in front of the
 *  pinned tabs lands it at the first place that is not one of them, and dragging
 *  a pinned tab past the run holds it at the end of the run: the drop does what
 *  can be done rather than nothing at all, which is what a hand that overshot by
 *  a few pixels meant. A pinned tab dragged out of the run is not let go of -
 *  pinning and unpinning is a thing somebody says, not something a drag can do by
 *  accident. */
export function placeFor(
  strip: readonly Pinnable[],
  pinned: boolean,
  at: number | null,
): number | null {
  const run = pinnedRun(strip)
  if (pinned) return Math.max(0, Math.min(at ?? run, run))

  return at === null ? null : Math.max(at, run)
}

/** A strip with the pinned tabs first, each of the two runs in the order it was
 *  already in.
 *
 *  What a session read back off the disk goes through, and the only place the
 *  order is ever put right rather than kept: an entry written by a build that did
 *  not hold the run at the head, or edited by hand, still opens as a strip with
 *  its kept tabs at the front. Everything after that is `placeFor`. */
export function byPin<T extends Pinnable>(strip: readonly T[]): T[] {
  return [...strip.filter((one) => one.pinned), ...strip.filter((one) => !one.pinned)]
}
