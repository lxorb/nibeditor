/** Everything line-door.ts fetches, as the one module it asks for: the commands, and
 *  the rule that makes a link of words an address is pasted over. */

export { lowerCase, titleCase, upperCase } from './case'
export { expandSelection, shrinkSelection } from './grow'
export { deleteLine, insertLineAbove, joinLines, reverseLines, sortLines } from './lines'
export { linkedPaste } from './paste-link'
