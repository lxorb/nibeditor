/** What a press, a drag and a lift mean, as one machine over events.
 *
 *  Every gesture the plane has lives here and nowhere else: picking, banding,
 *  dragging, resizing, connecting, panning, pinching, drawing, rubbing out and
 *  lassoing. The surface next door does three things and no more - it works out
 *  what is under a point, it hands the machine the event, and it carries out the
 *  effects it gets back. That is why this file has no DOM in it and every rule in
 *  it is a test rather than a thing to try with a mouse.
 *
 *  A hit is part of the event rather than something the machine goes and asks
 *  for. Hit testing needs the plane, the camera and the z order; keeping it out
 *  here is what makes a gesture a sequence of values, and a sequence of values is
 *  something a test can write down.
 *
 *  Nothing here touches the document. The machine says "these cards moved by
 *  this much"; the store decides what that is worth remembering. A gesture is one
 *  edit because the machine only ever says so once, when the pointer comes up. */

import type { InkPoint, InkTool, Shape, Side } from './format'
import type { Box, HandleId, Point } from './geometry'

/** What the bar is set to. The arrow is the one everything else falls back to;
 *  the last seven are the shapes, which the format already names. */
export type Tool = 'select' | 'hand' | 'draw' | 'erase' | 'lasso' | PutTool

/** A tool that puts something on the plane, which every one of them does by being
 *  pulled out: pressed once it lands at its own size, dragged it lands at the size
 *  it was dragged to. One gesture for a card, a frame and a triangle alike. */
export type PutTool = 'text' | 'file' | 'picture' | 'link' | 'group' | Shape

/** The ones a press puts down, as a set, so the machine can ask in one lookup. */
const PUT: ReadonlySet<Tool> = new Set<Tool>([
  'text',
  'file',
  'picture',
  'link',
  'group',
  'rect',
  'ellipse',
  'rhombus',
  'triangle',
  'line',
  'arrow',
  'elbow',
])

/** Whether the tool puts something on the plane. */
export function puts(tool: Tool): tool is PutTool {
  return PUT.has(tool)
}

/** The three that are a line from one point to another rather than a body, and so
 *  become a connector when both ends land on a card. */
const JOINS: ReadonlySet<Tool> = new Set<Tool>(['line', 'arrow', 'elbow'])

export type PointerKind = 'mouse' | 'pen' | 'touch'

/** Which end of a connector: the one it leaves, or the one it arrives at. */
type EdgeEnd = 'from' | 'to'

/** What the pointer landed on, worked out by the surface before the event gets
 *  here. Everything is a name rather than an object, so a machine state can be
 *  compared with `toEqual` and a test needs no canvas to write one down. */
export interface Hit {
  /** A resize handle of what is picked. */
  handle: HandleId | null
  /** One of the four dots an edge is dragged from. */
  port: { id: string; side: Side } | null
  /** An end of a picked connector, which is dragged onto another card to move it
   *  there. */
  endpoint: { id: string; end: EdgeEnd } | null
  /** The card under the point, if any. */
  node: string | null
  /** The connector under the point, if any. */
  edge: string | null
  /** The ink stroke under the point, if any. */
  stroke: string | null
  /** A handle of the lasso's own box: a corner to pull, or its ring to turn by. */
  ink: HandleId | 'turn' | 'inside' | null
}

export const NOTHING: Hit = {
  handle: null,
  port: null,
  endpoint: null,
  node: null,
  edge: null,
  stroke: null,
  ink: null,
}

/** What the surface knows when the pointer goes down, beyond where it is. */
export interface Down {
  kind: 'down'
  id: number
  pointer: PointerKind
  /** Where on the plane, and where on the screen. Panning and pinching are
   *  screen arithmetic; everything else is plane arithmetic. */
  at: Point
  screen: Point
  /** When it landed, from the event. Two fingers a moment apart are a pinch and
   *  two fingers a second apart are a hand settling on the page, and that is the
   *  only thing in here that needs a clock. */
  time: number
  /** The mouse button, or 0 for a pen and a finger. */
  button: number
  /** Shift, and the "as well as" key, which is Ctrl or Cmd. */
  shift: boolean
  adds: boolean
  /** Alt, which is what leaves a copy behind when something is dragged. */
  alt: boolean
  /** The pen held with its button down, or turned over. Rubs out whatever the
   *  bar is set to, which is what every stylus does. */
  eraser: boolean
  /** What the pen reported, for the first point of a stroke. */
  sample: InkPoint
  hit: Hit
}

interface Move {
  kind: 'move'
  id: number
  at: Point
  screen: Point
  /** Every sample since the last event, oldest first, which is what
   *  `getCoalescedEvents` hands over: a fast stroke is drawn through all of them
   *  rather than through the one that happened to be delivered. */
  samples: InkPoint[]
  hit: Hit
}

/** A contact that turns out to be a pen after all, or a pen whose button was not
 *  down yet when it landed.
 *
 *  Samsung's S Pen reports the first event of a contact as a finger on some
 *  devices, and a barrel button held as the nib touches down is sometimes only in
 *  the second event. Either way the surface says so as soon as it knows, and a
 *  gesture that has not got anywhere yet is taken back and begun again as the
 *  pen's own. Without it the first press after picking the tablet up pans the
 *  plane instead of drawing on it. */
