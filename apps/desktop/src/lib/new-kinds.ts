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
 *  what type."*, and 2026-09-27: *"Ctrl + T should always open a webpage by default
 *  [...] we need an other modal, not just a small one but a proper modal in the centre
 *  of the screen."* And 2026-09-30: *"add terminal as a new type of thing that you can
 *  open when creating a new tab [...] if there are different kinds of terminals [...]
 *  then you should be able to choose"*. A terminal is the one kind that is a session
 *  rather than a document, and the one with more than one way to make it: the row makes
 *  the default shell and its chevron lists the rest; see `others` and docs/terminal.md. */

import type { FileMark } from './file-mark'
import { t } from './i18n.svelte'
import { menu, type MenuEntry } from './menu.svelte'
import { isDesktop } from './tauri'
import { openTerminal, shellRows } from './terminal/open'
import { shells } from './terminal/shells.svelte'
import { viewport } from './viewport.svelte'
import { type NewKind, workspace } from './workspace.svelte'

/** What a new tab can be: the kinds the file list also makes, and a terminal, which is
 *  a tab and never a file. */
export type NewKindName = NewKind | 'terminal'

export interface NewKindRow {
  kind: NewKindName
  label: () => string
  /** The shape the file list and the tab strip already draw for this kind, so the
   *  buttons in an empty pane wear what the rows wear; see file-mark.ts. */
  mark: FileMark
  /** The key that picks it in the dialog: its own first letter, as the code names it
   *  rather than as a language spells it, so the key is the same key in every one of
   *  them and the dialog can show it on the card. See NewKindSheet.svelte. */
  letter: string
  /** Makes one. In the pane named, where a caller has one - the pane whose plus was
   *  pressed takes the keyboard first - and otherwise in whichever pane has it. */
  make: (paneId?: string) => void
  /** The other ways to make one, for a kind that has more than one: a terminal's other
   *  shells. Pressing the row still makes the usual one, as VS Code's `+` does beside
   *  its `˅`; these are a chevron away. See `showOthers`. */
  others?: (paneId?: string) => Promise<MenuEntry[]>
  /** Gets those ready, for a chooser that has just opened: finding the shells is a
   *  question to the machine, asked when a chooser first needs it and not at launch. */
  ready?: () => void
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
      letter: 'n',
      make: (paneId) => inPane(paneId, () => workspace.openBlank()),
    },
    {
      kind: 'canvas',
      label: () => t('New canvas'),
      mark: 'canvas',
      letter: 'c',
      make: (paneId) => inPane(paneId, () => workspace.newCanvas()),
    },
    // A website is a bookmark on a phone - it opens in the phone's own browser and
    // there is no tab to make - so the row is left out there rather than offered and
    // answering nothing. See openWeb in workspace.svelte.ts. The glasses' plugin has no
    // web tab on any screen.
    ...(__EVEN_PLUGIN__ || viewport.device === 'phone'
      ? []
      : [
          {
            kind: 'web' as const,
            label: () => t('New web note'),
            mark: 'web' as const,
            letter: 'w',
            make: (paneId: string | undefined) => inPane(paneId, () => workspace.openWebsite()),
          },
        ]),
    {
      kind: 'pages',
      label: () => t('New page note'),
      mark: 'pages',
      letter: 'p',
      make: (paneId) => inPane(paneId, () => workspace.newPages()),
    },
    // A shell is a desktop's alone: a phone has no shell to give an app, a page in a
    // browser has no machine under it, and the glasses' plugin carries none of it. R,
    // because T is the chord's own step, and R is what Run has been on Windows for thirty
    // years. See docs/terminal.md.
    ...(!__EVEN_PLUGIN__ && isDesktop ? [terminalRow()] : []),
  ]
}

function terminalRow(): NewKindRow {
  return {
    kind: 'terminal',
    label: () => t('New terminal'),
    mark: 'terminal',
    letter: 'r',
    make: (paneId) => inPane(paneId, () => openTerminal()),
    others: (paneId) =>
      shellRows((shell) => {
        inPane(paneId, () => openTerminal(shell.id))
      }),
    ready: () => void shells.ask(),
  }
}

/** The same kinds as menu rows, in the same order and the same words. */
export function newKindMenu(paneId?: string): MenuEntry[] {
  return newKinds().map((one) => {
    const others = one.others
    return {
      label: one.label(),
      run: () => one.make(paneId),
      ...(others ? { more: () => others(paneId) } : {}),
    }
  })
}

/** Everything a chooser offers, got ready as it opens; see `ready`. */
export function readyKinds(kinds: readonly NewKindRow[]): void {
  for (const one of kinds) one.ready?.()
}

/** A kind's other ways, as a menu at the card that was asked: the chevron on it, or Shift
 *  held as it was chosen. `before` runs as one of them is chosen - the dialog closing
 *  itself. False for a kind that has no others, which the caller then makes as usual. */
export function showOthers(
  one: NewKindRow,
  card: Element,
  paneId?: string,
  before?: () => void,
): boolean {
  const others = one.others
  if (!others) return false

  const box = card.getBoundingClientRect()
  void others(paneId).then((rows) => {
    const at = new MouseEvent('contextmenu', { clientX: box.left, clientY: box.bottom })
    const choosing = rows.map((row) =>
      row === null
        ? row
        : {
            ...row,
            run: () => {
              before?.()
              row.run()
            },
          },
    )
    menu.show(at, choosing, { title: one.label() })
  })
  return true
}

/** The chooser, at the pointer: the plus, a held finger on it, the menu key over it.
 *  A menu rather than the dialog Ctrl+T opens, because the pointer is already at the
 *  plus and the rows arrive under it, where a dialog would send the hand to the middle
 *  of the window and back. On a phone the menu draws itself as a sheet from the
 *  bottom, which is what every other menu there does. */
export function showNewKinds(event: MouseEvent, paneId?: string) {
  readyKinds(newKinds())
  menu.show(event, newKindMenu(paneId), { title: t('New') })
}
