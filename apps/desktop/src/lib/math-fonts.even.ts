import type * as Real from './math-fonts'

/** The plugin's twin of math-fonts.ts, which bakes every KaTeX face into a document
 *  that is written out as a file. The plugin writes no file - a WebView cannot save
 *  one, and the exporters are not here - so it carries none of the faces: 300 KB of
 *  base64, fetched by the settings at every launch for a question about pandoc. A
 *  document asked for anyway carries no maths sheet, which is what the real one does
 *  for a page with no equation. */
export const mathCss: typeof Real.mathCss = () => ''
