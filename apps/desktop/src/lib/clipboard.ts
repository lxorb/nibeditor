/** Cut, copy and paste, as a menu row means them.
 *
 *  `document.execCommand` is deprecated and there is nothing that replaces it
 *  here. The Clipboard API can write text, but a menu row for Cut has to take
 *  the selection out of whatever holds it as well - a note, a name being
 *  renamed, the token box in the connector pane - and only the browser knows
 *  which of those has the focus. So the old command stays, in one place, with
 *  the deprecation acknowledged once rather than at five call sites. */

/** Copies the selection, wherever it is. */
export function copySelection(): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the Clipboard API cannot read the focused element's selection
  document.execCommand('copy')
}

/** Copies the selection and takes it out. */
export function cutSelection(): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- nothing in the Clipboard API removes the selection it copied
  document.execCommand('cut')
}

/** Puts `text` on the clipboard from outside a text field: the connector's
 *  token and its config block, which are shown rather than selected.
 *
 *  The Clipboard API first, because it is the one that works in a webview
 *  without a document selection. A hidden field and the old command stand in
 *  where it is refused - an unfocused document, or a webview that never got
 *  the permission. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Fall through to the selection below.
  }

  const scratch = document.createElement('textarea')
  scratch.value = text
  scratch.setAttribute('readonly', '')
  scratch.style.position = 'fixed'
  scratch.style.opacity = '0'
  document.body.append(scratch)
  scratch.select()
  copySelection()
  scratch.remove()
}

/** Pastes the clipboard's text into a field, over its selection.
 *
 *  Read through the Clipboard API, because a page may not ask the old command to
 *  paste; written with `insertText`, because that is the one way of changing a
 *  field that its own Ctrl+Z takes back and that the field hears as typing - an
 *  address field offering to finish what was pasted, a name field judging it. The
 *  range is written by hand only where the old command is refused, and then the
 *  field is told it changed. */
export async function pasteInto(field: HTMLInputElement | HTMLTextAreaElement): Promise<void> {
  const text = await navigator.clipboard.readText().catch(() => '')
  if (!text) return

  field.focus()
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only edit a field's own undo keeps
  if (document.execCommand('insertText', false, text)) return

  const end = field.value.length
  try {
    field.setRangeText(text, field.selectionStart ?? end, field.selectionEnd ?? end, 'end')
  } catch {
    // A field with no selection to write over - an email or a number field - takes it
    // at the end, which is where a caret it cannot say would be.
    field.value += text
  }
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
