/** How a space's graph is drawn.
 *
 *  On the space rather than on the account, and rather than on the tab: what the
 *  picture is filtered to and what its colours mean are facts about one space's
 *  notes, so they travel with the space to every machine signed in and come back
 *  with it when it is restored. It is also what lets the graph stay a command
 *  rather than something to open: there is one picture of a space and it is
 *  already the way you left it.
 *
 *  A bookmarked view is the other half of that, and does not make the graph a
 *  thing to open either: a row in the bookmarks carries a whole set of these
 *  settings, and pressing it writes them here and shows the graph. Which is what
 *  gives a space a second way of being looked at - the whole of it, one project,
 *  what nothing links to - without setting the card up again each time. See
 *  `take`, and forGraph in workspace/bookmarks.svelte.ts.
 *
 *  Not the camera, though, and not the time the reader has scrubbed to. Where the
 *  view is looking is a gesture, not a setting; sending it up would make two
 *  machines fight over the same pan.
 *
 *  `nib:folder-icons` is this store's twin in every respect, down to remembering
 *  which account a space's settings have been folded into. */

import { isBoolean, isNumber, isRecord, isString, keep, stored } from '../stored'
import { without } from '../records'

export const STORAGE_KEY = 'nib:graph'

/** How many colour groups a space may have: one per colour the theme names. A
 *  seventh would either repeat a colour or invent one, and a picture with seven
 *  meanings in it is a picture nobody reads. */
export const MOST_GROUPS = 6

/** How long a query in the card may be. The service holds a space to the same
 *  number, so what fits here fits there. */
const LONGEST_QUERY = 200

/** How long after the last keystroke the account is told, in milliseconds. Long
 *  enough that a phrase typed at speed is one request, short enough that closing
 *  the window straight after does not lose it. */
const SETTLING = 700

/** How far apart the arrangement may be pushed, as a multiple of what it does on
 *  its own. */
export const LEAST_SPREAD = 0.25
export const MOST_SPREAD = 4

/** How many links out the picture beside a note may reach. Three is where a
 *  neighbourhood stops being one: at four, most spaces answer with the space. */
export const DEEPEST = 3

/** The three widths a link may be drawn at: thin, the look the picture has always
 *  had, and thick. Three steps rather than a range, because the widths worth having
 *  are the ones a screen can actually draw as a hairline; see `EDGE_PIXELS` in
 *  graph-paint.ts, which is where each step is a number of the screen's own pixels. */
export const LEAST_LINES = 1
export const MOST_LINES = 3

/** One query and the colour the notes it keeps are drawn in. */
interface ColourGroup {
  query: string
  /** One of the six the theme names, 1 to 6; see `--canvas-1` in tokens.css. */
  colour: number
}

export interface GraphSettings {
  /** What the picture of the whole space is narrowed to, in the search's own
   *  language; see graph-filter.ts. Empty for the whole space. */
  filter: string
  /** Whether notes nothing links to are in the picture. */
  orphans: boolean
  /** Whether the files the notes embed - pictures, PDFs, sounds, films - are in the
   *  picture as nodes of their own. */
  attachments: boolean
  groups: ColourGroup[]
  spread: number
  /** Whether the pull towards the middle is on, which is what keeps the notes
   *  nothing links to in a ring rather than letting them drift. */
  gather: boolean
  /** Whether a link is drawn with a head saying which note reached for which. */
  arrows: boolean
  /** Whether a note with more links is drawn bigger. */
  sized: boolean
  /** How wide a link is drawn: 1 thin, 2 the look the picture has always had, 3
   *  thick. */
  lines: number
  /** How many links out the picture beside a note reaches, 1 to `DEEPEST`. */
  depth: number
}

export const DEFAULT_GRAPH: GraphSettings = {
  filter: '',
  orphans: true,
  // Off: an attachment is a node the arrangement has to make room for, so the
  // picture a space arrives with is the picture of its notes.
  attachments: false,
  groups: [],
  spread: 1,
  gather: true,
  // Off: a graph says "these two are connected", and a space where most links are
  // read both ways is a space full of arrowheads saying nothing. On when the
  // question is which note reached for which.
  arrows: false,
  sized: true,
  // The middle step, which is the hairline the picture has always been drawn with:
  // a dial nobody has touched changes nothing.
  lines: 2,
  depth: 1,
}

function held(value: unknown, least: number, most: number, fallback: number): number {
  if (!isNumber(value)) return fallback
  return Math.min(most, Math.max(least, value))
}

/** A group with no query yet is kept, not dropped: it is the row that has just
 *  been added and is about to be typed into, and a card that removed it under the
 *  cursor would be a card nothing could be written in. It colours nothing until it
 *  says something. */
