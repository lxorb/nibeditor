/** The strips on screen, by the pane they belong to, and the one tab on its way
 *  from one of them to another.
 *
 *  A tab carried out of its strip is a pointer, not a transfer: the strip it came
 *  from follows it and has to ask the strip under it where it would go. That strip
 *  answers from its own layout - where its tabs are meant to be, not where they are
 *  drawn halfway through making room - so the answer does not move as the room
 *  opens under the pointer. */

export interface Strip {
  /** The place a tab dropped at this point on the glass would take. */
  slotAt(clientX: number): number
  /** Where the tabs start on the glass, top edge: a carried tab lines up with it. */
  top(): number
}

const strips = new Map<string, Strip>()

/** Puts a strip on the list for as long as it is on screen. */
export function register(paneId: string, strip: Strip): () => void {
  strips.set(paneId, strip)
  return () => {
    if (strips.get(paneId) === strip) strips.delete(paneId)
  }
}

export function stripOf(paneId: string): Strip | undefined {
  return strips.get(paneId)
}

/** A tab let go over another strip, and where on the glass it was let go: the
 *  strip it lands in slides it from there into its slot rather than growing a new
 *  tab out of nothing. Read once, by the tab it names. */
let arriving: { tabId: string; left: number; top: number } | null = null

export function handOver(tabId: string, left: number, top: number) {
  arriving = { tabId, left, top }
}

export function arrival(tabId: string): { left: number; top: number } | null {
  if (arriving?.tabId !== tabId) return null

  const where = arriving
  arriving = null
  return where
}
