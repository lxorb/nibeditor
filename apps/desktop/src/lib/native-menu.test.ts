import { describe, expect, test } from 'vitest'
import { matchesCombination, readCombination } from './keys'
import { DIVIDER, type MenuGroup, type MenuItem } from './menu-item'
import {
  changesBetween,
  chordFor,
  describeMenuBar,
  documentWindows,
  keyRuns,
  keystrokeOf,
  letPass,
  leftFullscreen,
  type MenuBarSources,
  type NativeEntry,
  type NativeItem,
  type NativeSubmenu,
  type SeenKey,
  titled,
  toAccelerator,
} from './native-menu'

const KEYS: Record<string, string> = {
  'app.new': 'Mod-n',
  'app.new-kind': 'Mod-t',
  'app.open': 'Mod-o',
  'app.save': 'Mod-s',
  'app.settings': 'Mod-,',
  'app.close': 'Mod-w',
  'app.fullscreen': 'Mod-Ctrl-f',
  'app.next-note': 'Ctrl-Tab',
  'app.keys': 'Mod-Shift-/',
  'edit.undo': 'Mod-z',
  'edit.redo': 'Mod-Shift-z',
  'fixed.copy': 'Mod-c',
  'fixed.paste': 'Mod-v',
  'edit.select-all': 'Mod-a',
  'edit.paste-plain': 'Mod-Shift-v',
  'format.bold': 'Mod-b',
  // A second row on a key a system row holds.
  'format.clash': 'Mod-q',
}

const row = (label: string, command?: string, extra: Partial<MenuItem> = {}): MenuItem => ({
  label,
  ...(command ? { command } : {}),
  run: () => undefined,
  ...extra,
})

