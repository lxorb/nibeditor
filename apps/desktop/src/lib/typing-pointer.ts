/** The pointer out of the way while somebody types, and back the moment the mouse
 *  moves: what Word does, what every text field on Windows and macOS does, and what
 *  Chrome and Edge do in a page since they started honouring Windows' own switch.
 *
 *  The engine used to do it for us, and it was turned off (b3162238) because it
 *  cannot do it here: the runtime hides the pointer from one browser process and
 *  only that process shows it again, while nib's window holds several - its own
 *  page and every web page's - so typing an address over a page left the pointer
 *  gone until it wandered back over the app. This is the same behaviour done inside
 *  the app's own page, as a style, so nothing another process does can leave it
 *  hidden and nothing here can reach a web page: over a page the pointer is that
 *  page's, whatever this one says.
 *
 *  What hides it: a key that writes - a character, Enter, Backspace, Delete, a
 *  composition - into something that takes words: a note, a card on a plane, any
 *  field. Not a shortcut, not an arrow, not a key in something that cannot be typed
 *  in. Never while a button is held, because a hand on the mouse is using it; and
 *  never after a touch, where there is no pointer to hide.
 *
 *  What shows it: the first move that actually moves, a press, and the window
 *  losing the keyboard. A move of nothing is the engine re-reading what is under a
 *  still pointer after the page moved beneath it, and is not somebody reaching for
 *  the mouse.
 *
 *  One listener object for the lot, and a key costs a few comparisons; the class on
 *  the root changes only when the answer does, so a hundred keys in a row restyle
 *  the page once. The move is listened for only while the pointer is hidden. */

/** The class that hides it, on the root. */
export const HIDDEN = 'nib-typing'

/** Over everything in the page, because whatever the pointer rests on has a cursor
 *  of its own - a text caret, a hand, a resize arrow - and each would win over the
 *  root's. */
const RULE = `:root.${HIDDEN}, :root.${HIDDEN} * { cursor: none !important; }`

/** Keys that are not a character and still write: a line, and a character taken
 *  back either way. */
const WRITING_KEYS = new Set(['Enter', 'Backspace', 'Delete'])

/** A key being composed into a character: an input method's, and a dead key's
 *  accent waiting for its letter. Both are somebody typing. */
const COMPOSING_KEYS = new Set(['Process', 'Dead'])

/** A key with a name rather than a character: `ArrowLeft`, `Tab`, `F5`, `Shift`.
 *  Every name the platform gives one is a capital and more letters or digits, and
 *  a key that writes carries the character it writes instead - one letter, or an
 *  emoji or a cluster that is more than one code unit but never a word. */
const NAMED_KEY = /^[A-Z][A-Za-z\d]+$/

/** The kinds of input nobody types words into. */
const WORDLESS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/** Whether a key writes, rather than moves or commands.
 *
 *  Ctrl and Cmd make a key a command, except that Windows reports AltGr as Ctrl and
 *  Alt together, and AltGr is how half of Europe types `@` and `{`. Alt alone is a
 *  command on Windows and Linux; on a Mac, Option is how `@` and `€` are typed on
 *  many layouts, so there it writes like any other character. */
export function writes(event: KeyboardEvent, mac: boolean): boolean {
  if (event.metaKey) return false

  const altGraph = event.getModifierState('AltGraph')
  if (event.ctrlKey && !altGraph) return false
  if (event.altKey && !altGraph && !mac) return false

  const key = event.key
  return WRITING_KEYS.has(key) || COMPOSING_KEYS.has(key) || (key !== '' && !NAMED_KEY.test(key))
}

/** Whether a key landing here would write anything: a field that takes words and
 *  is not locked, or editable text - which is what a note and a card are. */
export function takesWords(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled
  if (target instanceof HTMLInputElement) {
    return !WORDLESS.has(target.type) && !target.readOnly && !target.disabled
  }
  return target instanceof HTMLElement && target.isContentEditable
}

/** What the pointer is doing, and the one decision about it. The page is handed in
 *  as the root the class goes on and the window the move is listened on, so a test
 *  can hold both. */
export class TypingPointer {
  private hidden = false
  /** A button is down. */
  private held = false
  /** The last press was a finger or a pen, which leaves no pointer to hide. */
  private touched = false

  constructor(
    private readonly root: Element,
    private readonly listening: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
    private readonly mac: boolean,
  ) {}

  /** Every event this is registered for, by its name. The casts are the names:
   *  `keydown` is only ever a key, and the rest are only ever a pointer. */
  handleEvent(event: Event): void {
    switch (event.type) {
      case 'keydown':
        this.typed(event as KeyboardEvent)
        return
      case 'pointerdown':
        this.pressed(event as PointerEvent)
        return
      case 'pointerup':
      case 'pointercancel':
        this.held = false
        return
      case 'pointermove':
        this.moved(event as PointerEvent)
        return
      case 'blur':
        this.held = false
        this.show()
        return
    }
  }

  typed(event: KeyboardEvent): void {
    if (this.hidden || this.held || this.touched) return
    if (!writes(event, this.mac) || !takesWords(event.target)) return

    this.hidden = true
    this.root.classList.add(HIDDEN)
    this.listening.addEventListener('pointermove', this, true)
  }

  pressed(event: PointerEvent): void {
    this.touched = event.pointerType === 'touch' || event.pointerType === 'pen'
    this.held = !this.touched
    this.show()
  }

  moved(event: PointerEvent): void {
    if (event.movementX !== 0 || event.movementY !== 0) this.show()
  }

  show(): void {
    if (!this.hidden) return

    this.hidden = false
    this.root.classList.remove(HIDDEN)
    this.listening.removeEventListener('pointermove', this, true)
  }
}

/** Starts it for this window, where there is a pointer to hide at all: a phone has
 *  none, and nothing is listened for there. Answers how to stop. */
export function hidePointerWhileTyping(): () => void {
  if (!matchMedia('(any-pointer: fine)').matches) return () => undefined

  const style = document.createElement('style')
  style.textContent = RULE
  document.head.append(style)

  const mac = /Mac|iPhone|iPad/.test(navigator.userAgent)
  const pointer = new TypingPointer(document.documentElement, window, mac)
  const events = ['keydown', 'pointerdown', 'pointerup', 'pointercancel'] as const
  for (const one of events) window.addEventListener(one, pointer, true)
  // Not captured, so it is the window's own and not every field the focus leaves.
  window.addEventListener('blur', pointer)

  return () => {
    pointer.show()
    for (const one of events) window.removeEventListener(one, pointer, true)
    window.removeEventListener('blur', pointer)
    style.remove()
  }
}
