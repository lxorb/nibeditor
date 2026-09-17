/** One tab stop per list, and the arrows inside it.
 *
 *  A list of names is not a row of buttons. A space with four hundred notes in it
 *  put four hundred stops in the tab sequence, so Tab out of the file list took
 *  four hundred presses to reach the note - which is why every app that has lists
 *  keeps them out of it. Discord says so in as many words ("these things can have
 *  hundreds of entries at a time"), and the ARIA practices say the tab sequence
 *  holds one element of a composite widget and the arrows move inside it.
 *
 *  So: exactly one row of a list answers Tab, and it is the row that matters -
 *  the note you have open, the heading the caret is under - not the top of the
 *  list. The arrows walk, letters spell a name, Enter opens and the note takes the
 *  keyboard, Space opens without leaving, and Escape hands the keyboard back to
 *  the note, because the note is where people live.
 *
 *  One action for every `.nib-row` list there is: the file tree, the bookmarks
 *  above it, the outline, the tags, the search results, the backlinks, the strip
 *  of notes. The walk itself is walk.ts and the spelling is list-keys.ts, both of
 *  which are pure and tested; what is here is the part that has to hold a real
 *  element and move a real focus. */

import { steppedKey } from './direction'
import { focusEditor } from './focus'
import { spelled, type Spelling } from './list-keys'
import { walked } from './walk'

/** A list too long to keep in the page.
 *
 *  A space of three thousand notes mounts the twenty rows in view and leaves the
 *  rest as height; see row-window.ts. So the walk cannot be a walk over elements -
 *  End has to reach a row that does not exist yet, and a letter has to spell a name
 *  nothing in the page is wearing. What the walk is over instead is the list
 *  itself, counted and numbered by whoever draws it, and the one thing this asks of
 *  the page is `reach`: put row n there, and say when it is.
 *
 *  Absent for every other list in the app, which is short enough to be all in the
 *  page at once and is walked by its own elements. */
interface LongList {
  /** How many rows the list has, mounted or not. */
  count: () => number
  /** Which row this element is, or -1 for one the list no longer holds. */
  indexOf: (row: HTMLElement) => number
  /** What each row reads as, in order: the whole list, for spelling a name. */
  labels: () => string[]
  /** Puts row n in the page and answers the element once it is there, or null
   *  where there is no such row. */
  reach: (index: number) => Promise<HTMLElement | null>
}

export interface RovingOptions {
  /** A list drawn inside another list of the same kind, which the outermost one
   *  walks. The tag tree draws one of itself per tag, and two handlers reading one
   *  press would step twice. The file list is flat and has no use for it; see
   *  tree-flat.ts. */
  inner?: boolean
  /** A list that runs left to right rather than down: the strip of notes, the row
   *  of panel tabs. Its arrows are left and right, and it leaves up and down alone,
   *  which is what the ARIA practices ask of a horizontal widget - those two keys
   *  are how the page underneath is scrolled. */
  across?: boolean
  /** Which descendants are the rows. */
  rows?: string
  /** The row the keyboard starts on, so Tab into a list arrives at the note that
   *  is open rather than at the first name in it. The ARIA practices say the same:
   *  a list where something is chosen is entered at the chosen thing. */
  current?: string
  /** Whether the two ends meet. A menu wraps, because that is how a hand reaches
   *  the last row of a long one; a list of files does not, because falling off the
   *  bottom of a folder into its top loses somebody's place. */
  wrap?: boolean
  /** The standard name of the key a press stands for, where a reader may have
   *  rebound it: the file list's four arrows are in the registry. Null for a key
   *  the list knows nothing about; absent for a list whose keys are not anybody's
   *  to change, which reads the name off the event. */
  keyOf?: (event: KeyboardEvent) => string | null
  /** What a row reads as, for spelling a name. Its words, by default. */
  label?: (row: HTMLElement) => string
  /** Left and right, where a list holds lists. True when the press was spent. */
  sideways?: (key: string, row: HTMLElement) => boolean
  /** Enter: the row, opened, after which the note takes the keyboard. A click by
   *  default, so a list says what a row does in one place and not two. */
  open?: (row: HTMLElement) => void
  /** Space: the row, opened, with the keyboard left in the list, so a folder can
   *  be walked and read down. Enter's answer where a list has no second one. */
  peek?: (row: HTMLElement) => void
  /** Delete: the row, taken off the list. */
  remove?: (row: HTMLElement) => void
  /** Shift+F10 and the menu key: the row's own menu, at the row. */
  menu?: (row: HTMLElement, at: MouseEvent) => void
  /** Escape. True when the list had something of its own to give back - a
   *  selection to clear - and the note therefore keeps waiting. */
  leave?: () => boolean
  /** Chosen by arriving, for a list where arriving is free. The panel tabs are:
   *  the outline of the note in front is already worked out, so an arrow along the
   *  tabs may as well show it. The strip of notes is not - each of those is a file
   *  to read off a disk - so there an arrow moves and Enter opens.
   *
   *  Which is the rule the ARIA practices give: activate on arrival as long as
   *  what arrives does so without a wait. */
  follow?: (row: HTMLElement) => void
  /** Rows inside a row that leave the tab sequence with it: the cross on a tab.
   *  Reached with the arrows, and with the key that acts on the row instead. */
  quiet?: string
  /** A list whose rows are not all in the page; see LongList. */
  long?: LongList
}

