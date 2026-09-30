/** The paper a note is printed and exported on, as the settings keep it: the sizes, the
 *  two ways round, and what the app starts from. Apart from page-setup.ts, which reads a
 *  note's own setup and measures the page, because the settings are read at launch and
 *  the measuring waits for a print. */

/** Paper the print dialog understands, in `@page size` spelling. */
export const PAPER_SIZES = ['A3', 'A4', 'A5', 'Letter', 'Legal'] as const

export const ORIENTATIONS = ['portrait', 'landscape'] as const

export type Paper = (typeof PAPER_SIZES)[number]

export interface PageSetup {
  paper: Paper
  orientation: (typeof ORIENTATIONS)[number]
  /** A CSS length, or a plain number read as millimetres. */
  margin: string
  header: string
  footer: string
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  paper: 'A4',
  orientation: 'portrait',
  margin: '20mm',
  header: '',
  footer: '',
}