function groupsOf(value: unknown): ColourGroup[] {
  if (!Array.isArray(value)) return []

  const out: ColourGroup[] = []
  for (const one of value) {
    if (out.length >= MOST_GROUPS) break
    if (!isRecord(one) || !isString(one.query)) continue

    out.push({
      query: one.query.slice(0, LONGEST_QUERY),
      colour: Math.round(held(one.colour, 1, MOST_GROUPS, 1)),
    })
  }

  return out
}

/** The settings in an unknown, with whatever does not read as one left at its
 *  default. Written by a newer build, by an older one, or by hand: what reads is
 *  kept and the rest is the default, the way every other store here reads
 *  itself. */
export function graphSettingsOf(value: unknown): GraphSettings {
  if (!isRecord(value)) return { ...DEFAULT_GRAPH }

  return {
    filter: isString(value.filter) ? value.filter.slice(0, LONGEST_QUERY) : DEFAULT_GRAPH.filter,
    orphans: isBoolean(value.orphans) ? value.orphans : DEFAULT_GRAPH.orphans,
    attachments: isBoolean(value.attachments) ? value.attachments : DEFAULT_GRAPH.attachments,
    groups: groupsOf(value.groups),
    spread: held(value.spread, LEAST_SPREAD, MOST_SPREAD, DEFAULT_GRAPH.spread),
    gather: isBoolean(value.gather) ? value.gather : DEFAULT_GRAPH.gather,
    arrows: isBoolean(value.arrows) ? value.arrows : DEFAULT_GRAPH.arrows,
    sized: isBoolean(value.sized) ? value.sized : DEFAULT_GRAPH.sized,
    lines: Math.round(held(value.lines, LEAST_LINES, MOST_LINES, DEFAULT_GRAPH.lines)),
    depth: Math.round(held(value.depth, 1, DEEPEST, DEFAULT_GRAPH.depth)),
  }
}

/** Whether two sets of settings say the same thing, so a pass that changed
 *  nothing writes nothing. */
export function sameGraph(one: GraphSettings, other: GraphSettings): boolean {
  return JSON.stringify(one) === JSON.stringify(other)
}

/** One space's settings, and which account they have already been folded into. */
interface Kept {
  settings: GraphSettings
  /** The account these have been folded into, or null while there was none. A
   *  different account signing in on this machine merges again; the same one
   *  signing in twice does not, or a filter it cleared on another machine would be
   *  handed straight back to it. */
  account: string | null
}

function read(): Record<string, Kept> {
  const saved = stored(STORAGE_KEY)
  if (!isRecord(saved)) return {}

  const out: Record<string, Kept> = {}
  for (const [root, one] of Object.entries(saved)) {
    if (!isRecord(one)) continue
    out[root] = {
      settings: graphSettingsOf(one.settings),
      account: isString(one.account) ? one.account : null,
    }
  }

  return out
}

export class SpaceGraphSettings {
  private spaces = $state<Record<string, Kept>>(read())
  /** A push waiting for the typing to stop, per space. Bookkeeping rather than
   *  state: nothing on screen is drawn from it. */
  private pushing: Record<string, ReturnType<typeof setTimeout>> = {}

  /** Which space the picture on screen is of. A function rather than a value
   *  because the workspace decides that, and it changes as spaces are picked. */
  constructor(private readonly root: () => string | null) {}

  /** Reads the settings again, once the storage that holds them has answered. For
   *  the plugin, whose store answers seconds after this one was built; see `reread`
   *  in folder-icons.svelte.ts, which is the same fact about the same storage. */
  reread(): void {
    const saved = read()
    const spaces = { ...this.spaces }
    let grew = false

    for (const [root, kept] of Object.entries(saved)) {
      if (spaces[root]) continue

      spaces[root] = kept
      grew = true
    }

    if (grew) this.spaces = spaces
  }

  of(root: string): GraphSettings {
    return this.spaces[root]?.settings ?? DEFAULT_GRAPH
  }

  /** The settings of the space being looked at, which is what every surface that
   *  draws a graph reads. */
  get here(): GraphSettings {
    const root = this.root()
    return root === null ? DEFAULT_GRAPH : this.of(root)
  }

  /** Changes what is named and leaves the rest as it was. */
  set(change: Partial<GraphSettings>) {
    const root = this.root()
    if (root === null) return

    const next = graphSettingsOf({ ...this.of(root), ...change })
    if (sameGraph(next, this.of(root))) return

    this.put(root, next)
  }

  /** Takes a whole view at once, as a bookmarked one is kept: the JSON a graph
   *  bookmark carries, read the way anything written by another build is read -
   *  what makes sense is kept and the rest is the default. Nothing at all leaves
   *  the picture alone, which is what a row with no view in it means.
   *
   *  See forGraph in workspace/bookmarks.svelte.ts, which writes it. */
  take(view: string | undefined) {
    if (!view) return

    let parsed: unknown
    try {
      parsed = JSON.parse(view)
    } catch {
      return
    }

    const root = this.root()
    if (root === null) return

    const next = graphSettingsOf(parsed)
    if (sameGraph(next, this.of(root))) return

    this.put(root, next)
  }

