/** Everything a canvas can be asked to do, in one place.
 *
 *  A gesture, a key and a menu row are three ways of asking for the same thing,
 *  and this is the thing. The surface next door owns the pointer and the layers;
 *  what happens when something is deleted, duplicated, lined up, coloured or
 *  turned into a note is here, once, so the three ways cannot drift apart.
 *
 *  Everything takes the store and hands nothing back. What is picked, what the
 *  canvas holds and what can be taken back all live there; these are verbs. */

import { type Alignment, aligned, distributed, type Order, ordered } from './arrange'
import {
  connected,
  copied,
  coloured,
  cutInk,
  grouped,
  movedBy,
  pasted,
  placedAt,
  reattached,
  removed,
  ungrouped,
  withEnds,
  withGroup,
  withLabel,
  withNode,
  withShape,
  withStroke,
} from './edits'
import {
  type Canvas,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  freshId,
  isShape,
  type Shape,
  type Side,
} from './format'
import { type Box, boxOf, facingSide, GRID, type Point, rectBetween } from './geometry'
import { erased, INK_STYLES, nearStroke, strokesInLasso, tidied } from './ink'
import type { Palette } from './paint'
import type { Hit, PendingStroke, PutTool, Tool } from './pointer'
import type { CanvasStore } from './store.svelte'
import { tools } from './tools.svelte'
import { pickPictures } from './upload'
import { shortcuts } from '../shortcuts.svelte'
import { storeImage } from '../assets'
import { t, key } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu.svelte'
import { prompt } from '../prompt.svelte'
import { folderOf, insideSpace, relativeTo } from '../space-paths'
import { openHref } from '../open-link'
import { workspace } from '../workspace.svelte'

/** How far a nudge moves a card: one pixel with a bare arrow key, one grid step
 *  with Shift, which is the pair every drawing program has. */
const NUDGE = 1

