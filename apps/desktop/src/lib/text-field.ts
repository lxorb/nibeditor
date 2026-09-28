/** Whether a right click landed in a text field; see field-menu.ts. */

export type TextField = HTMLInputElement | HTMLTextAreaElement

const TEXT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])

export function textFieldOf(target: EventTarget | null): TextField | null {
  if (target instanceof HTMLTextAreaElement) return target
  if (target instanceof HTMLInputElement && TEXT_TYPES.has(target.type)) return target
  return null
}
