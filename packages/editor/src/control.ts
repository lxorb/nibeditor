/** Typing that is nothing but control characters types nothing. On a Mac a Ctrl
 *  chord the system does not bind arrives as the character it makes - Ctrl+Q as
 *  U+0011 - which nothing draws and the file kept. Tab and the line breaks are text,
 *  and a paste does not come this way. */

import { type Extension, Prec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** Whether every character is a C0 control or DEL, other than tab, LF and CR. */
export function unprintable(text: string): boolean {
  if (!text) return false
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) return false
  }
  return true
}

/** Ahead of every other input handler, so none of them acts on it first. */
export function refuseControlCharacters(): Extension {
  return Prec.highest(EditorView.inputHandler.of((_view, _from, _to, typed) => unprintable(typed)))
}