export const run = {
  connect(
    store: CanvasStore,
    from: string,
    fromSide: Side,
    to: string,
    toSide: Side | 'auto',
    head = true,
  ) {
    const target = store.canvas.nodes.find((node) => node.id === to)
    const source = store.canvas.nodes.find((node) => node.id === from)
    if (!target || !source) return

    const side = toSide === 'auto' ? facingSide(boxOf(target), boxOf(source)) : toSide
    const made = connected(store.canvas, from, fromSide, to, side, head)
    store.edit(made.canvas)
    if (made.id) store.pick(made.id)
  },

  /** One end of a connector dropped on another card. */
  reattach(store: CanvasStore, edge: string, end: 'from' | 'to', to: string) {
    store.edit(reattached(store.canvas, edge, end, to))
  },

  shape(store: CanvasStore, shape: Shape, from: Point, to: Point, colour: string) {
    const made = withShape(store.canvas, shape, from, to, colour === 'ink' ? undefined : colour)
    store.edit(made.canvas)
    store.pick(made.id)
  },

  /** Everything picked inside one frame, and that frame picked. */
  group(store: CanvasStore) {
    if (store.picked.length < 1) return

    const made = grouped(store.canvas, store.picked)
    if (!made.id) return

    store.edit(made.canvas)
    store.pick(made.id)
  },

  /** The frames among what is picked, gone, and what they held picked instead. */
  ungroup(store: CanvasStore) {
    const made = ungrouped(store.canvas, store.picked)
    if (!made.ids.length && made.canvas === store.canvas) return

    store.edit(made.canvas)
    store.pickAll(made.ids)
  },

  /** A copy left exactly where what is picked stands, so the originals can be
   *  dragged off it. `run` is the drag it belongs to, so the copy and the move it
   *  begins are one thing to take back.  */
  leaveCopy(store: CanvasStore, run: string) {
    if (!store.picked.length) return

    const made = copied(store.canvas, store.picked, 0, 0)
    store.edit(made.canvas, run)
  },

  /** The words inside whatever is picked, if it is something that holds words. */
  write(store: CanvasStore): boolean {
    const id = store.picked[0]
    const node = store.canvas.nodes.find((one) => one.id === id)
    if (!node || (node.type !== 'text' && node.type !== 'shape')) return false

    store.editing = node.id
    return true
  },

  /** A stroke of ink, tidied on the way in: a digitiser reports far more points
   *  than a line needs, and the ones it drops are the ones that say nothing. */
  stroke(store: CanvasStore, pending: PendingStroke) {
    // One point is a dot, which is a stroke like any other. None at all is
    // nothing, and cannot happen: a stroke starts at the point the pen went down.
    if (!pending.points.length) return

    // The alpha is written down only where it is not the one this kind of pen has
    // by itself, so a plane drawn by somebody who never touched the dial is the
    // same bytes it was before there was a dial.
    const { opacity, ...rest } = pending
    const own = INK_STYLES[pending.tool].opacity
    const stroke = { id: freshId(), ...rest, ...(opacity === own ? {} : { opacity }) }

    store.edit(withStroke(store.canvas, tidied(stroke)))
  },

  /** Every stroke on the plane, gone, which is what the eraser's own row asks
   *  for. One edit, so one press of undo brings the drawing back. */
  eraseAll(store: CanvasStore) {
    if (!store.canvas.ink.length) return

    store.edit({ ...store.canvas, ink: [] })
  },

  /** Whole strokes gone, which is what the stroke eraser does: touch a line
   *  anywhere and the line goes. `run` names the drag it is part of, so the whole
   *  drag is one step to take back; see `edit` in store.svelte.ts. */
  rub(store: CanvasStore, ids: readonly string[], run?: string) {
    if (!ids.length) return

    const going = new Set(ids)
    store.edit({ ...store.canvas, ink: store.canvas.ink.filter((one) => !going.has(one.id)) }, run)
  },

  /** A hole rubbed through whatever is under the eraser, which may leave the two
   *  ends of a line behind. Every point of the drag is one of these, so the plane
   *  answers under the nib rather than when it is lifted, and all of them are one
   *  rub. */
  cut(store: CanvasStore, at: Point, reach: number, run?: string) {
    const next = cutInk(store.canvas, (stroke) =>
      nearStroke(stroke, at, reach) ? erased(stroke, at, reach) : [stroke],
    )

    store.edit(next, run)
  },

  /** What a loop or a box caught. Only strokes it went right round, so half a word
   *  is never dragged away from the other half, unless the lasso's own panel says
   *  a stroke it touched at all counts. */
  lasso(store: CanvasStore, points: readonly Point[], partly = false) {
    store.pickAll(strokesInLasso(store.canvas.ink, points, partly))
  },

  remove(store: CanvasStore) {
    if (!store.picked.length) return

    store.edit(removed(store.canvas, store.picked))
    store.clearPicked()
  },

  duplicate(store: CanvasStore) {
    if (!store.picked.length) return

    const made = copied(store.canvas, store.picked)
    store.edit(made.canvas)
    store.pickAll(made.ids)
  },

  nudge(store: CanvasStore, dx: number, dy: number) {
    if (!store.picked.length) return

    store.edit(movedBy(store.canvas, store.picked, dx, dy))
  },

  align(store: CanvasStore, how: Alignment) {
    store.edit(aligned(store.canvas, store.picked, how))
  },

  distribute(store: CanvasStore, axis: 'x' | 'y') {
    store.edit(distributed(store.canvas, store.picked, axis))
  },

  order(store: CanvasStore, how: Order) {
    store.edit(ordered(store.canvas, store.picked, how))
  },

  colour(store: CanvasStore, colour: string | null) {
    if (!store.picked.length) return

    store.edit(coloured(store.canvas, store.picked, colour))
  },

  /** Which way the arrows on the picked connectors point. */
  ends(store: CanvasStore, from: boolean, to: boolean) {
    store.edit(withEnds(store.canvas, store.picked, from, to))
  },

  /** Cards from a clipboard: another canvas, an address, or some words. */
  paste(store: CanvasStore, incoming: Canvas, text: string, at: Point) {
    if (incoming.nodes.length || incoming.ink.length) {
      // Centred on the pointer, so a paste lands where the reader is looking
      // rather than where the cards happened to be in the canvas they came from.
      const box = spanOf(incoming)
      const dx = box ? Math.round(at.x - box.x - box.width / 2) : 0
      const dy = box ? Math.round(at.y - box.y - box.height / 2) : 0
      const made = pasted(store.canvas, incoming, dx, dy)

      store.edit(made.canvas)
      store.pickAll(made.ids)
      return
    }

    if (/^[a-z][a-z\d+.-]*:\/\//i.test(text)) {
      putLink(store, text, placedAt(at, DEFAULT_WIDTH, GRID * 4))
    } else {
      putText(store, text, placedAt(at, DEFAULT_WIDTH, DEFAULT_HEIGHT))
    }
  },

  /** Notes and pictures dragged out of the file list. Several of them go one
   *  under the other, which is where a hand dropping a folder's worth would put
   *  them anyway. */
  dropPaths(store: CanvasStore, paths: readonly string[], at: Point) {
    const root = workspace.activeSpace?.root
    if (!root) return

    let next = store.canvas
    const ids: string[] = []

    for (const [index, path] of paths.entries()) {
      const id = freshId()
      const box = placedAt({ x: at.x, y: at.y + index * GRID * 10 }, DEFAULT_WIDTH, GRID * 9)
      next = withNode(next, { ...box, id, type: 'file', file: relativeTo(root, path) })
      ids.push(id)
    }

    store.edit(next)
    store.pickAll(ids)
  },

  /** A picture pasted or dropped: stored where every other pasted picture goes,
   *  and put on the plane as a card of its own. */
  async dropImage(store: CanvasStore, file: File, where: Point | Box, notePath: string | null) {
    const stored = await storeImage(file, notePath).catch(() => null)
    if (!stored) return

    const root = workspace.activeSpace?.root
    const relative = root && !stored.startsWith('http') ? relativeTo(root, stored) : stored
    const size = ownSize('picture')
    // A box says exactly where and how big; a point is a paste or a drop, which is
    // centred on it at the size a picture starts at.
    const box = 'width' in where ? where : placedAt(where, size.width, size.height)

    putFile(store, relative, box)
  },

  /** What a double click means, wherever it landed. */
  async open(store: CanvasStore, hit: Hit, at: Point) {
    if (hit.edge) {
      await askLabel(store, hit.edge)
      return
    }

    const node = hit.node ? store.canvas.nodes.find((one) => one.id === hit.node) : null

    if (!node) {
      putText(store, '', placedAt(at, DEFAULT_WIDTH, DEFAULT_HEIGHT), true)
      return
    }

    switch (node.type) {
      case 'text':
        store.pick(node.id)
        store.editing = node.id
        break
      case 'group':
        await askLabel(store, node.id)
        break
      // A card on a plane holding an address is the reader's own content, so opening
      // one opens the page here rather than handing them to another browser - the
      // same answer a link in a note gets; see open-link.ts.
      case 'link':
        openHref(node.url)
        break
      case 'file': {
        const root = workspace.activeSpace?.root
        if (root) await workspace.openEntry(insideSpace(root, node.file))
        break
      }
      // A shape holds words the way a card does, so opening one opens the words.
      case 'shape':
        store.pick(node.id)
        store.editing = node.id
        break
      // A page is never on a canvas, and on a page note a double press on the paper
      // is a press on the paper: there is nothing to open.
      case 'page':
        break
    }
  },

  /** A card that has outgrown its box, as a note beside the canvas, with the
   *  card left behind pointing at it. */
  async toNote(store: CanvasStore, canvasPath: string | null) {
    const id = store.picked[0]
    const node = store.canvas.nodes.find((one) => one.id === id)
    if (node?.type !== 'text' || !node.text.trim()) return

    const root = workspace.activeSpace?.root
    const folder = canvasPath === null ? root : folderOf(canvasPath)
    const path = await workspace.noteFrom(node.text, folder ?? undefined)
    if (!path || !root) return

    store.edit({
      ...store.canvas,
      nodes: store.canvas.nodes.map((one) =>
        one.id === node.id
          ? {
              id: one.id,
              type: 'file',
              x: one.x,
              y: one.y,
              width: one.width,
              height: one.height,
              file: relativeTo(root, path),
              ...(one.color === undefined ? {} : { color: one.color }),
            }
          : one,
      ),
    })
  },

  /** The keys the plane answers to on its own. Answers whether it took the key,
   *  so the surface knows whether to stop it going anywhere else.
   *
   *  Every one of them is in the shortcut registry, so a reader who rebound one
   *  has their own key here and can see the whole list in the settings. They are
   *  marked contextual there, which is what lets a plane hold a bare letter and
   *  the arrows without being a clash with anything the file list holds. */
  keys(store: CanvasStore, event: KeyboardEvent, view: KeyView): boolean {
    const tool = toolPressed(event)
    if (tool) {
      tools.choose(tool)
      return true
    }

    // Shift makes a nudge a grid step, which is the pair every drawing program
    // has. The key itself is the registry's; the modifier is what it means.
    const step = event.shiftKey ? GRID : NUDGE
    const nudge = NUDGES.find(([id]) => shortcuts.pressed(id, event))
    if (nudge) {
      if (!store.picked.length) return false

      run.nudge(store, nudge[1] * step, nudge[2] * step)
      return true
    }

    if (
      shortcuts.pressed('canvas.delete', event) ||
      shortcuts.pressed('canvas.delete.alt', event)
    ) {
      if (!store.picked.length) return false

      run.remove(store)
      return true
    }

    for (const [id, act] of ACTS) {
      if (!shortcuts.pressed(id, event)) continue

      // A key that turned out to have nothing to act on is not a key the plane
      // took: Enter with nothing picked belongs to whatever else wants it.
      return act(store, view) !== false
    }

    return false
  },
}

