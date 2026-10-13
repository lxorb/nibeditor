import { key } from './i18n.svelte'

/** The formats only pandoc can produce, for a machine that has it, in the order
 *  Typora lists them. The labels are product names and stay as they are; only
 *  `Presentation` is a plain noun, and it is translated where it is shown.
 *
 *  Word, RTF and ePub are not here even though pandoc writes them: Orden writes
 *  its own, with the diagrams drawn, the code coloured and the pictures carried,
 *  and one format that came out differently depending on whether a machine
 *  happened to have pandoc would be worse than either.
 *
 *  Kept apart from the exporter itself, which carries fonts and parsers the
 *  command list has no use for: this is all the palette needs at startup. */
export const PANDOC_FORMATS = [
  { id: 'odt', label: 'OpenOffice', extension: 'odt' },
  { id: 'latex', label: 'LaTeX', extension: 'tex' },
  { id: 'mediawiki', label: 'MediaWiki', extension: 'wiki' },
  { id: 'rst', label: 'reStructuredText', extension: 'rst' },
  { id: 'textile', label: 'Textile', extension: 'textile' },
  { id: 'opml', label: 'OPML', extension: 'opml' },
  { id: 'revealjs', label: key('Presentation'), extension: 'html' },
] as const

export type PandocFormat = (typeof PANDOC_FORMATS)[number]['id']
