import katex from 'katex/dist/katex.min.css?raw'
import base from './base.css?raw'
import note from './document.css?raw'
import exported from './export.css?raw'
import stage from './slides.css?raw'
import tokens from './tokens.css?raw'

/** Every sheet the app writes out rather than wears, in one module - which is what
 *  keeps it out of a launch. A bundler chunks by module, so anything that imports one
 *  of these exports has imported all the text below; that is fine for an export, a
 *  deck or a theme card, which are all asked for by a reader and all behind a dynamic
 *  import. It would not be fine for the shell, so the one sheet the shell needs is in
 *  contrast.ts beside this and not in here. See test/weight.test.ts.
 *
 *  Relative `?raw` imports resolve reliably; the same imports made through the
 *  package's exports map from another package come back empty.
 *
 *  The stylesheet as text, for baking into an exported document. */
export const themeCss = [tokens, base].join('\n')

/** The tokens alone. The theme gallery re-scopes the scheme-independent blocks
 *  of these onto its miniatures: the Typora aliases are written in terms of
 *  other tokens, and a custom property is substituted where it is declared, so
 *  without this a miniature's code block would take its colour from the app's
 *  palette rather than from the theme's. */
export const tokensCss = tokens

/** What an exported document needs on top of the theme: the constructs only the
 *  renderer makes (document.css, which the app loads too, so the reading view
 *  and the export are one thing rather than two that look alike), a page instead
 *  of an app around the text, and how it prints. */
export const exportCss = [note, exported].join('\n')

/** Everything that dresses a note, without the app around it. The theme
 *  gallery re-scopes these onto its miniatures, so a card is drawn by the same
 *  rules as the page it is a miniature of rather than by a second set written
 *  to look like them. */
export const proseCss = [base, note].join('\n')

/** The room a note is presented in, on top of the prose sheets: the stage, the
 *  progress line and the counter. The app loads it with everything else, and a
 *  deck written out as a file or served from a published note carries it, so all
 *  three show the same slide. */
export const slidesCss = stage

/** KaTeX's own stylesheet. Its fonts are referenced by relative path, which
 *  an export resolves before writing the file. */
export const katexCss = katex
