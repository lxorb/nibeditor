/** The front-matter keys the app has a fixed set of answers for, so a property row
 *  offers a menu rather than a field somebody has to spell something into.
 *
 *  Only keys the app itself writes and reads, and only where the set really is
 *  fixed: a colour nib does not draw is not a colour, and a paper size no printer
 *  has is not a size. Everything else is anybody's to write, which is what a note's
 *  metadata mostly is - a tag, a title, a date.
 *
 *  Here rather than in the editor package, because which answers are fixed is the
 *  app's business: the accents are accents.ts, the paper is page-setup.ts, and the
 *  editor knows about neither. Handed over when a view is built; see
 *  `propertyChoices` in @nib/editor. */

import { ACCENTS } from './accents'
import { ICON_COLOUR_KEY } from './icons'
import { ORIENTATIONS, PAPER_SIZES } from './page-setup'

export const PROPERTY_CHOICES: Record<string, readonly string[]> = {
  [ICON_COLOUR_KEY]: ACCENTS.map((one) => one.id),
  // The two nib's own `export:` page setup names. Written at the top level as well
  // as under `export:` by notes that came from Typora, and a row is a row either
  // way; the nested pairs of a map are chips and stay chips, because what a key two
  // deep means belongs to whoever wrote it.
  paper: PAPER_SIZES,
  orientation: ORIENTATIONS,
}
