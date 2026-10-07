/** Whether the caret goes into the note now in front of somebody.
 *
 *  One rule in one place. A note is opened many ways - the plus beside the tabs,
 *  a row in the file list, the palette, a followed link, a shortcut, a new note -
 *  and each of them leaves the focus on whatever was pressed, so each of them
 *  used to leave the reader typing into a button: a space on the plus made
 *  another note instead of a word. A browser does not leave you typing into a
 *  tab, and neither should this.
 *
 *  Pure, so the rule reads as its cases rather than as a condition buried in an
 *  effect; App.svelte holds the one effect that acts on it. */

/** What is showing in the pane that has the focus. */
export interface Showing {
  /** Only an editor is given the caret from out here. A canvas, a page note, a paper,
   *  the graph, a page in a web tab and a terminal each take the keyboard themselves,
   *  and already do. */
  kind:
    'note' | 'canvas' | 'pages' | 'pdf' | 'graph' | 'web' | 'terminal' | 'view' | 'chat' | 'channel'
  /** A note being read is a page, and a page has no caret to put anywhere. */
  reading: boolean
}

/** Everything else that has a claim on the keyboard. */
export interface Claims {
  /** Something is over the note: the palette, the settings, a sheet, a menu. It
   *  closes on its own, and the note waits rather than taking the keys from it. */
  overlaid: boolean
  /** A name is being typed in the file list, which is where a new note starts. */
  renaming: boolean
  /** A deck is on the stage, and then the window is the deck. */
  presenting: boolean
  /** A finger's screen, where the caret brings up a keyboard over half of it.
   *  Tapping a note in a list asks to read the note. */
  touch: boolean
}

export function takesCaret(showing: Showing | null, claims: Claims): boolean {
  if (showing?.kind !== 'note' || showing.reading) return false
  return !claims.overlaid && !claims.renaming && !claims.presenting && !claims.touch
}
