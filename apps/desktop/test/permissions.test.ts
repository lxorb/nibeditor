import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Tauri denies anything the capability file does not grant, and a denied call
 *  rejects a promise nobody is awaiting - so the button simply does nothing.
 *  That is how `destroy` went missing and the close button stopped working.
 *
 *  `WindowLike` in `tauri.ts` is the whole set of window commands the app can
 *  reach, so it is the list to check against.
 *
 *  There are two capability files, one per kind of build, because the phone app
 *  is a smaller app: half the plugins are not compiled into it at all, and a
 *  permission for one that is not there fails the build outright. */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

interface Capability {
  platforms: string[]
  permissions: string[]
  /** The desktop capability names webviews; see the labels block below. */
  webviews?: string[]
  windows?: string[]
}

const capabilities = JSON.parse(read('../src-tauri/capabilities/default.json')) as Capability
const mobile = JSON.parse(read('../src-tauri/capabilities/mobile.json')) as Capability

/** Method name to the permission Tauri wants for it. Events are not commands
 *  and need nothing, so they are left out. */
const NEEDS: Record<string, string> = {
  minimize: 'core:window:allow-minimize',
  toggleMaximize: 'core:window:allow-toggle-maximize',
  isMaximized: 'core:window:allow-is-maximized',
  setFullscreen: 'core:window:allow-set-fullscreen',
  isFullscreen: 'core:window:allow-is-fullscreen',
  setAlwaysOnTop: 'core:window:allow-set-always-on-top',
  outerPosition: 'core:window:allow-outer-position',
  outerSize: 'core:window:allow-outer-size',
  scaleFactor: 'core:window:allow-scale-factor',
  close: 'core:window:allow-close',
  destroy: 'core:window:allow-destroy',
  setTitle: 'core:window:allow-set-title',
}

const EVENTS = new Set(['onCloseRequested', 'onResized'])

/** The window commands presenting calls, which do not go through `WindowLike`:
 *  the presenter's window is opened with the Tauri API directly, because it is
 *  a second window rather than this one. Each is the call as it is written in
 *  slides/presenter.ts, so a permission cannot outlive the code that needed it.
 *  See docs/slides.md. */
const PRESENTING: Record<string, string> = {
  'new WebviewWindow(': 'core:webview:allow-create-webview-window',
  'availableMonitors()': 'core:window:allow-available-monitors',
  'currentMonitor()': 'core:window:allow-current-monitor',
  'setFocus()': 'core:window:allow-set-focus',
}

/** The one webview command the Mac's menu bar calls, for the same reason as the
 *  list above: it is the Tauri API directly, on this window's own page. See
 *  native-menu-bar.svelte.ts. */
const MENU_BAR: Record<string, string> = {
  'getCurrentWebview()': 'core:webview:allow-set-webview-focus',
}

/** The same webview command, which does not go through `WindowLike` either: a window
 *  with a web tab in it holds several webviews, and this is the app's own taking the
 *  keyboard back from a page. Written as the calls are, in the file that makes them. */
const FOCUSING = {
  file: '../src/lib/web-tab/WebAsk.svelte',
  calls: ['getCurrentWebview()', '.setFocus()'],
  permission: 'core:webview:allow-set-webview-focus',
}