/** The tool a key asks for, or null where this key is not one of them.
 *
 *  Exported because a page note answers the same keys with the same hand: the bar
 *  teaches the keyboard, and it is one bar. It takes the five that mean something on
 *  paper and leaves the rest; see Pages.svelte. One table either way, so a reader who
 *  rebound Draw has their own key on both surfaces. */
export function toolPressed(event: KeyboardEvent): Tool | null {
  return TOOL_KEYS.find(([id]) => shortcuts.pressed(id, event))?.[1] ?? null
}

/** Which tool each key puts in your hand. */
const TOOL_KEYS: readonly (readonly [string, Tool])[] = [
  ['canvas.tool.select', 'select'],
  ['canvas.tool.hand', 'hand'],
  ['canvas.tool.draw', 'draw'],
  ['canvas.tool.erase', 'erase'],
  ['canvas.tool.lasso', 'lasso'],
  ['canvas.tool.text', 'text'],
  ['canvas.tool.file', 'file'],
  ['canvas.tool.picture', 'picture'],
  ['canvas.tool.link', 'link'],
  ['canvas.tool.group', 'group'],
  ['canvas.tool.rect', 'rect'],
  ['canvas.tool.ellipse', 'ellipse'],
  ['canvas.tool.rhombus', 'rhombus'],
  ['canvas.tool.triangle', 'triangle'],
  ['canvas.tool.line', 'line'],
  ['canvas.tool.arrow', 'arrow'],
  ['canvas.tool.elbow', 'elbow'],
]

