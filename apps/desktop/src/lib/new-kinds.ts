/** The kinds of document a new tab can be: one list, and the only one.
 *
 *  Five places offered these and no two of them offered the same set. The tab
 *  strip's plus had four, the File menu had the same four with no phone in mind,
 *  the sidebar's two menus had three and left page notes out, and the palette had
 *  six. A reader who found a kind in one place and looked for it in another found
 *  a different list, which is not one design; and there are three ways in now - the
 *  plus, Ctrl+T, and the buttons a pane with nothing open shows - so the list has
 *  to be somewhere they can all read it.
 *
 *  Data and one call each. What a kind is called, which mark it wears and what
 *  makes one, in the order a reader is offered them: a note first, which is what a
 *  strip is mostly filled with.
 *
 *  Every one of them opens a tab and writes nothing: no file in the space and no row in
 *  the list until somebody saves it. The file list's own New rows are the other gesture
 *  and still make a named file where they are asked to; see `newCanvas` and
 *  `createCanvas` in workspace.svelte.ts.
 *
 *  Emil, 2026-09-13: *"When you press on the plus for creating a new tab, then you
 *  should be able to choose between the different things (note, canvas, web note
 *  etc.)"*, and 2026-09-14: *"When you press Ctrl + T it shouldn't just be a new
 *  note, there should be a menu (as if you would click the +) where you can decide
 *  what type."* */

import type { FileMark } from './file-mark'
import { t } from './i18n.svelte'
import { menu, type MenuEntry } from './menu.svelte'
import { viewport } from './viewport.svelte'
import { type NewKind, workspace } from './workspace.svelte'

export interface NewKindRow {
  kind: NewKind
  label: () => string
  /** The shape the file list and the tab strip already draw for this kind, so the
   *  buttons in an empty pane wear what the rows wear; see file-mark.ts. */
  mark: FileMark
  /** Makes one. In the pane named, where a caller has one - the pane whose plus was
   *  pressed takes the keyboard first - and otherwise in whichever pane has it. */
  make: (paneId?: string) => void
}

/** Makes one in the pane that asked, so a plus in the other pane does not open its
 *  note over here. */
function inPane(paneId: string | undefined, make: () => unknown) {
  if (paneId !== undefined) workspace.focusPane(paneId)
  void make()
}

/** The kinds, as they are offered now. A function rather than a constant: a phone
 *  has one fewer, and what device this is can change under a window being
 *  resized. */
export function newKinds(): NewKindRow[] {
  return [
    {
      kind: 'note',
      label: () => t('New note'),
      mark: 'note',
      make: (paneId) => inPane(paneId, () => workspace.openBlank()),
    },
    {
      kind: 'canvas',
      label: () => t('New canvas'),
      mark: 'canvas',
      make: (paneId) => inPane(paneId, () => workspace.newCanvas()),
    },
    // A website is a bookmark on a phone - it opens in the phone's own browser and
    // there is no tab to make - so the row is left out there rather than offered and
    // answering nothing. See openWeb in workspace.svelte.ts.
    ...(viewport.device === 'phone'
      ? []
      : [
          {
            kind: 'web' as const,
            label: () => t('New web note'),
            mark: 'web' as const,
            make: (paneId: string | undefined) => inPane(paneId, () => workspace.openWebsite()),
          },
        ]),
    {
      kind: 'pages',
      label: () => t('New page note'),
      mark: 'pages',
      make: (paneId) => inPane(paneId, () => workspace.newPages()),
    },
  ]
}

/** The same kinds as menu rows. */
export function newKindMenu(paneId?: string): MenuEntry[] {
  return newKinds().map((one) => ({ label: one.label(), run: () => one.make(paneId) }))
}

/** The chooser, at the pointer. Every way in comes through here - the plus, a held
 *  finger, the menu key, Ctrl+T - so what is offered and what it is called cannot
 *  differ between them. On a phone the menu draws itself as a sheet from the bottom,
 *  which is what every other menu there does. */
export function showNewKinds(event: MouseEvent, paneId?: string) {
  menu.show(event, newKindMenu(paneId), { title: t('New') })
}
