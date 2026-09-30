/** Everything on the canvas bar, as data: the icon, the words and the key.
 *
 *  One icon set for the whole app. These are Lucide's, the same ones the spaces
 *  and the file list are drawn with, so the plane does not arrive wearing a
 *  second set of hand-drawn shapes that drift a little further from the rest of
 *  the interface every time one of them is redrawn. Each is an icon node, which
 *  is a list of tags and attributes; `CanvasIcon.svelte` draws one.
 *
 *  The words are thunks rather than strings, so a language chosen after this
 *  module loaded is the one they answer in. Each carries the id of the shortcut
 *  that does the same thing, which is where the key in the tooltip comes from:
 *  the bar teaches the keyboard, and neither of them holds a key of its own. */

import ArrowUpRight from 'lucide/dist/esm/icons/arrow-up-right.mjs'
import Brush from 'lucide/dist/esm/icons/brush.mjs'
import Circle from 'lucide/dist/esm/icons/circle.mjs'
import Copy from 'lucide/dist/esm/icons/copy.mjs'
import CornerDownRight from 'lucide/dist/esm/icons/corner-down-right.mjs'
import Diamond from 'lucide/dist/esm/icons/diamond.mjs'
import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
import Eraser from 'lucide/dist/esm/icons/eraser.mjs'
import Feather from 'lucide/dist/esm/icons/feather.mjs'
import FileText from 'lucide/dist/esm/icons/file-text.mjs'
import Frame from 'lucide/dist/esm/icons/frame.mjs'
import GripVertical from 'lucide/dist/esm/icons/grip-vertical.mjs'
import Group from 'lucide/dist/esm/icons/group.mjs'
import Hand from 'lucide/dist/esm/icons/hand.mjs'
import Highlighter from 'lucide/dist/esm/icons/highlighter.mjs'
import Image from 'lucide/dist/esm/icons/image.mjs'
import Lasso from 'lucide/dist/esm/icons/lasso.mjs'
import Link2 from 'lucide/dist/esm/icons/link-2.mjs'
import Minus from 'lucide/dist/esm/icons/minus.mjs'
import MousePointer2 from 'lucide/dist/esm/icons/mouse-pointer-2.mjs'
import Paintbrush from 'lucide/dist/esm/icons/paintbrush.mjs'
import PenLine from 'lucide/dist/esm/icons/pen-line.mjs'
import PenTool from 'lucide/dist/esm/icons/pen-tool.mjs'
import Pencil from 'lucide/dist/esm/icons/pencil.mjs'
import Plus from 'lucide/dist/esm/icons/plus.mjs'
import Pointer from 'lucide/dist/esm/icons/pointer.mjs'
import Redo2 from 'lucide/dist/esm/icons/redo-2.mjs'
import Ruler from 'lucide/dist/esm/icons/ruler.mjs'
import Shapes from 'lucide/dist/esm/icons/shapes.mjs'
import Slash from 'lucide/dist/esm/icons/slash.mjs'
import Square from 'lucide/dist/esm/icons/square.mjs'
import StickyNote from 'lucide/dist/esm/icons/sticky-note.mjs'
import Trash2 from 'lucide/dist/esm/icons/trash-2.mjs'
import Triangle from 'lucide/dist/esm/icons/triangle.mjs'
import Undo2 from 'lucide/dist/esm/icons/undo-2.mjs'
import Ungroup from 'lucide/dist/esm/icons/ungroup.mjs'
import type { IconNode } from 'lucide'

import { type InkTool } from './format'
import { type Tool } from './pointer'
import { t } from '../i18n.svelte'
import { titled } from '../titled'

/** One button on the bar. */
export interface Mark {
  icon: IconNode
  /** Read out, and shown on a hover. */
  title: () => string
  /** The shortcut that does the same thing, or nothing where no key does. */
  key: string | null
}

/** A button that puts a tool in your hand. */
export interface ToolMark extends Mark {
  id: Tool
}

/** What a hover says: the name, and the key that does the same thing, in the words
 *  every other button in the app says it with; see titled.ts. This is how the bar
 *  teaches the keyboard: somebody reads "Rectangle (R)" once, and after that the
 *  button is there for the times their hand is on the glass rather than on the keys. */
