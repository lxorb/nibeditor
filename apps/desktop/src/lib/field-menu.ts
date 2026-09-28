/** A text field's own menu: Cut, Copy, Paste and Select all.
 *
 *  Every system gives a field these four under the right button, and nib had taken
 *  them away: the window stops the browser's own menu everywhere (App.svelte), so the
 *  address bar, the search box, the find bar and a name being renamed answered a
 *  right click with nothing at all. This gives them back in nib's own menu, the same
 *  one every row and the editor use.
 *
 *  One rule rather than a menu per field, because a field is a field wherever it is:
 *  the window asks `textFieldOf` (menu.svelte.ts) on the way down, before any row a
 *  field sits in can offer its own menu instead.
 *
 *  The field keeps the keyboard while the menu is up, the way it does under the
 *  system's menu, because several fields act on losing it: a name is committed and an
 *  address goes back to the page's own. So the menu takes no focus (`keepFocus`), a
 *  press on a row does not move it, and the rows are walked from the field instead:
 *  the arrows light one, Enter chooses it, Escape closes the menu and nothing else,
 *  and any other key closes it and goes on into the field.
 *
 *  Fetched on the first right click, or at the launch's last turn, whichever is
 *  first: the window's first paint has no use for it. See `warmDoors`.
 *
 *  A phone is left alone: pressing and holding in a field there brings the system's
 *  own handles and bar, which is what a thumb expects. */

import { copySelection, cutSelection } from './clipboard'
import { t } from './i18n.svelte'
import { showCombination } from './keys'
import { DIVIDER, type MenuEntry, walkableRows } from './menu-item'
import { menu, type TextField } from './menu.svelte'
import { shortcuts } from './shortcuts.svelte'
import { walked } from './walk'

/** Opens the field's menu at the pointer, leaving the keyboard in the field. */
export function showFieldMenu(event: MouseEvent, field: TextField): void {
  menu.show(event, fieldEntries(field), { keepFocus: true })
  window.removeEventListener('keydown', onKey, true)
  window.addEventListener('keydown', onKey, true)
}

const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta']

/** A key while the menu is up, read off the window before the field hears it. */
function onKey(event: KeyboardEvent): void {
  if (!menu.open || !menu.keepFocus) {
    window.removeEventListener('keydown', onKey, true)
    return
  }
  if (MODIFIERS.includes(event.key)) return

  const took = () => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const stops = walkableRows(menu.items)
  const at = stops.indexOf(menu.lit)
  const moved = walked(event.key, at < 0 ? null : at, stops.length, true)
  if (moved !== null) {
    took()
    menu.lit = stops[moved] ?? -1
    return
  }

  const row = menu.items[menu.lit]
  if (event.key === 'Escape' || event.key === 'Enter' || (event.key === ' ' && row)) took()
  menu.hide()
  if ((event.key === 'Enter' || event.key === ' ') && row) row.run()
}

/** Whether anything in the field is selected. A field that cannot say - an email or a
 *  number field has no selection it will report - is taken to have one, so the rows
 *  are offered and the browser decides. */
function selects(field: TextField): boolean {
  const { selectionStart: from, selectionEnd: to } = field
  return from === null || to === null || from !== to
}

/** The four rows, each greyed where it cannot happen: nothing selected to cut or copy,
 *  a field that may not be changed, a field with nothing in it to select. A password is
 *  never cut or copied, which is what every browser does with one. */
export function fieldEntries(field: TextField): MenuEntry[] {
  const locked = field.readOnly || field.disabled
  const secret = field instanceof HTMLInputElement && field.type === 'password'
  const selected = selects(field)

  return [
    {
      label: t('Cut'),
      hint: shortcuts.hint('fixed.cut'),
      disabled: !selected || locked || secret,
      run: cutSelection,
    },
    {
      label: t('Copy'),
      hint: shortcuts.hint('fixed.copy'),
      disabled: !selected || secret,
      run: copySelection,
    },
    {
      label: t('Paste'),
      hint: shortcuts.hint('fixed.paste'),
      disabled: locked,
      run: () => void pasteInto(field),
    },
    DIVIDER,
    {
      label: t('Select all'),
      // The field's own key, which no preference moves: `edit.select-all` is the
      // editor's and may be bound elsewhere.
      hint: showCombination('Mod-a', shortcuts.platform),
      disabled: field.value === '',
      run: () => field.select(),
    },
  ]
}

/** Pastes the clipboard's text into a field, over its selection.
 *
 *  Read through the Clipboard API, because a page may not ask the old command to
 *  paste; written with `insertText`, because that is the one way of changing a field
 *  that its own Ctrl+Z takes back and that the field hears as typing - an address
 *  field offering to finish what was pasted, a name field judging it. The range is
 *  written by hand only where the old command is refused, and then the field is told
 *  it changed. See clipboard.ts for why the old command at all. */
async function pasteInto(field: TextField): Promise<void> {
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