interface Penned {
  kind: 'penned'
  id: number
  at: Point
  /** The first point of the stroke it should have been drawing. */
  sample: InkPoint
  /** Whether the pen's button is down now, which rubs out. */
  eraser: boolean
  hit: Hit
}

export type Input =
  | Down
  | Move
  | Penned
  | { kind: 'up'; id: number; at: Point; screen: Point; hit: Hit }
  | { kind: 'cancel'; id: number }
  | { kind: 'space'; down: boolean }
  /** The pointer has been still long enough to mean something: a menu under a
   *  finger, a tidied shape under a pen. */
  | { kind: 'held'; at: Point }

/** What the machine asks the surface to do. Named as verbs because that is what
 *  they are; the surface carries them out in order and none of them can fail. */
export type Effect =
  | { do: 'pick'; ids: string[]; adding: boolean }
  /** The band as it stands, for the surface to say what it covers: what a box
   *  caught is the plane's own arithmetic, and the machine has no plane. `was`
   *  is what was picked before the band began, which a band held with the "as
   *  well as" key adds to. */
  | { do: 'band'; from: Point; to: Point; was: string[]; adding: boolean }
  | { do: 'clear' }
  | { do: 'edit'; id: string }
  | { do: 'leave' }
  | { do: 'move'; ids: string[]; dx: number; dy: number }
  | {
      do: 'resize'
      ids: string[]
      handle: HandleId
      dx: number
      dy: number
      /** Whether the shape of the box is held, which Shift asks for and a picture
       *  under a thumb is given without being asked. */
      aspect: boolean
    }
  /** A copy left where the drag began, so what the pointer carries away is what
   *  was picked and the copy stays behind. Alt on a drag, which is what every
   *  drawing program does with it. */
  | { do: 'clone' }
  /** `auto` lets the store work the far side out from where the two cards
   *  ended up, which is what a hand dropping a line on a card means. */
  | {
      do: 'connect'
      from: string
      fromSide: Side
      to: string
      toSide: Side | 'auto'
      head?: boolean
    }
  /** One end of an existing connector moved onto another card. */
  | { do: 'reconnect'; edge: string; end: EdgeEnd; to: string }
  /** Something put on the plane at the size it was dragged out to. */
  | { do: 'pull'; tool: PutTool; from: Point; to: Point }
  /** Something put on the plane at its own size, which is what a press with no
   *  drag in it means. */
  | { do: 'place'; tool: PutTool; at: Point }
  | { do: 'stroke'; stroke: PendingStroke }
  | { do: 'rub'; ids: string[] }
  | { do: 'cut'; at: Point; reach: number }
  | { do: 'catch'; lasso: Point[] }
  | { do: 'ink'; dx: number; dy: number; scale: number; turn: number; about: Point }
  | { do: 'pan'; dx: number; dy: number }
  | { do: 'zoom'; at: Point; by: number }
  | { do: 'menu'; at: Point }
  | { do: 'assist' }

/** A stroke while it is being drawn: everything but an id, which the store hands
 *  out when it takes it. */
export interface PendingStroke {
  tool: InkTool
  size: number
  color: string
  /** How much of the colour lands, 0 to 1. */
  opacity: number
  points: InkPoint[]
}

type Gesture =
  | { kind: 'pan'; id: number; screen: Point; moved: boolean }
  | { kind: 'pinch'; ids: [number, number]; screens: [Point, Point]; apart: number }
  | { kind: 'drag'; ids: string[]; screen: Point; dx: number; dy: number }
  | {
      kind: 'resize'
      ids: string[]
      handle: HandleId
      screen: Point
      dx: number
      dy: number
      aspect: boolean
    }
  | { kind: 'band'; from: Point; to: Point; was: string[]; adding: boolean }
  | { kind: 'connect'; id: string; side: Side; to: Point }
  | { kind: 'reconnect'; edge: string; end: EdgeEnd; to: Point }
  /** Something being pulled out of the bar onto the plane. `fromNode` is the card
   *  the pull began on, which is what turns a line dragged between two cards into
   *  a connector rather than a line lying across them. */
  | { kind: 'pull'; tool: PutTool; from: Point; to: Point; fromNode: string | null }
  | { kind: 'draw'; stroke: PendingStroke; id: number }
  | { kind: 'erase'; whole: boolean; hit: string[]; id: number }
  /** A loop drawn by hand, or a box pulled out. Either way it is the ring it
   *  caught things with, so what draws it and what reads it know one shape. */
  | { kind: 'lasso'; from: Point; points: Point[]; box: boolean }
  | { kind: 'ink'; how: 'move' | HandleId | 'turn'; box: Box; from: Point }