export function hinted(mark: Pick<Mark, 'title' | 'key'>): string {
  return titled(mark.title(), mark.key)
}

/** Getting about the plane: the arrow, and the hand that moves it. */
export const ABOUT: ToolMark[] = [
  {
    id: 'select',
    icon: MousePointer2,
    title: () => t('Select'),
    key: 'canvas.tool.select',
  },
  { id: 'hand', icon: Hand, title: () => t('Pan'), key: 'canvas.tool.hand' },
]

/** The two tools the pens are used with. */
export const RUBBING: ToolMark[] = [
  { id: 'erase', icon: Eraser, title: () => t('Erase'), key: 'canvas.tool.erase' },
  { id: 'lasso', icon: Lasso, title: () => t('Lasso'), key: 'canvas.tool.lasso' },
]

/** What a press puts on the plane, in the order the grid shows them: the five
 *  things a note taker puts down, then the four bodies, then the three lines.
 *
 *  A note and a picture are two entries and not one. They were one, which meant
 *  somebody who wanted a photograph on the plane was asked which note to embed;
 *  they are different things to want, they come from different places, and one of
 *  them was unreachable. */
export const PLACING: ToolMark[] = [
  { id: 'text', icon: StickyNote, title: () => t('Card'), key: 'canvas.tool.text' },
  { id: 'file', icon: FileText, title: () => t('Note'), key: 'canvas.tool.file' },
  { id: 'picture', icon: Image, title: () => t('Picture'), key: 'canvas.tool.picture' },
  { id: 'link', icon: Link2, title: () => t('Link'), key: 'canvas.tool.link' },
  { id: 'group', icon: Frame, title: () => t('Frame'), key: 'canvas.tool.group' },
  { id: 'rect', icon: Square, title: () => t('Rectangle'), key: 'canvas.tool.rect' },
  { id: 'ellipse', icon: Circle, title: () => t('Oval'), key: 'canvas.tool.ellipse' },
  { id: 'rhombus', icon: Diamond, title: () => t('Diamond'), key: 'canvas.tool.rhombus' },
  { id: 'triangle', icon: Triangle, title: () => t('Triangle'), key: 'canvas.tool.triangle' },
  { id: 'line', icon: Slash, title: () => t('Line'), key: 'canvas.tool.line' },
  { id: 'arrow', icon: ArrowUpRight, title: () => t('Arrow'), key: 'canvas.tool.arrow' },
  { id: 'elbow', icon: CornerDownRight, title: () => t('Elbow'), key: 'canvas.tool.elbow' },
]

/** A nib each. Seven pens are seven objects rather than seven scribbles, so each
 *  one is the icon of the instrument it is. */
export const PEN_ICONS: Record<InkTool, IconNode> = {
  pen: PenLine,
  fountain: PenTool,
  pencil: Pencil,
  marker: Paintbrush,
  highlighter: Highlighter,
  brush: Brush,
  calligraphy: Feather,
}

/** What each pen is called. Beside its icon in the pen's own panel, because a
 *  drawing of a nib and a drawing of a broad nib are two pictures of one thing
 *  and the word is what tells them apart. */
export const PEN_NAMES: Record<InkTool, () => string> = {
  pen: () => t('Pen'),
  fountain: () => t('Fountain pen'),
  pencil: () => t('Pencil'),
  marker: () => t('Marker'),
  highlighter: () => t('Highlighter'),
  brush: () => t('Brush'),
  calligraphy: () => t('Calligraphy'),
}

/** Everything on the bar that is not a tool: the two arrows, the zoom, the
 *  handful of marks the panels and the selection use. */
export const MARKS = {
  undo: Undo2,
  redo: Redo2,
  zoomOut: Minus,
  zoomIn: Plus,
  /** What a press puts on the plane, as one button with a grid behind it. */
  put: Shapes,
  /** The rest of what can be done, which is the menu everything else opens. */
  rest: Ellipsis,
  copy: Copy,
  bin: Trash2,
  /** Several things made one, and taken apart again. */
  group: Group,
  ungroup: Ungroup,
  /** The bar itself: dragged to an edge, pressed to fold away. */
  grip: GripVertical,
  /** A stroke tidied into the line, ring or box it was aiming at. */
  straight: Ruler,
  /** Whether a finger draws on a device that also has a pen. */
  finger: Pointer,
} as const
