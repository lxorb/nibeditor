/** Key combinations: reading them off a keystroke, writing them down, and
 *  showing them to a reader.
 *
 *  One notation throughout, CodeMirror's, because the editor's own keymap
 *  reads it: `Mod-Shift-k`, where `Mod` is Cmd on a Mac and Ctrl everywhere
 *  else. Storing that rather than a resolved `Ctrl-Shift-k` is what lets the
 *  same account carry one choice to a Mac and a PC and have it land on the
 *  key each of them expects.
 *
 *  Nothing here touches the DOM or the app's state, so all of it is testable
 *  with a plain object standing in for a keystroke. */

export type Platform = 'mac' | 'win' | 'linux'

export function currentPlatform(): Platform {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Mac|iPhone|iPad|iPod/.test(agent)) return 'mac'
  if (agent.includes('Windows')) return 'win'
  return 'linux'
}

export interface Combination {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  /** The key itself, as `KeyboardEvent.key` names it, with letters in lower
   *  case: `k`, `1`, `[`, `Enter`, `ArrowUp`, `F10`. */
  key: string
}

/** Which of Ctrl and Cmd `Mod` means here. */
const primary = (platform: Platform) => (platform === 'mac' ? 'meta' : 'ctrl')

/** Reads a written combination. Null when it is not one - an empty string, or
 *  a modifier nobody knows.
 *
 *  Split the way CodeMirror splits it, on every `-` except a trailing one, so
 *  `Mod--` is Mod and the minus key rather than Mod and nothing. */
export function parseCombination(text: string, platform: Platform): Combination | null {
  if (!text) return null

  const parts = text.split(/-(?!$)/)
  const combination: Combination = {
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: normalizeKey(parts.at(-1) ?? ''),
  }

  if (!combination.key) return null

  for (const modifier of parts.slice(0, -1)) {
    const name = modifier.toLowerCase()
    if (name === 'mod') combination[primary(platform)] = true
    else if (name === 'cmd' || name === 'meta' || name === 'm') combination.meta = true
    else if (name === 'ctrl' || name === 'control' || name === 'c') combination.ctrl = true
    else if (name === 'alt' || name === 'a' || name === 'option') combination.alt = true
    else if (name === 'shift' || name === 's') combination.shift = true
    else return null
  }

  return combination
}

/** A single letter is written in lower case, so `Mod-K` and `Mod-k` are the
 *  same combination; everything else keeps the name the browser gives it. */
function normalizeKey(key: string): string {
  if (key.length === 1) return key.toLowerCase()
  if (key === 'Space') return ' '
  return key
}

/** The combination written the way this app writes them: Mod, then Alt, then
 *  Shift, then the key. What goes to storage and to the account. */
function writeCombination(combination: Combination, platform: Platform): string {
  const parts: string[] = []
  const mod = primary(platform)

  if (combination[mod]) parts.push('Mod')
  if (mod !== 'ctrl' && combination.ctrl) parts.push('Ctrl')
  if (mod !== 'meta' && combination.meta) parts.push('Meta')
  if (combination.alt) parts.push('Alt')
  if (combination.shift) parts.push('Shift')

  parts.push(combination.key === ' ' ? 'Space' : combination.key)
  return parts.join('-')
}

/** Whether two written combinations are the same one. `Mod-Shift-k` and
 *  `Shift-Mod-K` are; so are `Mod-k` and `Ctrl-k` off a Mac. */
export function sameCombination(left: string, right: string, platform: Platform): boolean {
  const a = parseCombination(left, platform)
  const b = parseCombination(right, platform)
  if (!a || !b) return false

  return (
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.key === b.key
  )
}

/** The physical key behind a code, for the shifted characters.
 *
 *  Ctrl+Shift+= arrives as `+`, Ctrl+Shift+3 as `#`, and on a Mac Alt+5
 *  arrives as `[`. What was pressed is the same key either way, and the
 *  written combination names it unshifted, so the code is what to compare. */
const PHYSICAL: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
}

for (let digit = 0; digit <= 9; digit++) PHYSICAL[`Digit${digit}`] = String(digit)
for (let letter = 0; letter < 26; letter++) {
  PHYSICAL[`Key${String.fromCharCode(65 + letter)}`] = String.fromCharCode(97 + letter)
}

/** Just the modifiers, which on their own are not a combination. */
const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'CapsLock', 'OS', 'Dead'])

interface Keystroke {
  key: string
  code?: string | undefined
  ctrlKey?: boolean | undefined
  metaKey?: boolean | undefined
  altKey?: boolean | undefined
  shiftKey?: boolean | undefined
}

/** Which modifiers were down, as plain yes or no. A keystroke may arrive with
 *  them left out - a synthetic one, or an older recording - and "not there" is
 *  not held down. */
function held(event: Keystroke) {
  return {
    ctrl: event.ctrlKey ?? false,
    meta: event.metaKey ?? false,
    alt: event.altKey ?? false,
    shift: event.shiftKey ?? false,
  }
}

/** The character the physical key carries unshifted, when the code names one. */
function unshifted(event: Keystroke): string | undefined {
  return event.code === undefined ? undefined : PHYSICAL[event.code]
}

/** What was pressed, written down. Null while only modifiers are held, which
 *  is what the recorder waits through. */
