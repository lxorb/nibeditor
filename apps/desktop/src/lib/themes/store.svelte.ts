/** The theme store: the catalogue as the gallery sees it, and installing from it.
 *
 *  Nothing here draws anything. What it owns is the state a gallery reads: what
 *  the catalogue holds, what is being searched for, which card is open, and
 *  which theme is at this moment being written to the themes folder. Installing
 *  writes an ordinary `.css` file into the folder the app already watches, so a
 *  theme from the store and a theme somebody dropped in by hand are the same
 *  kind of thing from that moment on. */

import { message, t } from '../i18n.svelte'
import { log } from '../log'
import { theme } from '../theme.svelte'
import { invoke } from '../tauri'
import { indexUrl, isNewer, readIndex, type StoreTheme, styleUrl } from './registry'
import { stamped } from './stamp'
import { review } from './validate'

/** How the grid is ordered. Newest first is what a store is looked at for; by
 *  name is what it is come back to. */
type Order = 'newest' | 'name'

/** How long a catalogue already fetched is still current. The gallery asks on
 *  every opening, and opening it twice in a row should not be two requests. */
const FRESH_FOR = 5 * 60 * 1000

/** What the first paint of the grid is measured as, under a name a profiler and
 *  the browser's own timeline both show. */
export const PAINT = 'nib:themes'

/** Whether a theme is worth showing for what was typed. Plain substring, case
 *  aside, over everything a card shows: the same kind of lookup the settings
 *  search does, because it is looked up by a word and not by initials. */
function matches(one: StoreTheme, needle: string): boolean {
  return [one.name, one.author, one.description, ...one.tags].some((text) =>
    text.toLowerCase().includes(needle),
  )
}

/** The grid: what was searched for, in the order that was asked for.
 *
 *  Sorting still applies while searching. A search narrows the shelf; it does
 *  not reorder what is left by a score nobody can see. */
export function arrange(themes: StoreTheme[], query: string, order: Order): StoreTheme[] {
  const needle = query.trim().toLowerCase()
  const shown = needle ? themes.filter((one) => matches(one, needle)) : [...themes]

  return shown.sort((a, b) =>
    order === 'name'
      ? a.name.localeCompare(b.name)
      : // Ties broken by name, so the order is the same on every machine rather
        // than whatever the catalogue happened to list.
        b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name),
  )
}

class Store {
  open = $state(false)
  query = $state('')
  order = $state<Order>('newest')
  /** The card whose full preview is showing, by id. Null while the grid is. */
  opened = $state<string | null>(null)

  themes = $state<StoreTheme[]>([])
  loading = $state(false)
  /** Why the catalogue or an install did not work, as a sentence. */
  error = $state<string | null>(null)
  /** What a theme's stylesheet asked for and did not get, and which theme asked.
   *  Shown under that theme's preview rather than instead of it, and under no
   *  other theme's: a theme with one bad line installs, and says so where it
   *  can be read as being about that theme. */
  refused = $state<{ id: string; notes: string[] }>({ id: '', notes: [] })
  /** Which theme is being written right now, so its button can say so. */
  working = $state<string | null>(null)

  /** When the catalogue was last read. */
  private fetchedAt = 0

  readonly shown = $derived(arrange(this.themes, this.query, this.order))
  readonly chosen = $derived(this.themes.find((one) => one.id === this.opened) ?? null)

  /** Whether this theme is in the folder, and whether the catalogue is ahead of
   *  what is there. */
  installed(id: string): boolean {
    return theme.installed.has(id)
  }

  updatable(one: StoreTheme): boolean {
    const held = theme.installed.get(one.id)?.stamp?.version
    return held !== undefined && isNewer(one.version, held)
  }

  /** Whether the app is showing this theme right now. */
  using(id: string): boolean {
    return theme.active.stamp?.id === id
  }

  show() {
    this.open = true
    this.opened = null
    this.error = null
    void this.load()
  }

  close() {
    this.open = false
    this.query = ''
    this.opened = null
    // What went wrong last time went wrong last time. A count of refusals left
    // lying about would come back under the same card on a later opening,
    // saying something about an install that did not happen.
    this.error = null
    this.refused = { id: '', notes: [] }
  }

  /** The catalogue. Read once per opening, and not again while what was read is
   *  still fresh: the gallery is opened and closed while looking for something,
   *  and each opening should not be another round trip. */
  async load(force = false) {
    if (!force && this.themes.length && Date.now() - this.fetchedAt < FRESH_FOR) return

    this.loading = true
    this.error = null

    try {
      const response = await fetch(indexUrl(), { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error('could not reach the theme store')

      const body: unknown = await response.json()
      // Where the measurement starts: the catalogue has arrived, and reading it
      // and drawing it are both ours. The gallery closes the measure on the
      // frame after the cards are laid out, and takes the mark away with it, so
      // an opening that fetched nothing cannot be measured against a stale one.
      performance.clearMarks(`${PAINT}:index`)
      performance.mark(`${PAINT}:index`)

      this.themes = readIndex(body)
      this.fetchedAt = Date.now()
    } catch (error) {
      this.error = message(error, 'could not reach the theme store')
    } finally {
      this.loading = false
    }
  }

  /** Writes the theme into the themes folder and applies it.
   *
   *  The stylesheet is read down to what a theme may be here as well as in the
   *  registry: the registry says what may be published, and this says what may
   *  be applied, and only the second one is a promise to the person installing
   *  it. What is written is what survived that reading, with a line on the front
   *  saying which theme it is and at which version. */
  async install(one: StoreTheme) {
    this.working = one.id
    this.error = null
    this.refused = { id: one.id, notes: [] }

    try {
      const response = await fetch(styleUrl(one.id))
      if (!response.ok) throw new Error('could not fetch that theme')

      const reviewed = review(await response.text())
      if (!reviewed.css) throw new Error('that theme has nothing a theme may set')

      this.refused = { id: one.id, notes: reviewed.refused }
      // The count is what the preview says, because a list of CSS complaints is
      // not what somebody installing a theme came for. The complaints themselves
      // go to the log, which is where a question about them is answered.
      if (reviewed.refused.length) {
        log('warn', `${one.id} ${one.version}: ${reviewed.refused.join('; ')}`)
      }

      await invoke<string>('write_theme', {
        id: one.id,
        css: stamped(
          { id: one.id, name: one.name, author: one.author, version: one.version },
          reviewed.css,
        ),
      })

      await theme.reload()
      // Applied at once. Installing a theme and then being asked to turn it on
      // is a second click for something nobody meant twice; taking it off again
      // is one click away in the same place.
      this.use(one.id)
    } catch (error) {
      this.error = message(error, 'could not install that theme')
    } finally {
      this.working = null
    }
  }

  /** Applies an installed theme, exactly as choosing a hand-placed file does. */
  use(id: string) {
    const file = theme.installed.get(id)
    if (file) theme.select(file.id)
  }

  async remove(id: string) {
    this.working = id
    this.error = null

    try {
      await invoke('remove_theme', { id })
      // The file is gone; the reload notices the active theme went with it and
      // puts the app back on the system's own look.
      await theme.reload()
    } catch (error) {
      this.error = message(error, 'could not remove that theme')
    } finally {
      this.working = null
    }
  }

  /** What the button under a card says, which is the whole of what a card has
   *  to explain about where that theme stands. */
  action(one: StoreTheme): string {
    if (this.updatable(one)) return t('Update')
    if (this.using(one.id)) return t('In use')
    if (this.installed(one.id)) return t('Use')
    return t('Install')
  }
}

export const store = new Store()