/** The pointer a gesture belongs to.
 *
 *  A palm coming off the glass must not end the stroke the pen is still drawing,
 *  and a second finger lifting must not end a pan the first is still driving, so
 *  the gesture knows whose it is. It also knows what kind of pointer that is,
 *  where it last was on screen, so a second finger pinches from wherever the
 *  first one has got to, and when it began, so a stroke a moment old can be given
 *  up for a pinch and an older one cannot. */
interface Driver {
  id: number
  kind: PointerKind
  screen: Point
  since: number
}

export interface Machine {
  gesture: Gesture | null
  /** Whose gesture it is. */
  driver: Driver | null
  /** Space held, which turns any drag into a pan. */
  spacing: boolean
  /** Whether a pen is on the glass. Every finger is ignored while it is, which
   *  is the whole of palm rejection: a hand resting on a tablet is touch, and a
   *  pen that has arrived means the hand is not what anybody is drawing with. */
  penDown: boolean
  /** Fingers down that are not driving the gesture, so the second one can start
   *  a pinch and the first can carry on. */
  spare: { id: number; screen: Point }[]
  /** The card the pointer is over, which wears the four dots. */
  hovered: string | null
}

export function start(): Machine {
  return { gesture: null, driver: null, spacing: false, penDown: false, spare: [], hovered: null }
}

/** How far a pointer may travel and still count as a press rather than a drag,
 *  in plane units at one to one. */
const SLOP = 3

/** How soon after a gesture began a second finger is the plane rather than a palm,
 *  in milliseconds.
 *
 *  Two fingers mean the page, in every tool: whatever the first one had started,
 *  the second one takes over as a pan and a pinch. The only question is what
 *  happens to ink the first finger had already laid down, and the answer every
 *  drawing app gives is that a stroke a moment old is given up for the pinch and
 *  an older one is not: a hand settling on the page halfway through a long line
 *  must not take the line with it. */
const TWO_FINGERS = 250

export interface Step {
  machine: Machine
  effects: Effect[]
}

/** What the surface has to tell the machine that is not in the event: which tool
 *  the bar is on, what is picked, and how big a plane unit is on screen. */
export interface Context {
  tool: Tool
  picked: string[]
  /** Whether a card is being written in, which suspends every gesture over it. */
  editing: string | null
  /** Pixels per plane unit. Slop and the eraser are felt in pixels. */
  scale: number
  /** The box round the ink a lasso caught, when there is one. */
  inkBox: Box | null
  /** The pen as the bar has it set. */
  pen: { tool: InkTool; size: number; color: string; opacity: number }
  /** The eraser as the bar has it set: how wide it is on screen, and whether it
   *  takes a whole stroke rather than the part under it. */
  eraser: { whole: boolean; size: number }
  /** Whether the lasso is a box pulled out rather than a loop drawn by hand. */
  lassoBox: boolean
  /** Whether a resize holds the shape of the box without being asked. What a
   *  picture under a thumb wants: a photograph stretched one way is not the
   *  photograph, and there is no Shift on a tablet. */
  aspect: boolean
  /** Whether a stroke held still is tidied into the line, ring or box it was
   *  aiming at. */
  straighten: boolean
  /** Whether a pen has ever been on this glass. */
  penSeen: boolean
  /** Whether a finger draws anyway, which is the one way round the above. */
  fingerDraws: boolean
}

/** What the eraser reaches, in plane units, from what the bar says and how far
 *  in the plane a pixel goes. Held in one place, because a rub answers under the
 *  nib and again on every point of the drag, and the two have to agree.
 *
 *  Shift is the other way of asking for a whole stroke, which is what a keyboard
 *  had before there was a popover to ask in. */
function rubbing(context: Context, shift: boolean): { whole: boolean; reach: number } {
  return {
    whole: context.eraser.whole || shift,
    reach: context.eraser.size / context.scale,
  }
}

/** What the first touch of the eraser does: take the stroke it landed on whole,
 *  or bite a hole where it is. */
function rubbed(
  rub: { whole: boolean; reach: number },
  input: Down,
  hit: readonly string[],
): Effect[] {
  if (!rub.whole) return [{ do: 'cut', at: input.at, reach: rub.reach }]
  return hit.length ? [{ do: 'rub', ids: [...hit] }] : []
}

/** The eraser taken up: the pen's own button, or the tool on the bar. Both are
 *  the eraser, set the way the bar has the eraser set. */
function rubbingOut(held: Machine, input: Down, context: Context): Step {
  const rub = rubbing(context, input.shift)
  // What was rubbed is remembered, so dragging back over a stroke that has
  // already gone does not ask for it again.
  const first = rub.whole && input.hit.stroke ? [input.hit.stroke] : []

  return {
    machine: { ...held, gesture: { kind: 'erase', whole: rub.whole, hit: first, id: input.id } },
    effects: rubbed(rub, input, first),
  }
}

/** Which side of a card a line drawn from it left by: whichever way the hand went
 *  furthest. What settles the near end of a connector dragged out with the arrow
 *  tool, since the hand aimed rather than pressed a dot. */
function facing(from: Point, to: Point): Side {
  const across = to.x - from.x
  const down = to.y - from.y

  if (Math.abs(across) >= Math.abs(down)) return across >= 0 ? 'right' : 'left'
  return down >= 0 ? 'bottom' : 'top'
}

