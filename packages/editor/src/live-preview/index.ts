import type { Extension } from '@codemirror/state'
import { aiExtension } from '../ai/run'
import { blockDecorations } from './blocks'
import { livePreviewDecorations } from './decorate'
import { dragFreeze } from './dragging'
import { hiddenFrontMatterGuard } from './hidden-front-matter'
import { imageExtension } from './image'
import { runExtension } from '../run/run'
import { pointerSnap } from './snap'

/** Hides markdown syntax until the caret enters the construct that owns it.
 *  The document text is never rewritten - only what you see changes. */
export function livePreview(): Extension {
  // The run panels live here too, so switching to source mode takes them away
  // with everything else that is rendered rather than written. The `ai` blocks'
  // questions are here for the same reason: the glyph that asks one is part of a
  // fence's drawn header, so source mode has nothing to press.
  return [
    aiExtension,
    dragFreeze,
    pointerSnap,
    livePreviewDecorations,
    blockDecorations,
    hiddenFrontMatterGuard,
    imageExtension,
    runExtension,
  ]
}

export { blockDecorations }
