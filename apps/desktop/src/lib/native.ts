/** The crate, reached the one way a webview can reach it.
 *
 *  A module of its own for one reason. `@tauri-apps/api/core` holds the IPC every
 *  other part of that package is built on - the window, the events, the images, the
 *  webview - so five of its own modules import it outright, and a dynamic
 *  `import('@tauri-apps/api/core')` is therefore not a boundary at all: the bundler
 *  cannot move a module its own dependencies hold in place, and said so on every
 *  build. A door of nib's own is one it can move, because nothing but this file
 *  names the package.
 *
 *  Which matters most where the crate is never asked anything: a page in a browser
 *  answers the same commands out of its own storage, and there this module and the
 *  ten kilobytes of IPC behind it are not fetched at all. See tauri.ts, which is the
 *  only caller, and web/commands.ts, which is the other half of the same `invoke`. The
 *  one other thing taken from here is the channel a terminal's output streams down,
 *  and only by the terminal, which only a desktop has; see terminal/sessions.svelte.ts. */

export { Channel, invoke } from '@tauri-apps/api/core'