/** Which way each nudge goes. */
const NUDGES: readonly (readonly [string, number, number])[] = [
  ['canvas.nudge.left', -1, 0],
  ['canvas.nudge.right', 1, 0],
  ['canvas.nudge.up', 0, -1],
  ['canvas.nudge.down', 0, 1],
]

/** Everything else a key does, by the id it is bound to. */
/** What each key does, and whether it turned out to have anything to do: a row that
 *  answers `false` is a key the plane did not take, so Enter with nothing picked
 *  belongs to whatever else wants it. Everything else answers nothing at all. */
const ACTS: readonly (readonly [string, (store: CanvasStore, view: KeyView) => unknown])[] = [
  ['canvas.duplicate', (store) => run.duplicate(store)],
  ['canvas.write', (store) => run.write(store)],
  ['canvas.group', (store) => run.group(store)],
  ['canvas.ungroup', (store) => run.ungroup(store)],
  ['canvas.fit', (store, view) => store.fit(view.width, view.height)],
  ['canvas.frame', (store, view) => store.frame(view.width, view.height)],
  ['canvas.find', (_store, view) => view.onfind()],
  ['canvas.front', (store) => run.order(store, 'front')],
  ['canvas.forward', (store) => run.order(store, 'forward')],
  ['canvas.back', (store) => run.order(store, 'back')],
  ['canvas.backward', (store) => run.order(store, 'backward')],
]

export interface KeyView {
  width: number
  height: number
  path: string | null
  name: string
  palette: Palette
  onfind: () => void
}

function spanOf(canvas: Canvas) {
  const [first] = canvas.nodes
  if (!first) return null

  let least = first.x
  let most = first.x + first.width
  let lowest = first.y
  let highest = first.y + first.height

  for (const node of canvas.nodes) {
    least = Math.min(least, node.x)
    most = Math.max(most, node.x + node.width)
    lowest = Math.min(lowest, node.y)
    highest = Math.max(highest, node.y + node.height)
  }

  return { x: least, y: lowest, width: most - least, height: highest - lowest }
}

function putText(store: CanvasStore, text: string, box: Box, writing = false) {
  const id = freshId()
  store.edit(withNode(store.canvas, { ...box, id, type: 'text', text }))
  store.pick(id)
  // A card made by hand is a card somebody is about to write in.
  if (writing) store.editing = id
}

