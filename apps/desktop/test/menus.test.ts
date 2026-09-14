import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What the menus offer, read out of the components that compose them.
 *
 *  A menu is a list of entries built in the component that owns the thing being
 *  asked about, so there is no function a test can call for it. What can be
 *  read is the list itself: which entries a menu is written with, and whether
 *  the gesture that opens it is there for a pointer and for a finger both. That
 *  is what this does, in the way `tab-strip.test.ts` reads the strip's widths
 *  back out of its stylesheet. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const read = (name: string) => readFileSync(`${SOURCE}${name}`, 'utf8')

/** Every component in the app, for the rules that are about none of them in
 *  particular: what no menu anywhere may offer. */
function componentSources(): string[] {
  const out: string[] = []

  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.svelte')) out.push(readFileSync(path, 'utf8'))
    }
  }

  walk(SOURCE)
  return out
}

/** A function in a component's script, from its signature to the brace that
 *  closes it: every one of these sits at the top level of the script, so that
 *  brace is the first one indented by two. */
function body(text: string, signature: string): string {
  const from = text.indexOf(signature)
  expect(from, `no ${signature}`).toBeGreaterThanOrEqual(0)

  const to = text.indexOf('\n  }', from)
  expect(to, `${signature} is never closed`).toBeGreaterThan(from)

  return text.slice(from, to)
}

/** The same, for a function in a module rather than in a component: nothing is
 *  indented there, so the closing brace is the one at the left margin. */
function moduleBody(text: string, signature: string): string {
  const from = text.indexOf(signature)
  expect(from, `no ${signature}`).toBeGreaterThanOrEqual(0)

  const to = text.indexOf('\n}', from)
  expect(to, `${signature} is never closed`).toBeGreaterThan(from)

  return text.slice(from, to)
}

describe('what a space offers', () => {
  const space = moduleBody(read('lib/space-actions.ts'), 'export function spaceMenu(space: Space)')

  test('the space itself: its name, its mark, who may reach it', () => {
    for (const entry of ["t('Rename')", "t('Choose an icon')", "t('Share')", "t('Publish')"]) {
      expect(space, entry).toContain(entry)
    }
  })

  /** Both are the same question about the same folder, so they are neighbours
   *  rather than one at each end of the menu. */
  test('publishing stands next to sharing', () => {
    const share = space.indexOf("t('Share')")
    const publish = space.indexOf("t('Publish')")

    expect(publish).toBeGreaterThan(share)
    // Between the two words is nothing but the start of publishing's own entry.
    expect(space.slice(share, publish).match(/label:/g) ?? []).toHaveLength(1)
  })

  test('and not what to put in it, which is the file list', () => {
    expect(space).not.toContain("t('New note')")
  })

  test('a shared space still offers the way out of it', () => {
    expect(space).toContain("t('Leave space')")
  })

  /** The column of squares this order used to be dragged in is gone, so the
   *  menu is the whole of how a space is moved - and it is the same two rows on
   *  a desktop as under a thumb. */
  test('and where it sits, as a step in each direction', () => {
    expect(space).toContain("t('Move up')")
    expect(space).toContain("t('Move down')")
  })

  /** The order is a column of the account's own space rows, and the push writes
   *  it as one; a space somebody else shared is not a row there. So the move
   *  has to be asked about the role and not only about the ends of the list, or
   *  it is a row that looks like it worked and is back the next launch. */
  test('but not for a space somebody else shared', () => {
    const nudge = moduleBody(
      read('lib/space-actions.ts'),
      'function canNudge(space: Space, by: -1 | 1): boolean',
    )

    expect(nudge).toContain("roleOf(space.root) !== 'owner'")
  })

  /** One list of entries, reached from the row in the switcher, from a right
   *  click on it and from a held finger. */
  test('through the one menu the switcher opens, however it is asked for', () => {
    const switcher = read('lib/SpaceSwitcher.svelte')

    expect(switcher).toContain('menu.show(event, spaceMenu(space)')
    expect(switcher).toContain('oncontextmenu={(event) => about(event, space)}')
    expect(switcher).toContain('use:longPress={(event) => about(event, space)}')
  })
})

/** The folder behind a note is not something a menu talks about.
 *
 *  Nib is a notes app, not a file manager: the path a note is written at is how
 *  the app finds it, not something the reader is asked to hold. Both rows -
 *  "Reveal in Explorer" and "Copy path" - are gone from every menu and from the
 *  palette, and this is what says so if one comes back. What still reaches the
 *  file manager is an export the reader asked for and the app's own folders,
 *  which are commands about a file somebody just made rather than a row on every
 *  note; see export/save.ts and commands.ts. */
describe('the path a note sits at', () => {
  const everywhere = [
    ...componentSources(),
    read('lib/menu.svelte.ts'),
    read('lib/commands.ts'),
    read('lib/app-menu.ts'),
  ].join('\n')

  test('is not a row in any menu, on any device', () => {
    expect(everywhere).not.toContain("t('Reveal in Explorer')")
    expect(everywhere).not.toContain("t('Copy path')")
    expect(everywhere).not.toContain('revealEntry')
    expect(everywhere).not.toContain('copyPathEntry')
  })
})

/** Folders left the interface: a note that holds notes is the whole of how a
 *  space is organised, so nothing anywhere offers to make one and nothing draws a
 *  row as one. This is what says so if either comes back. See docs/tree.md. */
