/** The platform's material behind the window: Mica Alt on Windows 11, Acrylic on 10.
 *
 *  Worn by the glass theme and nothing else, and fetched only by it. It was a switch of
 *  its own once, and showed next to nothing: it took the window's ground away and every
 *  surface painted over the ground. A theme is what can say which surfaces stand on it.
 *
 *  Two halves have to agree - the crate puts the material behind the window, and
 *  `data-translucent` on the root takes the page's ground away over it (base.css) - and
 *  out of step the page can have nothing under it at all, which is the desk behind the
 *  words. So on is the material first and the attribute once the crate has answered;
 *  off is the attribute first. The attribute says which material, because Mica keeps its
 *  own brightness and Acrylic does not, and glass.css leans on that. At launch the
 *  attribute is already said, from what was written down; see `standAsBefore`. */

import { MATERIAL_KEY, rememberGround } from './ground'
import { forget, keep } from './stored'
import { invoke, isDesktop } from './tauri'

/** What was last asked, so nothing is asked twice. */
let worn: { on: boolean; dark: boolean } | null = null
/** What the crate last said the window stands on, and whether an answer is due. */
let standing: string | null = null
let pending = false
/** Whether the answer is written down for the next launch: a choice is, what the
 *  picker only shows is not. Raised by a choice that asks what a preview asked. */
let keeping = false
/** The latest request; an older answer says nothing. */
let asked = 0

function say(kind: string | null): void {
  standing = kind
  const said = document.documentElement.dataset
  if (kind) said.translucent = kind
  else delete said.translucent
}

function remember(): void {
  if (standing) keep(MATERIAL_KEY, standing)
  else forget(MATERIAL_KEY)
  rememberGround()
}

/** On or off, in the page's scheme, which is what Mica is tinted by. */
export function wearMaterial(on: boolean, dark: boolean, kept: boolean): void {
  if (!isDesktop) return

  if (worn?.on === on && worn.dark === dark) {
    if (pending) {
      keeping ||= kept
      return
    }
    // Said again, which is nothing where it is said already.
    say(standing)
    if (kept) remember()
    return
  }

  worn = { on, dark }
  keeping = kept
  const asking = ++asked

  if (!on) {
    pending = false
    say(null)
    if (keeping) remember()
    // Off never fails: a window with nothing behind it has nothing to take away.
    void invoke('set_translucency', { on: false, dark }).catch(() => undefined)
    return
  }

  pending = true
  const answered = (kind: string | null) => {
    if (asking !== asked) return
    pending = false
    say(kind)
    if (keeping) remember()
  }
  // Refused where there is nothing to stand on - Linux, the presenter's window - and
  // glass then stands on its own ground, which is a colour.
  void invoke<string>('set_translucency', { on: true, dark }).then(answered, () => answered(null))
}