function putLink(store: CanvasStore, url: string, box: Box) {
  const id = freshId()
  store.edit(withNode(store.canvas, { ...box, id, type: 'link', url }))
  store.pick(id)
}

function putFile(store: CanvasStore, file: string, box: Box) {
  const id = freshId()
  store.edit(withNode(store.canvas, { ...box, id, type: 'file', file }))
  store.pick(id)
}

async function askLabel(store: CanvasStore, id: string) {
  const node = store.canvas.nodes.find((one) => one.id === id)
  const was =
    node?.type === 'group'
      ? (node.label ?? '')
      : (store.canvas.edges.find((one) => one.id === id)?.label ?? '')

  const answer = await prompt.ask({ title: t('Name this'), value: was, confirmLabel: key('Save') })
  if (answer !== null) store.edit(withLabel(store.canvas, id, answer))
}

/** How big each thing is when it is pressed rather than dragged out: a card wide
 *  enough to read a line in, a frame with room for a handful of cards, a shape big
 *  enough to grab. Dragging says otherwise, and then this is not asked. */
function ownSize(tool: PutTool): { width: number; height: number } {
  // Every shape starts at the same size, which is big enough to grab and small enough
  // that a hand that meant to drag one out sees at once that it did not.
  if (isShape(tool)) return { width: GRID * 6, height: GRID * 4 }

  switch (tool) {
    case 'text':
      return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
    case 'file':
      return { width: DEFAULT_WIDTH, height: GRID * 9 }
    case 'picture':
      return { width: GRID * 16, height: Math.round(GRID * 16 * 0.7) }
    case 'link':
      return { width: DEFAULT_WIDTH, height: GRID * 4 }
    case 'group':
      return { width: GRID * 20, height: GRID * 12 }
  }
}

/** What the surface has to say for something to be put down: the colour the next
 *  one gets, and where this canvas lives, which is what a picture is stored beside. */
export interface Putting {
  colour: string
  path: string | null
}

/** What a tool puts on the plane where it was pressed, at its own size. */
export async function place(store: CanvasStore, tool: PutTool, at: Point, putting: Putting) {
  const size = ownSize(tool)
  await putDown(store, tool, placedAt(at, size.width, size.height), putting)
}

/** What a tool puts on the plane at the size it was dragged out to. The one
 *  difference from a press: the box came from the hand rather than from the table
 *  above, and a line remembers which way round it was drawn. */
export async function pull(
  store: CanvasStore,
  tool: PutTool,
  from: Point,
  to: Point,
  putting: Putting,
) {
  await putDown(store, tool, rectBetween(from, to), putting, from, to)
}

/** One thing on the plane in one box, whichever kind of thing it is.
 *
 *  Here rather than twice over, because a press and a drag differ only in where the
 *  box came from: a picture asks for a picture either way, a link asks for an
 *  address either way, and a card is a card. */
async function putDown(
  store: CanvasStore,
  tool: PutTool,
  box: Box,
  putting: Putting,
  from?: Point,
  to?: Point,
) {
  if (isShape(tool)) {
    const corner = from ?? { x: box.x, y: box.y }
    const other = to ?? { x: box.x + box.width, y: box.y + box.height }
    run.shape(store, tool, corner, other, putting.colour)
    return
  }

  switch (tool) {
    case 'text':
      putText(store, '', box, true)
      return
    case 'group': {
      const id = freshId()
      store.edit(withGroup(store.canvas, { ...box, id, type: 'group' }))
      store.pick(id)
      return
    }
    case 'link': {
      const url = await prompt.ask({
        title: t('Which address'),
        placeholder: t('Address'),
        confirmLabel: key('Add'),
      })
      if (url) putLink(store, url, box)
      return
    }
    case 'file': {
      const root = workspace.activeSpace?.root
      if (!root) return

      const chosen = await prompt.find({
        title: t('Which note'),
        placeholder: t('Search'),
        options: workspace.files.map((one) => {
          const relative = relativeTo(root, one.path)
          return { id: relative, label: relative }
        }),
      })

      if (chosen) putFile(store, chosen, box)
      return
    }
    case 'picture': {
      // The system's own picker, which on Android is the gallery and the camera;
      // see canvas/upload.ts.
      const [file] = await pickPictures()
      if (!file) return

      await run.dropImage(store, file, box, putting.path)
      return
    }
  }
}

export interface MenuView extends KeyView {
  narrowed: boolean
  onnarrow: () => void
}

