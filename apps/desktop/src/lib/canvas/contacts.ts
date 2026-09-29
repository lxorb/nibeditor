/** What each pointer on the glass said about itself, what has changed since, and
 *  what kind of pen this device has at all.
 *
 *  A contact is not always what it claims when it lands. Samsung's S Pen reports
 *  the first event of a contact as a finger on some devices, and a barrel button
 *  held as the nib touches down is sometimes only in the second event. Both are the
 *  same shape of problem: the surface acted on what it was told, and a moment later
 *  it is told something else that would have meant a different gesture.
 *
 *  So the surface keeps what each contact claimed here and asks, on every move,
 *  whether that claim has changed in a way worth taking the gesture back for.
 *  Answered once: a stroke is not restarted on every event of a drag just because
 *  the pen is still a pen.
 *
 *  The pens themselves are five instruments with one interface and no two of them
 *  saying the same thing; `penProfile` below is the whole of what the surface
 *  believes about which one this is, and `docs/canvas.md` has the table it came
 *  from. Nothing here touches a DOM: every shape is a value, so every pen nobody
 *  here can hold is a test. */

export interface Contact {
  /** Whether the event says pen. */
  pen: boolean
  /** Whether the pen's button is down, which rubs out. */
  eraser: boolean
}

/** The bit Chromium sets for a stylus held with its button, on a desktop. */
const ERASER_BIT = 32
/** The bit for the right mouse button, which is what Chrome on Android reports the
 *  same barrel button as. */
const RIGHT_BIT = 2

/** As much of a pointer event as saying what kind of pointer it is needs. */
export interface Reported {
  pointerType: string
  button: number
  buttons: number
}

/** What a pen event says about the pen itself rather than about where it is: how
 *  hard it is pressed, and which way it is leaning - in either of the two ways a
 *  browser says the second one.
 *
 *  `tiltX` and `tiltY` are degrees off the vertical along the screen's own axes,
 *  which is what Chromium reports. `altitudeAngle` and `azimuthAngle` are radians
 *  up from the glass and radians round it, which is what Safari reports for an
 *  Apple Pencil - and what Chromium reports as well, since it grew the fields.
 *  Both are the same fact; `tiltOf` in ink.ts makes them one. */
export interface Felt {
  pressure: number
  tiltX: number
  tiltY: number
  altitudeAngle?: number
  azimuthAngle?: number
}

/** Whether nothing at all is pressed, which means the pointer is over the glass
 *  rather than on it.
 *
 *  A hovering pen is the one thing on this list that no mouse ever taught anybody
 *  to expect: an Apple Pencil an inch above an M2 iPad, a Surface Pen approaching
 *  the screen, a Wacom nib crossing the tablet on its way somewhere, all of them
 *  reporting where they are the whole time and none of them drawing. `buttons` is
 *  the whole test, because the nib itself is a button and every shape of the barrel
 *  is another one: nothing pressed is nothing touching. */
export function hovering(event: { buttons: number }): boolean {
  return event.buttons === 0
}

/** What the glass is like under this event: whether a pen has ever been on it, and
 *  whether it is a screen a finger uses. */
export interface Glass {
  penSeen: boolean
  touch: boolean
}

/** What kind of pointer this really is, and whether it is rubbing out.
 *
 *  Three shapes of the same fact, all of them seen on the same Samsung tablet:
 *
 *  - a pen that says pen, with the eraser bit set, which is Chromium on a desktop;
 *  - a pen that says pen, with the right button bit set, which is Chrome on
 *    Android, where the barrel button is reported as the right mouse button;
 *  - a pen that says **mouse** while the button is held, which some builds do,
 *    because a stylus with a button pressed looks like a mouse to the layer
 *    underneath.
 *
 *  The third is only believed on a touch screen that has had a pen on it. A desktop
 *  right click is a desktop right click, and turning it into an eraser because
 *  somebody once drew with a stylus would take the menu away for good.
 *
 *  Pure, so all three shapes are a test rather than a tablet. */
export function penKind(
  event: Reported,
  glass: Glass,
): { kind: 'mouse' | 'pen' | 'touch'; eraser: boolean } {
  const held = (event.buttons & ERASER_BIT) !== 0 || (event.buttons & RIGHT_BIT) !== 0
  const asked = event.button === 2 || event.button === 5

  if (event.pointerType === 'pen') return { kind: 'pen', eraser: held || asked }
  if (event.pointerType === 'touch') return { kind: 'touch', eraser: false }

  // A mouse that is really the pen, on glass that has had one on it.
  if (glass.penSeen && glass.touch && (held || asked)) return { kind: 'pen', eraser: true }

  return { kind: 'mouse', eraser: false }
}

