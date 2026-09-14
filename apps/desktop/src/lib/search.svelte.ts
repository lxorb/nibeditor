/** The Search panel: what was asked, what came back, and what a replacement
 *  would do to it.
 *
 *  A store rather than state inside the panel, because two places reach it: a
 *  bookmarked search runs from the row above the file list, and the panel has
 *  to show what it asked. */

import { SvelteSet } from 'svelte/reactivity'
import type { Hit } from './search/match'
import { isEmpty, parseQuery } from './search/query'
import { searchSpace } from './search/space'
import { isBoolean, isRecord, keep, stored } from './stored'
import { afterQuiet } from './timing'
import { workspace } from './workspace.svelte'

/** How long after the last keystroke to ask. Long enough that a word typed at
 *  speed is one search, short enough that it does not feel like waiting. */
const WAIT = 140

/** How many hits are worth showing. Past this the panel is a second copy of
 *  the space rather than an answer. */
const MOST = 200

/** Two letters, so a single one does not fetch the whole space on its way to
 *  becoming a word. */
const SHORTEST = 2

const keyOf = (hit: Hit) => `${hit.path}:${hit.line}`

/** What order the results are read in. `relevance` is the order the search
 *  itself answered in: the notes as they were walked, and the guesses ranked
 *  under them. */
export type SearchSort = 'relevance' | 'name' | 'modified' | 'created'

/** Where the order is kept, and why here rather than on the account.
 *
 *  The order a list is read in is this machine's, not the space's: it is a habit
 *  of whoever is reading rather than a fact about the notes. The file list's own
 *  sort is kept exactly here, under `nib:tree`, and this is the same question
 *  about the same space asked of a different list. */
const SORT_KEY = 'nib:search-sort'

interface Ordering {
  sort: SearchSort
  descending: boolean
}

const AS_ASKED: Ordering = { sort: 'relevance', descending: false }

const SORTS: readonly SearchSort[] = ['relevance', 'name', 'modified', 'created']

function readOrdering(): Ordering {
  const saved = stored(SORT_KEY)
  if (!isRecord(saved)) return { ...AS_ASKED }

  const sort = SORTS.find((one) => one === saved.sort)
  return {
    sort: sort ?? AS_ASKED.sort,
    descending: isBoolean(saved.descending) ? saved.descending : false,
  }
}

class Search {
  text = $state('')
  /** Hits that answer the query as asked, in the order the notes answered. */
  found = $state<Hit[]>([])
  /** Notes that answer it only loosely, best score first; see fuzzy.ts. */
  loose = $state<Hit[]>([])
  /** True from the keystroke until the last note has answered. */
  running = $state(false)
  /** Whether the replacement field is open. */
  replacing = $state(false)
  replacement = $state('')
  /** Whether the archive answers too.
   *
   *  Off, because an archived note is one somebody has put away and a search that kept
   *  handing them back would be the archive not working. On, it is the one place in the
   *  app that looks inside the archive by words rather than by name - which is what a
   *  reader who half-remembers an old note needs, and the reason this is a chip in the
   *  field rather than a setting in a pane.
   *
   *  A reader's own exclusions are not affected: those are folders they said to leave
   *  out of the search, and this chip is about the archive. */
  archived = $state(false)

  /** The hits the reader has turned off. Everything found is on to begin with,
   *  so what is worth keeping is the exceptions. */
  private readonly skipped = new SvelteSet<string>()

  /** The search itself, a moment after the last keystroke; see `ask`. */
  private readonly asking = afterQuiet(() => void this.run(), WAIT)
  /** Which search is the latest. Typing outruns the disk, and answers to a
   *  word that is no longer in the field are dropped rather than shown. */
  private round = 0
  /** Which space the words in the field are a question about. */
  private about: string | null = null

  readonly query = $derived(parseQuery(this.text))
  readonly asks = $derived(this.text.trim().length >= SHORTEST && !isEmpty(this.query))

  /** Everything found, exact first.
   *
   *  The rule, in one line: a note that answers the query keeps exactly the rows
   *  and the order it had before there was any loose matching, and the guesses go
   *  underneath it ranked by score. So nothing can regress - every list the app
   *  used to show is still the top of the list it shows now - and a query that
   *  used to find nothing is where the guesses are worth most. */
  readonly hits = $derived([...this.inOrder(this.found), ...this.inOrder(this.loose)])

  /** How the results are ordered, and which way round. */
  ordering = $state<Ordering>(readOrdering())

  /** When each file was made and last written, by the path a hit names it with.
   *  From the file list, which has read it already: a hit carries no dates, and
   *  putting them on one would be a date per row of two hundred rows about twenty
   *  notes. Every file rather than every note, because a paper answers a search
   *  too; see pdf/papers.ts. */
  private readonly dated = $derived.by(() => new Map(workspace.files.map((one) => [one.path, one])))

  /** Chooses the order. The same key again flips the direction, as the file
   *  list's own sort does. */
  /** The chip pressed: the same question asked again, of a different set of notes. */
  showArchived(shown: boolean) {
    if (this.archived === shown) return

    this.archived = shown
    if (this.asks) void this.run()
  }

  setSort(sort: SearchSort) {
    const descending = this.ordering.sort === sort ? !this.ordering.descending : false
    this.ordering = { sort, descending }
    keep(SORT_KEY, JSON.stringify(this.ordering))
  }