/** Which keys walk a list, and what each of them is in the one vocabulary the walk
 *  is written in; see walk.ts. A list that runs across is a list that runs down,
 *  turned on its side, so right is down and left is up and there is one walk for
 *  both. */
const DOWN: Record<string, string> = {
  ArrowDown: 'ArrowDown',
  ArrowUp: 'ArrowUp',
  Home: 'Home',
  End: 'End',
}

const ACROSS: Record<string, string> = {
  ArrowRight: 'ArrowDown',
  ArrowLeft: 'ArrowUp',
  Home: 'Home',
  End: 'End',
}

/** The two that mean the same thing in every list there has ever been. */
const ENDS = new Set(['Home', 'End'])

export function roving(node: HTMLElement, options: RovingOptions = {}) {
  if (options.inner) return {}

  let settings = options
  let spelling: Spelling = { typed: '', typedAt: 0 }

  const rowsSelector = () => settings.rows ?? '.nib-row'
  const currentSelector = () =>
    settings.current ?? '.is-on, .is-picked, .active, [aria-current=true]'

  const rowsOf = (): HTMLElement[] => [...node.querySelectorAll<HTMLElement>(rowsSelector())]

  const labelOf = (row: HTMLElement) => (settings.label ? settings.label(row) : row.textContent)

  /** A row whose name is being typed. It is a `div` rather than the button a row
   *  usually is, because a button cannot hold a field, and it is not a row to press
   *  either: the field in it is what the keyboard is for. So it is not the list's
   *  tab stop - the field already is one - and putting a tabindex on it left an
   *  extra stop in the sequence with no name on it at all, which a reader walking
   *  the panel arrived at and was told nothing about. See NameField.svelte. */
  const naming = (row: HTMLElement) => row.querySelector('input, textarea') !== null

  /** The one row Tab answers: whichever has the keyboard, else the one the list
   *  says is current, else the first. Everything else is reachable but not
   *  stopped on, which is the roving tabindex the practices describe. */
  function apply() {
    const rows = rowsOf()
    if (!rows.length) return

    const standing = rows.filter((row) => !naming(row))
    const holding = standing.find((row) => row.contains(document.activeElement))
    const stop =
      holding ?? standing.find((row) => row.matches(currentSelector())) ?? standing[0] ?? null

    for (const row of rows) {
      if (naming(row)) row.removeAttribute('tabindex')
      else row.tabIndex = row === stop ? 0 : -1
    }

    // Anywhere in the list, not inside a row: the cross that shuts a tab is the
    // row's neighbour rather than something in it, and looking for it inside each
    // row is how Tab into the strip landed on Close instead of on the note.
    if (settings.quiet) {
      for (const one of node.querySelectorAll<HTMLElement>(settings.quiet)) one.tabIndex = -1
    }
  }

  function stand(row: HTMLElement) {
    row.tabIndex = 0
    for (const other of rowsOf()) {
      if (other !== row) other.tabIndex = -1
    }

    row.focus()
    row.scrollIntoView({ block: 'nearest' })
    settings.follow?.(row)
  }

  /** The row a press came from. */
  function rowOf(event: Event): HTMLElement | null {
    const from = event.target instanceof Element ? event.target.closest(rowsSelector()) : null
    return from instanceof HTMLElement && node.contains(from) ? from : null
  }

  function onKey(event: KeyboardEvent) {
    // A name being typed into the list is a text field, and the arrows, Escape
    // and the letters belong to the words in it.
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return
    }

    const long = settings.long
    const rows = rowsOf()
    const row = rowOf(event)
    const at = row ? (long ? long.indexOf(row) : rows.indexOf(row)) : -1
    const count = long ? long.count() : rows.length
    // The two ends of a list are not anybody's to rebind, and the registry says so
    // in as many words: see `fixed.lists`. So they are read off the event even in a
    // list whose arrows do come from the registry.
    // In reading terms: in a list that runs across, and in a tree that opens to
    // one side, the two sideways keys trade places under an interface that reads
    // right to left. See `steppedKey` in direction.ts.
    const pressed = ENDS.has(event.key)
      ? event.key
      : settings.keyOf
        ? settings.keyOf(event)
        : event.key
    const key = pressed === null ? null : steppedKey(pressed)

    const moves = settings.across ? ACROSS : DOWN
    const move = key === null ? undefined : moves[key]

    if (move !== undefined) {
      const moved = walked(move, at < 0 ? null : at, count, settings.wrap ?? false)
      if (moved !== null && went(moved)) event.preventDefault()
      return
    }

    if (row && key !== null && settings.sideways?.(key, row)) {
      event.preventDefault()
      return
    }

    // A press with Ctrl, Cmd or Alt on it is the app's and not this list's. The four
    // keys below are read off the event rather than through the registry - they are
    // the ones `fixed.lists` says nobody may rebind - so a chord that happens to end
    // in one of them used to be answered here and go no further: Ctrl+Shift+Space is
    // the space switcher, and pressing it with the keyboard in the file list opened
    // the row it was on instead. Shift alone is not a chord: Shift+F10 is the
    // context-menu key every list answers below.
    const chorded = event.ctrlKey || event.metaKey || event.altKey

    switch (event.key) {
      case 'Enter':
        if (!row || chorded) return
        event.preventDefault()
        if (settings.open) settings.open(row)
        else row.click()
        return

      case ' ':
        // Taken either way, so a space meant for the list never scrolls the page
        // underneath it.
        if (!row || chorded) return
        event.preventDefault()
        if (settings.peek) settings.peek(row)
        else if (settings.open) settings.open(row)
        else row.click()
        return

      case 'Delete':
      case 'Backspace':
        if (!row || chorded || !settings.remove) return
        event.preventDefault()
        settings.remove(row)
        return

      case 'F10':
      case 'ContextMenu':
        if (!row || !settings.menu) return
        if (event.key === 'F10' && !event.shiftKey) return
        event.preventDefault()
        settings.menu(row, atRow(row))
        return

      case 'Escape':
        // One level back and nothing else: the list gives up its selection first,
        // and once it has none the keyboard goes back to the note. Never an action
        // - an Escape that changes something is the one key nobody can undo.
        if (settings.leave?.()) {
          event.preventDefault()
          return
        }
        event.preventDefault()
        focusEditor()
        return

      default:
        break
    }

    // A letter spells a name, which is how a list of four hundred is reached
    // without four hundred presses of an arrow.
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return

    const labels = long ? long.labels() : rows.map(labelOf)
    const next = spelled(spelling, event.key, event.timeStamp, labels)
    spelling = { typed: next.typed, typedAt: next.typedAt }

    if (next.found >= 0 && went(next.found)) event.preventDefault()
  }

  /** Puts the keyboard on row n, wherever it is. In a short list that is the
   *  element; in a long one the row may not be in the page yet, and `reach` is
   *  what puts it there - a frame later, which is why the press is taken now and
   *  the focus moves when the row arrives. False for a row the list has not got. */
  function went(index: number): boolean {
    const long = settings.long
    if (!long) {
      const landed = rowsOf()[index]
      if (!landed) return false

      stand(landed)
      return true
    }

    if (index < 0 || index >= long.count()) return false

    void long.reach(index).then((landed) => {
      if (landed) stand(landed)
    })
    return true
  }

  /** A press with the pointer moves the tab stop too, or the keyboard and the
   *  hand disagree about where the list is. The practices call this out by name. */
  function onFocusIn() {
    apply()
  }

  const watch = new MutationObserver(() => apply())
  watch.observe(node, { childList: true, subtree: true })

  node.addEventListener('keydown', onKey)
  node.addEventListener('focusin', onFocusIn)
  apply()

  return {
    update(next: RovingOptions) {
      settings = next
      apply()
    },
    destroy() {
      watch.disconnect()
      node.removeEventListener('keydown', onKey)
      node.removeEventListener('focusin', onFocusIn)
    },
  }
}

/** A press where the row is, so the menu a key asks for arrives where the menu a
 *  right click asks for would have. The menu takes a mouse event because that is
 *  what a menu is opened by; this is the same event, from a key. */
function atRow(row: HTMLElement): MouseEvent {
  const box = row.getBoundingClientRect()

  return new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: Math.round(box.left + Math.min(box.width / 2, 120)),
    clientY: Math.round(box.bottom),
  })
}