/** The method names declared on the `WindowLike` interface. */
function windowMethods(): string[] {
  const source = read('../src/lib/tauri.ts')
  const [, block] = /interface WindowLike \{([\s\S]*?)\n\}/.exec(source) ?? []
  if (block === undefined) throw new Error('WindowLike interface not found in tauri.ts')

  return [...block.matchAll(/^\s{2}(\w+)\(/gm)].map(([, name = '']) => name)
}

describe('window permissions', () => {
  test('the interface was actually found', () => {
    // Guards the test itself: a rename that empties this would pass silently.
    expect(windowMethods().length).toBeGreaterThan(5)
  })

  test('every window command the app can call is granted', () => {
    const missing = windowMethods()
      .filter((name) => !EVENTS.has(name))
      .filter((name) => !capabilities.permissions.includes(NEEDS[name] ?? `unmapped:${name}`))

    expect(missing, `ungranted or unmapped: ${missing.join(', ')}`).toEqual([])
  })

  test('every call presenting makes is granted, and it makes each of them', () => {
    const source = read('../src/lib/slides/presenter.ts')

    const missing = Object.entries(PRESENTING).filter(
      ([call, permission]) =>
        !source.includes(call) || !capabilities.permissions.includes(permission),
    )

    expect(missing.map(([call]) => call)).toEqual([])
  })

  test('every call the Mac menu bar makes is granted, and it makes each of them', () => {
    const source = read('../src/lib/native-menu-bar.svelte.ts')

    const missing = Object.entries(MENU_BAR).filter(
      ([call, permission]) =>
        !source.includes(call) || !capabilities.permissions.includes(permission),
    )

    expect(missing.map(([call]) => call)).toEqual([])
  })

  test('a site’s question takes the keyboard back, and is granted that', () => {
    const source = read(FOCUSING.file)

    expect(FOCUSING.calls.filter((call) => !source.includes(call))).toEqual([])
    expect(capabilities.permissions).toContain(FOCUSING.permission)
  })

  test('nothing is granted that the app never calls', () => {
    const used = new Set([
      ...Object.values(NEEDS),
      ...Object.values(PRESENTING),
      ...Object.values(MENU_BAR),
      FOCUSING.permission,
    ])
    const stale = capabilities.permissions
      .filter((one) => one.startsWith('core:window:') || one.startsWith('core:webview:allow-'))
      // Dragging comes from `data-tauri-drag-region`, not a method call.
      .filter((one) => one !== 'core:window:allow-start-dragging')
      .filter((one) => !used.has(one))

    expect(stale).toEqual([])
  })
})

/** The plugins the crate compiles only for a desktop, read out of the manifest
 *  so that moving one can never leave a permission for it behind. A permission
 *  named after a plugin that is not in the build is not a wasted line: Tauri
 *  refuses to build at all. */
function desktopOnlyPlugins(): string[] {
  const cargo = read('../src-tauri/Cargo.toml')
  const [, block] =
    /\[target\.'cfg\(any\(target_os = "windows".*\n([\s\S]*?)(?:\n\[|$)/.exec(cargo) ?? []
  if (block === undefined) throw new Error('no desktop-only dependencies in Cargo.toml')

  return [...block.matchAll(/^tauri-plugin-([a-z-]+)/gm)].map(([, name = '']) => name)
}

/** Exporting is the one feature that writes a file the reader named, and every
 *  byte of it goes through the app's own commands rather than through a plugin.
 *
 *  Not because the path is judged first: `paths::chosen` deliberately is not a
 *  bound - it checks that the string names a file at all and says so in its own
 *  doc, because a file worth editing is wherever it already is and the dialog is
 *  what chose it. What `notes::write_bytes` is for is the writing. It goes through
 *  `write_file`, which makes the folders the path needs and then hands the bytes to
 *  `paths::write_atomically`: a hidden temp file beside the target, flushed, then
 *  renamed over it, so a crash halfway through can never truncate the file that was
 *  already there. And it is one command - one call site in `export/save.ts`, one in
 *  the importer, one in the web shim - rather than a grant the whole window holds,
 *  so what the app writes is a list somebody can read to the end. The fs plugin
 *  offers neither: it writes where it is told, in place, from anywhere. */
describe('writing an export', () => {
  test('goes through the app’s own commands, so no build grants the fs plugin', () => {
    for (const [build, granted] of [
      ['desktop', capabilities.permissions],
      ['phone', mobile.permissions],
    ] as const) {
      expect(
        granted.filter((one) => one.startsWith('fs:')),
        `${build} grants the fs plugin`,
      ).toEqual([])
    }
  })

  test('writes bytes through a command the crate registers and the frontend calls', () => {
    expect(read('../src-tauri/src/lib.rs')).toContain('notes::write_bytes')
    expect(read('../src-tauri/src/notes.rs')).toContain('pub fn write_bytes')
    expect(read('../src/lib/export/save.ts')).toContain("invoke('write_bytes'")
  })

  /** And the reason it is a command of ours: the write is whole or it never
   *  happened. The plugin writes in place, which truncates the file it is replacing
   *  the moment it opens it. */
  test('and the write is atomic, which is what the plugin could not give it', () => {
    expect(read('../src-tauri/src/notes.rs')).toContain('write_atomically(target, bytes)')
    expect(read('../src-tauri/src/paths.rs')).toContain('fs::rename(&temp, target)')
  })

  test('asks the desktop where to save, which needs the save dialog', () => {
    expect(read('../src/lib/export/save.ts')).toContain("import('@tauri-apps/plugin-dialog')")
    expect(capabilities.permissions).toContain('dialog:allow-save')
  })

  test('shows the finished file in the file manager, which the opener covers', () => {
    expect(read('../src/lib/export/save.ts')).toContain('revealItemInDir')
    expect(capabilities.permissions).toContain('opener:default')
  })

  test('a phone writes into its own documents folder, since it has no dialog', () => {
    // No dialog and no file manager on a phone, so `deliver` takes neither road
    // there; see the comment at the top of save.ts.
    expect(read('../src/lib/export/save.ts')).toContain('spaces_root')
    expect(mobile.permissions.filter((one) => one.startsWith('dialog:'))).toEqual([])
  })
})

/** Looking for a new version is the one updater step that is not the plugin's
 *  command, because which stream an install follows decides which endpoint it
 *  looks at and only the builder in Rust takes endpoints. So the window calls a
 *  command of ours for the look and the plugin's own commands for the two steps
 *  after it; see src-tauri/src/updates.rs. */
describe('looking for a new version', () => {
  test('goes through the app’s own command, which needs no permission of its own', () => {
    expect(read('../src-tauri/src/lib.rs')).toContain('updates::check_update')
    expect(read('../src/lib/updater.ts')).toContain("invoke<unknown>('check_update'")
    expect(capabilities.permissions).not.toContain('updater:allow-check')
  })

  test('downloads and installs through the plugin, which is granted both', () => {
    expect(read('../src/lib/updater.ts')).toContain("import('@tauri-apps/plugin-updater')")
    expect(capabilities.permissions).toContain('updater:allow-download')
    expect(capabilities.permissions).toContain('updater:allow-install')
  })

  test('reads one endpoint per channel, the releases being the configured one', () => {
    const config = JSON.parse(read('../src-tauri/tauri.conf.json')) as {
      plugins: { updater: { endpoints: string[] } }
    }
    const { endpoints } = config.plugins.updater

    // Two endpoints in the list would mean the first that answers wins whatever
    // the channel says, since that is how the updater reads a list.
    expect(endpoints).toHaveLength(1)
    expect(endpoints[0]).not.toContain('/edge/')
    // And the other channel's is the crate's, where the choice is made.
    expect(read('../src-tauri/src/updates.rs')).toContain('/edge/')
  })
})

/** A capability is granted to the labels it names, and a webview whose label
 *  matches none of them is granted nothing: no event channel, no dragging, no
 *  close. New window opens a second one, so the labels `launch::new_window` hands
 *  out have to be in the list beside `main`.
 *
 *  Tauri matches a label against these as a glob, which is what `nib-[0-9]*`
 *  is: every label the counter can produce, and not `nib-presenter`, which is
 *  meant to have nothing.
 *
 *  Webviews, not windows, and the difference is a security one rather than a
 *  spelling: a capability that names a window grants every webview inside it
 *  whatever its own label says, and a web tab puts a website in a webview inside
 *  the app's window. The webview a `WebviewWindowBuilder` makes carries the
 *  window's label, so the two patterns cover the same two windows they always
 *  did. See src-tauri/src/web_tabs.rs and docs/web-tabs.md. */
describe('webview labels', () => {
  /** Which key the desktop capability grants by. A file that went back to naming
   *  windows would hand a site in a web tab the opener, the dialogs and the
   *  updater, and nothing else here would notice. */
  test('the desktop capability names webviews rather than windows', () => {
    expect(capabilities.webviews).toBeDefined()
    expect(capabilities.windows).toBeUndefined()
  })

  /** The label format string in `free_label`, which is what a second window is
   *  named after. Read out of the crate so a rename cannot leave this behind. */
  function labelShape(): string {
    const source = read('../src-tauri/src/launch.rs')
    const [, block] = /fn free_label\(([\s\S]*?)\n\}/.exec(source) ?? []
    const [, format] = /format!\("([^"]+)"/.exec(block ?? '') ?? []
    if (format === undefined) throw new Error('no window label format in free_label')

    return format
  }

  const matches = (pattern: string, label: string) =>
    new RegExp(`^${pattern.replace(/\[0-9\]/g, '\\d').replace(/\*/g, '.*')}$`).test(label)

  test('the label the crate hands out is covered', () => {
    // `nib-{counter}`, and the counter starts at 2 because `main` is the first.
    expect(labelShape()).toBe('nib-{}')

    for (const label of ['main', 'nib-2', 'nib-3', 'nib-17', 'nib-1000']) {
      expect(
        (capabilities.webviews ?? []).some((pattern) => matches(pattern, label)),
        `${label} is granted nothing`,
      ).toBe(true)
    }
  })

  test('the presenter window is granted nothing, because it calls nothing', () => {
    const label = /const LABEL = '([^']+)'/.exec(read('../src/lib/slides/presenter.ts'))?.[1]
    expect(label).toBe('nib-presenter')

    expect((capabilities.webviews ?? []).some((pattern) => matches(pattern, label ?? ''))).toBe(
      false,
    )
  })

  /** The phone has no child webviews - `add_child` is desktop only - so its file
   *  has nothing to tell apart and names its one window. */
  test('the phone has one window and names it', () => {
    expect(mobile.windows).toEqual(['main'])
  })
})