  /** Back to the picture the space arrived with. */
  reset() {
    const root = this.root()
    if (root === null || sameGraph(this.of(root), DEFAULT_GRAPH)) return

    this.put(root, { ...DEFAULT_GRAPH })
  }

  /** A space folder that has been renamed, which re-keys the settings at once:
   *  they are kept under the root, and the root is what moved. */
  spaceMoved(from: string, to: string) {
    const kept = this.spaces[from]
    if (!kept || from === to) return

    this.spaces = { ...without(this.spaces, from), [to]: kept }
    this.write()
  }

  /** Forgets a space's settings, for a space that is no longer here. */
  forget(root: string) {
    if (!(root in this.spaces)) return

    this.spaces = without(this.spaces, root)
    this.write()
  }

  /** Takes over what the account holds for one space: this machine's own settings
   *  the first time an account sees the space, and the account's outright on every
   *  pass after that.
   *
   *  There is nothing to merge here the way there is with a map of icons - a
   *  filter is one string, not a set of pairs - so first contact keeps whatever
   *  this machine has where the account has only the defaults, and sends it up.
   *  Exactly what `bookmarks.adopt` does about which copy wins, and why. */
  adopt(root: string, theirs: unknown, accountId: string) {
    // Read rather than trusted: the service is deployed on its own, so a build of
    // it older than this app answers with no graph settings at all.
    const account = graphSettingsOf(theirs)
    const kept = this.spaces[root]
    const first = kept?.account !== accountId
    const mine = kept?.settings ?? DEFAULT_GRAPH
    const settings = first && sameGraph(account, DEFAULT_GRAPH) ? mine : account

    if (kept && !first && sameGraph(kept.settings, settings)) return

    this.spaces = { ...this.spaces, [root]: { settings, account: accountId } }
    this.write()

    if (first && !sameGraph(settings, account)) void this.push(root)
  }

  private put(root: string, settings: GraphSettings) {
    this.spaces = {
      ...this.spaces,
      [root]: { settings, account: this.spaces[root]?.account ?? null },
    }
    this.soon(root)
  }

  /** The storage and the account both hear about it once the typing stops.
   *
   *  Unlike a folder icon, which is one gesture, a filter is written a letter at a
   *  time: a push per keystroke would be a request per keystroke, and every one of
   *  them would be out of date before it landed. The storage is the same bargain on
   *  a smaller scale and it used to be paid on every letter - every space's
   *  settings stringified and written to `localStorage`, which blocks the thread it
   *  is called on, beside the pass over five thousand nodes the same keystroke asks
   *  the picture for.
   *
   *  What is on screen is still right immediately: the picture draws from the state
   *  above, which this writes down rather than reads. What a crash inside the next
   *  seven tenths of a second costs is the letter that was typed in it, which is
   *  the bargain a note's own save makes at nearly twice the wait. */
  private soon(root: string) {
    const held = this.pushing[root]
    if (held !== undefined) clearTimeout(held)

    const waiting = setTimeout(() => {
      this.pushing = without(this.pushing, root)
      this.write()
      void this.push(root)
    }, SETTLING)

    this.pushing = { ...this.pushing, [root]: waiting }
  }

  /** Everything waiting, written down now. For a window going away: the timer
   *  above will not fire after that, and the letters typed into the card in the last
   *  breath are the ones somebody would look for when they came back. */
  flush() {
    for (const [root, held] of Object.entries(this.pushing)) {
      clearTimeout(held)
      void this.push(root)
    }

    this.pushing = {}
    this.write()
  }

  /** The space's settings as they now stand, sent up so every other machine draws
   *  the same picture.
   *
   *  Signed out, in a space the account has never heard of, or in one shared to
   *  read, they stay on this machine. Imported where they are used, for the reason
   *  folder-icons gives: the syncing loop reads the workspace this store belongs
   *  to, and the two would import each other. */
  private async push(root: string) {
    const [{ account }, { api }, { sync }] = await Promise.all([
      import('../account.svelte'),
      import('../api'),
      import('../sync.svelte'),
    ])

    const token = account.token
    const spaceId = sync.remoteIdFor(root)
    if (!token || !spaceId) return
    if (account.spaces.find((one) => one.id === spaceId)?.role === 'read') return

    await api.saveGraphSettings(token, spaceId, this.of(root)).catch(() => undefined)
    await account.loadSpaces().catch(() => undefined)
  }

  private write() {
    // Through `keep`, the one place that writes: a picture that cannot be
    // written down is still the picture on screen, and the settings are in
    // memory and true. See stored.ts.
    keep(STORAGE_KEY, JSON.stringify(this.spaces))
  }
}
