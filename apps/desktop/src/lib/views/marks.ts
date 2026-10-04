/** The marks of the views, on the 13 unit grid the panel's marks are drawn on (see
 *  panel-marks.ts): one per layout for the switch, and the three of the head's tools.
 *  A shape says it where a word would be a label (docs/conventions.md, Product). */

import type { Layout } from './words'

export const LAYOUT_MARKS: Record<Layout, string> = {
  list: 'M4.5 3.5h7M4.5 6.5h7M4.5 9.5h7M1.8 3.5h.5M1.8 6.5h.5M1.8 9.5h.5',
  table: 'M1.5 2.5h10v8h-10zM1.5 5.3h10M5.2 2.5v8',
  cards: 'M1.5 1.5h4v4h-4zM7.5 1.5h4v4h-4zM1.5 7.5h4v4h-4zM7.5 7.5h4v4h-4z',
  kanban: 'M1.5 1.5h2.6v10H1.5zM5.2 1.5h2.6v6.5H5.2zM8.9 1.5h2.6v8.5H8.9z',
  calendar: 'M1.5 2.5h10v9h-10zM1.5 5.2h10M4.2 1v3M8.8 1v3',
  timeline: 'M1.5 3.5h6M4 6.5h6.5M2.5 9.5h4.5',
  chart: 'M1.5 11.5h10M3.2 11V7.5M6.5 11V3M9.8 11V5.5',
}

/** A funnel: what is let through. */
export const FILTER_MARK = 'M1.5 2.5h10l-4 4.6v4l-2-1.1V7.1z'

/** Rows in two piles: a grouping. */
export const GROUP_MARK = 'M1.5 2.2h10M1.5 4.6h6.5M1.5 8.3h10M1.5 10.7h6.5'

/** The rows of the panel: Inbox a tray, Today a sun-less clock face, Upcoming a
 *  calendar, Logbook a tick, a view the grid of a base, a project a page with a box,
 *  a label the hash. */
export const INBOX_MARK = 'M1.5 7.5h3l1 1.7h2l1-1.7h3M1.5 7.5l1.6-5h6.8l1.6 5v3h-10z'
export const TODAY_MARK = 'M6.5 1.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM6.5 3.8v2.7l1.8 1.2'
export const UPCOMING_MARK = LAYOUT_MARKS.calendar
export const LOGBOOK_MARK = 'M2 6.8l2.8 2.8 6.2-6.6'
export const VIEW_MARK = LAYOUT_MARKS.table
export const PROJECT_MARK = 'M6.5 1.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10z'
export const LABEL_MARK = 'M4.8 1.8 3.8 11.2M9.2 1.8l-1 9.4M1.8 4.6h9.6M1.4 8.4h9.6'
export const ADD_MARK = 'M6.5 2v9M2 6.5h9'