export function readCombination(event: Keystroke, platform: Platform): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null

  const down = held(event)
  const physical = unshifted(event)
  // With Shift or Alt down the character on the key is not the key: the
  // combination is named after the key itself.
  const key =
    (down.shift || down.alt) && physical !== undefined ? physical : normalizeKey(event.key)
  if (!key) return null

  return writeCombination({ ...down, key }, platform)
}

/** Whether a keystroke is part of a chord rather than a key on its own.
 *
 *  What a widget that claims a bare key has to ask before it claims it. A list
 *  answers Space by opening the row the keyboard is on, and Ctrl+Shift+Space is
 *  not that Space: it is the space switcher, on its way to the window, and a list
 *  that took it and called `preventDefault` made that chord dead everywhere the
 *  keyboard could be in a list. The window's handler is the last one to run and
 *  gives way to anything already spent - see `handle` in shortcuts.svelte.ts - so
 *  every one of these is a chord nobody can press rather than a key that does two
 *  things.
 *
 *  Shift is not one of them, because Shift is how a keyboard writes half of what
 *  it writes and a widget's own keys include Shift+F10 and Shift+Tab. Ctrl, Alt
 *  and Cmd are: nothing in this app binds a bare key under one of them to anything
 *  but a command.
 *
 *  Here rather than in each of them, because "what is a chord" is the same
 *  question `matchesCombination` answers from the other side. */
export function chorded(event: Keystroke): boolean {
  const down = held(event)
  return down.ctrl || down.meta || down.alt
}

/** Whether a chord's key is a digit, which is the one class of key a layout puts
 *  behind Shift. See `matchesCombination`. */
function isDigit(key: string): boolean {
  return key.length === 1 && key >= '0' && key <= '9'
}

/** Whether a keystroke is the written combination.
 *
 *  Both names of the key are allowed - the character it produced and the key
 *  it was - so `Mod-Shift-3` answers to Ctrl+Shift+3 on a layout where that
 *  makes a `#` and on one where it makes a `§`. The modifiers have to match
 *  exactly: Ctrl+Alt+S is not Ctrl+S with something extra held down.
 *
 *  With one exception, and it is a whole keyboard's worth. On AZERTY the digits are
 *  the shifted characters of the top row: Shift is how that row makes a nought at
 *  all, so a French reader pressing what is printed as Ctrl+0 has Shift down, and
 *  exact modifiers made Ctrl+0 a chord nobody there could press. Every browser reads
 *  its own Ctrl+0 by the key rather than by the character, and so does this: where
 *  the chord wants a digit and no Shift, the key underneath decides and the Shift the
 *  layout needed is forgiven.
 *
 *  Digits only. A letter is two names for one key - `E` and `e` - so forgiving Shift
 *  there would make Ctrl+Shift+E fire Ctrl+E as well, and a chord that asks for Shift
 *  is still matched exactly, so nothing can be both. */
export function matchesCombination(text: string, event: Keystroke, platform: Platform): boolean {
  const wanted = parseCombination(text, platform)
  if (!wanted) return false

  const down = held(event)
  if (wanted.ctrl !== down.ctrl) return false
  if (wanted.meta !== down.meta) return false
  if (wanted.alt !== down.alt) return false

  if (wanted.shift !== down.shift) {
    // The one forgiveness, and the code has to name the very key: a digit typed on a
    // layout that needs Shift for it.
    if (wanted.shift || !isDigit(wanted.key)) return false
    return wanted.key === unshifted(event)
  }

  return wanted.key === normalizeKey(event.key) || wanted.key === unshifted(event)
}

/** How a key reads on a Mac, where modifiers are signs rather than words. */
const SIGNS = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }

/** Names for keys whose own name is too long, or is a word in English that
 *  every keyboard prints as an arrow anyway. */
const SHOWN: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Delete: 'Del',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ' ': 'Space',
  // The key beside the right Ctrl with a picture of a menu on it. `ContextMenu` is
  // a browser's word for it and is printed on no keyboard anywhere.
  ContextMenu: 'Menu',
}

/** The combination as a reader sees it: `⌘⇧K` on a Mac, `Ctrl+Shift+K`
 *  everywhere else. An unreadable one comes back as it was written, which is
 *  better than an empty box. */
export function showCombination(text: string, platform: Platform): string {
  const combination = parseCombination(text, platform)
  if (!combination) return text

  const key =
    SHOWN[combination.key] ??
    (combination.key.length === 1 ? combination.key.toUpperCase() : combination.key)

  if (platform === 'mac') {
    return (
      (combination.ctrl ? SIGNS.ctrl : '') +
      (combination.alt ? SIGNS.alt : '') +
      (combination.shift ? SIGNS.shift : '') +
      (combination.meta ? SIGNS.meta : '') +
      key
    )
  }

  const parts: string[] = []
  if (combination.ctrl) parts.push('Ctrl')
  // What the key with the flag on it is called where this is read: `Meta` is a
  // browser's word for it and is printed on no keyboard anywhere.
  if (combination.meta) parts.push(platform === 'win' ? 'Win' : 'Super')
  if (combination.alt) parts.push('Alt')
  if (combination.shift) parts.push('Shift')
  parts.push(key)

  return parts.join('+')
}
