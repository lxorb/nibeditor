import type { Extension } from '@codemirror/state'
import { modifierWatch } from '../links'
import { noteClicks } from './follow'
import { notePreviews } from './hover'

/** Links between notes, Obsidian's way.
 *
 *  `[[Note]]`, `[[Note|shown text]]`, `[[Note#Heading]]`, `[[Note#^blockid]]`,
 *  `![[Note]]` to show the note itself, and `![[picture.png]]` to show a
 *  picture. A note moves between Orden and Obsidian unchanged, which is the whole
 *  reason for the spelling.
 *
 *  Which part is where:
 *
 *  - The grammar is not here at all. It lives in `@nib/markdown/links`, because
 *    the renderer, the app and the sync service read the same links, and four
 *    readings of one grammar would drift.
 *  - markdown/constructs.ts teaches the parser to see one, so a wikilink is a
 *    node like any other construct.
 *  - notes.ts holds what the app tells the editor about the space, and works out
 *    which note a name means.
 *  - at.ts reads a link out of the document; live-preview/decorate.ts draws it,
 *    and live-preview/blocks.ts draws an embed that has a line to itself.
 *  - follow.ts is the modifier-click, complete.ts the `[[` popup, embed.ts what
 *    an embed looks like, hover.ts the preview, preview.ts the HTML both of
 *    those show.
 *
 *  Everything the editor cannot know - which notes exist, what one says, what
 *  opening a note means - arrives through a facet the app fills in. */
export function wikilinks(): Extension {
  return [modifierWatch, noteClicks, notePreviews]
}