/** What a changed claim comes to. */
export interface Turned {
  eraser: boolean
  /** Whether this is the first the surface has heard that the contact is a pen,
   *  which is also what makes the glass remember it has seen one. */
  first: boolean
}

export class Contacts {
  private readonly held = new Map<number, Contact>()

  /** A pointer that has landed, and what it said. */
  came(id: number, one: Contact) {
    this.held.set(id, one)
  }

  /** A pointer that has left. */
  went(id: number) {
    this.held.delete(id)
  }

  /** Whether the surface is holding this pointer at all. A move for one it is not
   *  is a pen crossing the glass on its way somewhere: it says where the pen is
   *  and nothing about a stroke. */
  has(id: number): boolean {
    return this.held.has(id)
  }

  /** Whether a nib is on the glass.
   *
   *  Windows hands pen input to anything that does not ask for it as mouse input,
   *  and a driver on a desktop tablet will report the same nib as both if it is set
   *  up to. A mouse arriving while a nib is down is that nib a second time, not a
   *  second hand, so the surface drops it and one contact stays one gesture. */
  get penned(): boolean {
    for (const one of this.held.values()) if (one.pen) return true
    return false
  }

  /** Whether this event is a contact already being held, arriving again under
   *  another name; see `penned`. */
  echo(event: Reported): boolean {
    return event.pointerType === 'mouse' && this.penned
  }

  /** Whether this event means the contact is a pen after all, or that a pen's
   *  button has come down since it landed. Nothing for a contact nobody is holding,
   *  for a finger, and for a pen that is already known to be one.
   *
   *  Remembers what it answered, so the second event of the same stroke says
   *  nothing. */
  turned(id: number, now: Contact): Turned | null {
    const was = this.held.get(id)
    if (!was || !now.pen) return null
    if (was.pen && (!now.eraser || was.eraser)) return null

    this.held.set(id, now)
    return { eraser: now.eraser, first: !was.pen }
  }
}

/** Which shape of pen this is, as far as the machine says before one has touched
 *  the glass. Named for the platform rather than for the maker, because the platform
 *  is what decides it: every pen on a Windows machine reports the way Windows
 *  reports pens, whoever made it. */
export type PenShape = 'apple' | 'windows' | 'android' | 'chromeos' | 'desktop'

/** How a pen says which way it is leaning, once one has. */
export type Lean = 'tilt' | 'spherical' | 'none'

/** What a pen's own pressure is worth: what it reports, or nothing, for a pen that
 *  reports the same number for ever. */
type Force = 'reported' | 'flat'

/** What the surface believes about the pen this device has. */
export interface PenTraits {
  shape: PenShape
  /** What the reported pressure is raised to before the ink reads it; see GAINS. */
  gain: number
  /** Whether the browser hands over the samples between two frames, which is
   *  `getCoalescedEvents`. Safari has had it since 18.2, and not before. */
  coalesced: boolean
  /** Whether it guesses ahead of the nib, which is `getPredictedEvents`. */
  predicted: boolean
  /** Which of the two ways of saying how the pen leans this one uses; `none` until
   *  a pen has leant. */
  lean: Lean
  /** What its pressure is worth; see `Stylus`. */
  force: Force
}

/** What the machine says about itself, and what its `PointerEvent` can do. Passed
 *  in rather than read here, so every device below is a value. */
export interface Said {
  agent: string
  /** Whether there is a touch screen at all, which is `navigator.maxTouchPoints`.
   *  It is what tells an iPad from a Mac, because since iPadOS 13 Safari on an iPad
   *  calls itself Macintosh and nothing else. */
  touch: boolean
  coalesced: boolean
  predicted: boolean
}

const APPLE = /iPad|iPhone|iPod/
const MAC = /Macintosh|Mac OS X/

/** Which shape of pen this machine has. */
export function penShape(said: Said): PenShape {
  const agent = said.agent
  if (APPLE.test(agent)) return 'apple'
  // An iPad says Macintosh and nothing else, and there is nothing to tell it from a
  // Mac by but the glass.
  if (MAC.test(agent)) return said.touch ? 'apple' : 'desktop'
  if (agent.includes('Windows NT')) return 'windows'
  if (agent.includes('CrOS')) return 'chromeos'
  if (agent.includes('Android')) return 'android'

  // A machine nobody recognises with a touch screen is a tablet of some sort and its
  // pen is Chromium's; without one it is a desktop, and so is the tablet plugged
  // into it.
  return said.touch ? 'android' : 'desktop'
}

