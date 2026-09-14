/** The marks the list panel is navigated by, on a 13 unit grid.
 *
 *  Here rather than in the panel that draws the tabs, because three surfaces ask
 *  for the same drawing and a path copied is a path that drifts: the magnifier is
 *  the Search tab, the pill at the top of the panel that opens it, and the mark a
 *  bookmarked search wears in the list. One `d`, one shape.
 */

/** A folder with its corners taken off and its tab eased into the body, so it
 *  sits with the arcs of the three beside it rather than as the one hard shape in
 *  the row. */
export const FILES_MARK =
  'M2.2 3.5h2.3c.5 0 .7.4 1 .9s.5.6 1 .6h4.3a1.2 1.2 0 0 1 1.2 1.2v4.1a1.2 1.2 0 0 1-1.2 1.2H2.2A1.2 1.2 0 0 1 1 10.3V4.7a1.2 1.2 0 0 1 1.2-1.2z'

/** Three lines, each shorter and further in than the last: a note's headings. */
export const OUTLINE_MARK = 'M2 2.5h9M4 6.5h7M6 10.5h5'

export const SEARCH_MARK = 'M5.5 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM8.6 8.6l3 3'

/** Two links of a chain, which is what a link between notes is. */
export const LINKS_MARK =
  'M5.6 7.4 7.4 5.6M6.9 4.3l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7l-1.2 1.2M8.4 9.9l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7l1.2-1.2'

/** A line of words with a raised number after it, and the rule and the note under
 *  it: a footnote, which is a mark in the words and what it says at the bottom. */
export const FOOTNOTES_MARK = 'M2 3h5.5M9.4 1.8h1.6l-1.8 2.6h1.9M2 7h9M2 10h4'

/** Three notes and the edges between them: the same links, drawn as a picture. */
export const GRAPH_MARK =
  'M1.4 3.4a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0M8 3.4a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0M4.7 9.9a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0M5 3.4h3M5.7 8.3 4 5M7.3 8.3 9 5'