/** The four corners of the box between two points, which is what a lasso pulled
 *  out as a box catches things with. */
function ring(from: Point, to: Point): Point[] {
  return [from, { x: to.x, y: from.y }, to, { x: from.x, y: to.y }]
}

/** Whether a second finger takes the plane from the gesture in hand.
 *
 *  It does, in every tool: a card being dragged, a band, a shape or a stroke a
 *  moment old all give way to a pan and a pinch, because two fingers on a page
 *  mean the page. The one thing it will not do is throw away ink that has been
 *  going for longer than a moment, so a hand settling on the glass halfway
 *  through a long line leaves the line alone; see TWO_FINGERS. */
function takesOver(gesture: Gesture, first: Driver, now: number): boolean {
  if (first.kind !== 'touch' || gesture.kind === 'pinch') return false
  if (gesture.kind !== 'draw' && gesture.kind !== 'erase') return true

  return now - first.since <= TWO_FINGERS
}

/** Whether a gesture has got anywhere: something on the plane has moved, ink has
 *  been laid down, or the plane itself has. What has got nowhere can be taken
 *  back and begun again as something else. */
function begun(gesture: Gesture): boolean {
  switch (gesture.kind) {
    case 'pan':
      return gesture.moved
    case 'drag':
    case 'resize':
      return gesture.dx !== 0 || gesture.dy !== 0
    case 'band':
    case 'pull':
      return gesture.from.x !== gesture.to.x || gesture.from.y !== gesture.to.y
    case 'draw':
      return gesture.stroke.points.length > 1
    case 'lasso':
      return gesture.points.length > 1
    case 'connect':
    case 'reconnect':
      return true
    case 'erase':
    case 'pinch':
    case 'ink':
      return true
  }
}

/** A contact the surface has just worked out is a pen, or a pen whose button was
 *  not down yet when it landed. Whatever a finger was given is taken back, so
 *  long as it has got nowhere, and the pen draws or rubs out from where the nib
 *  touched down. */
function onPenned(machine: Machine, input: Penned, context: Context): Step {
  const driver = machine.driver
  if (driver?.id !== input.id) return { machine, effects: [] }

  const pen: Driver = { ...driver, kind: 'pen' }
  const now: Machine = { ...machine, penDown: true, driver: pen }

  const drawing = machine.gesture?.kind === 'draw'

  // A button that comes down while the nib is already writing turns that contact
  // into the eraser it now is, and the ink laid down since it touched down goes
  // with it: a hand holding the button is rubbing out, and a stub of a stroke it
  // never meant to leave is worse than nothing. Nothing is on the plane yet - a
  // stroke is committed when the pen lifts - so there is nothing to undo either.
  if (!(input.eraser && drawing) && machine.gesture && begun(machine.gesture)) {
    // Whatever else it is doing, it is doing it: a stroke half drawn is not
    // restarted because the pen was reported late, and a plane that has been
    // panned stays where the hand put it.
    return { machine: now, effects: [] }
  }

  const tool = input.eraser ? 'erase' : context.tool
  const down: Down = {
    kind: 'down',
    id: input.id,
    pointer: 'pen',
    at: input.at,
    screen: pen.screen,
    time: pen.since,
    button: 0,
    shift: false,
    adds: false,
    alt: false,
    eraser: input.eraser,
    sample: input.sample,
    hit: input.hit,
  }

  if (tool === 'erase') return rubbingOut({ ...now, gesture: null }, down, context)

  if (tool === 'draw') {
    return {
      machine: {
        ...now,
        gesture: { kind: 'draw', id: input.id, stroke: { ...context.pen, points: [input.sample] } },
      },
      effects: [{ do: 'leave' }],
    }
  }

  // A pen with the arrow or a shape in hand behaves as a mouse does, and a mouse
  // is what the finger was already being treated as. Nothing to take back.
  return { machine: now, effects: [] }
}

/** The tools a pen is for. Everything else on the bar is for a finger as much as
 *  for anything: a card has to be placed and a shape dragged out somehow. */
const INK: ReadonlySet<Tool> = new Set<Tool>(['draw', 'erase', 'lasso'])

/** What a press means with this pointer, which is not always what the bar says.
 *
 *  On a tablet with a stylus the two are different instruments. Once a pen has
 *  been on the glass the finger stops being a nib and goes back to what a finger
 *  is for - moving the plane, picking things up, holding for the menu - whichever
 *  pen the bar is holding, because a hand resting on a page while the other one
 *  writes must not leave a mark. That is what every stylus app does and what
 *  nobody has to be told.
 *
 *  A device that has never seen a pen has no other way to draw, so there the
 *  finger draws. And a reader who wants it anyway says so once, in the pen's own
 *  row, and is believed. */
function toolFor(input: Down, context: Context): Tool {
  if (inks(input.pointer, context)) return context.tool
  return INK.has(context.tool) ? 'select' : context.tool
}

