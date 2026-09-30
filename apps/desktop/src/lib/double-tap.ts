/** A modifier pressed twice on its own: JetBrains' double Shift, which is how nib's
 *  palette opens.
 *
 *  Emil, 2026-09-30: *"instead of Ctrl + P I want the shortcut to be just 'shift
 *  shift' for that global search"*. Shift is the busiest key on the keyboard, so what
 *  counts is narrow, and everything that is not it is the key doing its usual job:
 *
 *  - **Alone.** Down and up with nothing else in between: no letter (a capital), no
 *    arrow (a selection), no other modifier, and no press of the pointer (Shift+click,
 *    a drag with Shift held) or turn of the wheel (Shift+wheel scrolls sideways).
 *  - **Short.** Each press let go within `WITHIN`, and the second begun within `WITHIN`
 *    of the first being let go. Held longer, it was somebody changing their mind.
 *  - **Either key.** The left Shift then the right counts; both at once does not.
 *  - **Answered on the second release**, not the second press: a Shift pressed twice
 *    and then held for a capital is typing.
 *  - **Once a burst.** Having answered, it waits for the presses to stop before it
 *    counts again, so five presses - which Windows reads as a request for Sticky Keys
 *    - open the palette once, and Windows still hears all five: nothing here takes a
 *    key from anyone.
 *  - **Not while composing.** An input method's keys are the word being made.
 *  - A key held down and repeating is neither a press nor a break.
 *
 *  Pure, with the clock handed in, so every one of those is a test. The window's
 *  listeners and who hears the answer are tapped.ts; a web page's own copy of the same
 *  rules is `SCRIPT` in src-tauri/src/web_opens.rs, which double-tap.test.ts holds to
 *  the same `WITHIN`.
 *
 *  And how one is written down, as a shortcut's key: the modifier twice with a space
 *  between, `Shift Shift`, `Mod Mod`, `Alt Alt` - a space being how CodeMirror writes
 *  one stroke after another, which is what this is. `Mod` is Ctrl or Cmd as it is in a
 *  chord, so a double Ctrl chosen on a PC is a double Cmd on a Mac. keys.ts shows one. */

import type { Platform } from './keys'

/** The modifiers a double tap can be made of, named the way `KeyboardEvent.key` names
 *  them. */
export type Modifier = 'Shift' | 'Control' | 'Alt' | 'Meta'

const MODIFIERS: readonly Modifier[] = ['Shift', 'Control', 'Alt', 'Meta']

const isModifier = (key: string): key is Modifier => MODIFIERS.some((one) => one === key)

/** How each is written, where it is not the platform's own `Mod`. */
const WRITTEN: Record<Modifier, string> = {
  Shift: 'Shift',
  Control: 'Ctrl',
  Alt: 'Alt',
  Meta: 'Meta',
}

/** The one `Mod` stands for here. */
const primary = (platform: Platform): Modifier => (platform === 'mac' ? 'Meta' : 'Control')

/** A double tap of `key`, written down. */
export function writeTap(key: Modifier, platform: Platform): string {
  const name = key === primary(platform) ? 'Mod' : WRITTEN[key]
  return `${name} ${name}`
}

/** The modifier a written double tap is made of, or null for anything else. */
export function tapOf(text: string, platform: Platform): Modifier | null {
  const [one, other, ...rest] = text.trim().toLowerCase().split(/\s+/)
  if (one === undefined || one !== other || rest.length) return null
  if (one === 'mod') return primary(platform)

  return MODIFIERS.find((key) => WRITTEN[key].toLowerCase() === one) ?? null
}

/** How long a tap may be held, and how long the second may wait for. JetBrains waits
 *  about as long; under 300 ms a relaxed hand misses it, over 400 two Shifts a
 *  sentence apart start to count. */
export const WITHIN = 350

/** What a keystroke says, as much of it as this needs. */
export interface Stroke {
  key: string
  repeat?: boolean
  isComposing?: boolean
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

/** Which of the four is held besides `key` itself. */
function othersHeld(stroke: Stroke, key: Modifier): boolean {
  return (
    (key !== 'Shift' && stroke.shiftKey === true) ||
    (key !== 'Control' && stroke.ctrlKey === true) ||
    (key !== 'Alt' && stroke.altKey === true) ||
    (key !== 'Meta' && stroke.metaKey === true)
  )
}

export class DoubleTap {
  /** The modifier down right now, alone, and since when. */
  private down: { key: Modifier; at: number } | null = null

  /** The last tap: which, when it was let go, and whether it already answered. */
  private tap: { key: Modifier; at: number; spent: boolean } | null = null

  /** Anything that is not a tap ends what was building. */
  broken() {
    this.down = null
    this.tap = null
  }

  /** A key went down. */
  pressed(stroke: Stroke, now: number) {
    if (stroke.repeat) return
    if (stroke.isComposing || stroke.key === 'Process') {
      this.broken()
      return
    }

    const key = stroke.key
    if (isModifier(key) && this.down === null && !othersHeld(stroke, key)) {
      // A pause long enough ends a burst, answered or not.
      if (this.tap && now - this.tap.at > WITHIN) this.tap = null
      this.down = { key, at: now }
      return
    }

    this.broken()
  }

  /** A key came up. Answers the modifier when this was the second tap of it. */
  released(stroke: Stroke, now: number): Modifier | null {
    const down = this.down
    if (down?.key !== stroke.key) {
      // Something let go of that was pressed before the tap began: a key held
      // through it, which makes it not alone.
      this.broken()
      return null
    }

    this.down = null
    if (now - down.at > WITHIN) {
      this.tap = null
      return null
    }

    const before = this.tap
    const twice = before?.key === down.key && down.at - before.at <= WITHIN

    if (twice && before.spent) {
      // Still the burst that already answered: Sticky Keys' five presses.
      this.tap = { key: down.key, at: now, spent: true }
      return null
    }

    this.tap = { key: down.key, at: now, spent: twice }
    return twice ? down.key : null
  }
}