describe('phone permissions', () => {
  test('the two files divide the platforms between them', () => {
    expect([...capabilities.platforms].sort()).toEqual(['linux', 'macOS', 'windows'])
    expect([...mobile.platforms].sort()).toEqual(['android', 'iOS'])

    const both = mobile.platforms.filter((one) => capabilities.platforms.includes(one))
    expect(both, 'a platform in both files gets both sets of permissions').toEqual([])
  })

  test('the phone grants nothing for a plugin it does not have', () => {
    const plugins = desktopOnlyPlugins()
    // Guards the test: a rename upstream that emptied this would pass silently.
    expect(plugins).toContain('updater')

    const wrong = mobile.permissions.filter((one) =>
      plugins.some((plugin) => one.startsWith(`${plugin}:`)),
    )

    expect(wrong, `granted to a build without the plugin: ${wrong.join(', ')}`).toEqual([])
  })

  test('a link tapped in a note can still leave the app', () => {
    // The one call the phone build makes into a plugin, and the only reason it
    // has permissions of its own beyond core. Both are needed: the first allows
    // the command, the second says which addresses it may be given.
    expect(read('../src/lib/tauri.ts')).toContain('await openUrl(url)')
    expect(mobile.permissions).toContain('opener:allow-open-url')
    expect(mobile.permissions).toContain('opener:allow-default-urls')
  })

  test('the phone has no window commands, because it has no title bar', () => {
    const chrome = mobile.permissions.filter(
      (one) => one.startsWith('core:window:allow-') || one.startsWith('core:webview:allow-'),
    )

    expect(chrome).toEqual([])
  })
})