/** Whether a contact of this kind may lay ink down at all, which is the rule above
 *  with the tool left out of it.
 *
 *  Its own function because a page note asks the same question of the same glass, and
 *  there is one answer: a hand resting on paper while the other one writes must not
 *  leave a mark, whichever surface the paper is on. Pure, like everything else here,
 *  so both surfaces are held to it by the same test. */
export function inks(
  pointer: PointerKind,
  glass: { penSeen: boolean; fingerDraws: boolean },
): boolean {
  return pointer !== 'touch' || !glass.penSeen || glass.fingerDraws
}

/** One event. The machine and the effects, never a change in place: a reducer
 *  that hands back a new value is one a test can compare. */
export function step(machine: Machine, input: Input, context: Context): Step {
  switch (input.kind) {
    case 'space':
      return { machine: { ...machine, spacing: input.down }, effects: [] }
    case 'down':
      return onDown(machine, input, context)
    case 'move': {
      const next = onMove(machine, input, context)
      // Where the pointer driving the gesture has got to, kept in one place: a
      // second finger pinches from there rather than from where the first one
      // landed.
      const driver = next.machine.driver
      if (driver?.id !== input.id) return next

      return {
        machine: { ...next.machine, driver: { ...driver, screen: input.screen } },
        effects: next.effects,
      }
    }
    case 'penned':
      return onPenned(machine, input, context)
    case 'up':
      return onUp(machine, input, context)
    case 'cancel':
      return {
        machine: { ...machine, gesture: null, spare: [], penDown: false, driver: null },
        effects: [],
      }
    case 'held':
      return onHeld(machine, input.at, context)
  }
}

function onDown(machine: Machine, input: Down, context: Context): Step {
  // A hand resting on the glass while the pen is on it is a hand, not a gesture.
  if (input.pointer === 'touch' && machine.penDown) return { machine, effects: [] }

  // A pen arriving is what the hand is drawing with, whatever else is on the
  // glass. A palm that landed a moment before it began a gesture nobody meant,
  // and it is dropped here rather than left to drag the plane out from under the
  // stroke.
  const now: Machine =
    input.pointer === 'pen' ? { ...machine, gesture: null, spare: [], driver: null } : machine

  const penDown = now.penDown || input.pointer === 'pen'
  const tool = toolFor(input, context)

  // A second finger is the page, whatever the first one was doing. A third is
  // spare and changes nothing, and so is a second finger on a stroke that is
  // already under way; see TWO_FINGERS.
  if (input.pointer === 'touch' && now.gesture && now.driver) {
    const first = now.driver

    if (takesOver(now.gesture, first, input.time)) {
      return {
        machine: {
          ...now,
          penDown,
          driver: { id: input.id, kind: 'touch', screen: input.screen, since: input.time },
          gesture: {
            kind: 'pinch',
            ids: [first.id, input.id],
            screens: [first.screen, input.screen],
            apart: Math.hypot(input.screen.x - first.screen.x, input.screen.y - first.screen.y),
          },
        },
        effects: [],
      }
    }

    return {
      machine: {
        ...now,
        penDown,
        spare: [...now.spare, { id: input.id, screen: input.screen }],
      },
      effects: [],
    }
  }

  if (now.gesture) return { machine: { ...now, penDown }, effects: [] }

  const held: Machine = {
    ...now,
    penDown,
    driver: { id: input.id, kind: input.pointer, screen: input.screen, since: input.time },
  }

  // The pen's own button rubs out whatever the bar says, which is what a stylus
  // does in every app that has ever had one. Before the button below it, because
  // Chromium reports a barrel button held as the right one on Android and as the
  // eraser bit elsewhere, and both mean the same thing to a hand. Set the way the
  // eraser is set, because it is the eraser.
  if (input.eraser) return rubbingOut(held, input, context)

  // The right button is the menu's, wherever it lands, and it is a mouse's: a pen
  // holding its button is rubbing out. It starts nothing, so it drives nothing
  // either.
  if (input.button === 2 && input.pointer !== 'pen') {
    return {
      machine: { ...held, driver: now.driver },
      effects: [{ do: 'menu', at: input.at }],
    }
  }

  // Space, the middle button and the hand tool all pan, over a card as readily
  // as over the plane: a hand that has learned one of them uses it everywhere.
  if (now.spacing || input.button === 1 || tool === 'hand') {
    return {
      machine: {
        ...held,
        gesture: { kind: 'pan', id: input.id, screen: input.screen, moved: false },
      },
      effects: [],
    }
  }

  // Everything a press puts on the plane is pulled out: a card, a frame, a picture
  // and a triangle alike. Let go without moving and it lands at its own size;
  // dragged, it lands at the size it was dragged to, and the plane draws it the
  // whole way rather than only once it is let go.
  if (puts(tool)) {
    return {
      machine: {
        ...held,
        gesture: { kind: 'pull', tool, from: input.at, to: input.at, fromNode: input.hit.node },
      },
      effects: [{ do: 'leave' }],
    }
  }

  switch (tool) {
    case 'draw':
      return {
        machine: {
          ...held,
          gesture: {
            kind: 'draw',
            id: input.id,
            stroke: { ...context.pen, points: [input.sample] },
          },
        },
        effects: [{ do: 'leave' }],
      }
    case 'erase':
      return rubbingOut(held, input, context)
    case 'lasso':
      // A press inside what the lasso already caught moves it; anywhere else
      // draws a new one.
      if (input.hit.ink) {
        return {
          machine: {
            ...held,
            gesture: {
              kind: 'ink',
              how: input.hit.ink === 'inside' ? 'move' : input.hit.ink,
              box: context.inkBox ?? { x: 0, y: 0, width: 0, height: 0 },
              from: input.at,
            },
          },
          effects: [],
        }
      }

      return {
        machine: {
          ...held,
          gesture: {
            kind: 'lasso',
            from: input.at,
            points: context.lassoBox ? ring(input.at, input.at) : [input.at],
            box: context.lassoBox,
          },
        },
        effects: [],
      }
    case 'select':
      // The hand is not here: it panned above, from anywhere, which is what a hand
      // does. Only the arrow reaches the rest of this file, and a finger on a device
      // with a pen reaches it whatever the bar says.
      break
  }

  return select(held, input, context)
}

