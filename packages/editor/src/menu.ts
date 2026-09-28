/** What the app's right-click menu over a note asks of the editor: the link a press
 *  landed on and the two edits it offers, and the picture a press landed on and what
 *  can be done with it.
 *
 *  A door of its own rather than a line in the index, because the index is in front of
 *  the first paint and nothing here is: the menu that asks is fetched at the launch's
 *  last turn, and this arrives with it. See editor-menu.ts in the app. */

export { editLink, linkPartsAt, removeLink } from './link-edit'
export {
  deletePicture,
  pictureUrl,
  pressedPicture,
  showPicture,
} from './live-preview/image/pressed'