const GROUPS: MenuGroup[] = [
  {
    id: 'file',
    label: 'File',
    rows: [
      row('Print', 'app.print'),
      DIVIDER,
      row('Version history', undefined, { disabled: true }),
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    rows: [
      row('Undo', 'edit.undo'),
      row('Redo', 'edit.redo'),
      DIVIDER,
      row('Copy', 'fixed.copy'),
      row('Paste', 'fixed.paste'),
      row('Paste as plain text', 'edit.paste-plain'),
      row('Select all', 'edit.select-all'),
    ],
  },
  {
    id: 'format',
    label: 'Format',
    rows: [
      row('Bold', 'format.bold'),
      row('Clash', 'format.clash'),
      { label: 'Colour', rows: [row('Red', undefined, { checked: true }), row('Blue')] },
    ],
  },
  {
    id: 'view',
    label: 'View',
    rows: [row('Fullscreen', 'app.fullscreen', { checked: false })],
  },
  { id: 'help', label: 'Help', rows: [row('Source code')] },
]

const WORDS = {
  app: 'Nib',
  about: 'About Nib',
  services: 'Services',
  hide: 'Hide Nib',
  hideOthers: 'Hide others',
  showAll: 'Show all',
  quit: 'Quit Nib',
  window: 'Window',
  minimize: 'Minimize',
  zoom: 'Zoom',
  bringAllToFront: 'Bring all to front',
  openRecent: 'Open recent',
  clearMenu: 'Clear menu',
  find: 'Find',
}

function sources(over: Partial<MenuBarSources> = {}): MenuBarSources {
  return {
    groups: GROUPS,
    file: {
      opening: [
        row('New note', 'app.new'),
        row('New tab', 'app.new-kind'),
        row('Open file', 'app.open'),
        DIVIDER,
        row('Save', 'app.save'),
      ],
      closing: [row('Close note', 'app.close')],
    },
    settings: row('Settings', 'app.settings'),
    recent: [row('One.md'), row('Two.md')],
    clearRecent: () => undefined,
    windowRows: [row('Next note', 'app.next-note')],
    helpRows: [row('Keyboard shortcuts', 'app.keys')],
    keyFor: (command) => KEYS[command] ?? null,
    isWindowCommand: (command) => command.startsWith('app.'),
    words: WORDS,
    english: false,
    ...over,
  }
}

const bar = (over: Partial<MenuBarSources> = {}) => describeMenuBar(sources(over)).entries

function menu(entries: NativeEntry[], id: string): NativeSubmenu {
  const found = entries.find((one) => one.id === id)
  if (found?.kind !== 'submenu') throw new Error(`no ${id} menu`)
  return found
}

/** A menu's rows the way they read: a word, or a line for a rule. */
function read(submenu: NativeSubmenu): string[] {
  return submenu.items.map((one) => {
    if (one.kind === 'rule') return '---'
    if (one.kind === 'system') return `[${one.item}] ${one.text}`
    return one.text
  })
}

function itemIn(submenu: NativeSubmenu, text: string): NativeItem {
  const found = submenu.items.find((one) => one.kind === 'item' && one.text === text)
  if (found?.kind !== 'item') throw new Error(`no ${text} row`)
  return found
}

describe('a key as a Mac menu row writes it', () => {
  test('Mod is Command, and the letter is upper case', () => {
    expect(toAccelerator('Mod-s')).toBe('Cmd+S')
    expect(toAccelerator('Mod-Shift-k')).toBe('Cmd+Shift+K')
  })

  test('with the modifiers in one order however they were written', () => {
    expect(toAccelerator('Mod-Ctrl-f')).toBe('Cmd+Ctrl+F')
    expect(toAccelerator('Ctrl-Mod-f')).toBe('Cmd+Ctrl+F')
    expect(toAccelerator('Shift-Alt-Mod-1')).toBe('Cmd+Alt+Shift+1')
  })

  test('names the keys that are words the way Tauri reads them', () => {
    expect(toAccelerator('Ctrl-Tab')).toBe('Ctrl+Tab')
    expect(toAccelerator('Mod-Alt-ArrowRight')).toBe('Cmd+Alt+Right')
    expect(toAccelerator('Mod-PageDown')).toBe('Cmd+PageDown')
    expect(toAccelerator('Mod-Shift-Space')).toBe('Cmd+Shift+Space')
  })

  test('keeps punctuation as itself, the minus key included', () => {
    expect(toAccelerator('Mod--')).toBe('Cmd+-')
    expect(toAccelerator('Mod-=')).toBe('Cmd+=')
    expect(toAccelerator('Mod-,')).toBe('Cmd+,')
    expect(toAccelerator('Mod-Shift-/')).toBe('Cmd+Shift+/')
    expect(toAccelerator('Ctrl-[')).toBe('Ctrl+[')
  })

  test('lets a function key stand alone', () => {
    expect(toAccelerator('F11')).toBe('F11')
    expect(toAccelerator('Shift-F6')).toBe('Shift+F6')
  })

  test('refuses a bare key that is typed, which would take it from every field', () => {
    expect(toAccelerator('Enter')).toBeNull()
    expect(toAccelerator('Escape')).toBeNull()
    expect(toAccelerator('Shift-a')).toBeNull()
  })

  test('refuses a key Tauri has no name for, rather than break the whole strip', () => {
    expect(toAccelerator('Mod-ContextMenu')).toBeNull()
    expect(toAccelerator('Mod-+')).toBeNull()
    expect(toAccelerator('')).toBeNull()
  })
})

/** The palette is Shift twice, and a key equivalent is a chord: its row says the
 *  second key, which is Cmd+P. */
describe('a key a menu row can show', () => {
  const keys: Record<string, string | null> = {
    'app.palette': 'Shift Shift',
    'app.palette.alt': 'Mod-p',
    'app.save': 'Mod-s',
    'app.graph': 'Alt Alt',
  }
  const keyFor = (command: string) => keys[command] ?? null

  test('is the chord a command has, or its second key where it has a tap', () => {
    expect(chordFor(keyFor, 'app.save')).toBe('Mod-s')
    expect(chordFor(keyFor, 'app.palette')).toBe('Mod-p')
    expect(toAccelerator(chordFor(keyFor, 'app.palette') ?? '')).toBe('Cmd+P')
  })

  test('is nothing for a tap with no second key', () => {
    expect(chordFor(keyFor, 'app.graph')).toBeNull()
  })
})

describe('the strip', () => {
  test('is the app menu, the app’s own groups, then Window just before Help', () => {
    expect(bar().map((one) => one.id)).toEqual([
      'nib',
      'file',
      'edit',
      'format',
      'view',
      'window',
      'help',
    ])
  })

  test('opens with the app’s own menu, the way every Mac app does', () => {
    expect(read(menu(bar(), 'nib'))).toEqual([
      '[About] About Nib',
      '---',
      'Settings…',
      '---',
      '[Services] Services',
      '---',
      '[Hide] Hide Nib',
      '[HideOthers] Hide others',
      '[ShowAll] Show all',
      '---',
      '[Quit] Quit Nib',
    ])
  })

  test('where Settings has its key, and File no longer has it', () => {
    expect(itemIn(menu(bar(), 'nib'), 'Settings…').accelerator).toBe('Cmd+,')
    expect(read(menu(bar(), 'file'))).not.toContain('Settings')
  })

  /** The in-window File menu is Export, Print and Version history and nothing else
   *  (Emil, 2026-09-30). A Mac's keeps what a Mac's File menu has, and with a web tab
   *  in front a key is only a key there as a row. */
  test('File has the making, opening and closing rows around the in-window menu’s', () => {
    const file = menu(bar(), 'file')
    expect(read(file)).toEqual([
      'New note',
      'New tab',
      'Open file',
      'Open recent',
      '---',
      'Save',
      '---',
      'Print',
      '---',
      'Version history',
      '---',
      'Close note',
    ])
    expect(itemIn(file, 'New tab').accelerator).toBe('Cmd+T')
    expect(itemIn(file, 'Save').accelerator).toBe('Cmd+S')
    expect(itemIn(file, 'Close note').accelerator).toBe('Cmd+W')
  })

  test('and no doubled rule where the in-window menu has nothing under File', () => {
    const groups = GROUPS.map((one) => (one.id === 'file' ? { ...one, rows: [] } : one))
    expect(read(menu(bar({ groups }), 'file'))).toEqual([
      'New note',
      'New tab',
      'Open file',
      'Open recent',
      '---',
      'Save',
      '---',
      'Close note',
    ])
  })

  test('Open Recent lists the notes and a way to clear them', () => {
    expect(read(menu(menu(bar(), 'file').items, 'file.3'))).toEqual([
      'One.md',
      'Two.md',
      '---',
      'Clear menu',
    ])
  })

  test('and with none, only a greyed Clear Menu', () => {
    const recent = menu(menu(bar({ recent: [] }), 'file').items, 'file.3')
    expect(read(recent)).toEqual(['Clear menu'])
    expect(itemIn(recent, 'Clear menu').enabled).toBe(false)
  })

  test('Edit’s clipboard rows are the system’s, so they reach a field and a web page', () => {
    expect(read(menu(bar(), 'edit'))).toEqual([
      'Undo',
      'Redo',
      '---',
      '[Copy] Copy',
      '[Paste] Paste',
      'Paste as plain text',
      'Select all',
    ])
  })

  /** AppKit's Undo reached WebKit's history, which holds only what was typed. */
  test('and its Undo, Redo and Select All are the app’s, standing in for the system’s', () => {
    const edit = menu(bar(), 'edit')
    expect(itemIn(edit, 'Undo')).toMatchObject({
      accelerator: 'Cmd+Z',
      key: 'Mod-z',
      standIn: 'undo',
    })
    expect(itemIn(edit, 'Redo')).toMatchObject({ accelerator: 'Cmd+Shift+Z', standIn: 'redo' })
    expect(itemIn(edit, 'Select all')).toMatchObject({
      accelerator: 'Cmd+A',
      standIn: 'selectAll',
    })
    expect(itemIn(edit, 'Paste as plain text').standIn).toBeUndefined()
  })

  /** A canvas has no note behind it, and its own undo is what the key is for. */
  test('which serve whatever has the keyboard, so the note cannot grey them', () => {
    const greyed: MenuGroup = {
      id: 'edit',
      label: 'Edit',
      rows: [
        row('Undo', 'edit.undo', { disabled: true }),
        row('Paste as plain text', 'edit.paste-plain', { disabled: true }),
      ],
    }
    const edit = menu(bar({ groups: [greyed] }), 'edit')
    expect(itemIn(edit, 'Undo')).toMatchObject({ enabled: true, anywhere: true })
    expect(itemIn(edit, 'Paste as plain text')).toMatchObject({ enabled: false, anywhere: false })
  })

  test('Window is the system’s, with walking the tabs in it', () => {
    const window = menu(bar(), 'window')
    expect(window.role).toBe('window')
    expect(read(window)).toEqual([
      '[Minimize] Minimize',
      '[Maximize] Zoom',
      '---',
      'Next note',
      '---',
      '[BringAllToFront] Bring all to front',
    ])
    expect(itemIn(window, 'Next note').accelerator).toBe('Ctrl+Tab')
  })

  /** Shift+Cmd+? is the search field at the top of every Mac app's Help menu, and
   *  AppKit puts it there only in a menu it is told is Help, or one titled in English. */
  test('Help is the system’s, and opens with the list of keys', () => {
    const help = menu(bar(), 'help')
    expect(help.role).toBe('help')
    expect(read(help)).toEqual(['Keyboard shortcuts', '---', 'Source code'])
  })

  test('keeps the ticks, the greys and the nesting', () => {
    const format = menu(bar(), 'format')
    const colour = menu(format.items, 'format.2')
    expect(read(colour)).toEqual(['Red', 'Blue'])
    expect(itemIn(colour, 'Red').checked).toBe(true)
    expect(itemIn(colour, 'Blue').checked).toBeUndefined()
    expect(itemIn(menu(bar(), 'view'), 'Fullscreen')).toMatchObject({
      checked: false,
      accelerator: 'Cmd+Ctrl+F',
    })
    expect(itemIn(menu(bar(), 'file'), 'Version history').enabled).toBe(false)
  })

  test('gives no row a key a system row holds', () => {
    expect(itemIn(menu(bar(), 'format'), 'Clash')).toMatchObject({ accelerator: null, key: null })
  })

  test('gives a key to one row only', () => {
    const doubled: MenuGroup = {
      id: 'format',
      label: 'Format',
      rows: [row('Bold', 'format.bold'), row('Again', 'format.bold')],
    }
    const format = menu(bar({ groups: [doubled] }), 'format')
    expect(itemIn(format, 'Bold').accelerator).toBe('Cmd+B')
    expect(itemIn(format, 'Again').accelerator).toBeNull()
  })

  test('knows a row of the window’s from a row of the note’s', () => {
    expect(itemIn(menu(bar(), 'file'), 'Close note').anywhere).toBe(true)
    expect(itemIn(menu(bar(), 'format'), 'Bold').anywhere).toBe(false)
    // A row with no command at all is only ever clicked.
    expect(itemIn(menu(bar(), 'file'), 'Version history')).toMatchObject({
      anywhere: true,
      key: null,
    })
  })

  test('runs each row’s own function, by the row’s id', () => {
    const ran: string[] = []
    const groups: MenuGroup[] = [
      {
        id: 'view',
        label: 'View',
        rows: [row('Focus', undefined, { run: () => ran.push('focus') })],
      },
    ]
    const { runs } = describeMenuBar(sources({ groups }))
    runs.get('view.0')?.()
    expect(ran).toEqual(['focus'])
  })
})

describe('the strip, changed', () => {
  test('in place, where only a tick, a grey, a word or a key moved', () => {
    const before = bar()
    const view: MenuGroup = {
      id: 'view',
      label: 'View',
      rows: [row('Fullscreen', 'app.fullscreen', { checked: true })],
    }
    const file = {
      ...GROUPS[0]!,
      rows: GROUPS[0]!.rows.map((one) =>
        one && 'label' in one && one.label === 'Version history'
          ? { ...one, disabled: false }
          : one,
      ),
    }
    const after = bar({
      groups: GROUPS.map((one) => (one.id === 'view' ? view : one.id === 'file' ? file : one)),
      keyFor: (command) => (command === 'format.bold' ? 'Mod-Shift-b' : (KEYS[command] ?? null)),
      words: { ...WORDS, quit: 'Nib beenden' },
    })

    expect(changesBetween(before, after)).toEqual([
      { id: 'nib.quit', text: 'Nib beenden' },
      { id: 'file.9', enabled: true },
      { id: 'format.0', accelerator: 'Cmd+Shift+B' },
      { id: 'view.0', checked: true },
    ])
  })

  test('not at all when nothing did', () => {
    expect(changesBetween(bar(), bar())).toEqual([])
  })

  test('built again when a row came or went', () => {
    expect(changesBetween(bar(), bar({ recent: [row('One.md')] }))).toBeNull()
  })

  test('and when a row became a different kind of thing', () => {
    const plain: MenuGroup = {
      id: 'view',
      label: 'View',
      rows: [row('Fullscreen', 'app.fullscreen')],
    }
    const groups = GROUPS.map((one) => (one.id === 'view' ? plain : one))
    expect(changesBetween(bar(), bar({ groups }))).toBeNull()
  })
})

describe('a key the page let pass', () => {
  const event = (extra: Partial<SeenKey['event']> = {}): SeenKey['event'] => ({
    key: 'b',
    code: 'KeyB',
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    ...extra,
  })

  test('is the one the page saw a moment ago and did not act on', () => {
    expect(letPass('Mod-b', { event: event(), at: 1000 }, 1050)).toBe(true)
  })

  test('is not one the page acted on, which never reaches the menu at all', () => {
    expect(letPass('Mod-b', { event: event({ defaultPrevented: true }), at: 1000 }, 1050)).toBe(
      false,
    )
  })

  test('is not another key, nor one from long ago, nor one the page never saw', () => {
    expect(letPass('Mod-i', { event: event(), at: 1000 }, 1050)).toBe(false)
    expect(letPass('Mod-b', { event: event(), at: 1000 }, 5000)).toBe(false)
    expect(letPass('Mod-b', null, 1050)).toBe(false)
  })
})

describe('full screen, left by the window', () => {
  test('takes the app’s own with it', () => {
    expect(leftFullscreen(true, false, true)).toBe(true)
  })

  test('and nothing else does', () => {
    expect(leftFullscreen(false, true, false)).toBe(false)
    expect(leftFullscreen(false, false, true)).toBe(false)
    expect(leftFullscreen(true, true, true)).toBe(false)
    expect(leftFullscreen(true, false, false)).toBe(false)
  })
})

/** Each document window builds a strip of its own, and AppKit adds a line to a menu
 *  every time it is told that menu is the Window menu. How many strips there are
 *  decides whether a window coming back to the front needs a fresh one. */
describe('the windows that have a strip of their own', () => {
  test('are the first window and the ones opened after it', () => {
    expect(documentWindows(['main'])).toBe(1)
    expect(documentWindows(['main', 'nib-2', 'nib-17'])).toBe(3)
  })

  test('and not the presenter, a print, or anything else', () => {
    expect(documentWindows(['main', 'nib-presenter', 'print-3', 'nib-', 'nib-2a'])).toBe(1)
    expect(documentWindows([])).toBe(0)
  })
})

/** On macOS 26 a key a row holds never reaches the page: the menu bar answers it
 *  first, so a Cmd+B typed into the sidebar's search field arrived as the Bold row
 *  and bolded the note behind the field. A row of the note's pressed by its key runs
 *  only while the note has the keyboard, which is when the editor's own keymap would
 *  have run it; a row of the window's runs from anywhere. */
describe('a row pressed by its key', () => {
  test('of the window’s runs wherever the keyboard is', () => {
    expect(keyRuns(true, 'note')).toBe(true)
    expect(keyRuns(true, 'page')).toBe(true)
    expect(keyRuns(true, 'away')).toBe(true)
  })

  test('of the note’s runs only while the note has the keyboard', () => {
    expect(keyRuns(false, 'note')).toBe(true)
    expect(keyRuns(false, 'page')).toBe(false)
    expect(keyRuns(false, 'away')).toBe(false)
  })
})

describe('a key a stand-in hands the page', () => {
  test('is the keystroke it names, by the key and by the character', () => {
    expect(keystrokeOf('Mod-Shift-z')).toEqual({
      key: 'z',
      code: 'KeyZ',
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      shiftKey: true,
    })
    expect(keystrokeOf('Mod-Alt-[')).toMatchObject({ key: '[', code: 'BracketLeft' })
    expect(keystrokeOf('Ctrl-Tab')).toMatchObject({ key: 'Tab', code: 'Tab' })
    expect(keystrokeOf('Mod-Space')).toMatchObject({ key: ' ', code: 'Space' })
  })

  /** It has to be the very key the page is waiting for. */
  test('is matched by the combination and read back as it', () => {
    for (const written of ['Mod-z', 'Mod-Shift-z', 'Mod-a', 'Mod-Alt-5', 'Mod-Shift-/', 'Mod--']) {
      const keystroke = keystrokeOf(written)
      if (!keystroke) throw new Error(`no keystroke for ${written}`)
      expect(matchesCombination(written, keystroke, 'mac')).toBe(true)
      expect(readCombination(keystroke, 'mac')).toBe(written)
    }
  })

  test('is nothing for a combination that cannot be read', () => {
    expect(keystrokeOf('')).toBeNull()
    expect(keystrokeOf('Hyper-k')).toBeNull()
  })
})

/** A Mac writes a menu's rows in title case in English, puts an ellipsis on the ones
 *  that ask for something before they act, and keeps finding in a submenu of Edit.
 *  The strip wrote the app's own sentence-case labels as they were, with none of it. */
describe('the words a Mac writes its menus in', () => {
  test('title case leaves the small words small, and the first and last never', () => {
    expect(titled('Bring all to front')).toBe('Bring All to Front')
    expect(titled('Paste as plain text')).toBe('Paste as Plain Text')
    expect(titled('Save as')).toBe('Save As')
    expect(titled('Zoom in')).toBe('Zoom In')
    expect(titled('Export as HTML without styles')).toBe('Export as HTML Without Styles')
  })

  test('and a word someone else spelled is left as it is', () => {
    expect(titled('Export as ePub')).toBe('Export as ePub')
    expect(titled('Present with reveal.js')).toBe('Present with reveal.js')
    expect(titled('Read-only')).toBe('Read-Only')
    expect(titled('Heading 1')).toBe('Heading 1')
  })

  test('in English the strip is in title case, and the notes keep their names', () => {
    const recent = [row('shopping list.md')]
    const file = menu(bar({ english: true, recent }), 'file')
    const opened = file.items.find((one) => one.kind === 'submenu')

    expect(read(file)).toContain('Close Note')
    expect(opened?.text).toBe('Open Recent')
    expect(opened?.kind === 'submenu' && read(opened)).toContain('shopping list.md')
    expect(read(menu(bar({ english: true }), 'window'))).toContain(
      '[BringAllToFront] Bring All to Front',
    )
  })

  test('and in any other language as the language writes it', () => {
    expect(read(menu(bar(), 'file'))).toContain('Close note')
  })

  test('a row that asks first ends in an ellipsis', () => {
    const groups = GROUPS.map((group) =>
      group.id === 'file'
        ? { ...group, rows: [row('Save as', 'app.save-as', { asks: true }), ...group.rows] }
        : group,
    )
    const file = menu(bar({ groups }), 'file')

    expect(read(file)).toContain('Save as…')
    expect(read(menu(bar(), 'nib'))).toContain('Settings…')
  })

  test('finding is a submenu of Edit, where the rows were', () => {
    const finding = [
      row('Find', 'edit.find', { asks: true }),
      row('Replace', 'edit.replace', { asks: true }),
      row('Find next', 'edit.find-next'),
      row('Find previous', 'edit.find-previous'),
    ]
    const groups = GROUPS.map((group) =>
      group.id === 'edit' ? { ...group, rows: [...group.rows, DIVIDER, ...finding] } : group,
    )
    const edit = menu(bar({ groups }), 'edit')
    const find = edit.items.at(-1)

    expect(find?.kind === 'submenu' && find.text).toBe('Find')
    expect(find?.kind === 'submenu' && read(find)).toEqual([
      'Find…',
      'Replace…',
      'Find next',
      'Find previous',
    ])
  })
})