/** What a press means with the arrow: a handle, a dot, a connector, a card, or
 *  the plane. In that order, because that is the order they are drawn in. */
function select(machine: Machine, input: Down, context: Context): Step {
  const { hit } = input

  if (hit.handle && context.picked.length) {
    return {
      machine: {
        ...machine,
        gesture: {
          kind: 'resize',
          ids: [...context.picked],
          handle: hit.handle,
          screen: input.screen,
          dx: 0,
          dy: 0,
          aspect: input.shift || context.aspect,
        },
      },
      effects: [],
    }
  }

  // An end of a connector that is already picked, dragged onto another card. Before
  // the dots below, because an end sits exactly where a dot would.
  if (hit.endpoint) {
    return {
      machine: {
        ...machine,
        gesture: {
          kind: 'reconnect',
          edge: hit.endpoint.id,
          end: hit.endpoint.end,
          to: input.at,
        },
      },
      effects: [],
    }
  }

  if (hit.port) {
    return {
      machine: {
        ...machine,
        gesture: { kind: 'connect', id: hit.port.id, side: hit.port.side, to: input.at },
      },
      effects: [],
    }
  }

  if (hit.edge) {
    return {
      machine,
      effects: [
        { do: 'pick', ids: [hit.edge], adding: input.adds || input.shift },
        { do: 'leave' },
      ],
    }
  }

  // A card being written in keeps the pointer: it is a text field, and a drag in
  // one selects words.
  if (context.editing !== null && hit.node === context.editing) {
    return { machine: { ...machine, driver: null }, effects: [] }
  }

  if (!hit.node) {
    // A finger on the plane moves the plane; there is no second button to pan
    // with and no marquee anybody draws with a thumb.
    if (input.pointer === 'touch') {
      return {
        machine: {
          ...machine,
          gesture: { kind: 'pan', id: input.id, screen: input.screen, moved: false },
        },
        effects: [{ do: 'leave' }],
      }
    }

    const adding = input.adds || input.shift
    return {
      machine: {
        ...machine,
        gesture: {
          kind: 'band',
          from: input.at,
          to: input.at,
          was: adding ? [...context.picked] : [],
          adding,
        },
      },
      effects: adding ? [{ do: 'leave' }] : [{ do: 'leave' }, { do: 'clear' }],
    }
  }

  const adding = input.adds || input.shift
  const effects: Effect[] = [{ do: 'leave' }]
  // A press on something already picked keeps the whole selection, so a drag of
  // nine cards is not undone by grabbing one of them.
  if (adding || !context.picked.includes(hit.node)) {
    effects.push({ do: 'pick', ids: [hit.node], adding })
  }

  const ids = adding
    ? // Whatever the pick just did, worked out here so the drag carries it.
      context.picked.includes(hit.node)
      ? context.picked.filter((one) => one !== hit.node)
      : [...context.picked, hit.node]
    : context.picked.includes(hit.node)
      ? [...context.picked]
      : [hit.node]

  if (!ids.length) return { machine: { ...machine, driver: null }, effects }

  // Alt leaves a copy where the drag began. The originals are what the pointer
  // carries away, so the ids the gesture already holds stay the right ones and
  // nothing has to be renamed halfway through a drag.
  if (input.alt) effects.push({ do: 'clone' })

  return {
    machine: {
      ...machine,
      gesture: { kind: 'drag', ids, screen: input.screen, dx: 0, dy: 0 },
    },
    effects,
  }
}