describe('making a folder', () => {
  const everywhere = [
    ...componentSources(),
    read('lib/row-menu.ts'),
    read('lib/menu.svelte.ts'),
    read('lib/commands.ts'),
    read('lib/app-menu.ts'),
    read('lib/shortcuts/registry.ts'),
  ].join('\n')

  test('is not offered anywhere, under any name', () => {
    expect(everywhere).not.toContain("t('New folder')")
    expect(everywhere).not.toContain('createFolder')
  })

  /** The mark went with the gesture, so there is not even a drawing of a folder
   *  left for a row to reach for; see file-mark.ts. */
  test('and no row can be drawn as one', () => {
    expect(read('lib/file-mark.ts')).not.toContain("'folder'")
    expect(everywhere).not.toContain("mark: 'folder'")
    expect(everywhere).not.toContain("'folder-open'")
  })
})

/** What a row in the file list offers about the thing it stands for. One menu for
 *  every row, because every row is one kind of thing - a note, which may hold
 *  notes - and it is a module of its own so its entries can be read as a list of
 *  labels; see row-menu.ts and row-menu.test.ts. A note's icon is written in its
 *  front matter, a canvas's under its `nib` key and a folder's in the space's own
 *  map, so the entries live in menu.svelte.ts and any list that shows a row can
 *  offer them. */
describe('what a row of the file list offers', () => {
  const tree = read('lib/Tree.svelte')
  const source = read('lib/row-menu.ts')
  const row = moduleBody(source, 'export function rowMenu(entry: Entry)')
  const entries = moduleBody(read('lib/menu.svelte.ts'), 'export function iconEntries(')

  test('opening it, its name, and where it goes', () => {
    for (const entry of ["t('Open')", "t('Rename')", 'moveEntry(entry)']) {
      expect(row, entry).toContain(entry)
    }
  })

  /** The one gesture that organises a space, on the row it organises. */
  test('a note inside it, which is how a note comes to hold notes', () => {
    expect(row).toContain("t('New note inside')")
    expect(row).toContain('workspace.createInside(entry.path)')
  })

  test('its icon, in the same words the rail uses for a space', () => {
    expect(row).toContain('iconEntries(marked.path, entry.is_dir && !own)')
    expect(entries).toContain("t('Choose an icon')")
  })

  test('and the way back to no icon, only while it wears one', () => {
    expect(entries).toContain("t('Remove icon')")
    expect(entries).toContain('chosenIcon(path) === null')
  })

  /** The picker is the sheet the rail opens, on the row this menu stands for. */
  test('choosing opens the one picker there is', () => {
    expect(entries).toContain('iconChoice.file(path)')
    expect(entries).toContain('iconChoice.folder(path)')
  })

  /** The note inside the folder where there is one, so the icon is written in the
   *  file the row is drawn as; the folder itself while no note has been written in
   *  it, since there is nowhere else to keep one. */
  test('on the note the row is drawn as, whichever that is', () => {
    expect(row).toContain('const marked = own ?? entry')
    expect(body(tree, 'function markPath(entry: Entry, own: Entry | null)')).toContain(
      'own?.path ?? entry.path',
    )
  })

  test('and deleting asks first where something is nested under it', () => {
    const removing = moduleBody(source, 'async function removeRow(')

    expect(removing).toContain('prompt.confirm')
    expect(removing).toContain("t('The notes inside it go too.')")
    expect(removing).toContain('workspace.remove(entry.path, true)')
  })

  /** A right click and a held finger, which is the right click a touch screen
   *  has: every entry is offered on a phone as well as on a desktop, and the menu
   *  is also the only way a row moves where there is no drag. */
  test('through the menu a pointer opens and the one a finger opens', () => {
    const drawn = tree.slice(tree.indexOf('data-path={entry.path}'))

    expect(drawn).toContain('oncontextmenu={(event) => menu.show(event, rowMenu(entry)')
    expect(drawn).toContain('use:longPress={(event) => menu.show(event, rowMenu(entry)')
  })
})

describe('what the plus in the tab strip offers', () => {
  const tabs = read('lib/Tabs.svelte')

  /** The plus button, from its class to the tag that closes it. */
  const plus = tabs.slice(
    tabs.indexOf('class="new"'),
    tabs.indexOf('</button>', tabs.indexOf('class="new"')),
  )

  /** Which kinds are offered is new-kinds.ts now and has its own test beside it:
   * three ways in - the plus, Ctrl+T, and the buttons a pane with nothing open
   * shows - and a list written in any one of them is a list the other two can
   * disagree with. What is left to read here is that the plus asks the shared one. */
  test('the kinds out of the one list, and no list of its own', () => {
    expect(tabs).toContain("import { showNewKinds } from './new-kinds'")
    expect(tabs).toContain('showNewKinds(event, paneId)')
    expect(tabs).not.toContain("t('New canvas')")
  })

  /** Ctrl+T presses this very button, so the chooser arrives under the plus rather
   * than in the corner of the window; the pane's own name on it is how the key finds
   * the plus of the pane that has the keyboard. See chooseNewKind in focus.ts. */
  test('says which pane it belongs to, so a chord can press it', () => {
    expect(plus).toContain('data-new={paneId}')

    const focus = read('lib/focus.ts')
    expect(focus).toContain('export function chooseNewKind()')
    expect(focus).toContain('[data-new="${CSS.escape(workspace.panes.focusedId)}"]')
  })

  /** Emil, 2026-09-13: *"When you press on the plus for creating a new tab, then you
   *  should be able to choose between the different things (note, canvas, web note
   *  etc.)."* So a press opens the chooser rather than making a note outright; a note
   *  is the first row, which is the tab a strip is mostly filled with. */
  test('a press opens the chooser, the gesture Emil asked for', () => {
    expect(plus).toContain('onclick={showNewMenu}')
  })

  /** A right click, the menu key a keyboard has - both arrive as `contextmenu` -
   *  and a held finger, which is the right click a touch screen has. */
  test('asked for the way every other menu in the app is', () => {
    expect(plus).toContain('oncontextmenu={showNewMenu}')
    expect(plus).toContain('use:longPress={showNewMenu}')
  })
})
