/** Settings put back to what they started as, from either surface that offers it:
 *  a pane of the app's own Settings and the glasses' settings screen. See
 *  `resetPane` in preferences.ts and `resetGlasses` in even/settings.ts. */

import type { Field } from './preferences'

/** A field as a reset sees one, whichever kind it is.
 *
 *  Every kind of `Field` starts as, reads and writes one type - a switch booleans
 *  throughout, a slider numbers - which is why one comparison serves all five and
 *  nothing has to ask which kind it holds. The compiler takes a field of any kind as
 *  one of these because a method's parameter is compared both ways; what makes that
 *  true rather than merely allowed is the one type per kind. */
interface Resettable {
  initial?: boolean | number | string
  get(): boolean | number | string
  set(value: boolean | number | string): void
}

/** Puts every field that says what it started as back to that. Only the ones that
 *  differ are touched: a switch's setter may be a toggle, which would flip a value
 *  that was already right. */
export function resetFields(fields: Iterable<Field>): void {
  for (const field of fields) {
    const one: Resettable = field
    if (one.initial !== undefined && one.get() !== one.initial) one.set(one.initial)
  }
}