function onMove(machine: Machine, input: Move, context: Context): Step {
  const one = machine.gesture

  if (!one) {
    const hovered = input.hit.node
    return {
      machine: hovered === machine.hovered ? machine : { ...machine, hovered },
      effects: [],
    }
  }

  switch (one.kind) {
    case 'pan': {
      if (input.id !== one.id) return { machine, effects: [] }

      const dx = input.screen.x - one.screen.x
      const dy = input.screen.y - one.screen.y

      return {
        machine: {
          ...machine,
          gesture: { ...one, screen: input.screen, moved: one.moved || Math.hypot(dx, dy) > SLOP },
        },
        effects: [{ do: 'pan', dx, dy }],
      }
    }

    case 'pinch': {
      const which = one.ids.indexOf(input.id)
      if (which < 0) return { machine, effects: [] }

      const screens: [Point, Point] =
        which === 0 ? [input.screen, one.screens[1]] : [one.screens[0], input.screen]
      const apart = Math.hypot(screens[1].x - screens[0].x, screens[1].y - screens[0].y)
      const middle = {
        x: (screens[0].x + screens[1].x) / 2,
        y: (screens[0].y + screens[1].y) / 2,
      }
      const was = {
        x: (one.screens[0].x + one.screens[1].x) / 2,
        y: (one.screens[0].y + one.screens[1].y) / 2,
      }

      const effects: Effect[] = [{ do: 'pan', dx: middle.x - was.x, dy: middle.y - was.y }]
      // Two fingers that stay the same distance apart are a pan, and a zoom of
      // exactly one is not worth a camera write.
      if (one.apart > 0 && Math.abs(apart - one.apart) > 0.5) {
        effects.push({ do: 'zoom', at: middle, by: apart / one.apart })
      }

      return { machine: { ...machine, gesture: { ...one, screens, apart } }, effects }
    }

    case 'drag':
    case 'resize':
      return {
        machine: {
          ...machine,
          gesture: {
            ...one,
            dx: (input.screen.x - one.screen.x) / context.scale,
            dy: (input.screen.y - one.screen.y) / context.scale,
          },
        },
        effects: [],
      }

    case 'band': {
      // Answered as it is dragged rather than when it is let go, which is what a
      // band round a row of files does: what is caught is shown being caught.
      const band = { ...one, to: input.at }
      return {
        machine: { ...machine, gesture: band },
        effects: [{ do: 'band', from: band.from, to: band.to, was: band.was, adding: band.adding }],
      }
    }

    case 'connect':
    case 'reconnect':
    case 'pull':
      return { machine: { ...machine, gesture: { ...one, to: input.at } }, effects: [] }

    case 'draw': {
      if (input.id !== one.id) return { machine, effects: [] }

      const points = input.samples.length ? input.samples : []
      if (!points.length) return { machine, effects: [] }

      return {
        machine: {
          ...machine,
          gesture: { ...one, stroke: { ...one.stroke, points: [...one.stroke.points, ...points] } },
        },
        effects: [],
      }
    }

    case 'erase': {
      if (input.id !== one.id) return { machine, effects: [] }

      if (!one.whole) {
        const reach = context.eraser.size / context.scale
        return { machine, effects: [{ do: 'cut', at: input.at, reach }] }
      }

      if (!input.hit.stroke || one.hit.includes(input.hit.stroke)) return { machine, effects: [] }

      return {
        machine: { ...machine, gesture: { ...one, hit: [...one.hit, input.hit.stroke] } },
        effects: [{ do: 'rub', ids: [input.hit.stroke] }],
      }
    }

    case 'lasso':
      return {
        machine: {
          ...machine,
          gesture: {
            ...one,
            points: one.box ? ring(one.from, input.at) : [...one.points, input.at],
          },
        },
        effects: [],
      }

    case 'ink':
      return { machine, effects: [inkEffect(one, input.at)] }
  }
}

/** What a drag of the lasso's box comes to: a move, a pull from one corner, or a
 *  turn about its middle. One effect either way, so the surface applies one
 *  transform and the store keeps one undo step. */
function inkEffect(one: Extract<Gesture, { kind: 'ink' }>, at: Point): Effect {
  const box = one.box
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  if (one.how === 'move') {
    return {
      do: 'ink',
      dx: at.x - one.from.x,
      dy: at.y - one.from.y,
      scale: 1,
      turn: 0,
      about: middle,
    }
  }

  if (one.how === 'turn') {
    const was = Math.atan2(one.from.y - middle.y, one.from.x - middle.x)
    const now = Math.atan2(at.y - middle.y, at.x - middle.x)
    return { do: 'ink', dx: 0, dy: 0, scale: 1, turn: now - was, about: middle }
  }

  // A corner scales about the middle, evenly on both axes: handwriting stretched
  // one way is handwriting nobody wrote.
  const reach = Math.max(box.width, box.height, 1) / 2
  const was = Math.hypot(one.from.x - middle.x, one.from.y - middle.y)
  const now = Math.hypot(at.x - middle.x, at.y - middle.y)
  const scale = was > reach * 0.1 ? Math.max(0.05, now / was) : 1

  return { do: 'ink', dx: 0, dy: 0, scale, turn: 0, about: middle }
}