/** The menu, which is the whole of what a canvas can do, written down. What a
 *  reader cannot find a key for they find here. */
export function canvasMenu(store: CanvasStore, at: Point, view: MenuView): MenuEntry[] {
  const picked = store.picked.length > 0
  const several = store.picked.length > 1
  const many = store.picked.length > 2
  const onEdge = store.picked.some((id) => store.canvas.edges.some((edge) => edge.id === id))
  const onCard =
    store.picked.length === 1 &&
    store.canvas.nodes.find((one) => one.id === store.picked[0])?.type === 'text'
  const onFrame = store.picked.some((id) =>
    store.canvas.nodes.some((node) => node.id === id && node.type === 'group'),
  )
  const putting = { colour: tools.colour, path: view.path }

  return [
    { label: t('Card'), run: () => void place(store, 'text', at, putting) },
    { label: t('Note'), run: () => void place(store, 'file', at, putting) },
    { label: t('Picture'), run: () => void place(store, 'picture', at, putting) },
    { label: t('Link'), run: () => void place(store, 'link', at, putting) },
    { label: t('Frame'), run: () => void place(store, 'group', at, putting) },
    DIVIDER,
    { label: t('Duplicate'), disabled: !picked, run: () => run.duplicate(store) },
    { label: t('Delete'), danger: true, disabled: !picked, run: () => run.remove(store) },
    ...(onCard
      ? [{ label: t('Turn into a note'), run: () => void run.toNote(store, view.path) }]
      : []),
    DIVIDER,
    { label: t('Group'), disabled: !picked, run: () => run.group(store) },
    { label: t('Ungroup'), disabled: !onFrame, run: () => run.ungroup(store) },
    DIVIDER,
    { label: t('Bring to front'), disabled: !picked, run: () => run.order(store, 'front') },
    { label: t('Bring forward'), disabled: !picked, run: () => run.order(store, 'forward') },
    { label: t('Send backward'), disabled: !picked, run: () => run.order(store, 'backward') },
    { label: t('Send to back'), disabled: !picked, run: () => run.order(store, 'back') },
    DIVIDER,
    { label: t('Align left'), disabled: !several, run: () => run.align(store, 'left') },
    { label: t('Align centre'), disabled: !several, run: () => run.align(store, 'centre') },
    { label: t('Align right'), disabled: !several, run: () => run.align(store, 'right') },
    { label: t('Align top'), disabled: !several, run: () => run.align(store, 'top') },
    { label: t('Align middle'), disabled: !several, run: () => run.align(store, 'middle') },
    { label: t('Align bottom'), disabled: !several, run: () => run.align(store, 'bottom') },
    { label: t('Spread across'), disabled: !many, run: () => run.distribute(store, 'x') },
    { label: t('Spread down'), disabled: !many, run: () => run.distribute(store, 'y') },
    ...(onEdge
      ? [
          DIVIDER,
          { label: t('Arrow at the end'), run: () => run.ends(store, false, true) },
          { label: t('Arrow at the start'), run: () => run.ends(store, true, false) },
          { label: t('Arrows at both ends'), run: () => run.ends(store, true, true) },
          { label: t('No arrows'), run: () => run.ends(store, false, false) },
        ]
      : []),
    DIVIDER,
    { label: t('Find on the canvas'), run: view.onfind },
    { label: t('Fit the canvas'), run: () => store.fit(view.width, view.height) },
    {
      label: t('Zoom to what is picked'),
      disabled: !picked,
      run: () => store.frame(view.width, view.height),
    },
    {
      label: view.narrowed ? t('Show the whole canvas') : t('Narrow to what is picked'),
      disabled: !picked && !view.narrowed,
      run: view.onnarrow,
    },
    DIVIDER,
    { label: t('Export as PNG'), run: () => void exportAs(store, view, 'png') },
    { label: t('Export as SVG'), run: () => void exportAs(store, view, 'svg') },
    { label: t('Export as PDF'), run: () => void exportAs(store, view, 'pdf') },
  ]
}

async function exportAs(store: CanvasStore, view: MenuView, how: 'png' | 'svg' | 'pdf') {
  const picture = await import('./picture')
  const drawing = {
    canvas: store.canvas,
    palette: view.palette,
    path: view.path,
    root: workspace.activeSpace?.root ?? null,
    name: view.name,
  }

  if (how === 'png') await picture.exportCanvasPng(drawing)
  else if (how === 'svg') await picture.exportCanvasSvg(drawing)
  else await picture.exportCanvasPdf(drawing)
}