  /** One run of hits in the order asked for.
   *
   *  The exact hits and the guesses are ordered apart and stay apart, so a guess
   *  can never come out above an answer. Rows from one note stay together
   *  whatever the order, because the note decides and the line breaks the tie -
   *  which is what lets the panel go on reading a run of them as a group. */
  private inOrder<T extends Hit>(hits: readonly T[]): T[] {
    const { sort, descending } = this.ordering
    if (sort === 'relevance') return [...hits]

    const dated = this.dated
    const at = (hit: Hit) => {
      if (sort === 'name') return 0
      const entry = dated.get(hit.path)
      return (sort === 'modified' ? entry?.modified : entry?.created) ?? 0
    }

    const way = descending ? -1 : 1
    return [...hits].sort((one, other) => {
      const first =
        sort === 'name'
          ? one.name.localeCompare(other.name, undefined, { sensitivity: 'base' })
          : at(one) - at(other)

      return first * way || one.path.localeCompare(other.path) || one.line - other.line
    })
  }

  /** What a replacement would be put into: the exact hits that are still ticked.
   *  A loose hit is never one of them. There is nothing in its line for the query
   *  to replace, and guessing at what somebody meant is not a thing to do to
   *  their notes. */
  readonly chosen = $derived(this.found.filter((hit) => !this.skipped.has(keyOf(hit))))

  /** Whether a hit will be replaced. */
  keeps(hit: Hit): boolean {
    return !this.skipped.has(keyOf(hit))
  }

  toggle(hit: Hit) {
    const key = keyOf(hit)
    if (this.skipped.has(key)) this.skipped.delete(key)
    else this.skipped.add(key)
  }

  /** A new question. Every keystroke comes through here. */
  ask(text: string) {
    this.text = text
    this.about = workspace.activeSpace?.root ?? null
    this.asking.cancel()
    this.round++

    if (!this.asks) {
      this.empty()
      this.running = false
      return
    }

    this.running = true
    this.asking()
  }

  /** Opens or shuts the replacement field. Shutting it turns every hit back
   *  on, so opening it again never starts from somebody else's choices. */
  toggleReplace() {
    this.replacing = !this.replacing
    if (!this.replacing) this.skipped.clear()
  }

  closeReplace() {
    if (!this.replacing) return

    this.replacing = false
    this.skipped.clear()
  }

  clear() {
    this.asking.cancel()
    this.round++
    this.text = ''
    this.about = null
    this.empty()
    this.running = false
    this.skipped.clear()
  }

  private empty() {
    this.found = []
    this.loose = []
  }

  /** The panel saying which space it is showing. A question asked of another
   *  space is not this space's question, and the lines it found are not in
   *  front of the reader any more. */
  forSpace(root: string | null) {
    if (this.about !== root) this.clear()
  }

  private async run() {
    const round = this.round
    const root = workspace.activeSpace?.root

    if (!root) {
      this.running = false
      return
    }

    this.empty()
    this.skipped.clear()

    // The words to match loosely, or none. Nothing is relaxed while a
    // replacement is being written: that is precision work, and a list holding
    // rows the replacement will not touch would be a list lying about what is
    // about to happen. See fuzzy.ts for what else is left exact.
    //
    // The ranking engine is fetched here rather than imported: it is the largest
    // single module the sidebar reaches, and a window that opens on a note has not
    // been asked anything yet. One fetch per session - the module registry holds it -
    // and the panel it belongs to has already asked for it by the time anybody types,
    // because the panel carries it too. See `warmDoors` in surfaces.svelte.ts.
    const { fuzzyTerms } = await import('./search/fuzzy')
    const terms = this.replacing ? [] : fuzzyTerms(this.query)

    // Rows arrive in handfuls and go on the end, so the list fills from the
    // top while the rest of the space is still being read. The guesses come in
    // the last handful, already ranked; see space.ts.
    // What the space is not showing, which the walk skips as it goes rather than
    // filtering afterwards: the crate and the worker both take this list, so a limit is
    // never spent on a row nobody was going to see. The archive is part of it until the
    // reader asks for it, and then only the reader's own exclusions are left.
    const excluded = this.archived ? workspace.excluded.of(root) : workspace.leftOut.of(root)
    await searchSpace(
      root,
      this.query,
      terms,
      MOST,
      (batch) => {
        if (round !== this.round) return

        if (batch.hits.length) this.found = [...this.found, ...batch.hits]
        if (batch.loose.length) this.loose = [...this.loose, ...batch.loose]
      },
      excluded,
    )

    if (round === this.round) this.running = false
  }

  /** Puts the replacement into every hit that is still ticked. */
  async replace() {
    const root = workspace.activeSpace?.root
    const chosen = this.chosen
    if (!root || !chosen.length) return

    // What a replacement would do to each note, worked out where the edits are
    // written down; fetched with the press, like the ranking above.
    const { changesFor } = await import('./search/apply')
    const changes = await changesFor(this.query, chosen, this.replacement, root, (path) =>
      workspace.noteText(path),
    )

    await workspace.replaceInNotes(changes)

    // The notes have changed under the list, so the list is asked again.
    this.round++
    await this.run()
  }
}

export const search = new Search()