function onUp(machine: Machine, input: Extract<Input, { kind: 'up' }>, context: Context): Step {
  const one = machine.gesture
  const spare = machine.spare.filter((held) => held.id !== input.id)

  if (!one) return { machine: { ...machine, spare, penDown: false, driver: null }, effects: [] }

  // A pinch that loses one finger goes back to panning with the other.
  if (one.kind === 'pinch' && one.ids.includes(input.id)) {
    const left = one.ids[0] === input.id ? 1 : 0
    return {
      machine: {
        ...machine,
        spare,
        driver: {
          id: one.ids[left],
          kind: 'touch',
          screen: one.screens[left],
          since: machine.driver?.since ?? 0,
        },
        gesture: { kind: 'pan', id: one.ids[left], screen: one.screens[left], moved: true },
      },
      effects: [],
    }
  }

  // Somebody else's pointer. A palm coming off the glass is not the pen putting
  // its stroke down, and a stray finger is not the end of a drag.
  if (machine.driver !== null && machine.driver.id !== input.id) {
    return { machine: { ...machine, spare }, effects: [] }
  }

  const rest: Machine = { ...machine, gesture: null, spare, penDown: false, driver: null }

  switch (one.kind) {
    case 'pan':
      // A finger that went down and came up without going anywhere is a tap on
      // the plane, and a tap on the plane means "nothing, thank you". A mouse
      // says the same thing the moment it is pressed; a finger cannot, because
      // the same press is how the plane is moved.
      return { machine: rest, effects: one.moved ? [] : [{ do: 'clear' }] }
    case 'pinch':
      return { machine: rest, effects: [] }

    case 'drag': {
      // A drag that was really a click has nothing to record.
      if (Math.hypot(one.dx, one.dy) * context.scale <= SLOP) return { machine: rest, effects: [] }
      return { machine: rest, effects: [{ do: 'move', ids: one.ids, dx: one.dx, dy: one.dy }] }
    }

    case 'resize': {
      if (Math.hypot(one.dx, one.dy) * context.scale <= SLOP) return { machine: rest, effects: [] }
      return {
        machine: rest,
        effects: [
          {
            do: 'resize',
            ids: one.ids,
            handle: one.handle,
            dx: one.dx,
            dy: one.dy,
            aspect: one.aspect,
          },
        ],
      }
    }

    case 'band':
      return { machine: rest, effects: [] }

    case 'connect': {
      const target = input.hit.node
      if (!target || target === one.id) return { machine: rest, effects: [] }

      return {
        machine: rest,
        effects: [{ do: 'connect', from: one.id, fromSide: one.side, to: target, toSide: 'auto' }],
      }
    }

    case 'reconnect': {
      const target = input.hit.node
      if (!target) return { machine: rest, effects: [] }

      return {
        machine: rest,
        effects: [{ do: 'reconnect', edge: one.edge, end: one.end, to: target }],
      }
    }

    case 'pull': {
      const span = Math.hypot(one.to.x - one.from.x, one.to.y - one.from.y)
      // Pressed rather than dragged: it lands at its own size where the press was.
      if (span * context.scale <= SLOP) {
        return { machine: rest, effects: [{ do: 'place', tool: one.tool, at: one.from }] }
      }

      // A line dragged from one card to another is a connector between them, which
      // is what a hand drawing an arrow between two cards means. A line dragged
      // anywhere else is a line.
      const target = input.hit.node
      if (JOINS.has(one.tool) && one.fromNode && target && target !== one.fromNode) {
        return {
          machine: rest,
          effects: [
            {
              do: 'connect',
              from: one.fromNode,
              fromSide: facing(one.from, one.to),
              to: target,
              toSide: 'auto',
              head: one.tool === 'arrow',
            },
          ],
        }
      }

      return {
        machine: rest,
        effects: [{ do: 'pull', tool: one.tool, from: one.from, to: one.to }],
      }
    }

    // A tap is a dot: the pen went down and came up in one place, which is a mark
    // somebody meant to make. What it looks like is the nib's own footprint; see
    // outlineOf in ink.ts.
    case 'draw':
      return { machine: rest, effects: [{ do: 'stroke', stroke: one.stroke }] }

    case 'erase':
      return { machine: rest, effects: [] }

    case 'lasso':
      return { machine: rest, effects: [{ do: 'catch', lasso: one.points }] }

    case 'ink':
      return { machine: rest, effects: [] }
  }
}

/** The pointer has been still long enough to mean something. A finger asks for
 *  the menu; a pen that is still drawing asks for its shape to be tidied. */
function onHeld(machine: Machine, at: Point, context: Context): Step {
  const one = machine.gesture
  if (!one) return { machine, effects: [] }

  // A stroke that stops still is asking to be tidied, when the pen has been told
  // to do that. A pen that has not is a pen drawing a wobbly circle on purpose.
  if (one.kind === 'draw') {
    return { machine, effects: context.straighten ? [{ do: 'assist' }] : [] }
  }

  // A finger held on the plane or on a card is the menu, which is the only way
  // to reach one without a second mouse button. Never a pen: a nib resting on the
  // page is a hand thinking, not a hand asking for a list.
  if ((one.kind === 'pan' || one.kind === 'drag') && machine.driver?.kind !== 'pen') {
    return { machine: { ...machine, gesture: null }, effects: [{ do: 'menu', at }] }
  }

  return { machine, effects: [] }
}
