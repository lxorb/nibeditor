/** What the app needs to know about blocks: which one a press landed in, and
 *  everything a menu row does to it - to one of them or to every one a selection
 *  lies across, which is the same list either way. */

export {
  blocksFor,
  blockTarget,
  blockTargets,
  deleteBlocks,
  duplicateBlocks,
  indentBlocks,
  moveBlocks,
  outdentBlocks,
  turnBlocksInto,
} from './commands'
export type { BlockShape } from './shape'
export { blockAt, type BlockKind, type BlockSpan } from './span'
