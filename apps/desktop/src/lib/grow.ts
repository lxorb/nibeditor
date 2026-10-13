/** A field that grows with what is written in it, where the stylesheet cannot say so.
 *
 *  `field-sizing: content` is the whole of it in Chrome and in WebKit from Safari 26.2;
 *  a Mac on an older Safari ignores it, and a composer written for it sat at one line
 *  and scrolled whatever was typed. There, this sizes the field to its words on every
 *  change - typed, or written by the app, which the action is handed as its value - and
 *  the stylesheet's own `max-height` still says where it stops and scrolls. Nothing at
 *  all where the engine sizes the field itself. */

import type { Action } from 'svelte/action'

const SIZES_ITSELF = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content')

export const grow: Action<HTMLTextAreaElement, unknown> = (field) => {
  if (SIZES_ITSELF) return {}

  const fit = () => {
    const style = getComputedStyle(field)
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    field.style.height = 'auto'
    field.style.height = `${String(field.scrollHeight + borders)}px`
  }

  field.addEventListener('input', fit)
  fit()

  return {
    // After the frame the value was written in, which is when it is the field's.
    update: () => requestAnimationFrame(fit),
    destroy: () => field.removeEventListener('input', fit),
  }
}
