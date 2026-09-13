/** What each of the three answers about a note's front matter is called.
 *
 *  Here rather than beside the type in @nib/markdown, for the reason every other
 *  word in the app is: a package that renders markdown has no dictionary, and the
 *  three words are shown by the settings row and by the palette. Keys for `t()`,
 *  translated in every catalogue. */

import type { PropertiesMode } from '@nib/markdown/properties'
import { key } from './i18n.svelte'

export const PROPERTIES_WORDS: Record<PropertiesMode, string> = {
  properties: key('Properties'),
  source: key('Source'),
  hidden: key('Hidden'),
}
