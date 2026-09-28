/** Everything line-door.ts fetches, as the one module it asks for: the commands, the
 *  three a block is duplicated and moved with from a key, and the rule that makes a
 *  link of words an address is pasted over. */

export { duplicateBlock, moveBlockDown, moveBlockUp } from './block/commands'
export { lowerCase, titleCase, upperCase } from './case'
export { expandSelection, shrinkSelection } from './grow'
export { deleteLine, insertLineAbove, joinLines, reverseLines, sortLines } from './lines'
export { linkedPaste } from './paste-link'
