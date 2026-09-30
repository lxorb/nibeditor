/** What the app needs to know about blocks before anything is pressed: which one a
 *  position is in. Everything a menu row does to one - or to every one a selection
 *  lies across, which is the same list either way - is in ./commands, and reaches the
 *  app through `@nib/editor/menu` with the menu that offers it; see menu.ts. */

export type { BlockShape } from './shape'
export { blockAt, type BlockKind, type BlockSpan } from './span'
