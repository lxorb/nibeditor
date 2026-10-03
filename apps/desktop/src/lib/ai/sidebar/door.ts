/** The one part of the AI panel the first paint holds: what Ctrl+Shift+A asks before it
 *  opens the panel. The panel, once it is on screen, answers whether the press was its
 *  own (the field had the keyboard, so the press means the thread list); until then
 *  nothing is listening and the key opens the panel as it always has. No imports, so it
 *  costs the launch nothing. */

let listener: (() => boolean) | null = null

/** Whether the panel took the press. */
export function askAgain(): boolean {
  return listener?.() ?? false
}

/** The panel's answer, while it is on screen; null as it goes. */
export function hearAgain(answer: (() => boolean) | null): void {
  listener = answer
}
