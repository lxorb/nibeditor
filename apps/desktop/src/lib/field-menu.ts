/** A text field's own menu: Cut, Copy, Paste and Select all.
 *
 *  Every system gives a field these four under the right button, and nib had taken
 *  them away: the window stops the browser's own menu everywhere (App.svelte), so the
 *  address bar, the search box, the find bar and a name being renamed answered a
 *  right click with nothing at all. This gives them back in nib's own menu, the same
 *  one every row and the editor use.
 *
 *  One rule rather than a menu per field, because a field is a field wherever it is:
 *  the window asks `textFieldOf` on the way down, before any row a field sits in can
 *  offer its own menu instead. The field keeps the keyboard while the menu is up, the
 *  way it does under the system's menu, because several of them act on losing it: a
 *  name is committed and an address goes back to the page's own. See ContextMenu.svelte.
 *
 *  A phone is left alone: pressing and holding in a field there brings the system's
 *  own handles and bar, which is what a thumb expects. */

import { copySelection, cutSelection, pasteInto } from './clipboard'
import { t } from './i18n.svelte'
import { showCombination } from './keys'
import { DIVIDER, type MenuEntry } from './menu-item'
import { shortcuts } from './shortcuts.svelte'

/** Something a person types a line or a paragraph into. */
export type TextField = HTMLInputElement | HTMLTextAreaElement

/** The kinds of `input` that hold text. A checkbox, a slider and a colour are inputs
 *  too and have nothing to cut. */
const TEXT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])

/** The text field a right click landed in, or null where it landed on anything else. */
export function textFieldOf(target: EventTarget | null): TextField | null {
  if (target instanceof HTMLTextAreaElement) return target
  if (target instanceof HTMLInputElement && TEXT_TYPES.has(target.type)) return target
  return null
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