/** The one number per platform that makes a nib feel the same in every hand.
 *
 *  Pressure is not a measurement. A digitiser reports a fraction of its own full
 *  scale, every full scale is a different weight of hand, and the browser puts its
 *  own curve on top of that: WebKit's for an Apple Pencil is not Chromium's for an
 *  S Pen. So the same hand writing the same word is a different width on each, and
 *  one ink pipeline with one width curve cannot be right on all of them at once.
 *
 *  The gain is the exponent the reported pressure goes through, and it is the whole
 *  of the difference. One below one lifts the middle of the range, so a hand that
 *  writes lightly gets the line it got on the tablet the ink was built on; one above
 *  one would flatten it. Every platform whose pen has been held here is 1, which is
 *  no curve at all. The Pencil's is a shade under, because Safari reports a lower
 *  fraction of full scale for the same weight of hand than Chromium does - a
 *  judgement rather than a measurement, and this table is the one place to change it
 *  when somebody can hold one. */
const GAINS: Record<PenShape, number> = {
  apple: 0.8,
  windows: 1,
  android: 1,
  chromeos: 1,
  desktop: 1,
}

/** What the surface believes about this pen before one has touched the glass. */
export function penProfile(said: Said): PenTraits {
  const shape = penShape(said)

  return {
    shape,
    gain: GAINS[shape],
    coalesced: said.coalesced,
    predicted: said.predicted,
    // Both of these are what a pen turns out to be rather than what a platform
    // promises, so they start at nothing said and the first pen on the glass settles
    // them; see `Stylus`.
    lean: 'none',
    force: 'reported',
  }
}

/** Which of the two ways this event says the pen is leaning.
 *
 *  Tilt first, because it is the pair Chromium fills in natively and the pair the
 *  file format keeps; the spherical angles are what Safari has instead. A pen
 *  standing straight up leans no way at all and says nothing either way. */
export function leanOf(event: Felt): Lean {
  if (event.tiltX !== 0 || event.tiltY !== 0) return 'tilt'

  const up = event.altitudeAngle
  if (typeof up === 'number' && up < Math.PI / 2) return 'spherical'

  return 'none'
}

/** How many samples of a nib on the glass are watched before the pressure a pen
 *  reports is called flat. A fifth of a second of writing: long enough that no real
 *  hand holds a digitiser to one number across it, short enough that the first
 *  stroke of the first drawing is already right. */
const WATCHED = 24

/** The pen this device has, learnt.
 *
 *  Two things cannot be read off a user agent and are read off the pen instead: how
 *  it says which way it is leaning, and whether its pressure says anything at all.
 *  The second is what a USI pen on a Chromebook needs. Some of them report exactly
 *  one half for every sample of every stroke, and some report a fixed sliver near
 *  nought - and a fixed sliver handed to a nib that thins with pressure draws every
 *  stroke anybody ever draws as a hairline. A number that never changes is not a
 *  measurement, so once a pen has held one across a fifth of a second of writing the
 *  ink stops believing it and draws at the width the nib is set to. Any variation at
 *  all settles it the other way for good: a pen that reports pressure has proved it.
 *
 *  Nothing on the page is drawn from this beyond the hidden record a drive and a
 *  person on a tablet can both read; see canvas/trace.ts. */
export class Stylus {
  traits: PenTraits
  /** The pressure of the last sample with the nib down, and whether two of them have
   *  ever differed. */
  private was: number | null = null
  private varied = false
  private seen = 0

  constructor(said: Said) {
    this.traits = penProfile(said)
  }

  /** A pen event, read for what it says about the pen rather than about the stroke.
   *  Answers whether anything changed, so the record is written once rather than on
   *  every sample of every line. */
  saw(event: Reported & Felt): boolean {
    if (event.pointerType !== 'pen') return false

    let changed = false

    const lean = leanOf(event)
    if (lean !== 'none' && lean !== this.traits.lean) {
      this.traits = { ...this.traits, lean }
      changed = true
    }

    // Only with the nib down, and only until the pen has proved itself. A hovering
    // pen reports no pressure because it is not pressing on anything, and a column of
    // noughts is not a pen with nothing to say.
    if (this.varied || hovering(event)) return changed

    if (this.was !== null && event.pressure !== this.was) {
      this.varied = true
      if (this.traits.force !== 'reported') {
        this.traits = { ...this.traits, force: 'reported' }
        changed = true
      }

      return changed
    }

    this.was = event.pressure
    this.seen += 1
    if (this.seen >= WATCHED && this.traits.force !== 'flat') {
      this.traits = { ...this.traits, force: 'flat' }
      changed = true
    }

    return changed
  }

  /** The profile as one short line for the hidden record: `apple g0.8 spherical
   *  reported plain unguessed`. Short enough to be read off a tablet over a call. */
  get line(): string {
    const traits = this.traits

    return [
      traits.shape,
      `g${traits.gain}`,
      traits.lean,
      traits.force,
      traits.coalesced ? 'coalesced' : 'plain',
      traits.predicted ? 'predicted' : 'unguessed',
    ].join(' ')
  }
}
